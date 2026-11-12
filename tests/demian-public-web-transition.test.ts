import assert from "node:assert/strict";
import test from "node:test";
import {
  executePublicWebTransition,
  type PublicWebInspection,
  type PublicWebTransitionOptions,
  type PublicWebTransitionResult,
} from "../deploy/demian/public-web-transition.mjs";

// An interface without an index signature verifies generic identity support.
interface Identity { pid: number; receipt: string }
const rawError = new Error("private callback error details");

function fixture() {
  const original: Identity = { pid: 11, receipt: "original" };
  const candidate: Identity = { pid: 22, receipt: "same-operation" };
  const fallback: Identity = { pid: 33, receipt: "fallback" };
  const calls: string[] = [];
  const faults = new Set<string>();
  const recovered: Array<Identity | undefined> = [];
  const reports: PublicWebTransitionResult<Identity>[] = [];
  const states = new Map<number, PublicWebInspection>([
    [original.pid, { state: "owned-live" }],
    [candidate.pid, { state: "owned-live" }],
  ]);
  let preservation = 0;
  const step = (name: string) => {
    calls.push(name);
    if (faults.has(name)) throw rawError;
  };
  const options: PublicWebTransitionOptions<Identity> = {
    original,
    prepare: async () => { step("prepare"); },
    checkPreserved: async () => { step(`preserved-${++preservation}`); },
    inspect: async record => {
      assert.ok(record === original || record === candidate);
      step(`inspect-${record.pid}`);
      return states.get(record.pid)!;
    },
    journal: async (stage, record) => {
      if (stage === "stop-intent") assert.equal(record, original);
      if (stage === "commit-intent" || stage === "committed") {
        assert.equal(record, candidate);
      }
      step(stage);
    },
    stop: async record => {
      assert.equal(record, original);
      states.set(original.pid, { state: "exited-free" });
      step("stop");
    },
    startCandidate: async () => { step("start"); return candidate; },
    findCandidate: async () => { step("find"); return candidate; },
    verifyCandidate: async record => {
      assert.equal(record, candidate);
      step("verify");
    },
    commitCandidate: async record => {
      assert.equal(record, candidate);
      step("commit");
    },
    recover: async replacement => {
      recovered.push(replacement);
      step("recover");
      return {
        recoveredIdentity: fallback,
        activationFailed: false,
        recoveryFailed: false,
        metadataUpdateFailed: false,
      };
    },
    report: async result => { reports.push(result); step("report"); },
  };
  return { original, candidate, fallback, calls, faults, recovered, reports,
    states, options };
}

test("commits once in order, retaining the exact generic identity", async () => {
  const f = fixture();
  const result = await executePublicWebTransition(f.options);
  assert.deepEqual(result, {
    stage: "committed", committed: true, stopAttempted: true,
    journalFailed: false, reportFailed: false, replacement: f.candidate,
  });
  assert.equal(result.replacement, f.candidate);
  assert.deepEqual(f.calls, [
    "prepare", "preserved-1", "inspect-11", "stop-intent", "stop",
    "inspect-11", "start-intent", "start", "inspect-22", "verify",
    "preserved-2", "commit-intent", "commit", "preserved-3",
    "committed", "report",
  ]);
});

for (const fault of ["prepare", "preserved-1", "inspect-11", "stop-intent"]) {
  test(`${fault} failure leaves original untouched without recovery`, async () => {
    const f = fixture();
    f.faults.add(fault);
    const result = await executePublicWebTransition(f.options);
    assert.equal(result.stopAttempted, false);
    assert.equal(result.committed, false);
    assert.equal(result.failure, "transition-failed");
    assert.equal(result.journalFailed, fault === "stop-intent");
    assert.equal(f.calls.includes("stop"), false);
    assert.equal(f.calls.includes("start"), false);
    assert.deepEqual(f.recovered, []);
    assert.equal(JSON.stringify(f.reports).includes(rawError.message), false);
  });
}

test("lost stop output continues only after same original is exited-free", async () => {
  const f = fixture();
  f.faults.add("stop");
  assert.equal((await executePublicWebTransition(f.options)).committed, true);
  assert.equal(f.calls.filter(call => call === "stop").length, 1);
});

for (const state of ["foreign", "owned-live", "exited-occupied"] as const) {
  for (const throws of [false, true]) {
    test(`stop ${throws ? "throws" : "returns"} with ${state}: recover, never start`, async () => {
      const f = fixture();
      f.options.stop = async record => {
        assert.equal(record, f.original);
        f.states.set(record.pid, state === "exited-occupied"
          ? { state, listenerPid: 99 } : { state });
        if (throws) throw rawError;
      };
      const result = await executePublicWebTransition(f.options);
      assert.equal(result.stage, "inspect-stopped-original");
      assert.equal(result.stopAttempted, true);
      assert.equal(f.calls.includes("start"), false);
      assert.deepEqual(f.recovered, [undefined]);
    });
  }
}

test("non-owned original is rejected before stop intent", async () => {
  const f = fixture();
  f.states.set(f.original.pid, { state: "foreign" });
  const result = await executePublicWebTransition(f.options);
  assert.equal(result.stopAttempted, false);
  assert.equal(f.calls.includes("stop-intent"), false);
  assert.deepEqual(f.recovered, []);
});

for (const receipt of ["found", "missing", "throws"] as const) {
  test(`lost start output with ${receipt} receipt never repeats start`, async () => {
    const f = fixture();
    f.faults.add("start");
    if (receipt === "missing") f.options.findCandidate = async () => {
      f.calls.push("find"); return undefined;
    };
    if (receipt === "throws") f.faults.add("find");
    const result = await executePublicWebTransition(f.options);
    assert.equal(result.committed, receipt === "found");
    assert.equal(f.calls.filter(call => call === "start").length, 1);
    assert.equal(f.calls.filter(call => call === "find").length, 1);
    assert.deepEqual(f.recovered, receipt === "found" ? [] : [undefined]);
  });
}

for (const fault of [
  "start-intent", "inspect-22", "verify", "preserved-2", "commit-intent",
  "commit", "preserved-3",
]) {
  test(`${fault} failure recovers even after partial commit`, async () => {
    const f = fixture();
    f.faults.add(fault);
    const result = await executePublicWebTransition(f.options);
    assert.equal(result.committed, false);
    assert.equal(result.stopAttempted, true);
    assert.equal(result.failure, "transition-failed");
    assert.equal(result.journalFailed, fault.endsWith("intent"));
    assert.deepEqual(f.recovered, [
      fault === "start-intent" ? undefined : f.candidate,
    ]);
    assert.equal(result.recovery?.recoveredIdentity, f.fallback);
    assert.equal(f.calls.includes("committed"), false);
    assert.equal(f.reports.length, 1);
  });
}

test("foreign candidate is not verified or committed", async () => {
  const f = fixture();
  f.states.set(f.candidate.pid, { state: "foreign" });
  const result = await executePublicWebTransition(f.options);
  assert.equal(result.stage, "inspect-candidate");
  assert.deepEqual(f.recovered, [f.candidate]);
  assert.equal(f.calls.includes("verify"), false);
  assert.equal(f.calls.includes("commit"), false);
});

test("failed inspection after stop still invokes recovery", async () => {
  const f = fixture();
  const stop = f.options.stop;
  f.options.stop = async record => {
    await stop(record);
    f.faults.add("inspect-11");
    throw rawError;
  };
  const result = await executePublicWebTransition(f.options);
  assert.equal(result.stage, "inspect-stopped-original");
  assert.deepEqual(f.recovered, [undefined]);
  assert.equal(f.calls.includes("start"), false);
});

test("partially written commit is recovered with the exact candidate", async () => {
  const f = fixture();
  let published = f.original;
  f.options.commitCandidate = async record => {
    published = record;
    throw rawError;
  };
  const recover = f.options.recover;
  f.options.recover = async record => {
    assert.equal(published, f.candidate);
    assert.equal(record, f.candidate);
    const recovery = await recover(record);
    published = recovery.recoveredIdentity!;
    return recovery;
  };
  const result = await executePublicWebTransition(f.options);
  assert.equal(result.committed, false);
  assert.equal(published, f.fallback);
  assert.equal(result.recovery?.recoveredIdentity, f.fallback);
});

test("recovery flags remain independent and metadata failure retains identity", async () => {
  for (const activationFailed of [false, true]) {
    for (const recoveryFailed of [false, true]) {
      for (const metadataUpdateFailed of [false, true]) {
        const f = fixture();
        f.faults.add("commit");
        const recovery = { recoveredIdentity: f.fallback,
          activationFailed, recoveryFailed, metadataUpdateFailed };
        f.options.recover = async () => recovery;
        const result = await executePublicWebTransition(f.options);
        assert.deepEqual(result.recovery, recovery);
        assert.equal(result.recovery?.recoveredIdentity, f.fallback);
        assert.deepEqual(f.reports[0]?.recovery, recovery);
      }
    }
  }
});

test("recovery throw still reports failure without raw details", async () => {
  const f = fixture();
  f.faults.add("verify");
  f.faults.add("recover");
  f.faults.add("report");
  const result = await executePublicWebTransition(f.options);
  assert.deepEqual(result.recovery, {
    activationFailed: false, recoveryFailed: true, metadataUpdateFailed: false,
  });
  assert.equal(result.reportFailed, true);
  assert.equal(result.failure, "transition-failed");
  assert.equal(result.stage, "verify-candidate");
  assert.equal(JSON.stringify(result).includes(rawError.message), false);
  assert.equal(f.reports.length, 1);
});

for (const faults of [["committed"], ["report"], ["committed", "report"]]) {
  test(`postcommit ${faults.join(" + ")} failure never rolls back`, async () => {
    const f = fixture();
    faults.forEach(fault => f.faults.add(fault));
    const result = await executePublicWebTransition(f.options);
    assert.equal(result.committed, true);
    assert.equal(result.failure, "reporting-failed");
    assert.equal(result.journalFailed, faults.includes("committed"));
    assert.equal(result.reportFailed, faults.includes("report"));
    assert.deepEqual(f.recovered, []);
    assert.equal(f.calls.filter(call => call === "commit").length, 1);
    assert.equal(f.reports.length, 1);
  });
}

const invalidPids = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
for (const pid of invalidPids) {
  test(`invalid original PID ${pid} invokes no callbacks`, async () => {
    const f = fixture();
    f.options.original = { ...f.original, pid };
    const result = await executePublicWebTransition(f.options);
    assert.equal(result.failure, "invalid-original");
    assert.deepEqual(f.calls, []);
  });
}

for (const pid of [...invalidPids, 11]) {
  for (const fromReceipt of [false, true]) {
    test(`reject candidate PID ${pid} from ${fromReceipt ? "receipt" : "start"}`, async () => {
      const f = fixture();
      const invalid = { ...f.candidate, pid };
      if (fromReceipt) {
        f.faults.add("start");
        f.options.findCandidate = async () => invalid;
      } else f.options.startCandidate = async () => invalid;
      const result = await executePublicWebTransition(f.options);
      assert.equal(result.stage, "validate-candidate");
      assert.equal(result.replacement, undefined);
      assert.deepEqual(f.recovered, [undefined]);
      assert.equal(f.calls.includes("verify"), false);
    });
  }
}

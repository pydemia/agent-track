import assert from "node:assert/strict";
import test from "node:test";
import { recoverWebProfiles } from "../deploy/demian/recover-webs.mjs";

const originals = { local: { pid: 100 }, public: { pid: 200 } };
const replacements = { local: { pid: 1 }, public: { pid: 2 } };
const stopped = new Set<"local" | "public">(["local", "public"]);

test("a conflicting public listener does not prevent local recovery and metadata repair", async () => {
  const committed: Array<[string, number]> = [];
  const events: string[] = [];
  const result = await recoverWebProfiles({ originals, replacements, stopped,
    activateFallback: async () => { events.push("activation"); },
    stop: async record => { events.push("stop:" + record.pid); if (record.pid === 2) throw new Error("Foreign listener preserved"); },
    start: async profile => ({ pid: profile === "local" ? 11 : 22, entry: "frozen-original", startedAt: "fixture" }),
    inspectOriginal: async () => ({ exited: false }), commitProfile: async (profile, record) => { committed.push([profile, record.pid]); },
  });
  assert.equal(events[0], "activation");
  assert.deepEqual(committed, [["local", 11]]);
  assert.deepEqual(result.failedProfiles, ["public"]);
  assert.deepEqual(result.recoveredIdentities.local, { pid: 11, entry: "frozen-original", startedAt: "fixture" });
});

test("lost activation ownership preserves running replacements without destructive cleanup", async () => {
  let operations = 0;
  await assert.rejects(recoverWebProfiles({ originals, replacements, stopped,
    activateFallback: async () => { throw new Error("Activation ownership changed"); },
    stop: async () => { operations++; }, start: async () => { operations++; return { pid: 11 }; },
    inspectOriginal: async () => ({ exited: false }), commitProfile: async () => { operations++; },
  }), /ownership changed/);
  assert.equal(operations, 0);
});

test("a profile metadata failure retains both recovered identities and repairs its sibling", async () => {
  const attempted: string[] = [];
  const result = await recoverWebProfiles({ originals, replacements, stopped,
    activateFallback: async () => {}, stop: async () => {}, start: async profile => ({ pid: profile === "local" ? 11 : 22 }),
    inspectOriginal: async () => ({ exited: false }), commitProfile: async profile => { attempted.push(profile); if (profile === "local") throw new Error("Metadata conflict"); },
  });
  assert.deepEqual(attempted, ["local", "public"]);
  assert.deepEqual(result.metadataUpdateFailures, ["local"]);
  assert.deepEqual(result.recoveredIdentities, { local: { pid: 11 }, public: { pid: 22 } });
});

test("an exited replacement permits both original profiles to be restored", async () => {
  const result = await recoverWebProfiles({ originals, replacements, stopped,
    activateFallback: async () => {}, stop: async () => ({ exited: true, portFree: true }),
    start: async profile => ({ pid: profile === "local" ? 11 : 22 }), inspectOriginal: async () => ({ exited: false }), commitProfile: async () => {},
  });
  assert.deepEqual(result.failedProfiles, []); assert.deepEqual(result.metadataUpdateFailures, []);
  assert.deepEqual(result.recoveredIdentities, { local: { pid: 11 }, public: { pid: 22 } });
});

// Public recovery fixtures are entirely in-memory; no service or filesystem adapters.
import { recoverPublicWeb, type PublicWebInspection } from "../deploy/demian/recover-webs.mjs";

type PublicRecord = { pid: number; identity: string };
function publicFixture() {
  const original: PublicRecord = { pid: 200, identity: "frozen" };
  const replacement: PublicRecord = { pid: 201, identity: "candidate" };
  const fallback: PublicRecord = { pid: 202, identity: "frozen-restarted" };
  const events: string[] = [];
  const states = new Map<number, PublicWebInspection>([
    [original.pid, { state: "exited-occupied", listenerPid: replacement.pid }],
    [replacement.pid, { state: "owned-live" }],
  ]);
  const options = {
    original,
    replacement: replacement as PublicRecord | undefined,
    activateFallback: async () => { events.push("activation"); },
    journalIntent: async (record: PublicRecord) => { events.push(`journal:${record.pid}`); },
    inspect: async (record: PublicRecord): Promise<PublicWebInspection> => {
      assert.ok(record === original || record === replacement || record === fallback);
      events.push(`inspect:${record.pid}`);
      return states.get(record.pid)!;
    },
    stop: async (record: PublicRecord) => {
      assert.equal(record, replacement);
      events.push(`stop:${record.pid}`);
      states.set(record.pid, { state: "exited-free" });
      states.set(original.pid, { state: "exited-free" });
    },
    startFrozenFallback: async () => { events.push("start:frozen"); states.set(fallback.pid, { state: "owned-live" }); return fallback; },
    commitPublic: async (record: PublicRecord) => { events.push(`commit:${record.pid}`); },
  };
  return { options, events, states, original, replacement, fallback };
}

test("public-only recovery journals before stopping and commits the frozen fallback", async () => {
  const f = publicFixture();
  const result = await recoverPublicWeb(f.options);
  assert.deepEqual(result, { recoveredIdentity: f.fallback, activationFailed: false, recoveryFailed: false, metadataUpdateFailed: false });
  assert.deepEqual(f.events, ["activation", "inspect:200", "inspect:201", "journal:201", "inspect:201", "stop:201", "inspect:201", "inspect:200", "start:frozen", "inspect:202", "commit:202"]);
});

test("activation conflict is independent of frozen service recovery", async () => {
  const f = publicFixture();
  f.options.activateFallback = async () => { throw "sensitive raw activation error"; };
  assert.deepEqual(await recoverPublicWeb(f.options), { recoveredIdentity: f.fallback, activationFailed: true, recoveryFailed: false, metadataUpdateFailed: false });
});

test("successful stop with lost output is reconciled once using the same record", async () => {
  const f = publicFixture();
  const stop = f.options.stop;
  f.options.stop = async record => { await stop(record); throw new Error("lost output"); };
  const result = await recoverPublicWeb(f.options);
  assert.equal(result.recoveredIdentity, f.fallback);
  assert.equal(f.events.filter(event => event === "stop:201").length, 1);
});

for (const target of ["original", "replacement"] as const) {
  test(`foreign ${target} prevents every stop and start`, async () => {
    const f = publicFixture();
    f.states.set(f[target].pid, { state: "foreign" });
    const result = await recoverPublicWeb(f.options);
    assert.equal(result.recoveryFailed, true);
    assert.equal(result.recoveredIdentity, undefined);
    assert.ok(!f.events.some(event => /^(stop|start|commit):/.test(event)));
  });
}

test("PID replacement during journal is preserved", async () => {
  const f = publicFixture();
  f.options.journalIntent = async () => { f.states.set(f.replacement.pid, { state: "foreign" }); };
  assert.equal((await recoverPublicWeb(f.options)).recoveryFailed, true);
  assert.ok(!f.events.some(event => /^(stop|start|commit):/.test(event)));
});

for (const state of ["owned-live", "foreign"] as const) {
  test(`stop error followed by ${state} never retries or starts fallback`, async () => {
    const f = publicFixture();
    let stops = 0;
    f.options.stop = async record => { stops++; f.states.set(record.pid, { state }); throw "private stop error"; };
    assert.deepEqual(await recoverPublicWeb(f.options), { activationFailed: false, recoveryFailed: true, metadataUpdateFailed: false });
    assert.equal(stops, 1);
    assert.ok(!f.events.includes("start:frozen"));
  });
}

test("exited original without any stop receipt starts only after fresh free-port inspection", async () => {
  const f = publicFixture();
  f.options.replacement = undefined;
  f.states.set(f.original.pid, { state: "exited-free" });
  assert.equal((await recoverPublicWeb(f.options)).recoveredIdentity, f.fallback);
  assert.deepEqual(f.events, ["activation", "inspect:200", "inspect:200", "start:frozen", "inspect:202", "commit:202"]);
});

test("owned live original is retained without a duplicate start", async () => {
  const f = publicFixture();
  f.options.replacement = undefined;
  f.states.set(f.original.pid, { state: "owned-live" });
  assert.equal((await recoverPublicWeb(f.options)).recoveredIdentity, f.original);
  assert.ok(!f.events.includes("start:frozen"));
});

test("metadata failure preserves recovered identity and independent activation failure", async () => {
  const f = publicFixture();
  f.options.activateFallback = async () => { throw new Error("activation"); };
  f.options.commitPublic = async () => { throw new Error("metadata"); };
  assert.deepEqual(await recoverPublicWeb(f.options), { recoveredIdentity: f.fallback, activationFailed: true, recoveryFailed: false, metadataUpdateFailed: true });
});

test("journal failure prevents stop and fallback start", async () => {
  const f = publicFixture();
  f.options.journalIntent = async () => { throw new Error("journal"); };
  assert.equal((await recoverPublicWeb(f.options)).recoveryFailed, true);
  assert.ok(!f.events.some(event => /^(stop|start|commit):/.test(event)));
});

for (const pid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  for (const target of ["original", "replacement"] as const) {
    test(`invalid ${target} PID ${pid} fails before callbacks`, async () => {
      const f = publicFixture();
      f[target].pid = pid;
      assert.deepEqual(await recoverPublicWeb(f.options), { activationFailed: false, recoveryFailed: true, metadataUpdateFailed: false });
      assert.deepEqual(f.events, []);
    });
  }
}

test("same-PID lifecycle ambiguity fails without callbacks", async () => {
  const f = publicFixture();
  f.replacement.pid = f.original.pid;
  assert.equal((await recoverPublicWeb(f.options)).recoveryFailed, true);
  assert.deepEqual(f.events, []);
});

test("a foreign listener appearing before start is preserved", async () => {
  const f = publicFixture();
  const stop = f.options.stop;
  f.options.stop = async record => { await stop(record); f.states.set(f.original.pid, { state: "foreign" }); };
  assert.equal((await recoverPublicWeb(f.options)).recoveryFailed, true);
  assert.ok(!f.events.includes("start:frozen"));
});

test("invalid fallback identity is not committed", async () => {
  const f = publicFixture();
  f.fallback.pid = 0;
  assert.equal((await recoverPublicWeb(f.options)).recoveryFailed, true);
  assert.ok(!f.events.some(event => event.startsWith("commit:")));
});

test("a successful stop receipt cannot override live inspection", async () => {
  const f = publicFixture();
  f.options.stop = async () => {};
  assert.equal((await recoverPublicWeb(f.options)).recoveryFailed, true);
  assert.ok(!f.events.includes("start:frozen"));
});

test("an already exited replacement needs no stop or journal", async () => {
  const f = publicFixture();
  f.states.set(f.replacement.pid, { state: "exited-free" });
  f.states.set(f.original.pid, { state: "exited-free" });
  assert.equal((await recoverPublicWeb(f.options)).recoveredIdentity, f.fallback);
  assert.ok(!f.events.some(event => /^(stop|journal):/.test(event)));
});

test("an exited original occupied by an unknown listener never authorizes stopping the candidate", async () => {
  const f = publicFixture();
  f.states.set(f.original.pid, { state: "exited-occupied", listenerPid: 999 });
  assert.equal((await recoverPublicWeb(f.options)).recoveryFailed, true);
  assert.ok(!f.events.some(event => /^(stop|start|commit):/.test(event)));
});

test("an exited candidate referencing the verified live original permits retaining that original", async () => {
  const f = publicFixture();
  f.states.set(f.original.pid, { state: "owned-live" });
  f.states.set(f.replacement.pid, { state: "exited-occupied", listenerPid: f.original.pid });
  assert.equal((await recoverPublicWeb(f.options)).recoveredIdentity, f.original);
  assert.ok(!f.events.some(event => /^(stop|start):/.test(event)));
});

test("inspection failure fails closed without exposing raw errors", async () => {
  const f = publicFixture();
  f.options.inspect = async () => { throw "private inspection details"; };
  assert.deepEqual(await recoverPublicWeb(f.options), { activationFailed: false, recoveryFailed: true, metadataUpdateFailed: false });
  assert.ok(!f.events.some(event => /^(stop|start|commit):/.test(event)));
});

test("frozen start failure reports recovery failure independently of activation", async () => {
  const f = publicFixture();
  f.options.activateFallback = async () => { throw "activation details"; };
  f.options.startFrozenFallback = async () => { throw "start details"; };
  assert.deepEqual(await recoverPublicWeb(f.options), { activationFailed: true, recoveryFailed: true, metadataUpdateFailed: false });
  assert.ok(!f.events.some(event => event.startsWith("commit:")));
});

test("a fallback PID without verified live public ownership is never committed", async () => {
  const f = publicFixture();
  f.options.startFrozenFallback = async () => {
    f.states.set(f.fallback.pid, { state: "foreign" });
    return f.fallback;
  };
  assert.equal((await recoverPublicWeb(f.options)).recoveryFailed, true);
  assert.ok(!f.events.some(event => event.startsWith("commit:")));
});

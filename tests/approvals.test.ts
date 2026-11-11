import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { CommandError } from "../packages/commands/index.ts";
import { externalKey, type ApprovalRequest, type PermissionView } from "../packages/contracts/index.ts";
import { ApprovalService, type ApprovalObservation, type ApprovalPorts } from "../packages/approvals/index.ts";
import { Store } from "../packages/storage/store.ts";
import { mergeApprovalReceipts } from "../packages/projection/approval-receipts.ts";

const now = Date.parse("2026-11-11T10:00:00.000Z");
const sourceId = "native-source";
const runId = "11111111-1111-4111-8111-111111111111";
const permissionId = "22222222-2222-4222-8222-222222222222";
const runKey = externalKey(sourceId, runId);
const fingerprint = "a".repeat(64);
const requestId = "33333333-3333-4333-8333-333333333333";

function permission(overrides: Partial<PermissionView> = {}): PermissionView {
  return { id: permissionId, runId, callId: "call-1", tool: "shell",
    status: "pending", decision: null, createdAt: new Date(now - 10_000).toISOString(),
    resolvedAt: null, expiresAt: new Date(now + 60_000).toISOString(), fingerprint, ...overrides };
}
function observation(overrides: Partial<ApprovalObservation> = {}): ApprovalObservation {
  return { sourceId, runId, runStatus: "waiting_for_permission", permission: permission(), ...overrides };
}
function request(id = requestId, overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return { id, runKey, permissionId, fingerprint, decision: "allow_once",
    expiresAt: new Date(now + 30_000).toISOString(), ...overrides };
}
function ports(overrides: Partial<ApprovalPorts> = {}) {
  const calls: string[] = [];
  let current = observation();
  const native: ApprovalPorts = {
    async authorize() { calls.push("authorize"); },
    async read(id) { calls.push(`read:${id}`); return current; },
    async decide(id, decision) {
      calls.push(`decide:${id}:${decision}`);
      current = observation({ permission: permission({ status: "resolved", decision,
        resolvedAt: new Date(now).toISOString() }) });
      return current;
    },
    now: () => now,
    ...overrides,
  };
  return { native, calls, set(value: ApprovalObservation) { current = value; } };
}
function memory() {
  const store = new Store(":memory:");
  return { store, service: new ApprovalService(store) };
}
function tempDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "agent-track-approvals-"));
  const path = join(dir, "approvals.sqlite");
  return { path, cleanup() { rmSync(dir, { recursive: true, force: true }); } };
}

test("online backup preserves confirmed and unknown approval receipts without dispatch on replay", async () => {
  const temporary = tempDatabase(); const store = new Store(temporary.path);
  try {
    const service = new ApprovalService(store);
    const confirmed = await service.execute("alice", request(), ports().native);
    const otherId = "44444444-4444-4444-8444-444444444444";
    const otherPermission = "55555555-5555-4555-8555-555555555555";
    const input = request(otherId, { permissionId: otherPermission });
    const flaky = ports({ async read() { return observation({ permission: permission({ id: otherPermission }) }); }, async decide() { throw new Error("lost reply"); } });
    const unknown = await service.execute("alice", input, flaky.native); assert.equal(unknown.state, "unknown");
    await backup(store.db, temporary.path + ".backup");
    const restored = new Store(temporary.path + ".backup");
    try {
      const recovered = new ApprovalService(restored); assert.equal(restored.integrity(), "ok"); assert.equal(recovered.recoverInterrupted(), 0);
      const observer = ports();
      assert.deepEqual(await recovered.execute("alice", request(), observer.native), confirmed);
      assert.deepEqual(await recovered.execute("alice", input, observer.native), unknown);
      assert.equal(observer.calls.some((call) => call.startsWith("decide:")), false);
      assert.equal(recovered.list("alice", runKey).length, 2);
    } finally { restored.close(); }
  } finally { store.close(); temporary.cleanup(); }
});

test("resolved native decisions remain confirmed after the original request expiry", async () => {
  const { store, service } = memory();
  try {
    const unreliable = ports({ async decide() { throw new Error("lost reply"); } });
    assert.equal((await service.execute("alice", request(), unreliable.native)).state, "unknown");
    const observer = ports({ now: () => now + 90_000 });
    observer.set(observation({ permission: permission({ status: "resolved", decision: "allow_once", resolvedAt: new Date(now).toISOString() }) }));
    const result = await service.reconcile("alice", requestId, observer.native);
    assert.equal(result.state, "succeeded"); assert.match(result.detail, /attribution_unknown/);
  } finally { store.close(); }
});

test("an older pending observation cannot overwrite a concurrently confirmed decision", async () => {
  const { store, service } = memory();
  let release!: () => void;
  try {
    await service.execute("alice", request(), ports({ async decide() { throw new Error("lost reply"); } }).native);
    let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = ports({ async read() { entered(); await gate; return observation(); } });
    const older = service.reconcile("alice", requestId, slow.native); await waiting;
    const fresh = ports(); fresh.set(observation({ permission: permission({ status: "resolved", decision: "allow_once", resolvedAt: new Date(now).toISOString() }) }));
    const confirmed = await service.reconcile("alice", requestId, fresh.native);
    release(); assert.deepEqual(await older, confirmed);
    const stale = { ...confirmed, state: "unknown" as const, updatedAt: new Date(Date.parse(confirmed.updatedAt) - 1000).toISOString() };
    assert.deepEqual(mergeApprovalReceipts([confirmed], [stale]), [confirmed]);
    assert.deepEqual(mergeApprovalReceipts([stale], [confirmed]), [confirmed]);
  } finally { release?.(); store.close(); }
});

test("strict request schema, duplicate replay, conflict, and actor scope", async () => {
  const { store, service } = memory();
  try {
    const native = ports();
    const first = await service.execute("alice", request(), native.native);
    assert.deepEqual(await service.execute("alice", request(), native.native), first);
    assert.equal(native.calls.filter((call) => call.startsWith("decide:")).length, 1);
    await assert.rejects(service.execute("alice", request(requestId, { decision: "deny" }), native.native),
      (error: unknown) => error instanceof CommandError && error.code === "idempotency_conflict");
    assert.deepEqual(service.list("bob", runKey), []);
    const bob = await service.execute("bob", request(), ports().native);
    assert.equal(bob.id, first.id);
    assert.equal(service.list("alice", runKey).length, 1);
    assert.equal(service.list("bob", runKey).length, 1);
    assert.equal(JSON.stringify(service.list("alice", runKey)).includes("reviewText"), false);
    await assert.rejects(service.execute("alice", { ...request(), reviewText: "secret" }, native.native),
      (error: unknown) => error instanceof CommandError && error.code === "invalid_approval");
  } finally { store.close(); }
});

test("BEGIN IMMEDIATE election blocks concurrent distinct IDs and contradictory decisions", async () => {
  const { store, service } = memory();
  try {
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let dispatches = 0;
    const slow = ports({ async decide() { dispatches++; entered(); await gate; return observation({
      permission: permission({ status: "resolved", decision: "allow_once" }),
    }); } });
    const first = service.execute("alice", request(), slow.native);
    await enteredPromise;
    await assert.rejects(service.execute("alice", request("44444444-4444-4444-8444-444444444444", {
      decision: "deny",
    }), ports().native), (error: unknown) => error instanceof CommandError && error.code === "approval_pending");
    release();
    assert.equal((await first).state, "succeeded");
    assert.equal(dispatches, 1);
  } finally { store.close(); }
});

test("source, permission identity, and reviewed fingerprint are checked before dispatch", async () => {
  const { store, service } = memory();
  try {
    for (const [id, value] of [
      ["44444444-4444-4444-8444-444444444444", observation({ sourceId: "other-source" })],
      ["55555555-5555-4555-8555-555555555555", observation({ permission: permission({ id: "66666666-6666-4666-8666-666666666666" }) })],
      ["77777777-7777-4777-8777-777777777777", observation({ permission: permission({ fingerprint: "b".repeat(64) }) })],
    ] as const) {
      const native = ports(); native.set(value);
      const receipt = await service.execute("alice", request(id), native.native);
      assert.equal(receipt.state, "failed");
      assert.equal(native.calls.some((call) => call.startsWith("decide:")), false);
    }
  } finally { store.close(); }
});

test("deadline is checked after awaited authorization and expired native permission is not dispatched", async () => {
  const { store, service } = memory();
  try {
    let clock = now;
    let authorizations = 0;
    const lateAuth = ports({ now: () => clock, async authorize() {
      authorizations++;
      if (authorizations === 2) clock = now + 31_000;
    } });
    assert.equal((await service.execute("alice", request(), lateAuth.native)).state, "expired");
    assert.equal(lateAuth.calls.some((call) => call.startsWith("decide:")), false);

    const nativeExpired = ports({ now: () => now + 61_000 });
    assert.equal((await service.execute("bob", request("44444444-4444-4444-8444-444444444444"), nativeExpired.native)).state, "expired");
    assert.equal(nativeExpired.calls.some((call) => call.startsWith("decide:")), false);
  } finally { store.close(); }
});

test("revoked access after read and terminal Run fail without a native write", async () => {
  const { store, service } = memory();
  try {
    let checks = 0;
    const revoked = ports({ async authorize() { if (++checks === 2) throw Error("private transport secret"); } });
    assert.equal((await service.execute("alice", request(), revoked.native)).state, "failed");
    assert.equal(revoked.calls.some((call) => call.startsWith("decide:")), false);
    assert.doesNotMatch(JSON.stringify(service.list("alice", runKey)), /private transport secret/);

    const terminal = ports({ async read() { return observation({ runStatus: "succeeded" }); } });
    assert.equal((await service.execute("bob", request("44444444-4444-4444-8444-444444444444"), terminal.native)).state, "failed");
    assert.equal(terminal.calls.some((call) => call.startsWith("decide:")), false);
  } finally { store.close(); }
});

test("native decision acknowledgment is separate from tool Run completion", async () => {
  const { store, service } = memory();
  try {
    const native = ports({ async decide(id, decision) {
      return observation({ runStatus: "running", permission: permission({ status: "resolved", decision,
        resolvedAt: new Date(now).toISOString() }) });
    } });
    const receipt = await service.execute("alice", request(), native.native);
    assert.equal(receipt.state, "succeeded");
    assert.equal(receipt.detail, "native_permission_decision_recorded");
    assert.equal(receipt.detail.includes("Run succeeded"), false);
  } finally { store.close(); }
});

test("timeout or malformed native reply stays unknown; restart recovery and reconcile never resend", async () => {
  const db = tempDatabase();
  let store = new Store(db.path);
  try {
    let service = new ApprovalService(store);
    const timedOut = ports({ async decide() { throw new Error("secret timeout details"); } });
    const first = await service.execute("alice", request(), timedOut.native);
    assert.equal(first.state, "unknown");
    let mismatchDispatches = 0;
    const mismatch = ports({ async decide() { mismatchDispatches++; return observation({ sourceId: "wrong-source",
      permission: permission({ status: "resolved", decision: "allow_once" }) }); } });
    const second = await service.execute("bob", request("44444444-4444-4444-8444-444444444444"), mismatch.native);
    assert.equal(second.state, "unknown");
    assert.equal(mismatchDispatches, 1);
    assert.doesNotMatch(JSON.stringify(service.list("alice", runKey)), /secret timeout details/);

    const interruptedId = "55555555-5555-4555-8555-555555555555";
    const interrupted = ports({ async decide() { throw new Error("ambiguous"); } });
    await service.execute("carol", request(interruptedId), interrupted.native);
    // Simulate a process interruption after the durable dispatch marker.
    store.db.prepare("UPDATE approval_receipts SET payload=json_set(payload,'$.receipt.state','dispatching') WHERE actor=? AND id=?")
      .run("carol", interruptedId);
    store.close();
    store = new Store(db.path);
    service = new ApprovalService(store);
    assert.equal(service.recoverInterrupted(), 1);
    const before = service.list("carol", runKey)[0];
    const reconcilePorts = ports({ async read() { return observation({ permission: permission({ status: "resolved",
      decision: "allow_once", resolvedAt: new Date(now).toISOString() }) }); } });
    const reconciled = await service.reconcile("carol", interruptedId, reconcilePorts.native);
    assert.equal(reconciled.state, "succeeded");
    assert.equal(reconciled.detail, "runtime_resolution_observed_attribution_unknown");
    assert.equal(reconcilePorts.calls.some((call) => call.startsWith("decide:")), false);
    assert.equal(before?.state, "unknown");
  } finally {
    store.close();
    db.cleanup();
  }
});

test("reconcile reads and reauthorizes, records conflicting resolution as failed", async () => {
  const { store, service } = memory();
  try {
    const timeout = ports({ async decide() { throw Error("timeout"); } });
    await service.execute("alice", request(), timeout.native);
    const conflicting = ports();
    conflicting.set(observation({ permission: permission({ status: "resolved",
      decision: "deny", resolvedAt: new Date(now).toISOString() }) }));
    const receipt = await service.reconcile("alice", requestId, conflicting.native);
    assert.equal(receipt.state, "failed");
    assert.deepEqual(conflicting.calls.slice(0, 3), ["authorize", `read:${permissionId}`, "authorize"]);
    assert.equal(conflicting.calls.some((call) => call.startsWith("decide:")), false);
  } finally { store.close(); }
});

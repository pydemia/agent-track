import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandError, CommandService, cancelInputSchema, type CancelPorts } from "../packages/commands/index.ts";
import { Store } from "../packages/storage/store.ts";

const now = Date.parse("2026-11-11T10:00:00.000Z");
const sourceId = "source-a";
const runId = "tracked-run-key";
const runKey = Buffer.from(JSON.stringify([sourceId, runId])).toString("base64url");
function input(id = "11111111-1111-4111-8111-111111111111", extras: Record<string, unknown> = {}) {
  return { kind: "cancel", runKey, idempotencyKey: id,
    expectedCursor: "7", expiresAt: new Date(now + 30_000).toISOString(), ...extras };
}
function ports(overrides: Partial<CancelPorts> = {}): CancelPorts & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async authorize() { calls.push("authorize"); },
    async readRun() { calls.push("readRun"); return { sourceId, runId, status: "running", cursor: "7" }; },
    async cancel(id) { calls.push(`cancel:${id}`); return { sourceId, runId: id, status: "cancelling" }; },
    now: () => now,
    ...overrides,
  };
}
function setup(path = ":memory:") {
  const store = new Store(path);
  return { store, service: new CommandService(store) };
}

test("strict cancel schema rejects unsupported commands and extra fields", () => {
  assert.equal(cancelInputSchema.safeParse(input()).success, true);
  assert.equal(cancelInputSchema.safeParse(input(undefined, { kind: "resume" })).success, false);
  assert.equal(cancelInputSchema.safeParse({ ...input(), sourceBody: "private" }).success, false);
});

test("duplicate returns the same receipt without dispatch; conflicting input fails", async () => {
  const { store, service } = setup();
  const native = ports();
  const first = await service.execute("alice", input(), native);
  const again = await service.execute("alice", input(), native);
  assert.deepEqual(again, first);
  assert.equal(native.calls.filter((call) => call.startsWith("cancel:")).length, 1);
  await assert.rejects(() => service.execute("alice", input(undefined, { expectedCursor: "8" }), native),
    (error: unknown) => error instanceof CommandError && error.code === "idempotency_conflict");
  assert.equal(service.list("alice", runKey).length, 1);
  store.close();
});

test("concurrent identical requests elect one dispatcher", async () => {
  const { store, service } = setup();
  const native = ports();
  const results = await Promise.all([
    service.execute("alice", input(), native),
    service.execute("alice", input(), native),
  ]);
  assert.equal(results[0]?.id, results[1]?.id);
  assert.equal(service.list("alice", runKey)[0]?.state, "accepted");
  assert.equal(native.calls.filter((call) => call.startsWith("cancel:")).length, 1);
  store.close();
});

test("receipt access and idempotency are actor scoped", async () => {
  const { store, service } = setup();
  const a = await service.execute("alice", input(), ports());
  assert.deepEqual(service.list("bob", runKey), []);
  const b = await service.execute("bob", input(), ports());
  assert.notEqual(a.actor, b.actor);
  assert.equal(service.list("alice", runKey).length, 1);
  assert.equal(service.list("bob", runKey).length, 1);
  store.close();
});

test("different command UUIDs for the same actor and Run cannot dispatch concurrently or after an unknown outcome", async () => {
  const { store, service } = setup();
  const native = ports({ async cancel() { throw new Error("ambiguous transport"); } });
  const results = await Promise.allSettled([
    service.execute("alice", input(), native),
    service.execute("alice", input("22222222-2222-4222-8222-222222222222"), native),
  ]);
  assert.equal(results[0]!.status, "fulfilled");
  assert.equal(results[1]!.status, "rejected");
  if (results[1]!.status === "rejected") assert.equal((results[1].reason as CommandError).code, "cancel_pending");
  assert.equal(service.list("alice", runKey).length, 1);
  assert.equal(service.list("alice", runKey)[0]!.state, "unknown");
  await assert.rejects(() => service.execute("alice", input("33333333-3333-4333-8333-333333333333"), native),
    (error: unknown) => error instanceof CommandError && error.code === "cancel_pending");
  assert.equal(native.calls.filter((call) => call === "readRun").length, 1);
  store.close();
});

test("authorization revoked after snapshot persists failure without dispatch", async () => {
  const { store, service } = setup();
  let checks = 0;
  const native = ports({ async authorize() { checks++; if (checks === 2) throw Error("secret source failure"); } });
  await assert.rejects(() => service.execute("alice", input(), native),
    (error: unknown) => error instanceof CommandError && error.status === 403);
  assert.equal(native.calls.some((call) => call.startsWith("cancel:")), false);
  const [receipt] = service.list("alice", runKey);
  assert.equal(receipt?.state, "failed");
  assert.doesNotMatch(JSON.stringify(receipt), /secret source failure/);
  store.close();
});

test("stale cursor and expired deadline create receipts without dispatch", async () => {
  const { store, service } = setup();
  const stale = ports({ async readRun() { return { sourceId, runId, status: "running", cursor: "8" }; } });
  assert.equal((await service.execute("alice", input(), stale)).state, "failed");
  assert.equal(stale.calls.some((call) => call.startsWith("cancel:")), false);

  const expired = ports();
  assert.equal((await service.execute("alice", input("22222222-2222-4222-8222-222222222222", {
    expiresAt: new Date(now).toISOString(),
  }), expired)).state, "expired");
  assert.equal(expired.calls.includes("readRun"), false);
  assert.equal(expired.calls.some((call) => call.startsWith("cancel:")), false);
  store.close();
});

test("deadline beyond 120 seconds is rejected before source I/O", async () => {
  const { store, service } = setup();
  const native = ports();
  await assert.rejects(() => service.execute("alice", input(undefined, {
    expiresAt: new Date(now + 120_001).toISOString(),
  }), native), (error: unknown) => error instanceof CommandError && error.code === "invalid_deadline");
  assert.equal(native.calls.filter((call) => call === "readRun").length, 0);
  store.close();
});
test("deadline is rechecked after an awaited source observation", async () => {
  const { store, service } = setup();
  let clock = now;
  const native = ports({ now: () => clock, async readRun() {
    clock += 31_000;
    return { sourceId, runId, status: "running", cursor: "7" };
  } });
  assert.equal((await service.execute("alice", input(), native)).state, "expired");
  assert.equal(native.calls.some((call) => call.startsWith("cancel:")), false);
  store.close();
});

test("cancelling is accepted, not completed; cancelled observation is success", async () => {
  const { store, service } = setup();
  const accepted = await service.execute("alice", input(), ports());
  assert.equal(accepted.state, "accepted");
  const completed = await service.execute("bob", input(), ports({
    async cancel(id) { return { sourceId, runId: id, status: "cancelled" }; },
  }));
  assert.equal(completed.state, "succeeded");
  const already = await service.execute("carol", input(), ports({
    async readRun() { return { sourceId, runId, status: "cancelled", cursor: "7" }; },
  }));
  assert.equal(already.state, "succeeded");
  assert.match(already.detail ?? "", /already cancelled/);
  store.close();
});

test("wrong Run response and transport timeout remain unknown and never replay", async () => {
  const { store, service } = setup();
  let sends = 0;
  const mismatched = await service.execute("alice", input(), ports({
    async cancel() { sends++; return { sourceId, runId: "other-run", status: "cancelled" }; },
  }));
  assert.equal(mismatched.state, "unknown");
  const timedOut = ports({ async cancel() { sends++; throw Error("secret timeout details"); } });
  const first = await service.execute("bob", input(), timedOut);
  const replay = await service.execute("bob", input(), timedOut);
  assert.equal(first.state, "unknown");
  assert.deepEqual(replay, first);
  assert.equal(sends, 2);
  assert.doesNotMatch(JSON.stringify(first), /secret timeout details/);
  store.close();
});

test("restart recovery converts pending and accepted receipts to unknown without I/O", async () => {
  const dir = mkdtempSync(join(tmpdir(), "track-command-"));
  const path = join(dir, "journal.sqlite");
  try {
    let { store, service } = setup(path);
    const accepted = await service.execute("alice", input(), ports());
    store.db.prepare("UPDATE receipts SET state='dispatching' WHERE actor='alice'").run();
    store.close();

    ({ store, service } = setup(path));
    assert.equal(service.recoverInterrupted(), 1);
    const recovered = service.list("alice", runKey);
    assert.equal(recovered[0]?.state, "unknown");
    assert.match(recovered[0]?.detail ?? "", /restarted/);
    assert.equal(accepted.state, "accepted");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminal failed or expired Run is recorded as failed without cancel", async () => {
  const { store, service } = setup();
  const native = ports({ async readRun() { return { sourceId, runId, status: "failed", cursor: "7" }; } });
  const receipt = await service.execute("alice", input(), native);
  assert.equal(receipt.state, "failed");
  assert.match(receipt.detail ?? "", /already failed/);
  assert.equal(native.calls.some((call) => call.startsWith("cancel:")), false);
  store.close();
});

test("reconcile observes cancellation without dispatch and labels runtime attribution", async () => {
  const { store, service } = setup();
  const original = await service.execute("alice", input(), ports());
  let reads = 0;
  const native = ports({
    async readRun() { reads++; return { sourceId, runId, status: "cancelled", cursor: "9" }; },
    async cancel() { assert.fail("reconcile must not dispatch cancel"); },
  });
  const reconciled = await service.reconcile("alice", original.id, native);
  assert.equal(reconciled.state, "succeeded");
  assert.equal(reconciled.detail, "runtime_cancelled_observed");
  assert.equal(reads, 1);
  assert.equal(native.calls.some((call) => call.startsWith("cancel:")), false);
  store.close();
});

test("reconcile keeps unknown nonterminal outcomes unknown and rejects wrong source or Run", async () => {
  const { store, service } = setup();
  const pending = await service.execute("alice", input(), ports({
    async cancel() { throw Error("ambiguous transport failure"); },
  }));
  const unknown = await service.reconcile("alice", pending.id, ports());
  assert.equal(unknown.state, "unknown");

  await assert.rejects(() => service.reconcile("alice", pending.id, ports({
    async readRun() { return { sourceId: "different-source", runId, status: "cancelled", cursor: "9" }; },
  })), (error: unknown) => error instanceof CommandError && error.code === "run_identity_mismatch");
  await assert.rejects(() => service.reconcile("bob", pending.id, ports()),
    (error: unknown) => error instanceof CommandError && error.status === 404);
  store.close();
});

test("reconcile authorizes before receipt lookup and settles accepted terminal outcomes", async () => {
  const { store, service } = setup();
  const pending = await service.execute("alice", input(), ports());
  let authorizeCalls = 0;
  let readCalls = 0;
  const denied = ports({
    async authorize() { authorizeCalls++; throw Error("private source detail"); },
    async readRun() { readCalls++; return { sourceId, runId, status: "failed", cursor: "8" }; },
  });
  await assert.rejects(() => service.reconcile("nobody", pending.id, denied),
    (error: unknown) => error instanceof CommandError && error.status === 403);
  assert.equal(authorizeCalls, 1);
  assert.equal(readCalls, 0);

  const terminal = await service.reconcile("alice", pending.id, ports({
    async readRun() { return { sourceId, runId, status: "succeeded", cursor: "8" }; },
  }));
  assert.equal(terminal.state, "failed");
  assert.match(terminal.detail ?? "", /terminal \(succeeded\)/);
  store.close();
});
test("reconcile rechecks revocation after reading native metadata", async () => {
  const { store, service } = setup();
  const pending = await service.execute("alice", input(), ports());
  let checks = 0;
  await assert.rejects(() => service.reconcile("alice", pending.id, ports({
    async authorize() { if (++checks === 2) throw Error("revoked"); },
    async readRun() { return { sourceId, runId, status: "cancelled", cursor: "9" }; },
  })), (error: unknown) => error instanceof CommandError && error.status === 403);
  assert.equal(service.list("alice", runKey)[0]?.state, "accepted");
  store.close();
});

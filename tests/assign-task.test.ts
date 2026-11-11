import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { backup } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Store } from "../packages/storage/store.ts";
import { TaskAssignmentService, AssignmentRejected, type AssignmentInput, type AssignmentPorts } from "../packages/commands/assign-task.ts";

const now = Date.parse("2026-11-12T00:00:00Z"); const identity = "a".repeat(64); const inputHash = "b".repeat(64);
const id = () => randomUUID();
function setup() {
  const store = new Store(":memory:"); const service = new TaskAssignmentService(store); const actor = "owner@test.example";
  const input: AssignmentInput = { id: id(), projectSourceId: "projects", projectId: id(), taskId: id(), taskRevision: "1", reviewSha256: "c".repeat(64),
    demianSourceId: "demian", sessionId: id(), sessionSha256: "d".repeat(64), instructions: "PRIVATE_DRAFT", expiresAt: new Date(now + 60_000).toISOString() };
  let posts = 0; let bindings = 0; let accessible = true; const runId = id();
  const accepted = { runId, sessionId: input.sessionId, inputSha256: inputHash };
  const ports: AssignmentPorts = { authorize: async () => { if (!accessible) throw new Error(); return { identity }; },
    prepare: async () => ({ inputSha256: inputHash }), start: async () => { posts++; return accepted; }, lookup: async () => accepted,
    bind: async () => { bindings++; return "bound"; }, now: () => now };
  return { store, service, actor, input, ports, accepted, posts: () => posts, bindings: () => bindings, revoke: () => { accessible = false; } };
}
test("assignment records native acceptance and a separate binding without retaining submitted text", async () => {
  const c = setup(); try {
    const first = await c.service.execute(c.actor, c.input, c.ports);
    assert.equal(first.state, "accepted"); assert.equal(first.bindingState, "bound"); assert.equal(first.runId, c.accepted.runId);
    assert.deepEqual(await c.service.execute(c.actor, c.input, c.ports), first); assert.equal(c.posts(), 1);
    await assert.rejects(c.service.execute(c.actor, { ...c.input, instructions: "changed" }, c.ports), /같은 요청/);
    const rows = c.store.db.prepare("SELECT * FROM task_assignment_receipts").all(); assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_DRAFT|instructions/);
  } finally { c.store.close(); }
});
test("unknown requests survive recovery, block a different UUID in the same Session and reconcile without native repost", async () => {
  const c = setup(); try {
    c.ports.start = async () => { throw new Error("Lost response"); };
    const unknown = await c.service.execute(c.actor, c.input, c.ports); assert.equal(unknown.state, "unknown");
    await assert.rejects(c.service.execute(c.actor, { ...c.input, id: id() }, c.ports), /먼저 확인/);
    c.ports.lookup = async () => null;
    assert.equal((await c.service.reconcile(c.actor, c.input.id, c.ports)).state, "unknown");
    c.service.recoverInterrupted(); c.ports.lookup = async () => c.accepted;
    const found = await c.service.reconcile(c.actor, c.input.id, c.ports); assert.equal(found.state, "accepted"); assert.equal(found.bindingState, "bound");
    assert.equal(c.posts(), 0);
  } finally { c.store.close(); }
});
test("binding failure preserves accepted Run and later repairs only the binding", async () => {
  const c = setup(); try {
    c.ports.bind = async () => { throw new Error("Temporary binding failure"); };
    const pending = await c.service.execute(c.actor, c.input, c.ports); assert.equal(pending.state, "accepted"); assert.equal(pending.bindingState, "pending");
    c.ports.bind = async () => "conflict";
    assert.equal((await c.service.reconcile(c.actor, c.input.id, c.ports)).bindingState, "conflict");
    c.ports.bind = async () => "bound";
    assert.equal((await c.service.reconcile(c.actor, c.input.id, c.ports)).bindingState, "bound"); assert.equal(c.posts(), 1);
  } finally { c.store.close(); }
});
test("deadlines, authoritative rejection, invalid acknowledgements and revocation never claim an accepted execution", async () => {
  const c = setup(); try {
    c.ports.now = () => now + 61_000;
    assert.equal((await c.service.execute(c.actor, c.input, c.ports)).state, "expired"); assert.equal(c.posts(), 0);
    c.ports.now = () => now; const next = { ...c.input, id: id() };
    c.ports.start = async () => { throw new AssignmentRejected(); };
    assert.equal((await c.service.execute(c.actor, next, c.ports)).state, "failed");
    c.ports.start = async () => ({ ...c.accepted, sessionId: id() });
    assert.equal((await c.service.execute(c.actor, { ...next, id: id() }, c.ports)).state, "unknown");
    c.revoke(); await assert.rejects(c.service.reconcile(c.actor, next.id, c.ports));
  } finally { c.store.close(); }
});
test("concurrent UUIDs elect one dispatcher and late reconciliation cannot downgrade accepted receipts", async () => {
  const c = setup(); try {
    let settle!: () => void; const dispatched = new Promise<void>((resolve) => { settle = resolve; });
    let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; });
    c.ports.start = async () => { settle(); await waiting; return c.accepted; };
    const first = c.service.execute(c.actor, c.input, c.ports); await dispatched;
    await assert.rejects(c.service.execute(c.actor, { ...c.input, id: id() }, c.ports));
    let resolveLookup!: () => void; const lookup = new Promise<void>((resolve) => { resolveLookup = resolve; });
    c.ports.lookup = async () => { await lookup; return null; };
    const stale = c.service.reconcile(c.actor, c.input.id, c.ports); release(); await first; resolveLookup();
    assert.equal((await stale).state, "accepted");
  } finally { c.store.close(); }
});

test("file-backed restart and online backup preserve unknown assignments and never redispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "track-assignment-recovery-")); const path = join(root, "live.sqlite");
  const fixture = setup(); let store = new Store(path);
  try {
    let service = new TaskAssignmentService(store);
    const unknown = await service.execute(fixture.actor, fixture.input, { ...fixture.ports, start: async () => { throw new Error("Lost reply"); } });
    assert.equal(unknown.state, "unknown");
    store.db.prepare("UPDATE task_assignment_receipts SET state='dispatching'").run(); store.close(); store = new Store(path);
    service = new TaskAssignmentService(store); assert.equal(service.recoverInterrupted(), 1);
    await backup(store.db, join(root, "copy.sqlite")); const restored = new Store(join(root, "copy.sqlite"));
    try {
      const reader = new TaskAssignmentService(restored); const ports: AssignmentPorts = { ...fixture.ports, start: async () => { assert.fail("recovery must not POST"); } };
      const replay = await reader.execute(fixture.actor, fixture.input, ports); assert.equal(replay.state, "unknown");
      const accepted = await reader.reconcile(fixture.actor, fixture.input.id, ports); assert.equal(accepted.state, "accepted"); assert.equal(accepted.bindingState, "bound");
      assert.equal(restored.integrity(), "ok"); assert.doesNotMatch(JSON.stringify(restored.db.prepare("SELECT * FROM task_assignment_receipts").all()), /PRIVATE_DRAFT/);
    } finally { restored.close(); }
  } finally {
    store.close(); fixture.store.close(); const absolute = resolve(root);
    assert.equal(dirname(absolute), resolve(tmpdir())); assert.ok(basename(absolute).startsWith("track-assignment-recovery-")); await rm(absolute, { recursive: true, force: true });
  }
});

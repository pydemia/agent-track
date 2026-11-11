import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Store } from "../packages/storage/store.ts";
import { backup } from "node:sqlite";
import { CommandError } from "../packages/commands/index.ts";
import { TaskCreationService, TaskCreationRejected, TaskCreationExpired, type CreateTaskInput, type CreateTaskPorts, type NativeTaskCreation } from "../packages/commands/create-task.ts";

const actor = "owner@example.test";
const identity = "a".repeat(64);
const input = (): CreateTaskInput => ({ id: randomUUID(), sourceId: "projects", projectId: randomUUID(),
  title: "Private task title", body: "PRIVATE BODY MUST NOT BE JOURNALED", acceptanceCriteria: ["PRIVATE CRITERION"],
  requiresTest: true, expiresAt: new Date(Date.now() + 60_000).toISOString() });
const preparedHash = (draft: CreateTaskInput) => createHash("sha256").update(JSON.stringify({ operation_id: draft.id,
  title: draft.title, body: draft.body, acceptance_criteria: draft.acceptanceCriteria, requires_test: draft.requiresTest })).digest("hex");
function setup(draft: CreateTaskInput) {
  const store = new Store(":memory:"); const service = new TaskCreationService(store);
  let posts = 0;
  const result: NativeTaskCreation = { operationId: draft.id, requestBodySha256: preparedHash(draft), task: {
    id: randomUUID(), projectId: draft.projectId, title: draft.title, revision: "1", state: "todo", requiresTest: true } };
  const ports: CreateTaskPorts = { authorize: async () => ({ identity, sourceId: draft.sourceId, projectId: draft.projectId }), prepare: (value) => ({ requestBodySha256: preparedHash(value) }),
    create: async () => { posts++; return result; }, lookup: async () => result };
  return { store, service, ports, result, posts: () => posts };
}
const code = (expected: string) => (error: unknown) => error instanceof CommandError && error.code === expected;
async function cleanup(root: string) {
  const target = resolve(root);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith("track-create-"));
  await rm(target, { recursive: true, force: true });
}

test("native creation receipt uses operation/hash/Project identity; replay does not dispatch or persist draft", async () => {
  const draft = input(); const f = setup(draft);
  try {
    const receipt = await f.service.execute(actor, draft, f.ports);
    assert.equal(receipt.state, "created"); assert.equal(receipt.taskId, f.result.task.id);
    assert.deepEqual(await f.service.execute(actor, draft, f.ports), receipt); assert.equal(f.posts(), 1);
    const journal = JSON.stringify(f.store.db.prepare("SELECT * FROM task_creation_receipts").all());
    for (const secret of [draft.title, draft.body, ...draft.acceptanceCriteria]) assert.equal(journal.includes(secret), false);
    assert.equal(f.service.list("other@example.test", draft.sourceId, draft.projectId).length, 0);
    await assert.rejects(f.service.execute(actor, { ...draft, title: "Changed" }, f.ports), code("idempotency_conflict"));
    await assert.rejects(f.service.execute(actor, draft, { ...f.ports, authorize: async () => ({ identity: "b".repeat(64), sourceId: draft.sourceId, projectId: draft.projectId }) }), code("source_identity_changed"));
  } finally { f.store.close(); }
});

test("create validation and denied/deadline policy prevent native dispatch", async () => {
  const draft = input(); const f = setup(draft);
  try {
    await assert.rejects(f.service.execute(actor, { ...draft, title: " " }, f.ports), code("invalid_task_draft"));
    await assert.rejects(f.service.execute(actor, { ...draft, body: "한".repeat(4000) }, f.ports), code("invalid_task_draft"));
    await assert.rejects(f.service.execute(actor, draft, { ...f.ports, authorize: async () => { throw new Error("PRIVATE SOURCE ERROR"); } }), code("source_forbidden"));
    await assert.rejects(f.service.execute(actor, { ...draft, expiresAt: new Date(Date.now() + 300_000).toISOString() }, f.ports), code("invalid_deadline"));
    assert.equal((await f.service.execute(actor, { ...draft, expiresAt: new Date(Date.now() - 1000).toISOString() }, f.ports)).state, "expired");
    assert.equal(f.posts(), 0);
  } finally { f.store.close(); }
});

test("expiry and revocation are rechecked after await, before native create", async () => {
  for (const variant of ["expiry", "revoked", "rebound"] as const) {
    const draft = input(); const f = setup(draft); let checks = 0; let now = Date.now();
    const ports: CreateTaskPorts = { ...f.ports, now: () => now, authorize: async () => {
      checks++; if (checks === 2) {
        if (variant === "expiry") now = Date.parse(draft.expiresAt) + 1;
        if (variant === "revoked") throw new Error();
        if (variant === "rebound") return { identity: "b".repeat(64), sourceId: draft.sourceId, projectId: draft.projectId };
      }
      return { identity, sourceId: draft.sourceId, projectId: draft.projectId };
    } };
    try {
      if (variant === "expiry") assert.equal((await f.service.execute(actor, draft, ports)).state, "expired");
      else await assert.rejects(f.service.execute(actor, draft, ports), code("source_forbidden"));
      assert.equal(f.posts(), 0);
    } finally { f.store.close(); }
  }
});

test("unknown create is never resent; native operation lookup reconciles without draft", async () => {
  const draft = input(); const f = setup(draft); let posts = 0;
  const ports = { ...f.ports, create: async () => { posts++; throw new Error("response lost"); } };
  try {
    assert.equal((await f.service.execute(actor, draft, ports)).state, "unknown");
    assert.equal((await f.service.execute(actor, draft, ports)).state, "unknown"); assert.equal(posts, 1);
    await assert.rejects(f.service.execute(actor, { ...draft, id: randomUUID() }, ports), code("task_creation_pending"));
    assert.equal((await f.service.reconcile(actor, draft.id, { ...ports, lookup: async () => null })).state, "unknown");
    const recovered = await f.service.reconcile(actor, draft.id, ports);
    assert.equal(recovered.state, "created"); assert.equal(recovered.taskId, f.result.task.id); assert.equal(posts, 1);
  } finally { f.store.close(); }
});

test("mismatched native success metadata never marks source creation confirmed", async () => {
  for (const changed of [{ operationId: randomUUID() }, { requestBodySha256: "b".repeat(64) }, { task: { projectId: randomUUID() } }, { task: { revision: "0" } }]) {
    const draft = input(); const f = setup(draft);
    const wrong = { ...f.result, ...changed, task: { ...f.result.task, ...("task" in changed ? changed.task : {}) } };
    try { assert.equal((await f.service.execute(actor, draft, { ...f.ports, create: async () => wrong })).state, "unknown"); }
    finally { f.store.close(); }
  }
});

test("receipt reconciliation cannot borrow a grant for another Project or source", async () => {
  const draft = input(); const f = setup(draft); let lookups = 0;
  try {
    await f.service.execute(actor, draft, { ...f.ports, create: async () => { throw new Error(); } });
    for (const wrong of [{ sourceId: "different" }, { projectId: randomUUID() }]) {
      await assert.rejects(f.service.reconcile(actor, draft.id, { ...f.ports,
        authorize: async () => ({ identity, sourceId: draft.sourceId, projectId: draft.projectId, ...wrong }),
        lookup: async () => { lookups++; return f.result; } }), code("source_forbidden"));
    }
    assert.equal(lookups, 0);
  } finally { f.store.close(); }
});

test("authoritative source rejection preserves failed receipt; raw errors and draft stay out", async () => {
  const draft = input(); const f = setup(draft);
  try {
    const receipt = await f.service.execute(actor, draft, { ...f.ports, create: async () => { throw new TaskCreationRejected("PRIVATE ERROR"); } });
    assert.equal(receipt.state, "failed");
    assert.equal(JSON.stringify(receipt).includes("PRIVATE"), false);
    assert.equal((await f.service.reconcile(actor, draft.id, f.ports)).state, "failed");
  } finally { f.store.close(); }
});

test("an adapter deadline proven before POST produces an expired receipt", async () => {
  const draft = input(); const f = setup(draft);
  try {
    const receipt = await f.service.execute(actor, draft, { ...f.ports, create: async () => { throw new TaskCreationExpired(); } });
    assert.equal(receipt.state, "expired"); assert.equal(f.posts(), 0);
  } finally { f.store.close(); }
});

test("cross-process duplicate and a competing UUID cannot dispatch twice", async () => {
  const root = await mkdtemp(join(tmpdir(), "track-create-test-"));
  const a = new Store(join(root, "test.sqlite")); const b = new Store(join(root, "test.sqlite"));
  const first = new TaskCreationService(a); const second = new TaskCreationService(b);
  const draft = input(); const f = setup(draft); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }); let dispatched!: () => void;
  const started = new Promise<void>((resolve) => { dispatched = resolve; }); let posts = 0;
  const ports = { ...f.ports, create: async () => { posts++; dispatched(); await gate; return f.result; } };
  try {
    const pending = first.execute(actor, draft, ports); await started;
    assert.equal((await second.execute(actor, draft, ports)).state, "dispatching");
    await assert.rejects(second.execute(actor, { ...draft, id: randomUUID() }, ports), code("task_creation_pending"));
    release(); assert.equal((await pending).state, "created"); assert.equal(posts, 1);
  } finally { release(); a.close(); b.close(); f.store.close(); await cleanup(root); }
});

test("late missing-operation lookup cannot overwrite a confirmed receipt", async () => {
  const draft = input(); const f = setup(draft); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }); let called!: () => void;
  const started = new Promise<void>((resolve) => { called = resolve; });
  try {
    await f.service.execute(actor, draft, { ...f.ports, create: async () => { throw new Error(); } });
    const late = f.service.reconcile(actor, draft.id, { ...f.ports, lookup: async () => { called(); await gate; return null; } });
    await started;
    assert.equal((await f.service.reconcile(actor, draft.id, f.ports)).state, "created");
    release(); assert.equal((await late).state, "created");
  } finally { release(); f.store.close(); }
});

test("restarted journal preserves operation fingerprint and recovers without native resend", async () => {
  const root = await mkdtemp(join(tmpdir(), "track-create-restart-")); const path = join(root, "test.sqlite");
  const draft = input(); const f = setup(draft); let store = new Store(path);
  try {
    await new TaskCreationService(store).execute(actor, draft, { ...f.ports, create: async () => { throw new Error(); } });
    store.db.prepare("UPDATE task_creation_receipts SET state='dispatching'").run(); store.close(); store = new Store(path);
    const recovered = new TaskCreationService(store); assert.equal(recovered.recoverInterrupted(), 1);
    assert.equal((await recovered.reconcile(actor, draft.id, f.ports)).state, "created"); assert.equal(f.posts(), 0);
  } finally { store.close(); f.store.close(); await cleanup(root); }
});

test("online backup preserves confirmed and unknown task creation without text or redispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "track-create-backup-")); const store = new Store(join(root, "live.sqlite"));
  const draft = input(); const f = setup(draft);
  try {
    const service = new TaskCreationService(store); const confirmed = await service.execute(actor, draft, f.ports);
    const other = { ...draft, id: randomUUID() };
    const uncertain = await service.execute(actor, other, { ...f.ports, create: async () => { throw new Error(); } });
    assert.equal(uncertain.state, "unknown");
    await backup(store.db, join(root, "backup.sqlite")); const restored = new Store(join(root, "backup.sqlite"));
    try {
      const recovered = new TaskCreationService(restored); assert.equal(restored.integrity(), "ok");
      const forbiddenPost = { ...f.ports, create: async () => { assert.fail("backup replay must not dispatch"); } };
      assert.deepEqual(await recovered.execute(actor, draft, forbiddenPost), confirmed);
      assert.deepEqual(await recovered.execute(actor, other, forbiddenPost), uncertain);
      assert.doesNotMatch(JSON.stringify(restored.db.prepare("SELECT * FROM task_creation_receipts").all()), /PRIVATE/);
    } finally { restored.close(); }
  } finally { store.close(); f.store.close(); await cleanup(root); }
});

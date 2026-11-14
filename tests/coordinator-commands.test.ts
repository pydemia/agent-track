import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoordinatorCommands, CoordinatorDispatchWithheld, type CoordinatorPorts,
  type PreparedCoordinator } from "../packages/commands/coordinator-commands.ts";
import { coordinatorReceiptSchema, type CoordinatorReviewInput } from "../packages/contracts/coordinator-commands.ts";
import { type AssistantCommandReceipt } from "../packages/contracts/assistant-commands.ts";
import { CommandError } from "../packages/commands/index.ts";
import { externalKey } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";

const epoch = Date.parse("2026-11-14T00:00:00.000Z");
const runId = randomUUID(), sessionId = randomUUID(), executionId = randomUUID(), roleId = randomUUID();
const runKey = externalKey("native", runId);
const input = (): CoordinatorReviewInput => ({ id: randomUUID(), runKey, kind: "retry",
  expiresAt: new Date(epoch + 60_000).toISOString() });
const saved = (p: PreparedCoordinator): AssistantCommandReceipt => ({ version: 1, command: {
  operationId: p.command.operationId, executionId: p.target.executionId, roleId: p.target.roleId,
  kind: p.command.kind, attempt: p.target.attemptOrdinal + 1, intentState: "saved",
  createdAt: new Date(epoch).toISOString(),
} });
const code = (name: string) => (e: unknown) => e instanceof CommandError && e.code === name;
function setup(path = ":memory:") {
  const store = new Store(path), service = new CoordinatorCommands(store);
  let posts = 0, lookups = 0, prepares = 0, clock = epoch;
  const ports: CoordinatorPorts = {
    now: () => clock, async authorize() {},
    async prepare(i) {
      prepares++;
      return { target: { runKey: i.runKey, runId, nativeSourceId: "native", nativeSourceIdentity: "private-native",
        assistantSourceId: "assistant", assistantSourceIdentity: "private-assistant", executionId, roleId,
        attemptId: randomUUID(), attemptOrdinal: 1, expectedRevision: 2, sourceStatus: "failed", sessionId,
        binding: null }, scopeIdentity: "private-scope", command: { operationId: i.id, kind: i.kind,
          expectedRevision: 2, expiresAt: i.expiresAt } };
    },
    async dispatch(p) { posts++; return saved(p); },
    async lookup() { lookups++; return null; },
  };
  return { store, service, ports, counts: () => ({ posts, lookups, prepares }), tick: (ms: number) => { clock += ms; } };
}

test("strict public review, canonical offset digest, exact same ID and no POST", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  const first = await h.service.review("alice", { ...i, expiresAt: "2026-11-14T09:01:00+09:00" }, h.ports);
  assert.deepEqual(await h.service.review("alice", i, h.ports), first);
  assert.deepEqual(h.counts(), { posts: 0, lookups: 0, prepares: 1 });
  assert.equal(coordinatorReceiptSchema.safeParse(first).success, true);
  assert.doesNotMatch(JSON.stringify(first), /private|scopeIdentity|sourceIdentity|actor|digest/);
  for (const raw of [{ ...i, input: "secret" }, { ...i, id: i.id.toUpperCase() }, { ...i, kind: "continue" }])
    await assert.rejects(h.service.review("alice", raw, h.ports), code("invalid_command"));
  assert.doesNotMatch(JSON.stringify(h.store.db.prepare("SELECT * FROM coordinator_command_intents").all()), /secret/);
});

test("same ID with different body conflicts even after its deadline", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  for (const changed of [{ ...i, kind: "resume" }, { ...i, expiresAt: new Date(epoch + 70_000).toISOString() }])
    await assert.rejects(h.service.review("alice", changed, h.ports), code("idempotency_conflict"));
  h.tick(80_000);
  await assert.rejects(h.service.review("alice", { ...i, kind: "resume" }, h.ports), code("idempotency_conflict"));
  assert.equal((await h.service.review("alice", i, h.ports)).state, "expired");
});

test("initial deadline bounded to 120 seconds and rechecked after prepare", async t => {
  const h = setup(); t.after(() => h.store.close());
  for (const delta of [0, -1, 120_001])
    await assert.rejects(h.service.review("alice", { ...input(), expiresAt: new Date(epoch + delta).toISOString() }, h.ports), code("invalid_deadline"));
  const prepare = h.ports.prepare;
  h.ports.prepare = async i => { const p = await prepare(i); h.tick(60_000); return p; };
  await assert.rejects(h.service.review("alice", input(), h.ports), code("invalid_deadline"));
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM coordinator_command_intents").get()!.n, 0);
});

test("preparation validates run, operation, revision, deadline, binding and strict descriptor", async t => {
  const mutations: ((p: PreparedCoordinator) => void)[] = [
    p => { p.target.runId = randomUUID(); }, p => { p.command.operationId = randomUUID(); },
    p => { p.command.expectedRevision++; }, p => { p.command.kind = "resume"; },
    p => { p.command.expiresAt = new Date(epoch + 90_000).toISOString(); },
    p => { p.target.attemptOrdinal = 33; }, p => { p.target.sessionId = "bad"; },
    p => { p.target.assistantSourceIdentity = ""; }, p => { Object.assign(p.command, { token: "secret" }); },
    p => { p.target.binding = { sourceId: "wrong", runId, projectSourceId: "project", projectId: "p",
      taskId: null, taskRevision: null, projectTitle: "P", taskTitle: null, provenance: "source" }; },
  ];
  for (const mutate of mutations) {
    const h = setup(); t.after(() => h.store.close()); const prepare = h.ports.prepare;
    h.ports.prepare = async i => { const p = await prepare(i); mutate(p); return p; };
    await assert.rejects(h.service.review("alice", input(), h.ports), code("invalid_preparation"));
  }
});

test("concurrent reviews of same ID converge and competing IDs conflict", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  const pair = await Promise.all([h.service.review("alice", i, h.ports), h.service.review("alice", i, h.ports)]);
  assert.deepEqual(pair[0], pair[1]);
  await assert.rejects(h.service.review("alice", input(), h.ports), code("coordinator_pending"));
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM coordinator_command_intents").get()!.n, 1);
});

test("one unresolved per actor and coordinator role across different Native runs", async t => {
  const h = setup(); t.after(() => h.store.close()); await h.service.review("alice", input(), h.ports);
  const other = randomUUID(), prepare = h.ports.prepare;
  h.ports.prepare = async i => { const p = await prepare(i); p.target.runId = other; return p; };
  const i = { ...input(), runKey: externalKey("native", other) };
  await assert.rejects(h.service.review("alice", i, h.ports), code("coordinator_pending"));
  assert.equal((await h.service.review("bob", i, h.ports)).state, "prepared");
});

test("CAS and durable claim precede exactly one concurrent dispatch", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports); let posts = 0;
  h.ports.dispatch = async p => {
    posts++;
    assert.equal(h.store.db.prepare("SELECT state FROM coordinator_command_intents").get()!.state, "dispatching");
    await Promise.resolve(); return saved(p);
  };
  await Promise.all([h.service.dispatch("alice", i.id, h.ports), h.service.dispatch("alice", i.id, h.ports)]);
  assert.equal(posts, 1);
  assert.equal((await h.service.get("alice", i.id, h.ports)).state, "intent_saved");
});

test("lost ACK plus restart recovers same ID using GET only and blocks new ID", async t => {
  const dir = mkdtempSync(join(tmpdir(), "coordinator-test-")), path = join(dir, "store.db");
  const h = setup(path), i = input(); let receipt: AssistantCommandReceipt | null = null, posts = 0;
  let reopened: ReturnType<typeof setup> | undefined;
  t.after(() => { reopened?.store.close(); rmSync(dir, { recursive: true, force: true }); });
  await h.service.review("alice", i, h.ports);
  h.ports.dispatch = async p => { posts++; receipt = saved(p); throw new Error("ACK lost"); };
  assert.equal((await h.service.dispatch("alice", i.id, h.ports)).state, "unknown");
  h.store.close(); reopened = setup(path);
  await assert.rejects(reopened.service.review("alice", input(), reopened.ports), code("coordinator_pending"));
  reopened.ports.lookup = async p => { assert.equal(p.command.operationId, i.id); return receipt; };
  assert.equal((await reopened.service.dispatch("alice", i.id, reopened.ports)).state, "intent_saved");
  assert.equal(posts, 1); assert.equal(reopened.counts().posts, 0);
});

test("restart dispatching state never sends; missing and failed lookups stay unknown", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  h.store.db.prepare("UPDATE coordinator_command_intents SET state='dispatching',detail='outcome_unknown'").run();
  const restarted = new CoordinatorCommands(h.store);
  assert.equal((await restarted.dispatch("alice", i.id, h.ports)).state, "unknown");
  h.ports.lookup = async () => { throw new Error("404"); };
  h.tick(180_000);
  assert.equal((await restarted.get("alice", i.id, h.ports)).state, "unknown");
  assert.equal(h.counts().posts, 0);
});

test("receipt and saved state commit atomically; database failure remains recoverable", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports); let receipt: AssistantCommandReceipt | null = null;
  h.store.db.exec(`CREATE TRIGGER fail_receipt BEFORE UPDATE OF receipt_json ON coordinator_command_intents
    BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;`);
  h.ports.dispatch = async p => { receipt = saved(p); return receipt; };
  assert.equal((await h.service.dispatch("alice", i.id, h.ports)).state, "unknown");
  assert.equal(h.store.db.prepare("SELECT receipt_json FROM coordinator_command_intents").get()!.receipt_json, null);
  h.store.db.exec("DROP TRIGGER fail_receipt"); h.ports.lookup = async () => receipt;
  assert.equal((await h.service.get("alice", i.id, h.ports)).state, "intent_saved");
});

test("final fence withheld proves zero POST and persists safe terminal outcome", async t => {
  for (const detail of ["review_changed", "authority_changed", "deadline_passed"] as const) {
    const h = setup(); t.after(() => h.store.close()); const i = input();
    await h.service.review("alice", i, h.ports);
    h.ports.dispatch = async () => { throw new CoordinatorDispatchWithheld(detail); };
    const result = await h.service.dispatch("alice", i.id, h.ports);
    assert.equal(result.state, detail === "deadline_passed" ? "expired" : "rejected");
    assert.equal(result.detail, detail); assert.equal(h.counts().posts, 0);
  }
});

test("unproved invocation errors always stay unknown", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  h.ports.dispatch = async () => { throw new CommandError(403, "authority_changed", "secret"); };
  const result = await h.service.dispatch("alice", i.id, h.ports);
  assert.equal(result.state, "unknown"); assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test("mismatching and extra-field receipts cannot establish saved intent", async t => {
  for (const field of ["operationId", "executionId", "roleId", "kind", "attempt", "extra"] as const) {
    const h = setup(); t.after(() => h.store.close()); const i = input();
    await h.service.review("alice", i, h.ports);
    h.ports.dispatch = async p => {
      const r = saved(p);
      Object.assign(r.command, { [field]: field === "attempt" ? 33 : field === "kind" ? "resume" : randomUUID() });
      return r;
    };
    assert.equal((await h.service.dispatch("alice", i.id, h.ports)).state, "unknown");
  }
});

test("foreign local actor cannot access, dispatch, list or discard another intent", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  for (const method of ["get", "dispatch", "discard"] as const)
    await assert.rejects(h.service[method]("bob", i.id, h.ports), code("receipt_not_found"));
  assert.deepEqual(await h.service.list("bob", runKey, h.ports), { receipts: [], hasMore: false });
  assert.equal(h.counts().posts, 0);
});

test("revocation after preparation prevents persistence and final-fence revocation prevents POST", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  h.ports.authorize = async p => { if (p) throw new Error("revoked"); };
  await assert.rejects(h.service.review("alice", i, h.ports), code("authority_changed"));
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM coordinator_command_intents").get()!.n, 0);
  h.ports.authorize = async () => {}; await h.service.review("alice", i, h.ports);
  let checks = 0;
  h.ports.authorize = async () => { if (++checks === 2) throw new Error("revoked"); };
  await assert.rejects(h.service.dispatch("alice", i.id, h.ports), code("authority_changed"));
  assert.equal(h.counts().posts, 0);
  assert.equal(h.store.db.prepare("SELECT state FROM coordinator_command_intents").get()!.state, "rejected");
});

test("post-save auth failure hides response but preserves evidence", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input(); let revoked = false;
  await h.service.review("alice", i, h.ports);
  h.ports.dispatch = async p => { revoked = true; return saved(p); };
  h.ports.authorize = async () => { if (revoked) throw new Error("revoked"); };
  await assert.rejects(h.service.dispatch("alice", i.id, h.ports), code("authority_changed"));
  const row = h.store.db.prepare("SELECT state,receipt_json FROM coordinator_command_intents").get()!;
  assert.equal(row.state, "intent_saved"); assert.ok(row.receipt_json);
  revoked = false; assert.equal((await h.service.get("alice", i.id, h.ports)).state, "intent_saved");
});

test("same-ID recovery tolerates later Task progress while writes require fresh context", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input(); let receipt: AssistantCommandReceipt | null = null;
  await h.service.review("alice", i, h.ports);
  h.ports.dispatch = async p => { receipt = saved(p); throw new Error("lost ACK"); };
  await h.service.dispatch("alice", i.id, h.ports);
  h.ports.authorize = async (_p, writing) => { if (writing) throw new CommandError(409, "review_changed", "progress"); };
  h.ports.lookup = async () => receipt;
  assert.equal((await h.service.get("alice", i.id, h.ports)).state, "intent_saved");
  await assert.rejects(h.service.review("alice", input(), h.ports), code("review_changed"));
});

test("lookup revocation returns no receipt while persisting valid saved evidence", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input(); let receipt: AssistantCommandReceipt | null = null;
  await h.service.review("alice", i, h.ports);
  h.ports.dispatch = async p => { receipt = saved(p); throw new Error("lost"); };
  await h.service.dispatch("alice", i.id, h.ports); let revoked = false;
  h.ports.lookup = async () => { revoked = true; return receipt; };
  h.ports.authorize = async () => { if (revoked) throw new Error("revoked"); };
  await assert.rejects(h.service.get("alice", i.id, h.ports), code("authority_changed"));
  assert.equal(h.store.db.prepare("SELECT state FROM coordinator_command_intents").get()!.state, "intent_saved");
});

test("prepared expiry is checked after auth; discard releases unresolved slot", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  h.ports.authorize = async () => { h.tick(60_000); };
  assert.equal((await h.service.dispatch("alice", i.id, h.ports)).state, "expired");
  assert.equal(h.counts().posts, 0);
  const h2 = setup(); t.after(() => h2.store.close()); const j = input();
  await h2.service.review("alice", j, h2.ports);
  assert.equal((await h2.service.discard("alice", j.id, h2.ports)).state, "discarded");
  assert.equal((await h2.service.review("alice", input(), h2.ports)).state, "prepared");
});

test("corrupt durable descriptors, states and receipts fail closed before port I/O", async t => {
  for (const sql of ["UPDATE coordinator_command_intents SET private_json='{}'",
    "UPDATE coordinator_command_intents SET state='accepted'",
    "UPDATE coordinator_command_intents SET receipt_json='{}'",
    "UPDATE coordinator_command_intents SET assistant_source='other'",
    "UPDATE coordinator_command_intents SET digest='wrong'"]) {
    const h = setup(); t.after(() => h.store.close()); const i = input();
    await h.service.review("alice", i, h.ports); h.store.db.exec(sql);
    await assert.rejects(h.service.dispatch("alice", i.id, h.ports), code("invalid_stored_intent"));
    assert.equal(h.counts().posts, 0); assert.equal(h.counts().lookups, 0);
  }
});

test("list caps at 100 and rechecks access after later awaited entries", async t => {
  const h = setup(); t.after(() => h.store.close());
  for (let n = 0; n < 101; n++) {
    const i = input(); await h.service.review("alice", i, h.ports); await h.service.discard("alice", i.id, h.ports);
  }
  const page = await h.service.list("alice", runKey, h.ports);
  assert.equal(page.receipts.length, 100); assert.equal(page.hasMore, true);
  let checks = 0;
  h.ports.authorize = async () => { if (++checks === 202) throw new Error("revoked during list"); };
  await assert.rejects(h.service.list("alice", runKey, h.ports), code("authority_changed"));
});

test("concurrent receipt GET cannot erase the dispatch claimant's proof of zero POST", async t => {
  for (const detail of ["authority_changed", "deadline_passed"] as const) {
    const h = setup(); t.after(() => h.store.close()); const i = input();
    await h.service.review("alice", i, h.ports);
    h.ports.dispatch = async () => {
      assert.equal((await h.service.get("alice", i.id, h.ports)).state, "unknown");
      throw new CoordinatorDispatchWithheld(detail);
    };
    const result = await h.service.dispatch("alice", i.id, h.ports);
    assert.equal(result.state, detail === "deadline_passed" ? "expired" : "rejected");
    assert.equal(h.counts().posts, 0);
    assert.equal((await h.service.review("alice", input(), h.ports)).state, "prepared");
  }
});

test("concurrent receipt GET cannot retain an unresolved slot after post-claim authorization fails", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports); let writes = 0;
  h.ports.authorize = async (_prepared, writing) => {
    if (writing && ++writes === 2) {
      assert.equal((await h.service.get("alice", i.id, h.ports)).state, "unknown");
      throw new Error("withdrawn before POST");
    }
  };
  await assert.rejects(h.service.dispatch("alice", i.id, h.ports), code("authority_changed"));
  h.ports.authorize = async () => {};
  assert.equal((await h.service.get("alice", i.id, h.ports)).state, "rejected");
  assert.equal(h.counts().posts, 0);
});

test("discarding an unsent review requires current read scope without demanding a new dispatch grant", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  h.ports.authorize = async (_prepared, writing) => { if (writing) throw new Error("New dispatch disabled"); };
  assert.equal((await h.service.discard("alice", i.id, h.ports)).state, "discarded");
  assert.equal(h.counts().posts, 0);
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SuccessorCommands, SuccessorDispatchWithheld, type SuccessorPorts, type PreparedSuccessor } from "../packages/commands/run-successors.ts";
import { CommandError } from "../packages/commands/index.ts";
import { externalKey } from "../packages/contracts/index.ts";
import { successorReceiptSchema, type SuccessorReviewInput } from "../packages/contracts/run-successors.ts";
import { type NativeCommandReceipt } from "../packages/contracts/native-run-commands.ts";
import { Store } from "../packages/storage/store.ts";

const now = Date.parse("2026-11-14T00:00:00.000Z");
const runId = randomUUID(), sessionId = randomUUID(), sourceId = "source-a";
const runKey = externalKey(sourceId, runId);
function input(): SuccessorReviewInput {
  return { id: randomUUID(), runKey, kind: "continue", expiresAt: new Date(now + 60_000).toISOString(), input: "private prompt" };
}
function accepted(p: PreparedSuccessor): NativeCommandReceipt {
  const newId = randomUUID();
  return { object: "demian.run_command_receipt", version: 1, command_id: p.native.command.commandId,
    session_id: sessionId, source_run_id: runId, kind: p.native.command.kind, outcome: "accepted", rejection_code: null,
    new_run_id: newId, task_root_run_id: newId, relation: "continues", created_at: new Date(now).toISOString(),
    expires_at: p.native.command.expiresAt };
}
function setup(path = ":memory:") {
  const store = new Store(path), service = new SuccessorCommands(store);
  let posts = 0, prepares = 0, lookups = 0;
  const ports: SuccessorPorts = {
    now: () => now,
    async authorize() {},
    async prepare(i) {
      prepares++;
      return { target: { runKey: i.runKey, sourceId, runId, sessionId, sourceStatus: "failed", expectedCursor: "7",
        sourceIdentity: "private-source-proof", binding: null }, scopeIdentity: "private-scope-proof",
      native: { command: { version: 1, commandId: i.id, sourceRunId: runId, kind: i.kind, expectedSessionHead: "a".repeat(64),
        expectedSourceStatus: "failed", expectedAuthoritySha256: "b".repeat(64), expiresAt: i.expiresAt },
      ...(i.input === undefined ? {} : { input: [{ type: "input_text" as const, text: i.input }] }) } };
    },
    async dispatch(p) { posts++; return accepted(p); },
    async lookup() { lookups++; return { object: "demian.run_command_status", version: 1, status: "not_found", receipt: null }; },
    async observeAccepted() { return true; },
  };
  return { store, service, ports, counts: () => ({ posts, prepares, lookups }) };
}
const code = (expected: string) => (error: unknown) => error instanceof CommandError && error.code === expected;

test("a proved final pre-fetch fence rejection is durable without inventing uncertain transmission", async t => {
  for (const detail of ["authority_changed", "review_changed", "deadline_passed"] as const) {
    const h = setup(); t.after(() => h.store.close()); const i = input();
    await h.service.review("alice", i, h.ports);
    h.ports.dispatch = async () => { throw new SuccessorDispatchWithheld(detail); };
    const result = await h.service.dispatch("alice", i.id, h.ports);
    assert.equal(result.state, detail === "deadline_passed" ? "expired" : "rejected");
    assert.equal(result.detail, detail); assert.equal(h.counts().posts, 0);
    assert.equal(h.store.db.prepare("SELECT input_json FROM successor_intents WHERE id=?").get(i.id)!.input_json, null);
  }
});

test("review is idempotent, canonical-digested, private, and never sends", async t => {
  const h = setup(); t.after(() => h.store.close());
  const i = input(), first = await h.service.review("alice", i, h.ports);
  assert.deepEqual(await h.service.review("alice", { input: i.input, expiresAt: i.expiresAt, kind: i.kind, runKey, id: i.id }, h.ports), first);
  assert.deepEqual(h.counts(), { posts: 0, prepares: 1, lookups: 0 });
  await assert.rejects(h.service.review("alice", { ...i, input: "different" }, h.ports), code("idempotency_conflict"));
  await assert.rejects(h.service.review("alice", { ...i, expiresAt: new Date(now + 70_000).toISOString() }, h.ports), code("idempotency_conflict"));
  assert.equal(successorReceiptSchema.safeParse(first).success, true);
  assert.deepEqual(Object.keys(first).sort(), ["id", "runKey", "sourceId", "runId", "sessionId", "kind", "sourceStatus", "expectedCursor", "state", "detail", "expiresAt", "createdAt", "updatedAt", "newRunId", "relation", "observationState"].sort());
  assert.doesNotMatch(JSON.stringify(first), /private|actor|native|digest|scopeIdentity|sourceIdentity/);
});

test("deadline and strict input fences run before I/O", async t => {
  const h = setup(); t.after(() => h.store.close());
  h.ports.authorize = async () => { throw new Error("must not call"); };
  for (const raw of [{ ...input(), expiresAt: new Date(now + 120_001).toISOString() },
    { ...input(), expiresAt: new Date(now).toISOString() }, { ...input(), extra: true }, { ...input(), kind: "retry" }]) {
    await assert.rejects(h.service.review("alice", raw, h.ports), (e: unknown) => e instanceof CommandError && e.status === 400);
  }
  assert.equal(h.counts().prepares, 0);
});

test("equivalent ISO offsets, omitted milliseconds, and UUID case canonicalize before prepare and digest", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  const prepare = h.ports.prepare;
  h.ports.prepare = async value => {
    assert.equal(value.expiresAt, i.expiresAt); assert.equal(value.id, i.id);
    return prepare(value);
  };
  const receipt = await h.service.review("alice", { ...i, id: i.id.toUpperCase(), expiresAt: "2026-11-14T09:01:00+09:00" }, h.ports);
  assert.deepEqual(await h.service.review("alice", { ...i, expiresAt: "2026-11-14T00:01:00Z" }, h.ports), receipt);
  assert.deepEqual(await h.service.review("alice", i, h.ports), receipt);
  assert.equal(h.counts().prepares, 1);
});

test("prepared native identity, body and target fences", async t => {
  for (const mutate of [
    (p: PreparedSuccessor) => { p.native.command.commandId = randomUUID(); },
    (p: PreparedSuccessor) => { p.native.input![0]!.text = "changed"; },
    (p: PreparedSuccessor) => { p.target.sourceId = "other"; },
    (p: PreparedSuccessor) => { p.native.command.expiresAt = new Date(now + 90_000).toISOString(); },
    (p: PreparedSuccessor) => { Object.assign(p.target, { surprise: true }); },
  ]) {
    const h = setup(); t.after(() => h.store.close()); const prepare = h.ports.prepare;
    h.ports.prepare = async i => { const p = await prepare(i); mutate(p); return p; };
    await assert.rejects(h.service.review("alice", input(), h.ports), code("invalid_preparation"));
    assert.equal(h.store.db.prepare("SELECT count(*) AS n FROM successor_intents").get()!.n, 0);
  }
});

test("CAS permits one POST and removes stored input before invoking native", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  let calls = 0;
  h.ports.dispatch = async p => {
    calls++;
    const row = h.store.db.prepare("SELECT * FROM successor_intents").get()!;
    assert.equal(row.input_json, null); assert.doesNotMatch(JSON.stringify(row), /private prompt/);
    assert.deepEqual(p.native.input, [{ type: "input_text", text: i.input }]);
    await Promise.resolve(); return accepted(p);
  };
  await Promise.all([h.service.dispatch("alice", i.id, h.ports), h.service.dispatch("alice", i.id, h.ports)]);
  assert.equal(calls, 1);
  assert.equal((await h.service.get("alice", i.id, h.ports)).state, "accepted");
});

test("committed POST with lost ACK survives reopen, uses only lookup, and blocks new IDs", async t => {
  const dir = mkdtempSync(join(tmpdir(), "successor-test-"));
  const path = join(dir, "store.db"), h = setup(path), i = input();
  let reopened: Store | undefined;
  t.after(() => { reopened?.close(); rmSync(dir, { recursive: true, force: true }); });
  let posts = 0, committed: NativeCommandReceipt;
  h.ports.dispatch = async p => { posts++; committed = accepted(p); throw new Error("lost ACK secret"); };
  await h.service.review("alice", i, h.ports);
  assert.equal((await h.service.dispatch("alice", i.id, h.ports)).state, "unknown");
  h.store.close();
  const resumed = setup(path); reopened = resumed.store;
  resumed.ports.dispatch = h.ports.dispatch;
  resumed.ports.now = () => now + 200_000;
  assert.equal((await resumed.service.get("alice", i.id, resumed.ports)).state, "unknown");
  assert.equal((await resumed.service.dispatch("alice", i.id, resumed.ports)).state, "unknown");
  await assert.rejects(resumed.service.review("alice", { ...input(), expiresAt: new Date(now + 250_000).toISOString() }, resumed.ports), code("successor_pending"));
  resumed.ports.lookup = async p => {
    assert.equal(p.native.input, undefined); assert.equal(p.native.command.commandId, i.id);
    return { object: "demian.run_command_status", version: 1, status: "found", receipt: committed! };
  };
  const page = await resumed.service.list("alice", runKey, resumed.ports);
  assert.equal(page.receipts[0]!.state, "accepted"); assert.equal(posts, 1);
});

test("crashed dispatching row stays unknown on not_found and cannot be discarded", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  h.store.db.prepare("UPDATE successor_intents SET state='dispatching',input_json=NULL").run();
  assert.equal((await h.service.get("alice", i.id, h.ports)).state, "unknown");
  assert.equal((await h.service.discard("alice", i.id, h.ports)).state, "unknown");
  assert.equal((await h.service.dispatch("alice", i.id, h.ports)).state, "unknown");
  assert.equal(h.counts().posts, 0);
});

test("pre-POST revocation is durably rejected, sanitized, and sends zero writes", async t => {
  for (const phase of [1, 2]) {
    const h = setup(); t.after(() => h.store.close()); const i = input();
    await h.service.review("alice", i, h.ports); let checks = 0;
    h.ports.authorize = async () => { if (++checks === phase) throw new Error("secret credentials"); };
    await assert.rejects(h.service.dispatch("alice", i.id, h.ports), code("authority_changed"));
    assert.equal(h.counts().posts, 0);
    assert.equal(h.store.db.prepare("SELECT state FROM successor_intents").get()!.state, "rejected");
  }
});

test("authorization after lookup and observation awaits never returns cached receipt", async t => {
  for (const phase of ["lookup", "observation"]) {
    const h = setup(); t.after(() => h.store.close()); const i = input(); let revoked = false;
    h.ports.authorize = async () => { if (revoked) throw new Error("denied"); };
    await h.service.review("alice", i, h.ports);
    if (phase === "lookup") {
      h.ports.dispatch = async () => { throw new Error("lost"); };
      await h.service.dispatch("alice", i.id, h.ports);
      h.ports.lookup = async () => { revoked = true; return { object: "demian.run_command_status", version: 1, status: "not_found", receipt: null }; };
      await assert.rejects(h.service.get("alice", i.id, h.ports), code("authority_changed"));
    } else {
      h.ports.observeAccepted = async () => { revoked = true; return true; };
      await assert.rejects(h.service.dispatch("alice", i.id, h.ports), code("authority_changed"));
      assert.equal(h.store.db.prepare("SELECT state FROM successor_intents").get()!.state, "accepted");
    }
  }
});

test("corrupt native replies become unknown, never automatically resend", async t => {
  for (const mutate of [
    (r: NativeCommandReceipt) => { r.session_id = randomUUID(); },
    (r: NativeCommandReceipt) => { r.command_id = randomUUID(); },
    (r: NativeCommandReceipt) => { r.source_run_id = randomUUID(); },
    (r: NativeCommandReceipt) => { r.expires_at = new Date(now).toISOString(); },
    (r: NativeCommandReceipt) => { Object.assign(r, { extra: true }); },
  ]) {
    const h = setup(); t.after(() => h.store.close()); const i = input(); let posts = 0;
    h.ports.dispatch = async p => { posts++; const r = accepted(p); mutate(r); return r; };
    await h.service.review("alice", i, h.ports);
    assert.equal((await h.service.dispatch("alice", i.id, h.ports)).state, "unknown");
    await h.service.dispatch("alice", i.id, h.ports); assert.equal(posts, 1);
  }
});

test("durable admission precedes observation and read recovery proves exact source identity", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  h.ports.observeAccepted = async () => {
    assert.equal(h.store.db.prepare("SELECT state FROM successor_intents").get()!.state, "accepted");
    throw new Error("temporarily unavailable");
  };
  await h.service.review("alice", i, h.ports);
  const pending = await h.service.dispatch("alice", i.id, h.ports);
  assert.equal(pending.observationState, "pending"); assert.deepEqual(h.service.acceptedRunIds(sourceId, "private-source-proof"), []);
  h.ports.observeAccepted = async () => true;
  const result = await h.service.get("alice", i.id, h.ports);
  assert.equal(result.observationState, "observed");
  assert.deepEqual(h.service.acceptedRunIds(sourceId, "private-source-proof"), [result.newRunId]);
  assert.deepEqual(h.service.acceptedRunIds(sourceId, "other-proof"), []);
  assert.deepEqual(h.service.acceptedRunIds("other-source", "private-source-proof"), []);
  await assert.rejects(h.service.get("bob", i.id, h.ports), code("receipt_not_found"));
  assert.deepEqual(await h.service.list("bob", runKey, h.ports), { receipts: [], hasMore: false });
  assert.deepEqual(await h.service.list("alice", externalKey(sourceId, randomUUID()), h.ports), { receipts: [], hasMore: false });
});

test("only prepared reviews expire or discard and same ID cannot renew", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  assert.equal((await h.service.discard("alice", i.id, h.ports)).detail, "review_discarded");
  assert.equal((await h.service.review("alice", i, h.ports)).state, "rejected");
  const next = input(); await h.service.review("alice", next, h.ports);
  h.ports.now = () => now + 61_000;
  const latest = { ...input(), expiresAt: new Date(now + 100_000).toISOString() };
  await h.service.review("alice", latest, h.ports);
  assert.equal((await h.service.get("alice", next.id, h.ports)).state, "expired");
  assert.equal(h.counts().posts, 0);
});

test("list selects newest 100 with hasMore and rechecks access to cached entries", async t => {
  const h = setup(); t.after(() => h.store.close());
  for (let n = 0; n < 102; n++) {
    const i = input(); await h.service.review("alice", i, h.ports); await h.service.discard("alice", i.id, h.ports);
  }
  const page = await h.service.list("alice", runKey, h.ports);
  assert.equal(page.receipts.length, 100); assert.equal(page.hasMore, true);
  h.ports.authorize = async p => { if (p) throw new Error("revoked"); };
  await assert.rejects(h.service.list("alice", runKey, h.ports), code("authority_changed"));
});

test("reviewed binding stays private and survives descriptor-only observation recovery", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  const binding = { sourceId, runId, projectSourceId: "tasks", projectId: "project", taskId: "task",
    taskRevision: "9", projectTitle: "Project", taskTitle: "Task", provenance: "operator" as const };
  const prepare = h.ports.prepare;
  h.ports.prepare = async value => { const p = await prepare(value); p.target.binding = binding; return p; };
  h.ports.observeAccepted = async p => { assert.deepEqual(p.target.binding, binding); assert.equal(p.native.input, undefined); return false; };
  const review = await h.service.review("alice", i, h.ports);
  assert.equal("binding" in review, false);
  await h.service.dispatch("alice", i.id, h.ports);
  await new SuccessorCommands(h.store).get("alice", i.id, h.ports);
});

test("deadline passing during final authorization prevents POST and clears input", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports); let checks = 0;
  h.ports.authorize = async () => { if (++checks === 2) h.ports.now = () => now + 61_000; };
  assert.equal((await h.service.dispatch("alice", i.id, h.ports)).state, "expired");
  assert.equal(h.counts().posts, 0);
  assert.equal(h.store.db.prepare("SELECT input_json FROM successor_intents").get()!.input_json, null);
});

test("review changed rejection is durable and distinct from revoked authority", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  await h.service.review("alice", i, h.ports);
  h.ports.authorize = async () => { throw new CommandError(409, "review_changed", "private details"); };
  await assert.rejects(h.service.dispatch("alice", i.id, h.ports), code("review_changed"));
  assert.deepEqual({ ...h.store.db.prepare("SELECT state,detail FROM successor_intents").get() }, { state: "rejected", detail: "review_changed" });
  assert.equal(h.counts().posts, 0);
});

test("strict native rejection is durable and never observed or resent", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input(); let posts = 0;
  h.ports.dispatch = async p => { posts++; return { ...accepted(p), outcome: "rejected", rejection_code: "active_run",
    new_run_id: null, task_root_run_id: null, relation: null }; };
  h.ports.observeAccepted = async () => { assert.fail("rejection must not be observed"); };
  await h.service.review("alice", i, h.ports);
  assert.equal((await h.service.dispatch("alice", i.id, h.ports)).detail, "native_rejected");
  assert.equal((await h.service.get("alice", i.id, h.ports)).state, "rejected");
  await h.service.dispatch("alice", i.id, h.ports); assert.equal(posts, 1);
});

test("concurrent same-ID reviews prepare safely and different IDs elect one unresolved review", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  const reviews = await Promise.all([h.service.review("alice", i, h.ports), h.service.review("alice", i, h.ports)]);
  assert.deepEqual(reviews[0], reviews[1]);
  await h.service.discard("alice", i.id, h.ports);
  const attempts = await Promise.allSettled([h.service.review("alice", input(), h.ports), h.service.review("alice", input(), h.ports)]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(h.counts().posts, 0);
});

test("native receipt expiry matches the reviewed instant across ISO offsets", async t => {
  const h = setup(); t.after(() => h.store.close()); const i = input();
  h.ports.dispatch = async p => ({ ...accepted(p), expires_at: "2026-11-14T09:01:00+09:00" });
  await h.service.review("alice", i, h.ports);
  const receipt = await h.service.dispatch("alice", i.id, h.ports);
  assert.equal(receipt.state, "accepted"); assert.equal(receipt.expiresAt, i.expiresAt);
});

test("malformed, removed, or altered staged input fails safely before any POST", async t => {
  for (const body of ["{", JSON.stringify([{ type: "image", text: "private wrong type" }]),
    JSON.stringify([{ type: "input_text", text: "private substituted text" }]), null]) {
    const h = setup(); t.after(() => h.store.close()); const i = input();
    await h.service.review("alice", i, h.ports);
    h.store.db.prepare("UPDATE successor_intents SET input_json=?").run(body);
    await assert.rejects(h.service.dispatch("alice", i.id, h.ports), error => {
      assert.doesNotMatch(String(error), /private|substituted|wrong type/);
      return code("invalid_stored_intent")(error);
    });
    assert.equal(h.counts().posts, 0);
  }
});

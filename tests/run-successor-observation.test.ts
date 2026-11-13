import assert from "node:assert/strict";
import { test } from "node:test";
import { configSchema } from "../apps/api/config.ts";
import { sourceIdentity } from "../apps/api/source-identity.ts";
import { projectSuccessorSnapshot } from "../apps/api/run-successor-observation.ts";
import { SuccessorCommands, type SuccessorPorts } from "../packages/commands/run-successors.ts";
import { externalKey, type Snapshot, type SourceView } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";
import { missionFlow } from "../packages/projection/mission-flow.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = "owner@example.com", clock = Date.parse("2026-11-14T00:00:00.000Z"), now = new Date(clock).toISOString();
async function fixture(t: test.TestContext) {
  const store = new Store(":memory:"), journal = new SuccessorCommands(store); t.after(() => store.close());
  const config = configSchema.parse({ port: 14345, database: join(tmpdir(), "unused.sqlite"), publicOrigin: "https://track.example.invalid",
    auth: { mode: "proxy", secretFile: join(tmpdir(), "unused-proxy"), users: [actor] }, sources: [
      { id: "native", kind: "demian", label: "Native", device: "test", users: [actor], baseUrl: "https://native.example.invalid" },
      { id: "projects", kind: "projects", label: "Projects", device: "test", users: [actor] },
    ] });
  const sources: SourceView[] = [{ id: "native", kind: "demian", label: "Native", device: "test", state: "connected", capabilities: [], lastObservedAt: now, detail: "Scope" },
    { id: "projects", kind: "projects", label: "Projects", device: "test", state: "connected", capabilities: [], lastObservedAt: now, detail: "", authorizedProjectIds: [id(20), id(22)] }];
  for (const n of [1, 2]) {
    store.observeRun({ sourceId: "native", runId: id(n), sessionId: id(10), workspaceId: id(11), title: `Run ${n}`, status: n === 1 ? "failed" : "queued",
      createdAt: now, startedAt: n === 1 ? now : null, completedAt: n === 1 ? now : null, observedAt: new Date().toISOString() });
    store.bind({ sourceId: "native", runId: id(n), projectSourceId: "projects", projectId: id(20), taskId: id(21), taskRevision: "1",
      projectTitle: "Project", taskTitle: "Task", provenance: "operator" }, actor);
  }
  store.ingest({ sourceId: "native", runId: id(1), sequence: "1", type: "run.failed", occurredAt: now, data: { status: "failed", redacted: true } });
  const input = { id: id(30), runKey: externalKey("native", id(1)), kind: "retry" as const, expiresAt: new Date(clock + 60_000).toISOString() };
  const ports: SuccessorPorts = { now: () => clock, authorize: async () => {}, prepare: async input => ({
    target: { runKey: input.runKey, sourceId: "native", runId: id(1), sessionId: id(10), sourceStatus: "failed", expectedCursor: "1",
      sourceIdentity: sourceIdentity(config.sources[0]!), binding: null }, scopeIdentity: "private-proof", native: { command: { version: 1, commandId: input.id,
      sourceRunId: id(1), kind: input.kind, expectedSessionHead: "a".repeat(64), expectedSourceStatus: "failed", expectedAuthoritySha256: "b".repeat(64), expiresAt: input.expiresAt } } }),
    dispatch: async prepared => ({ object: "demian.run_command_receipt", version: 1, command_id: prepared.native.command.commandId,
      source_run_id: id(1), session_id: id(10), kind: "retry", outcome: "accepted", rejection_code: null, new_run_id: id(2), task_root_run_id: id(1),
      relation: "retry_of", created_at: now, expires_at: input.expiresAt }), lookup: async () => ({ object: "demian.run_command_status", version: 1, status: "not_found", receipt: null }),
    observeAccepted: async () => true };
  const raw = () => store.snapshot(actor, sources), project = (snapshot = raw()) => projectSuccessorSnapshot(snapshot, config, journal);
  const admit = async () => { await journal.review(actor, input, ports); return journal.dispatch(actor, input.id, ports); };
  return { store, journal, config, sources, raw, project, admit, ports, input };
}

test("only admitted and observed owner receipts enter current Run views; journal bytes and statuses stay unchanged", async t => {
  const f = await fixture(t), original = JSON.stringify(f.store.events(externalKey("native", id(1))));
  const legacy = f.raw(); assert.equal(f.project(legacy), legacy, "No receipt metadata preserves the exact legacy snapshot");
  await f.journal.review(actor, f.input, f.ports);
  assert.equal(f.project().runs.some(run => run.nativeCommandLink), false);
  await f.journal.dispatch(actor, f.input.id, f.ports);
  const value = f.project(), child = value.runs.find(run => run.runId === id(2))!;
  assert.equal(child.nativeCommandLink?.state, "observed"); assert.equal(child.status, "queued");
  assert.equal(JSON.stringify(f.store.events(externalKey("native", id(1)))), original);
  assert.doesNotMatch(JSON.stringify(value), /expectedSessionHead|expectedAuthority|scopeIdentity|sourceIdentity|private-proof|input_json/);
  assert.equal(f.raw().runs.some(run => run.nativeCommandLink), false, "Derived metadata is not persisted as a source observation");
  assert.deepEqual(f.project(value), value, "Projection is idempotent including coverage text");
});

test("writer revocation preserves read-only history while another actor and remapped source cannot borrow the receipt", async t => {
  const f = await fixture(t); await f.admit();
  assert.equal(f.project().runs.find(run => run.runId === id(2))!.nativeCommandLink?.state, "observed", "No writer grant is needed to read owned history");
  const other: Snapshot = { ...f.raw(), user: "other@example.com" };
  f.config.auth = { mode: "local", user: other.user };
  assert.equal(f.project(other).runs.some(run => run.nativeCommandLink), false);
  f.config.auth = { mode: "local", user: actor }; f.config.sources[0]!.baseUrl = "https://remapped.example.invalid";
  assert.equal(f.project().runs.some(run => run.nativeCommandLink), false);
});

test("missing/withdrawn predecessor, project or Native grant withholds all predecessor identifiers", async t => {
  const f = await fixture(t); await f.admit(); const value = f.project();
  for (const mutate of [
    (snapshot: Snapshot) => { snapshot.runs = snapshot.runs.filter(run => run.runId !== id(1)); },
    (snapshot: Snapshot) => { snapshot.runs.find(run => run.runId === id(1))!.stale = true; },
    (snapshot: Snapshot) => { snapshot.sources.find(source => source.id === "native")!.authorizedRunIds = [id(2)]; },
    (snapshot: Snapshot) => { snapshot.sources.find(source => source.id === "projects")!.authorizedProjectIds = []; },
  ]) {
    const current = structuredClone(value); mutate(current);
    const child = f.project(current).runs.find(run => run.runId === id(2))!;
    assert.equal(child.nativeCommandLink?.state, "unavailable"); assert.doesNotMatch(JSON.stringify(child.nativeCommandLink), /commandId|sourceRunId|rootRunId/);
  }
});

test("a hidden old root is nullable without inventing a missing node or losing the currently authorized direct edge", async t => {
  const f = await fixture(t); await f.admit();
  f.store.db.prepare("UPDATE successor_intents SET receipt_json=json_set(receipt_json,'$.task_root_run_id',?)").run(id(99));
  const current = f.project(), child = current.runs.find(run => run.runId === id(2))!;
  assert.ok(child.nativeCommandLink?.state === "observed"); assert.equal(child.nativeCommandLink.receipt.rootRunId, null);
  const model = missionFlow(child, current.runs, [], []);
  assert.equal(model.edges.filter(edge => edge.kind === "native-command-retry").length, 1);
  assert.equal(model.incomplete, true); assert.doesNotMatch(JSON.stringify(model), new RegExp(id(99)));
});

test("current Task rebinding does not erase admitted Run causality or infer a Projects dependency", async t => {
  const f = await fixture(t); await f.admit();
  f.store.bind({ sourceId: "native", runId: id(1), projectSourceId: "projects", projectId: id(22), taskId: id(23), taskRevision: "2",
    projectTitle: "Another", taskTitle: "Another Task", provenance: "operator" }, actor);
  const current = f.project(), model = missionFlow(current.runs.find(run => run.runId === id(2))!, current.runs, [], []);
  assert.equal(model.edges.filter(edge => edge.kind === "native-command-retry").length, 1);
  assert.equal(model.edges.some(edge => edge.kind === "dependency"), false);
});

test("corrupt receipt identity fails closed with partial coverage; no prompt or stored authority escapes", async t => {
  const f = await fixture(t); await f.admit();
  f.store.db.prepare("UPDATE successor_intents SET receipt_json=json_set(receipt_json,'$.source_run_id',?)").run(id(98));
  const observation = f.journal.acceptedObservations(actor); assert.equal(observation.incomplete, true); assert.deepEqual(observation.observations, []);
  const current = f.project(); assert.equal(current.runs.some(run => run.nativeCommandLink), false);
  assert.match(current.sources[0]!.detail, /일부 제외/); assert.doesNotMatch(JSON.stringify(current), new RegExp(id(98)));
});

test("conflicting accepted receipts for one successor and duplicate current identities never choose a winner", async t => {
  const f = await fixture(t); await f.admit();
  const current = f.project();
  const duplicated = { ...current, runs: [...current.runs, { ...current.runs.find(run => run.runId === id(2))!, key: "conflicting-key" }] };
  assert.equal(f.project(duplicated).runs.find(run => run.runId === id(2))!.nativeCommandLink?.state, "unavailable");
  f.store.db.prepare(`INSERT INTO successor_intents(actor,id,run_key,digest,state,detail,private_json,input_json,receipt_json,observed,created_at,updated_at)
    SELECT actor,?,run_key,digest,state,detail,json_set(private_json,'$.command.commandId',?),NULL,json_set(receipt_json,'$.command_id',?),observed,created_at,updated_at
    FROM successor_intents WHERE id=?`).run(id(31), id(31), id(31), f.input.id);
  const child = f.project().runs.find(run => run.runId === id(2))!;
  assert.deepEqual(child.nativeCommandLink, { state: "unavailable", reason: "ambiguous-receipt" });
});

test("receipt observation is a bounded recent owner window; disconnected source notice carries no old relation detail", async t => {
  const f = await fixture(t); await f.admit();
  const insert = f.store.db.prepare(`INSERT INTO successor_intents(actor,id,run_key,digest,state,detail,private_json,input_json,receipt_json,observed,created_at,updated_at)
    SELECT actor,?,run_key,digest,state,detail,json_set(private_json,'$.command.commandId',?),NULL,
      json_set(receipt_json,'$.command_id',?,'$.new_run_id',?),observed,?,updated_at FROM successor_intents WHERE id=?`);
  for (let n = 0; n < 1000; n++) insert.run(id(n + 100), id(n + 100), id(n + 100), id(n + 2000),
    new Date(clock + n + 1).toISOString(), f.input.id);
  const window = f.journal.acceptedObservations(actor); assert.equal(window.observations.length, 1000); assert.equal(window.incomplete, true);
  assert.equal(window.observations.some(value => value.receipt.command_id === f.input.id), false);
  const source = f.project().sources[0]!; assert.match(source.detail, /최근 1000건.*일부 제외/);
  const disconnected = f.project(); disconnected.sources[0]!.state = "disconnected";
  assert.doesNotMatch(f.project(disconnected).sources[0]!.detail, /후속 명령 관계/);
});

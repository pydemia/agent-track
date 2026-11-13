import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Sources } from "../apps/api/runner.ts";
import { configSchema } from "../apps/api/config.ts";
import { createTrackServer } from "../apps/api/server.ts";
import { AssistantReadService, AssistantReadError } from "../packages/assistant-read/service.ts";
import type { NativeMetadataPage } from "../packages/contracts/native-metadata.ts";
import { externalKey, type Snapshot, type EventView } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";
import { projectTrace } from "../packages/projection/trace.ts";
import { sourceIdentity } from "../apps/api/source-identity.ts";
import { nativeEvidenceFixture } from "./fixtures/native-run-evidence.ts";
import { nativeRunEvidenceViewSchema } from "../packages/contracts/native-run-evidence.ts";

const user = "owner@example.com", ownerId = "sso-sub:" + "a".repeat(64);
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const executionId = uuid(1), roleId = uuid(2), runId = uuid(3), sessionId = uuid(4);
const workspaceId = uuid(5), organizationId = uuid(6), projectId = uuid(7), taskId = uuid(8);
const now = "2026-11-14T00:00:00.000Z", nativeOrigin = "https://protected-native.example";
const key = externalKey("protected", runId);

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

// Synthetic upstream data over real HTTP. Production readers, Sources, SQLite and Track API are exercised.
async function fixture(t: test.TestContext, count = 5) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "track-native-collector-"));
  const paths = Object.fromEntries(["reader", "client", "producer", "projects", "projects-secret"].map(name => [name, join(root, name)]));
  const secret = randomBytes(32).toString("base64url");
  writeFileSync(paths.reader!, secret, { mode: 0o600 });
  writeFileSync(paths["projects-secret"]!, randomBytes(32).toString("base64url"), { mode: 0o600 });
  writeFileSync(paths.projects!, JSON.stringify({ version: 1, user, accountId: projectId, principalId: "projects-reader",
    kid: "test-key", revision: 1, secretFile: paths["projects-secret"] }), { mode: 0o600 });
  const grant = { version: 1, audience: "agent-track", ownerId, principalId: "reader", revision: 1,
    notBefore: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", secretFile: paths.reader };
  const enable = (enabled: boolean) => writeFileSync(paths.producer!, JSON.stringify({ ...grant, enabled })); enable(true);
  let visible = true, projectAllowed = true, missingTask = false;
  let hook = async (_after: string, _limit: number) => {};
  let evidenceHook = async (_after: string, _limit: number) => {};
  let responseHook = (value: unknown): unknown => value;
  const calls: string[] = [], methods: string[] = [];
  const native = { id: executionId, instructionId: executionId, instructionRevision: 1, revision: 1, state: "completed",
    errorCode: null, taskRef: { sourceService: "projects", sourceId: taskId, projectId, revision: 1, state: "todo", asOf: now,
      url: `https://projects.pydemia.ai/?project=${projectId}&view=tasks&item=${taskId}` }, createdAt: now, updatedAt: now,
    trackDemianReferences: [{ roleId, origin: nativeOrigin, organizationId, workspaceId, sessionId, runId, operationId: "original-operation" }],
    roles: [{ id: roleId, assignmentId: "a", workPackageId: "w", membershipId: "m", membershipRevision: 1,
      teamId: "t", teamName: "Team", personaName: "Agent", role: "Writer", responsibility: "contributor",
      state: "completed", runtimeTaskId: "native-task", threadId: null, turnId: null, attempts: 1,
      observation: { basis: "external_run_wall_timestamps_unverified", queuedAt: null,
        startedAt: null, endedAt: null, executionSeconds: null, timingComplete: false } }] };
  const events: NativeMetadataPage["events"]["data"] = Array.from({ length: count }, (_, index) => ({
    api_version: "2026-09-01", run_id: runId, sequence_text: String(index + 1), created_at: now,
    type: ["agent.invocation.started", "tool.started", "tool.completed", "agent.invocation.completed", "run.completed"][index] ?? "future.event",
    data: index < 4 ? { invocation_id: "invocation", ...(index === 1 || index === 2 ? { call_id: "call", name: "workspace.read" } : {}) } : { status: "succeeded" },
  }));
  const metadata = (after: string, limit: number): NativeMetadataPage => {
    const data = events.filter(event => BigInt(event.sequence_text) > BigInt(after)).slice(0, limit);
    const next = data.at(-1)?.sequence_text ?? after;
    return { version: 1, object: "demian.work_runtime.metadata_page", api_version: "2026-09-01",
      run: { id: runId, organization_id: organizationId, workspace_id: workspaceId, session_id: sessionId,
        acting_user_id: uuid(9), service_principal_id: uuid(10), status: "succeeded", created_at: now, started_at: now, completed_at: now,
        correlation_id: "original-operation", binding_sha256: "b".repeat(64), context_sha256: "c".repeat(64), request_sha256: "d".repeat(64) },
      events: { after, through_sequence: String(count), next_after: next, limit, has_more: BigInt(next) < BigInt(count), data } };
  };
  const service = new AssistantReadService({ protocol: 2, configFile: paths.producer!, configuredOwner: () => ownerId,
    port: { scan: () => ({ rows: [{ id: executionId, ordinal: "1" }], through: "1", hasMore: false }),
      execution: () => visible ? native : null, events: () => ({ events: [], hasMore: false }),
      nativeMetadata: async (_actor, _execution, _role, after, limit) => { await hook(after, limit); return metadata(after, limit); },
      nativeEvidence: async (_actor, _execution, _role, after, limit) => {
        await evidenceHook(after, limit);
        const value = nativeEvidenceFixture(after, limit);
        value.run = { ...value.run, ...metadata("0", 1).run };
        value.events.data = value.events.data.map(record => ({ ...record, runId }));
        value.timings = [{ kind: "queue", source: "runs.created_at-to-started_at", startedAt: now, endedAt: now },
          { kind: "wall", source: "runs.started_at-to-completed_at", startedAt: now, endedAt: now }];
        value.artifacts = value.artifacts.map(artifact => ({ ...artifact, sourceRunId: runId }));
        return value;
      } } });
  const upstream = createServer(async (req, res) => {
    calls.push(req.url!); methods.push(req.method!);
    try {
      assert.equal(req.method, "GET");
      assert.equal(req.headers.cookie, undefined);
      let body: unknown;
      if (req.url!.startsWith("/api/integrations/track/v2/")) body = responseHook(await service.handle({ method: req.method!, url: req.url!, headers: req.headers }));
      else if (req.url === "/api/integrations/assistant/v1/capabilities") body = { version: 1, projectsRead: true, tasksRead: true, tasksCreate: false, tasksUpdate: false, resultsAttach: false };
      else if (req.url === "/api/integrations/assistant/v1/projects") body = projectAllowed ? [{ id: projectId, name: "Project", version: 1, access_revision: 1, archived: false }] : [];
      else if (req.url === `/api/integrations/assistant/v1/tasks/${taskId}`) {
        if (missingTask) { res.writeHead(404).end("PRIVATE_ERROR"); return; }
        body = { id: taskId, project_id: projectId, kind: "task", title: "Task", revision: 2, data: { state: "done" } };
      } else { res.writeHead(404).end("No direct native endpoint"); return; }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    } catch (error) { res.writeHead(error instanceof AssistantReadError ? error.status : 500).end("PRIVATE_ERROR"); }
  });
  const baseUrl = await listen(upstream);
  writeFileSync(paths.client!, JSON.stringify({ ...grant, sourceId: "assistant", user, nativeOrigin: baseUrl }), { mode: 0o600 });
  const config = configSchema.parse({ port: 14345, database: join(root, "store.sqlite"), publicOrigin: "http://localhost",
    auth: { mode: "local", user }, sources: [
      { id: "assistant", kind: "assistant", label: "Assistant", device: "test", users: [user], baseUrl,
        assistantUser: user, assistantOwnerId: ownerId, assistantPrincipalId: "reader", assistantCredentialFile: paths.client,
        assistantProtocol: 2, assistantProjectsSourceId: "projects", assistantDemianMappings: [{ origin: nativeOrigin, organizationId, workspaceId, sourceId: "protected" }] },
      { id: "projects", kind: "projects", label: "Projects", device: "test", users: [user], baseUrl,
        projectsUser: user, projectsAccountId: projectId, projectsPrincipalId: "projects-reader", projectsCredentialFile: paths.projects },
      { id: "protected", kind: "demian", label: "Protected Demian", device: "test", users: [user], baseUrl: nativeOrigin,
        organizationId, assistantNativeSourceId: "assistant" },
    ] });
  const store = new Store(config.database), sources = new Sources(store, () => config);
  const track = createTrackServer(store, () => config, root, sources).server, origin = await listen(track);
  t.after(async () => {
    sources.stop();
    for (const server of [track, upstream]) {
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections(); await closed;
    }
    store.close(); assert.equal(dirname(root), realpathSync(tmpdir())); rmSync(root, { recursive: true, force: true });
  });
  const snapshot = async (): Promise<Snapshot> => { const response = await fetch(origin + "/api/snapshot"); assert.equal(response.status, 200); return response.json(); };
  return { config, store, sources, origin, snapshot, calls, methods, enable, events,
    set visible(value: boolean) { visible = value; }, set projectAllowed(value: boolean) { projectAllowed = value; },
    set missingTask(value: boolean) { missingTask = value; }, set hook(value: typeof hook) { hook = value; },
    set evidenceHook(value: typeof evidenceHook) { evidenceHook = value; },
    set responseHook(value: typeof responseHook) { responseHook = value; } };
}

test("protected Assistant HTTP metadata reaches native Run journal, Project binding and Trace without direct credentials", async t => {
  const f = await fixture(t);
  assert.equal(f.store.run(key), undefined);
  const view = await f.snapshot(), run = view.runs[0]!;
  assert.equal(view.runs.length, 1, JSON.stringify({ sources: view.sources, calls: f.calls })); assert.equal(run.key, key); assert.equal(run.runId, runId);
  assert.equal(run.cursor, "5"); assert.equal(run.highWater, "5"); assert.equal(run.incomplete, false);
  assert.equal(run.binding?.taskRevision, "1"); assert.equal(run.binding?.taskId, taskId);
  assert.deepEqual(run.capabilities, ["run.read", "events.read", "run.evidence"]);
  const response = await fetch(`${f.origin}/api/runs/${key}/events`); assert.equal(response.status, 200);
  const page = await response.json() as { events: EventView[] };
  const trace = projectTrace(run, page.events);
  assert.equal(trace.steps.length, 1); assert.equal(trace.steps[0]!.tools.length, 1);
  assert.equal(trace.steps[0]!.tools[0]!.phase, "completed");
  const detail = await fetch(`${f.origin}/api/assistant/assistant/executions/${executionId}`);
  assert.equal(detail.status, 200);
  const linked = await detail.json(); assert.equal(linked.demianLinks.links[0].runKey, key);
  assert.doesNotMatch(JSON.stringify([view, page, linked]), /binding_sha256|context_sha256|request_sha256|acting_user_id|service_principal_id|PRIVATE_ERROR/);
  for (const endpoint of ["lineage", "tools", "files", "artifacts", "orchestration", "session-relations?kind=peer-processing"]) {
    const response = await fetch(`${f.origin}/api/runs/${key}/${endpoint}`);
    assert.equal(response.status, 200, endpoint); assert.equal((await response.json()).state, "unsupported", endpoint);
  }
  assert.ok(f.calls.every(path => path.startsWith("/api/integrations/"))); assert.ok(f.methods.every(method => method === "GET"));
});

test("bounded pages persist the source boundary, resume from durable sequence and replay without duplicate events", async t => {
  const f = await fixture(t, 251);
  const first = (await f.snapshot()).runs[0]!;
  assert.equal(first.cursor, "250"); assert.equal(first.highWater, "251"); assert.equal(first.incomplete, true);
  const second = (await f.snapshot()).runs[0]!;
  assert.equal(second.cursor, "251"); assert.equal(second.incomplete, false);
  await f.snapshot();
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM events").get()!.n, 251);
  assert.equal(f.store.bindingHistory(key).length, 1);
  assert.ok(f.calls.some(path => path.includes("/native?after=250&limit=250")));
  assert.ok(f.calls.some(path => path.includes("/native?after=251&limit=250")));
});

test("revoked reader hides persisted protected Runs and event API; restart requires fresh authority", async t => {
  const f = await fixture(t); await f.snapshot(); f.enable(false);
  assert.equal((await f.snapshot()).runs.length, 0);
  assert.equal((await fetch(`${f.origin}/api/runs/${key}/events`)).status, 404);
  assert.equal(f.store.events(key).events.length, 5);
  const restarted = new Sources(f.store, () => f.config);
  assert.equal(f.store.snapshot(user, restarted.views(user)).runs.length, 0); restarted.stop();
  f.enable(true); assert.equal((await f.snapshot()).runs.length, 1);
});

test("withdrawal during native await and final Project refresh never publishes prior stored Run", async t => {
  const f = await fixture(t); await f.snapshot();
  f.hook = async () => { f.visible = false; };
  assert.equal((await f.snapshot()).runs.length, 0); assert.equal(f.store.events(key).events.length, 5);
  f.visible = true; f.hook = async (_after, limit) => { if (limit === 1) f.projectAllowed = false; };
  assert.equal((await f.snapshot()).runs.length, 0);
  f.projectAllowed = true; f.hook = async () => {}; f.missingTask = true;
  assert.equal((await f.snapshot()).runs.length, 0);
});

test("malformed/private native metadata cannot create a Run or reopen a denied cache", async t => {
  const f = await fixture(t);
  f.responseHook = value => value && typeof value === "object" && "page" in value ? { ...value, private: "PRIVATE_OUTPUT" } : value;
  assert.equal((await f.snapshot()).runs.length, 0); assert.equal(f.store.run(key), undefined);
  f.responseHook = value => value; await f.snapshot();
  f.responseHook = value => value && typeof value === "object" && "page" in value ? { ...value, roleId: uuid(99) } : value;
  assert.equal((await f.snapshot()).runs.length, 0); assert.equal(f.store.events(key).events.length, 5);
});

test("protected configuration forbids credentials, control grants, ambiguous mappings and actor borrowing", async t => {
  const f = await fixture(t), source = f.config.sources[2]!;
  for (const change of [{ tokenFile: join(tmpdir(), "inert") }, { cancelUsers: [user] }, { approvalUsers: [user] },
    { discoverActive: true }, { runIds: [runId] }, { users: ["other@example.com"] }, { baseUrl: "https://wrong.example" }]) {
    const candidate = structuredClone(f.config); Object.assign(candidate.sources[2]!, change);
    assert.equal(configSchema.safeParse(candidate).success, false);
  }
  assert.notEqual(sourceIdentity(source), sourceIdentity({ ...source, assistantNativeSourceId: "different" }));
  await f.sources.refreshProjectGrants("other@example.com");
  assert.equal(f.store.snapshot("other@example.com", f.sources.views("other@example.com")).runs.length, 0);
});

test("separate evidence crosses real HTTP reader and current Project authority without writing the journal", async t => {
  const f = await fixture(t); await f.snapshot();
  const before = JSON.stringify(f.store.events(key));
  const response = await fetch(`${f.origin}/api/runs/${key}/evidence?after=0&limit=2`);
  assert.equal(response.status, 200);
  const body = await response.json(), value = nativeRunEvidenceViewSchema.parse(body);
  assert.equal(value.state, "connected"); assert.equal(value.page!.events.data.length, 2);
  assert.equal(value.page!.events.next_after, "2"); assert.equal(value.page!.events.has_more, true);
  assert.equal(value.executionRef!.executionId, executionId);
  assert.doesNotMatch(JSON.stringify(body), /binding_sha256|context_sha256|request_sha256|acting_user_id|service_principal_id|organization_id|PRIVATE_ERROR/);
  assert.equal(JSON.stringify(f.store.events(key)), before);
  assert.ok(f.calls.some(path => path.endsWith(`/native-evidence?after=2&limit=1`)));
  assert.ok(f.calls.every(path => path.startsWith("/api/integrations/")));
  assert.ok(f.methods.every(method => method === "GET"));
});

test("evidence late grant, role, source or Project withdrawal cannot expose a prior page", async t => {
  for (const revoke of ["role", "grant", "project", "source"] as const) {
    const f = await fixture(t); await f.snapshot();
    const before = JSON.stringify(f.store.events(key));
    f.evidenceHook = async () => {
      if (revoke === "role") f.visible = false;
      if (revoke === "grant") f.enable(false);
      if (revoke === "project") f.projectAllowed = false;
      if (revoke === "source") f.config.sources[2]!.label = "changed source identity";
    };
    const response = await fetch(`${f.origin}/api/runs/${key}/evidence?after=0&limit=250`), body = await response.json();
    assert.notEqual(body.state, "connected", revoke); assert.equal(body.page ?? null, null, revoke);
    assert.equal(JSON.stringify(f.store.events(key)), before, revoke);
  }
});

test("evidence rejects malformed pages, unsupported queries and writes instead of mutating the Run", async t => {
  const f = await fixture(t); await f.snapshot();
  const before = JSON.stringify(f.store.events(key)), path = `${f.origin}/api/runs/${key}/evidence`;
  const nativeCalls = () => f.calls.filter(url => url.includes("native-evidence")).length;
  const count = nativeCalls();
  for (const query of ["?after=01", "?after=9223372036854775808", "?after=0&after=1", "?limit=251", "?extra=1"])
    assert.equal((await fetch(path + query)).status, 400, query);
  assert.equal((await fetch(path, { method: "POST" })).status, 405); assert.equal(nativeCalls(), count);
  f.responseHook = value => value && typeof value === "object" && "page" in value &&
    (value.page as { object?: string })?.object === "demian.work_runtime.evidence_page" ? { ...value, private: "PRIVATE_OUTPUT" } : value;
  const response = await fetch(path), body = await response.json();
  assert.equal(response.status, 404); assert.equal(body.error, "run_not_found"); assert.equal(body.page ?? null, null);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_OUTPUT|binding_sha256/);
  assert.equal(JSON.stringify(f.store.events(key)), before);
});

test("Project withdrawal during final signed evidence confirmation also hides the page", async t => {
  const f = await fixture(t); await f.snapshot();
  f.evidenceHook = async (_after, limit) => { if (limit === 1) f.projectAllowed = false; };
  const response = await fetch(`${f.origin}/api/runs/${key}/evidence?after=0&limit=250`), body = await response.json();
  assert.notEqual(body.state, "connected"); assert.equal(body.page ?? null, null);
});

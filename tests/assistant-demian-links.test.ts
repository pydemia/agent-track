import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantAuthority, AssistantAuthorityError, type AssistantReader } from "../apps/api/assistant-authority.ts";
import { AssistantDemianLinks } from "../apps/api/assistant-demian-links.ts";
import { ProjectsAuthority } from "../apps/api/projects-authority.ts";
import { ProjectsClient } from "../packages/adapters/projects/index.ts";
import { AssistantClient } from "../packages/adapters/assistant/index.ts";
import { DemianClient } from "../packages/adapters/demian/index.ts";
import { Store } from "../packages/storage/store.ts";
import { sourceIdentity } from "../apps/api/source-identity.ts";
import type { Config, SourceConfig } from "../apps/api/config.ts";
import type { AssistantCapabilitiesV2, AssistantExecutionMetadataV2 } from "../packages/contracts/assistant.ts";
import type { AssistantExecutionView } from "../packages/contracts/assistant-view.ts";
import type { SourceView } from "../packages/contracts/index.ts";

const uuid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const executionId = uuid(1), roleId = uuid(2), projectId = uuid(3), taskId = uuid(4);
const runId = uuid(5), sessionId = uuid(6), workspaceId = uuid(7), organizationId = uuid(8), principalId = uuid(9);
const user = "synthetic@example.test", ownerId = `sso-sub:${"a".repeat(64)}`;
const now = "2026-11-12T00:00:00.000Z", origin = "https://producer.example.invalid";
const operationId = "synthetic-operation";

// Only remote ports are synthetic: real HTTP/fetch, SQLite observations/pins,
// AssistantAuthority orchestration and AssistantDemianLinks projection are exercised.
async function fixture(t: TestContext, timeout = 10_000) {
  const directory = mkdtempSync(join(tmpdir(), "assistant-links-synthetic-"));
  const tokenFile = join(directory, "native-token"), credentialFile = join(directory, "assistant.json"), secretFile = join(directory, "assistant-secret");
  writeFileSync(tokenFile, "synthetic-native-token"); writeFileSync(secretFile, "s".repeat(48));
  const store = new Store(":memory:");
  const calls: string[] = [], methods: string[] = [];
  let nativeHook = async (_path: string) => {};
  let capsHook = async () => {}, projectsHook = async () => {};
  let capsCalls = 0, projectCalls = 0, meCalls = 0, taskCalls = 0;
  let status = 200, transport = false, granted = true;
  let nativeState: SourceView["state"] = "connected";
  const me = { object: "demian.user", id: principalId, organization_id: organizationId, email: "private-profile" };
  const run = { id: runId, session_id: sessionId, status: "succeeded", created_at: now, started_at: now, completed_at: now,
    work_runtime: { correlation_id: operationId } };
  const session = { id: sessionId, workspace_id: workspaceId, title: "private-native-title" };
  const caps: AssistantCapabilitiesV2 = { version: 2, service: "assistant", audience: "agent-track", ownerId,
    principalId: "reader", revision: "1", executionsRead: true, eventsRead: true, controls: false,
    listLimit: 50, eventLimit: 100, demianReferencesSupported: true };
  const execution: AssistantExecutionMetadataV2 = { id: executionId, instructionId: roleId, instructionRevision: "1", revision: "1",
    state: "completed", errorCode: null, task: { projectId, taskId, revision: "1", state: "todo", observedAt: now },
    roles: [{ id: roleId, assignmentId: "assignment", workPackageId: "work", teamId: "team", membershipId: "member",
      membershipRevision: "1", label: "synthetic-role", teamLabel: "team", agentLabel: "agent", responsibility: "accountable",
      state: "completed", attempts: 1, runtime: { taskId: "assistant-runtime-task", threadId: "private-native-thread", turnId: "private-native-turn",
        demian: { origin, organizationId, workspaceId, sessionId, runId, operationId } },
      observation: { queuedAt: now, startedAt: now, endedAt: now, seconds: null, timingComplete: false, basis: "external_run_wall_timestamps_unverified" } }],
    createdAt: now, updatedAt: now };
  const server = createServer(async (req, res) => {
    try {
      const path = req.url!; calls.push(path); methods.push(req.method!);
      if (path.startsWith("/api/integrations/track/")) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(path.endsWith("capabilities") ? caps : execution)); return;
      }
      assert.equal(req.headers.authorization, `Bearer ${String(req.headers.authorization).endsWith("rotated") ? "synthetic-rotated" : "synthetic-native-token"}`);
      assert.equal(req.headers["x-demian-organization-id"], organizationId);
      if (path === "/api/v1/me") meCalls++;
      await nativeHook(path);
      if (transport) { req.socket.destroy(); return; }
      res.writeHead(status, { "Content-Type": "application/json" });
      const body = path === "/api/v1/me" ? me : path === `/api/v1/runs/${runId}` ? run : path === `/api/v1/sessions/${run.session_id}` ? session : null;
      if (!body) { res.end(JSON.stringify({ unexpected: path })); return; }
      res.end(JSON.stringify(status === 200 ? body : { error: "private-native-error" }));
    } catch { res.destroy(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  writeFileSync(credentialFile, JSON.stringify({ version: 1, audience: "agent-track", sourceId: "assistant", user, ownerId,
    principalId: "reader", revision: 1, notBefore: "2020-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", nativeOrigin: baseUrl, secretFile }));
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close();
    for (const file of [tokenFile, credentialFile, secretFile]) unlinkSync(file);
    rmdirSync(directory);
  });
  const common = { users: [user], device: "synthetic", runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 };
  const source: SourceConfig = { ...common, id: "assistant", kind: "assistant", label: "Assistant", baseUrl,
    assistantCredentialFile: credentialFile, assistantUser: user, assistantOwnerId: ownerId, assistantPrincipalId: "reader",
    assistantProtocol: 2, assistantProjectsSourceId: "projects", assistantDemianMappings: [{ origin, organizationId, workspaceId, sourceId: "native" }] };
  const peer: SourceConfig = { ...common, id: "projects", kind: "projects", label: "Projects", baseUrl,
    projectsCredentialFile: credentialFile, projectsUser: user, projectsAccountId: projectId, projectsPrincipalId: "reader" };
  const native: SourceConfig = { ...common, id: "native", kind: "demian", label: "Native", baseUrl, tokenFile, organizationId };
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: baseUrl, auth: { mode: "local", user }, sources: [source, peer, native] };
  const project = { id: projectId, title: "synthetic-project", revision: "1", accessRevision: "1", archived: false };
  const task = { id: taskId, projectId, title: "synthetic-task", revision: "1", state: "done" as const, requiresTest: true };
  class TaskPort extends ProjectsClient {
    override async task(actualTask: string, actualProject: string) {
      taskCalls++; assert.deepEqual([actualTask, actualProject], [taskId, projectId]); return { ...task };
    }
  }
  const port = new TaskPort({ sourceId: peer.id, baseUrl, credentialFile, user, accountId: projectId, principalId: "reader" });
  class ProjectsPort extends ProjectsAuthority {
    override async refresh(actor: string) { assert.equal(actor, user); projectCalls++; await projectsHook(); }
    override view(): SourceView { return { id: peer.id, kind: "projects", label: peer.label, device: peer.device, state: "connected", lastObservedAt: now, detail: "synthetic", capabilities: [], authorizedProjectIds: granted ? [projectId] : [] }; }
    override catalog() { return granted ? [project] : []; }
    override client() { return port; }
  }
  const projects = new ProjectsPort(store, () => config);
  const reader: AssistantReader = {
    capabilities: async () => { capsCalls++; await capsHook(); return { ...caps }; },
    execution: async () => structuredClone(execution),
    executions: async () => ({ version: 2, observedAt: now, executions: [structuredClone(execution)], cursor: null, hasMore: false, omitted: 0, complete: false }),
    events: async () => ({ version: 2, observedAt: now, executionId, events: [], cursor: "0", hasMore: false, complete: false }),
  };
  let authority: AssistantAuthority;
  const links = new AssistantDemianLinks(() => config, actor => store.snapshot(actor, [authority.view(source, actor), projects.view(),
    { id: native.id, kind: "demian", label: native.label, device: native.device, state: nativeState, lastObservedAt: now, detail: "synthetic", capabilities: [] }]), async () => {});
  authority = new AssistantAuthority(store, () => config, projects, options => { assert.equal(options.protocol, 2); return reader; }, timeout, links);
  for (const value of config.sources) assert.equal(store.pinSourceIdentity(value.id, sourceIdentity(value)), true);
  const seed = (sourceId = "native", sid = sessionId, wid = workspaceId) => store.observeRun({ sourceId, runId, sessionId: sid, workspaceId: wid,
    title: "known-synthetic-run", status: "succeeded", createdAt: now, startedAt: now, completedAt: now, observedAt: now });
  seed();
  return { authority, source, peer, native, config, store, execution, caps, me, run, session, calls, methods, task, seed, tokenFile, credentialFile, baseUrl,
    read: () => authority.detail(user, source.id, executionId),
    get counts() { return { capsCalls, projectCalls, meCalls, taskCalls }; },
    set nativeHook(h: typeof nativeHook) { nativeHook = h; }, set capsHook(h: typeof capsHook) { capsHook = h; }, set projectsHook(h: typeof projectsHook) { projectsHook = h; },
    set status(v: number) { status = v; }, set transport(v: boolean) { transport = v; }, set granted(v: boolean) { granted = v; }, set nativeState(v: SourceView["state"]) { nativeState = v; } };
}
function safe(view: AssistantExecutionView, linked: boolean) {
  assert.equal(view.native.roles[0]!.runtime.threadId, null); assert.equal(view.native.roles[0]!.runtime.turnId, null);
  assert.equal((view.native as AssistantExecutionMetadataV2).roles[0]!.runtime.demian, null);
  assert.doesNotMatch(JSON.stringify(view), /producer\.example|private-native|private-profile|synthetic-native-token/);
  assert.equal(view.demianLinks?.links.length, linked ? 1 : 0, `link state: ${view.demianLinks?.state ?? "missing"}`);
  if (!linked) for (const id of [runId, sessionId, workspaceId, operationId]) assert.ok(!JSON.stringify(view).includes(id));
}
async function denied(pending: Promise<unknown>, status: number) {
  await assert.rejects(pending, e => e instanceof AssistantAuthorityError && e.status === status && e.message === "assistant_authority_unavailable");
}

test("real native HTTP and real Authority join only known Run and sanitize BFF", async t => {
  const f = await fixture(t); const result = await f.read(); safe(result, true);
  assert.equal(result.demianLinks?.state, "connected"); assert.equal(result.demianLinks?.links[0]?.operationId, operationId);
  assert.equal(result.currentTask?.task.id, taskId); assert.equal(f.counts.taskCalls, 2);
  assert.deepEqual(f.calls, ["/api/v1/me", `/api/v1/runs/${runId}`, `/api/v1/sessions/${sessionId}`, `/api/v1/runs/${runId}`, `/api/v1/sessions/${sessionId}`, "/api/v1/me"]);
  assert.ok(f.methods.every(method => method === "GET"));
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM runs").get()?.n, 1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n, 0);
});

test("explicit v2 AssistantClient uses real loopback protocol; native methods parse real DTOs", async t => {
  const f = await fixture(t);
  const client = new AssistantClient({ sourceId: "assistant", baseUrl: f.baseUrl, credentialFile: f.credentialFile, user, ownerId, principalId: "reader", protocol: 2 });
  assert.equal((await client.capabilities()).version, 2);
  assert.deepEqual((await client.execution(executionId) as AssistantExecutionMetadataV2).roles[0]!.runtime.demian, f.execution.roles[0]!.runtime.demian);
  assert.ok(f.calls.every(path => path.startsWith("/api/integrations/track/v2/")));
  const native = new DemianClient({ sourceId: "native", baseUrl: f.baseUrl, tokenFile: f.tokenFile, organizationId });
  assert.deepEqual(await native.identity(), { userId: principalId, organizationId });
  const observed = await native.observeRuntime(runId); assert.equal(observed.operationId, operationId); assert.equal(observed.run.workspaceId, workspaceId);
});

for (const mismatch of ["organization", "principal switch", "operation", "session", "workspace", "missing receipt", "403", "transport"] as const) {
  test(`prior links removed on native ${mismatch}`, async t => {
    const f = await fixture(t); safe(await f.read(), true);
    if (mismatch === "organization") f.me.organization_id = uuid(20);
    if (mismatch === "principal switch") f.nativeHook = async path => { if (path === "/api/v1/me" && f.counts.meCalls % 2 === 0) f.me.id = uuid(21); };
    if (mismatch === "operation") f.run.work_runtime.correlation_id = "wrong-operation";
    if (mismatch === "session") { f.run.session_id = uuid(22); f.session.id = uuid(22); }
    if (mismatch === "workspace") f.session.workspace_id = uuid(23);
    if (mismatch === "missing receipt") Reflect.deleteProperty(f.run, "work_runtime");
    if (mismatch === "403") f.status = 403;
    if (mismatch === "transport") f.transport = true;
    const result = await f.read(); safe(result, false); assert.equal(result.native.id, executionId);
    assert.notEqual(result.demianLinks?.state, "connected");
  });
}
for (const reason of ["evil origin", "wrong mapping org", "wrong mapping workspace", "missing Run", "other source Run", "known wrong session", "known wrong workspace"] as const) {
  test(`no native fetch for ${reason}`, async t => {
    const f = await fixture(t);
    if (reason === "evil origin") f.execution.roles[0]!.runtime.demian!.origin = "https://evil.example.invalid";
    if (reason === "wrong mapping org") f.source.assistantDemianMappings![0]!.organizationId = uuid(20);
    if (reason === "wrong mapping workspace") f.source.assistantDemianMappings![0]!.workspaceId = uuid(20);
    if (["missing Run", "other source Run", "known wrong session", "known wrong workspace"].includes(reason)) {
      f.store.db.exec("DELETE FROM runs");
      if (reason === "other source Run") f.seed("other-native");
      if (reason === "known wrong session") f.seed("native", uuid(20));
      if (reason === "known wrong workspace") f.seed("native", sessionId, uuid(20));
    }
    safe(await f.read(), false); assert.deepEqual(f.calls, []);
  });
}
for (const phase of ["mid-read", "final capabilities", "final Projects"] as const) {
  for (const change of ["token contents", "source URL", "native grant"] as const) {
    test(`${change} rotation at ${phase} removes links`, async t => {
      const f = await fixture(t); safe(await f.read(), true);
      const mutate = async () => {
        if (change === "token contents") writeFileSync(f.tokenFile, "synthetic-rotated");
        if (change === "source URL") f.native.baseUrl = "http://127.0.0.1:1";
        if (change === "native grant") f.nativeState = "forbidden";
      };
      if (phase === "mid-read") f.nativeHook = async path => { if (path.startsWith("/api/v1/runs/")) await mutate(); };
      if (phase === "final capabilities") f.capsHook = async () => { if (f.counts.capsCalls === 4) await mutate(); };
      if (phase === "final Projects") f.projectsHook = async () => { if (f.counts.projectCalls === 4) await mutate(); };
      if (change === "source URL") await denied(f.read(), 403);
      else safe(await f.read(), false);
    });
  }
}

test("current Projects revocation in final refresh blocks entire execution", async t => {
  const f = await fixture(t); safe(await f.read(), true);
  f.projectsHook = async () => { if (f.counts.projectCalls === 4) f.granted = false; };
  await denied(f.read(), 404);
});
for (const change of ["owner", "actor", "Task"] as const) {
  test(`current Assistant/actual Projects ${change} enforced before native reads`, async t => {
    const f = await fixture(t);
    if (change === "owner") f.caps.ownerId = `sso-sub:${"b".repeat(64)}`;
    if (change === "actor") f.source.assistantUser = "other@example.test";
    if (change === "Task") f.task.id = uuid(20);
    await denied(f.read(), change === "Task" ? 503 : 403); assert.deepEqual(f.calls, []);
  });
}

test("native fetch shares Authority overall deadline", async t => {
  const f = await fixture(t, 100); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  f.nativeHook = async () => held;
  try { await denied(f.read(), 503); assert.equal(f.counts.capsCalls, 1); }
  finally { release(); }
});

test("queued v2 read retains captured scope and allows only one waiter", async t => {
  const f = await fixture(t); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  f.capsHook = async () => { entered(); await held; };
  const first = f.read(); await waiting; const second = f.read();
  await denied(f.read(), 503);
  f.source.assistantCredentialFile = f.tokenFile;
  const checks = [denied(first, 403), denied(second, 403)]; release(); await Promise.all(checks);
  assert.deepEqual(f.calls, []);
});


for (const method of ["list", "events"] as const) {
  test(`${method} sanitizes producer references and rechecks late native visibility`, async t => {
    const f = await fixture(t);
    const read = async () => {
      if (method === "list") {
        const page = await f.authority.list(user, "assistant");
        assert.equal(page.executions.length, 1); return page.executions[0]!;
      }
      return (await f.authority.events(user, "assistant", executionId)).execution;
    };
    safe(await read(), true);
    f.projectsHook = async () => { if (f.counts.projectCalls === 4) f.nativeState = "forbidden"; };
    safe(await read(), false);
  });
}

test("v1 configuration does not silently consume v2 producer references", async t => {
  const f = await fixture(t);
  const client = new AssistantClient({ sourceId: "assistant", baseUrl: f.baseUrl, credentialFile: f.credentialFile, user, ownerId, principalId: "reader" });
  await assert.rejects(client.capabilities());
  assert.deepEqual(f.calls, ["/api/integrations/track/v1/capabilities"]);
});

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { configSchema } from "../apps/api/config.ts";
import { Sources } from "../apps/api/runner.ts";
import { createTrackServer } from "../apps/api/server.ts";
import { ProjectsClient, ProjectsSourceError } from "../packages/adapters/projects/index.ts";
import { AssistantReadService, AssistantReadError } from "../packages/assistant-read/service.ts";
import type { AssistantExecutionView, AssistantExecutionListView, AssistantExecutionEventsView } from "../packages/contracts/assistant-view.ts";
import { Store } from "../packages/storage/store.ts";

const user = "owner@example.com", other = "other@example.com";
const ownerId = `sso-sub:${"a".repeat(64)}`;
const id = "11111111-1111-4111-8111-111111111111";
const instructionId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const taskId = "44444444-4444-4444-8444-444444444444";
const roleId = "55555555-5555-4555-8555-555555555555";
const prefix = "/api/integrations/track/v1";
const route = "/api/assistant/assistant/executions";
const stamp = new Date().toISOString();

function gate() {
  let release!: () => void, enter!: () => void;
  const waiting = new Promise<void>(resolve => { enter = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  return { waiting, release, hold: async () => { enter(); await blocked; } };
}
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  if (!server.listening) return;
  const done = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await done;
}

// Synthetic native business metadata only: real canonical producer, client transport,
// Track HTTP/authentication and SQLite pins. No production/native provisioning claim.
async function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "track-assistant-api-"));
  const servers: Server[] = [];
  const store = new Store(":memory:");
  t.after(async () => {
    await Promise.all(servers.map(close));
    store.close();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("track-assistant-api-"));
    rmSync(root, { recursive: true, force: true });
  });
  const secret = randomBytes(32).toString("base64url");
  const proxyKey = randomBytes(32).toString("base64url");
  const secretFile = join(root, "reader.key"), proxyFile = join(root, "proxy.key");
  const configFile = join(root, "producer.json"), credentialFile = join(root, "client.json");
  writeFileSync(secretFile, secret); writeFileSync(proxyFile, proxyKey);
  const grant = { version: 1, audience: "agent-track", ownerId, principalId: "reader", revision: 1,
    notBefore: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), secretFile };
  const producer = (enabled: boolean) => writeFileSync(configFile, JSON.stringify({ ...grant, enabled }));
  producer(true);
  const native = { id, instructionId, instructionRevision: 1, revision: 3, state: "completed", errorCode: null,
    taskRef: { sourceService: "projects", sourceId: taskId, projectId, revision: 1, state: "todo",
      url: `https://projects.pydemia.ai/?project=${projectId}&view=tasks&item=${taskId}`, asOf: stamp },
    createdAt: stamp, updatedAt: stamp, body: "PRIVATE_BODY", privateNote: "PRIVATE_NOTE", result: "PRIVATE_RESULT",
    roles: [{ id: roleId, assignmentId: "assignment", workPackageId: "work", membershipId: "member", membershipRevision: 1,
      teamId: "team", teamName: "Team", personaName: "Agent", role: "Writer", responsibility: "contributor", state: "completed",
      runtimeTaskId: "runtime-task-not-demian-run", threadId: "runtime-thread", turnId: "runtime-turn", attempts: 1,
      observation: { basis: "server_dispatch_to_terminal_including_sdk_preparation", queuedAt: null, startedAt: null,
        endedAt: null, executionSeconds: null, timingComplete: false } }] };
  const state = { allowed: true, taskDenied: false, taskProject: projectId, taskIdentity: taskId,
    hook: async (_path: string) => {}, post: (_path: string) => {}, failure: "", paginate: false };
  const calls: string[] = [], taskCalls: string[][] = [], scans: Array<string | null> = [];
  const service = new AssistantReadService({ configFile, configuredOwner: () => ownerId, port: {
    scan: (owner, window) => {
      assert.equal(owner, ownerId); scans.push(window.after);
      return { rows: window.after ? [] : [{ id, ordinal: "2" }], through: "2", hasMore: state.paginate && !window.after };
    },
    execution: (owner, actual) => { assert.equal(owner, ownerId); return actual === id ? native : null; },
    events: (owner, actual, after) => {
      assert.equal(owner, ownerId); assert.equal(actual, id);
      return { events: after === "0" ? [{ executionId: id, sequence: 3, revision: 3, state: "completed", errorCode: null,
        occurredAt: stamp, body: "PRIVATE_EVENT" }] : [], hasMore: false };
    },
  } });
  const nativeServer = createServer(async (req, res) => {
    const path = req.url!; calls.push(path);
    try {
      assert.equal(req.headers.authorization, `Bearer ${secret}`);
      assert.equal(req.headers["x-agent-track-principal"], "reader");
      assert.equal(req.headers["x-track-proxy-key"], undefined);
      assert.equal(req.headers.cookie, undefined);
      await state.hook(path);
      if (state.failure === "disconnect") { req.socket.destroy(); return; }
      if (state.failure === "response") {
        res.writeHead(502, { "x-private": secret, location: "http://PRIVATE.invalid/token" }).end("PRIVATE_ERROR_BODY"); return;
      }
      const value = await service.handle({ method: req.method!, url: path, headers: req.headers });
      state.post(path);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
    } catch (error) {
      res.writeHead(error instanceof AssistantReadError ? error.status : 500).end("PRIVATE_NATIVE_ERROR");
    }
  });
  servers.push(nativeServer);
  const nativeOrigin = await listen(nativeServer);
  writeFileSync(credentialFile, JSON.stringify({ ...grant, sourceId: "assistant", user, nativeOrigin }));
  const common = { device: "fixture", users: [user, other] };
  const config = configSchema.parse({ database: join(root, "unused.sqlite"), publicOrigin: "http://127.0.0.1",
    auth: { mode: "proxy", secretFile: proxyFile, users: [user, other] }, sources: [
      { ...common, id: "assistant", kind: "assistant", label: "Fixture Assistant", baseUrl: nativeOrigin,
        assistantCredentialFile: credentialFile, assistantUser: user, assistantOwnerId: ownerId,
        assistantPrincipalId: "reader", assistantProjectsSourceId: "projects" },
      { ...common, id: "projects", kind: "projects", label: "Fixture Projects", baseUrl: "http://127.0.0.1:1",
        projectsCredentialFile: join(root, "unused-projects.json"), projectsUser: user, projectsAccountId: projectId,
        projectsPrincipalId: "projects-reader" },
      { ...common, id: "pending", kind: "assistant", label: "Not provisioned" },
    ] });
  const sources = new Sources(store, () => config);
  const projects = sources.projects;
  // Keep the instance captured by AssistantAuthority. Only Projects remote ports
  // are fake; these cases do not claim to exercise Projects HTTP or credentials.
  class ScopedFakeTaskClient extends ProjectsClient {
    override async task(actualTask: string, actualProject: string) {
      taskCalls.push([actualTask, actualProject]);
      assert.equal(actualTask, taskId); assert.equal(actualProject, projectId);
      if (state.taskDenied) throw new ProjectsSourceError(403);
      return { id: state.taskIdentity, projectId: state.taskProject, title: "Current task", revision: "2", state: "done" as const, requiresTest: true };
    }
  }
  const client = new ScopedFakeTaskClient({ sourceId: "projects", baseUrl: "http://127.0.0.1:1",
    credentialFile: join(root, "unused-projects.json"), user, accountId: projectId, principalId: "projects-reader" });
  projects.refresh = async actor => { assert.equal(actor, user); };
  projects.view = source => ({ id: source.id, kind: "projects", label: source.label, device: source.device,
    state: "connected", lastObservedAt: stamp, detail: "fixture", capabilities: [] });
  projects.catalog = (source, actor) => {
    assert.equal(source, "projects"); assert.equal(actor, user);
    return state.allowed ? [{ id: projectId, title: "Current project", revision: "2", accessRevision: "3", archived: false }] : [];
  };
  projects.client = (source, actor) => { assert.equal(source, "projects"); assert.equal(actor, user); return client; };
  const { server } = createTrackServer(store, () => config, join(root, "inert-web"), sources);
  servers.push(server);
  const origin = await listen(server);
  const headers = { "x-track-proxy-key": proxyKey, "x-forwarded-email": user };
  async function read(path = route, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    return new Promise<{ status: number; text: string; headers: import("node:http").IncomingHttpHeaders }>((resolve, reject) => {
      const req = request(origin + path, { method: options.method ?? "GET", headers: options.headers ?? {
        ...headers, ...(options.body ? { "content-length": String(Buffer.byteLength(options.body)) } : {}) } }, res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve({ status: res.statusCode!, text: Buffer.concat(chunks).toString(), headers: res.headers }));
      });
      req.on("error", reject); req.end(options.body);
    });
  }
  function safe(value: { text: string; headers: unknown }) {
    const serialized = JSON.stringify(value);
    for (const hidden of ["PRIVATE", secret, proxyKey, nativeOrigin, root]) assert.ok(!serialized.includes(hidden), hidden);
  }
  async function denied(path: string, status: number, options?: Parameters<typeof read>[1]) {
    const result = await read(path, options); assert.equal(result.status, status, result.text); safe(result);
    assert.deepEqual(JSON.parse(result.text), { error: status === 401 ? "authentication_required" : status === 405 ? "unsupported_method"
      : status === 400 ? "invalid_assistant_query" : status === 503 ? "assistant_source_unavailable" : "assistant_scope_unavailable" });
    return result;
  }
  return { read, denied, safe, state, calls, scans, taskCalls, config, sources, store, producer, proxyFile, headers, nativeOrigin };
}

test("HTTP list/detail/events retain native identities and separate historical/current Task metadata", async t => {
  const f = await fixture(t);
  f.state.paginate = true;
  const listed = await f.read(); assert.equal(listed.status, 200, listed.text); f.safe(listed);
  const page: AssistantExecutionListView = JSON.parse(listed.text);
  assert.equal(page.sourceId, "assistant"); assert.equal(page.complete, false); assert.equal(page.hasMore, true);
  assert.ok(page.cursor); assert.equal(page.executions.length, 1);
  assert.deepEqual(f.calls, [prefix + "/capabilities", prefix + "/capabilities", prefix + "/executions", prefix + "/capabilities", prefix + "/capabilities"]);
  const next = await f.read(route + "?cursor=" + encodeURIComponent(page.cursor));
  assert.equal(next.status, 200); assert.deepEqual(JSON.parse(next.text).executions, []); assert.deepEqual(f.scans, [null, "2"]);
  const detail = await f.read(route + "/" + id); assert.equal(detail.status, 200); f.safe(detail);
  const value: AssistantExecutionView = JSON.parse(detail.text);
  assert.equal(value.native.id, id); assert.equal(value.native.instructionId, instructionId);
  assert.equal(value.native.task?.taskId, taskId); assert.equal(value.native.task?.revision, "1"); assert.equal(value.native.task?.state, "todo");
  assert.equal(value.currentTask?.task.id, taskId); assert.equal(value.currentTask?.task.projectId, projectId);
  assert.equal(value.currentTask?.task.revision, "2"); assert.equal(value.currentTask?.task.state, "done");
  assert.equal(value.currentTask?.projectsSourceId, "projects");
  assert.equal(value.native.roles[0]!.id, roleId); assert.equal(value.native.roles[0]!.runtime.taskId, "runtime-task-not-demian-run");
  assert.equal(value.native.roles[0]!.runtime.threadId, "runtime-thread"); assert.equal(value.native.roles[0]!.runtime.turnId, "runtime-turn");
  assert.doesNotMatch(detail.text, /"runId"|"runKey"/);
  const events = await f.read(route + "/" + id + "/events?after=0"); assert.equal(events.status, 200); f.safe(events);
  const eventPage: AssistantExecutionEventsView = JSON.parse(events.text);
  assert.equal(eventPage.page.executionId, id); assert.equal(eventPage.page.cursor, "3"); assert.equal(eventPage.page.events.length, 1);
  const empty = await f.read(route + "/" + id + "/events?after=3");
  assert.equal(empty.status, 200); assert.deepEqual(JSON.parse(empty.text).page.events, []);
  assert.ok(f.taskCalls.every(args => args[0] === taskId && args[1] === projectId));
  for (const table of ["runs", "events", "bindings"]) assert.equal(f.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
});

test("HTTP root authentication and source actor binding reject spoofing before native access", async t => {
  const f = await fixture(t);
  for (const headers of [{}, { authorization: "Basic " + Buffer.from("fixture:PRIVATE").toString("base64") },
    { "x-forwarded-email": user }, { "x-track-proxy-key": "PRIVATE", "x-forwarded-email": user },
    { ...f.headers, "x-forwarded-email": "unknown@example.com" }]) await f.denied(route, 401, { headers });
  await f.denied(route, 403, { headers: { ...f.headers, "x-forwarded-email": other } });
  await f.denied(route.replace("/assistant/executions", "/missing/executions"), 404);
  assert.equal(f.calls.length, 0);
  await f.denied(route + "/" + instructionId, 404);
});

test("HTTP rejects duplicate/unknown queries, unsafe cursors, GET bodies and writes without data forwarding", async t => {
  const f = await fixture(t);
  for (const suffix of ["?cursor=a&cursor=b", "?unknown=1", `/${id}?cursor=a`, `/${id}/events?after=0&after=1`, `/${id}/events?unknown=1`]) await f.denied(route + suffix, 400);
  await f.denied(route, 400, { body: "PRIVATE" });
  for (const method of ["POST", "PUT", "DELETE"]) await f.denied(route, 405, { method });
  assert.equal(f.calls.length, 0);
  for (const suffix of ["?cursor=", "?cursor=%00", `/${id}/events?after=01`, `/${id}/events?after=9007199254740992`, `/${id}/events?after=-1`]) await f.denied(route + suffix, 400);
  assert.ok(f.calls.every(path => path === prefix + "/capabilities"));
});

for (const mode of ["before", "during", "post-response"] as const) test(`HTTP native grant disabled ${mode} never returns cached metadata`, async t => {
  const f = await fixture(t); assert.equal((await f.read()).status, 200);
  if (mode === "before") f.producer(false);
  if (mode === "during") f.state.hook = async path => { if (path === prefix + "/executions/" + id) f.producer(false); };
  if (mode === "post-response") f.state.post = path => { if (path === prefix + "/executions/" + id) f.producer(false); };
  await f.denied(route + "/" + id, 403);
  await f.denied(route + "/" + id, 403);
  if (mode === "post-response") assert.ok(f.calls.includes(prefix + "/executions/" + id));
});

for (const kind of ["list", "detail", "events"] as const) for (const moment of ["before", "during"] as const) {
  test(`HTTP Project scope revoked ${moment} ${kind} suppresses IDs and roles`, async t => {
    const f = await fixture(t); assert.equal((await f.read()).status, 200);
    const path = kind === "list" ? route : route + "/" + id + (kind === "events" ? "/events" : "");
    const hold = gate(); t.after(hold.release);
    if (moment === "before") f.state.allowed = false;
    else f.state.hook = async url => { if (url === prefix + "/executions" + (kind === "list" ? "" : "/" + id + (kind === "events" ? "/events?after=0" : ""))) await hold.hold(); };
    const pending = f.read(path);
    if (moment === "during") { await hold.waiting; f.state.allowed = false; hold.release(); }
    const result = await pending; f.safe(result);
    assert.equal(result.status, kind === "list" ? 200 : 404);
    for (const hidden of [id, roleId, projectId, taskId, "runtime-thread"]) assert.ok(!result.text.includes(hidden));
    if (kind === "list") { assert.deepEqual(JSON.parse(result.text).executions, []); assert.equal(JSON.parse(result.text).omitted, 1); }
    const repeated = await f.read(path); assert.equal(repeated.status, result.status); assert.ok(!repeated.text.includes(id));
  });
}

for (const change of ["proxy key", "root actor", "root actor plus native error"] as const) test(`HTTP reauth after blocked native await: ${change}`, async t => {
  const f = await fixture(t); const hold = gate(); t.after(hold.release);
  f.state.hook = async path => { if (path === prefix + "/executions/" + id) await hold.hold(); };
  const pending = f.read(route + "/" + id);
  await hold.waiting;
  if (change === "proxy key") writeFileSync(f.proxyFile, randomBytes(32).toString("base64url"));
  else { assert.equal(f.config.auth.mode, "proxy"); if (f.config.auth.mode === "proxy") f.config.auth.users = [other]; }
  if (change === "root actor plus native error") f.state.failure = "response";
  hold.release();
  const result = await pending; assert.equal(result.status, 401); f.safe(result);
  assert.deepEqual(JSON.parse(result.text), { error: "authentication_required" });
  await f.denied(route, 401);
});

for (const failure of ["disconnect", "response"]) test(`HTTP native ${failure} returns static 503 without upstream body, headers or URL`, async t => {
  const f = await fixture(t); assert.equal((await f.read()).status, 200);
  f.state.failure = failure;
  await f.denied(route, 503); await f.denied(route, 503);
});

test("HTTP Task mapping must match both identities and fresh denial supersedes successful reads", async t => {
  const f = await fixture(t); const path = route + "/" + id;
  assert.equal((await f.read(path)).status, 200);
  f.state.taskIdentity = instructionId; await f.denied(path, 503);
  f.state.taskIdentity = taskId; f.state.taskProject = instructionId; await f.denied(path, 503);
  f.state.taskProject = projectId; f.state.taskDenied = true;
  await f.denied(path, 404); await f.denied(path, 404);
  assert.equal(f.taskCalls.length, 5);
});

test("placeholder is unsupported and durable source identity pin rejects drift before HTTP", async t => {
  const f = await fixture(t);
  assert.equal(f.sources.views(user).find(source => source.id === "pending")?.state, "unsupported");
  await f.denied("/api/assistant/pending/executions", 403); assert.equal(f.calls.length, 0);
  assert.equal((await f.read()).status, 200);
  const count = f.calls.length;
  f.config.sources[0]!.assistantOwnerId = `sso-sub:${"b".repeat(64)}`;
  await f.denied(route, 403); await f.denied(route, 403); assert.equal(f.calls.length, count);
});

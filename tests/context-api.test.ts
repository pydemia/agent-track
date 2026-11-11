import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { configSchema, type Config } from "../apps/api/config.ts";
import { createTrackServer } from "../apps/api/server.ts";
import { Sources } from "../apps/api/runner.ts";
import { contextPath, contextSummarySchema } from "../packages/context/contracts.ts";
import { Store } from "../packages/storage/store.ts";
import { externalKey, type SourceView } from "../packages/contracts/index.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function listen(server: Server) { await new Promise<void>((done) => server.listen(0, "127.0.0.1", done)); const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }

test("private context API scopes independent readers, verifies original Task/native Runs and never enables commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "track-context-api-")); const user = "owner@example.test"; const at = new Date().toISOString();
  const proxyKey = randomBytes(32).toString("base64url"), contextKey = randomBytes(32).toString("base64url");
  const proxyFile = join(root, "proxy"), secretFile = join(root, "context"), nativeKeyFile = join(root, "projects-key"), credentialFile = join(root, "projects.json");
  await writeFile(proxyFile, proxyKey); await writeFile(secretFile, contextKey); await writeFile(nativeKeyFile, randomBytes(32).toString("base64url"));
  await writeFile(credentialFile, JSON.stringify({ version: 1, user, accountId: id(90), principalId: "reader", kid: "reader", revision: 1, secretFile: nativeKeyFile }));
  let granted = true, revokeDuringRun = false, scopeDuringRun = false, rotateDuringRun = false, nativeDenied = false, nativeConnected = true;
  let writes = 0, taskReads = 0, revision = 1; const runReads: string[] = [];
  let config: Config;
  const native = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method !== "GET") { writes++; response.writeHead(405).end("{}"); return; }
    const path = request.url;
    if (path === "/api/integrations/assistant/v1/capabilities") { response.end(JSON.stringify({ version: 1, projectsRead: true, tasksRead: true, tasksCreate: false, tasksUpdate: false, resultsAttach: false })); return; }
    if (path === "/api/integrations/assistant/v1/projects") { response.end(JSON.stringify(granted ? [id(1), id(9)].map((project) => ({ id: project, name: "PRIVATE_PROJECT", version: 1, access_revision: 1, archived: false })) : [])); return; }
    if (path === `/api/integrations/assistant/v1/tasks/${id(2)}`) {
      if (!granted) { response.writeHead(403).end("{}"); return; }
      taskReads++; response.end(JSON.stringify({ id: id(2), project_id: id(1), kind: "task", title: "PRIVATE_TASK_TITLE", revision,
        body: "PRIVATE_BODY", data: { state: "todo", requires_test: true, acceptance_criteria: ["PRIVATE_CRITERIA"] } })); return;
    }
    const run = /^\/api\/v1\/runs\/([0-9a-f-]+)$/.exec(path ?? "");
    if (run) {
      runReads.push(run[1]!); if (nativeDenied) { response.writeHead(403).end("{}"); return; }
      if (revokeDuringRun) granted = false;
      if (scopeDuringRun) config.contextReaders![0]!.sessionScopes[0]!.sessionIds = [];
      if (rotateDuringRun) await writeFile(secretFile, randomBytes(32).toString("base64url"));
      response.end(JSON.stringify({ id: run[1], session_id: run[1] === id(21) ? id(4) : id(3), status: "succeeded", created_at: at, started_at: at, completed_at: at, output_text: "PRIVATE_OUTPUT" })); return;
    }
    const session = /^\/api\/v1\/sessions\/([0-9a-f-]+)$/.exec(path ?? "");
    if (session) { response.end(JSON.stringify({ object: "demian.session", id: session[1], workspace_id: id(5), title: "PRIVATE_SESSION", agent: "general", provider: "test", model: null,
      mode: "single-agent", permission_policy: "ask", active_run_id: null, archived_at: null })); return; }
    response.writeHead(404).end("{}");
  });
  const nativeBase = await listen(native);
  config = configSchema.parse({ port: 14345, database: join(root, "product.sqlite"), publicOrigin: "https://track.example.test", auth: { mode: "proxy", secretFile: proxyFile, users: [user] },
    sources: [{ id: "projects", kind: "projects", label: "Projects", device: "fixture", users: [user], baseUrl: nativeBase, projectsUser: user, projectsAccountId: id(90), projectsPrincipalId: "reader", projectsCredentialFile: credentialFile },
      { id: "native", kind: "demian", label: "Native", device: "fixture", users: [user], baseUrl: nativeBase }],
    contextReaders: [{ id: "projects-context", purpose: "projects", user, secretFile, nativeSourceIds: ["native"], projectScopes: [{ sourceId: "projects", projectIds: [id(1)] }], sessionScopes: [{ sourceId: "native", sessionIds: [id(3), id(4)] }] }] });
  assert.equal(configSchema.safeParse({ ...config, contextReaders: [{ ...config.contextReaders![0], secretFile: proxyFile }] }).success, false);
  assert.equal(configSchema.safeParse({ ...config, contextReaders: [{ ...config.contextReaders![0], user: "other@example.test" }] }).success, false);
  const store = new Store(config.database);
  for (const n of [20, 21, 22, 23]) {
    store.observeRun({ sourceId: "native", runId: id(n), sessionId: n === 21 ? id(4) : id(3), workspaceId: id(5), title: "PRIVATE_RUN", status: "queued", createdAt: at, startedAt: null, completedAt: null, observedAt: at });
    if (n !== 23) store.bind({ sourceId: "native", runId: id(n), projectSourceId: "projects", projectId: n === 22 ? id(9) : id(1), taskId: n === 22 ? id(10) : id(2),
      taskRevision: "1", projectTitle: "PRIVATE_PROJECT", taskTitle: "PRIVATE_TASK_TITLE", provenance: "operator" }, user);
  }
  const sources = new Sources(store, () => config);
  sources.views = (actor) => actor === user ? [{ id: "native", kind: "demian", label: "Native", device: "fixture", state: nativeConnected ? "connected" : "disconnected", lastObservedAt: at, detail: "fixture", capabilities: ["run.read"] } as SourceView, sources.projects.view(config.sources[0]!, actor)] : [];
  const { server } = createTrackServer(store, () => config, root, sources); const base = await listen(server);
  store.db.prepare(`INSERT INTO task_assignment_receipts(actor,id,project_source_id,project_id,task_id,task_revision,review_sha256,demian_source_id,session_id,session_sha256,request_digest,source_identity,input_sha256,state,run_id,binding_state,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(user,id(70),"projects",id(9),id(10),"1","hash","native",id(3),"hash","hash","hash","hash","accepted",id(23),"pending",at,at);
  const headers = { authorization: `Bearer ${contextKey}`, "x-track-context-reader": "projects-context" };
  const path = contextPath({ kind: "task", sourceId: "projects", projectId: id(1), taskId: id(2) });
  const read = (route = path, extra = {}) => fetch(base + route, { headers: { ...headers, ...extra } });
  try {
    const response = await read(); assert.equal(response.status, 200); const body = await response.text(); assert.doesNotMatch(body, /PRIVATE_|actor|credential|apiToken/);
    const result = contextSummarySchema.parse(JSON.parse(body)); assert.equal(result.counts.runs, 2); assert.equal(result.counts.sessions, 2); assert.equal(result.counts.byStatus.succeeded, 2);
    assert.equal(result.task?.state, "todo"); assert.equal(result.task?.revision, "1"); assert.ok(result.runs.every((run) => run.incomplete), "fresh native status is distinct from the queued journal snapshot"); assert.equal(taskReads, 2);
    assert.ok(result.trackUrl?.includes("run=")); assert.equal(writes, 0);
    assert.equal((await fetch(base + "/api/snapshot", { headers })).status, 401, "service reader cannot authenticate general web API");
    assert.equal((await read(path, { authorization: `Bearer ${proxyKey}` })).status, 401, "proxy key cannot replace service credential");
    assert.equal((await read(path, { "x-forwarded-email": user })).status, 401, "browser/proxy impersonation headers rejected");
    const publicHostStatus = await new Promise<number>((done, reject) => {
      const request = httpRequest(base + path, { headers: { ...headers, host: "track.example.test" } }, (response) => { response.resume(); response.once("end", () => done(response.statusCode!)); });
      request.once("error", reject); request.end();
    });
    assert.equal(publicHostStatus, 401, "public Host rejected even with service credential");
    assert.equal((await fetch(base + path, { method: "POST", headers })).status, 405);
    assert.equal((await read(path + "?user=other@example.test")).status, 400);
    assert.equal((await read(contextPath({ kind: "task", sourceId: "projects", projectId: id(9), taskId: id(10) }))).status, 404);
    const session = contextSummarySchema.parse(await (await read(contextPath({ kind: "session", sourceId: "native", sessionId: id(3) }))).json());
    assert.deepEqual(session.runs.map((run) => run.runId), [id(20)]); assert.equal(session.coverage.unavailable, true);
    assert.ok(!runReads.includes(id(23)), "accepted unbound assignment outside reader Project scope stays hidden");
    nativeDenied = true; const denied = contextSummarySchema.parse(await (await read()).json()); assert.equal(denied.counts.runs, 0); assert.equal(denied.coverage.unavailable, true); nativeDenied = false;
    nativeConnected = false; const offline = contextSummarySchema.parse(await (await read()).json()); assert.equal(offline.counts.runs, 0); assert.equal(offline.coverage.unavailable, true); nativeConnected = true;
    revision = 2; const changed = contextSummarySchema.parse(await (await read()).json()); assert.equal(changed.task?.revision, "2"); assert.ok(changed.runs.every((run) => run.binding?.revision === "1"));
    revokeDuringRun = true; const revoked = await read(); assert.equal(revoked.status, 404); assert.doesNotMatch(await revoked.text(), /PRIVATE_|succeeded|taskId/); revokeDuringRun = false; granted = true;
    scopeDuringRun = true; assert.equal((await read()).status, 403); scopeDuringRun = false; config.contextReaders![0]!.sessionScopes[0]!.sessionIds = [id(3), id(4)];
    rotateDuringRun = true; assert.equal((await read()).status, 401); assert.equal(writes, 0);
    rotateDuringRun = false;
    await writeFile(secretFile, proxyKey);
    assert.equal((await fetch(base + "/api/snapshot", { headers: { "x-track-proxy-key": proxyKey, "x-forwarded-email": user } })).status, 401,
      "different files containing the same proxy/reader secret must fail closed");
    assert.equal((await read(path, { authorization: `Bearer ${proxyKey}` })).status, 401);
    await writeFile(secretFile, contextKey);
    const secondFile = join(root, "second-context"); await writeFile(secondFile, contextKey);
    config.contextReaders!.push({ ...config.contextReaders![0]!, id: "second-context", secretFile: secondFile });
    assert.equal((await read()).status, 401, "two readers cannot reuse a credential value across separate files");
    await writeFile(secondFile, randomBytes(32).toString("base64url"));
    assert.equal((await read()).status, 200, "fresh distinct keys restore only the configured reader scope");
    assert.equal(store.run(externalKey("native", id(20))) !== undefined, true);
  } finally {
    await close(server); await close(native); store.close(); assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith("track-context-api-")); await rm(root, { recursive: true, force: true });
  }
});

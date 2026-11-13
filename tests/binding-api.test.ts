import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTrackServer } from "../apps/api/server.ts";
import { Sources } from "../apps/api/runner.ts";
import type { Config } from "../apps/api/config.ts";
import type { BindingRequest, SourceView } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";
import { listenHttp } from "./helpers/http-listen.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function listen(server: Server) {
  return listenHttp(server);
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }

test("binding HTTP composes native revision, Run identity, CAS, replay and live Project scope without native writes", { timeout: 20_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "track-binding-api-"));
  const secretFile = join(directory, "proxy-key"); const secret = randomBytes(32).toString("hex"); writeFileSync(secretFile, secret);
  const keyFile = join(directory, "native-key"); writeFileSync(keyFile, randomBytes(32).toString("base64url"));
  const credentialFile = join(directory, "credential.json"); const user = "owner@example.com";
  writeFileSync(credentialFile, JSON.stringify({ version: 1, user, accountId: id(10), principalId: "reader", kid: "test", revision: 1, secretFile: keyFile }));
  const now = new Date().toISOString();
  let projects = [id(1), id(2)]; let taskRevision = 1; let denyRun = false;
  let nativeWrites = 0; let nativeReads = 0; let holdTask = false;
  let waiting!: () => void; const waitingTask = new Promise<void>((resolve) => { waiting = resolve; });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const native = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json"); nativeReads++;
    if (request.method !== "GET") { nativeWrites++; response.writeHead(405); response.end("{}"); return; }
    const path = request.url;
    if (path === "/api/integrations/assistant/v1/capabilities") { response.end(JSON.stringify({ version: 1, projectsRead: true, tasksRead: true, tasksCreate: false, tasksUpdate: false, resultsAttach: false })); return; }
    if (path === "/api/integrations/assistant/v1/projects") { response.end(JSON.stringify(projects.map((project, i) => ({ id: project, name: `Project${project === id(1) ? "PrivateA" : "B"}`, version: 1, access_revision: i + 1, archived: false })))); return; }
    if (path === `/api/v1/runs/${id(20)}`) {
      response.statusCode = denyRun ? 403 : 200;
      response.end(JSON.stringify(denyRun ? {} : { id: id(20), session_id: id(21), status: "succeeded", created_at: now, started_at: now, completed_at: now })); return;
    }
    if (path === `/api/v1/sessions/${id(21)}`) { response.end(JSON.stringify({ id: id(21), workspace_id: id(22), title: "QA Run" })); return; }
    if (path === `/api/integrations/assistant/v1/tasks/${id(30)}` || path === `/api/integrations/assistant/v1/tasks/${id(31)}`) {
      const project = path.endsWith(id(30)) ? id(1) : id(2);
      if (holdTask) { waiting(); await gate; }
      if (!projects.includes(project)) { response.writeHead(404); response.end("{}"); return; }
      response.end(JSON.stringify({ id: path.endsWith(id(30)) ? id(30) : id(31), project_id: project, kind: "task", title: project === id(1) ? "PrivateA Task" : "B Task", revision: taskRevision,
        data: { state: "todo", requires_test: true, body: "PRIVATE_BODY", acceptance_criteria: ["PRIVATE_ACCEPTANCE"] }, owner_id: "PRIVATE_OWNER" })); return;
    }
    response.writeHead(404); response.end("{}");
  });
  const base = await listen(native);
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "https://track.example.com", auth: { mode: "proxy", users: [user], secretFile },
    sources: [
      { id: "runtime", kind: "demian", label: "runtime", device: "fixture", users: [user], baseUrl: base, runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 },
      { id: "projects", kind: "projects", label: "Projects", device: "fixture", users: [user], baseUrl: base,
        projectsUser: user, projectsAccountId: id(10), projectsPrincipalId: "reader", projectsCredentialFile: credentialFile,
        runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 },
    ] };
  const store = new Store(":memory:");
  const runKey = store.observeRun({ sourceId: "runtime", runId: id(20), sessionId: id(21), workspaceId: id(22), title: "QA Run", status: "succeeded", createdAt: now, startedAt: now, completedAt: now, observedAt: now });
  const otherKey = store.observeRun({ sourceId: "runtime", runId: id(23), sessionId: id(21), workspaceId: id(22), title: "same-session other Run", status: "succeeded", createdAt: now, startedAt: now, completedAt: now, observedAt: now });
  const sources = new Sources(store, () => config);
  sources.views = (actor) => actor === user ? [{ id: "runtime", kind: "demian", label: "runtime", device: "fixture", state: "connected", lastObservedAt: now, detail: "fixture", capabilities: ["run.read", "binding.write"] } as SourceView,
    sources.projects.view(config.sources[1]!, actor)] : [];
  const { server } = createTrackServer(store, () => config, directory, sources); const track = await listen(server);
  const headers = { "x-track-proxy-key": secret, "x-forwarded-email": user, "content-type": "application/json", origin: config.publicOrigin };
  const post = (input: unknown, extra = {}) => fetch(track + "/api/bindings", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(input) });
  const first: BindingRequest = { id: randomUUID(), runKey, expectedVersion: "0", projectSourceId: "projects", projectId: id(1), taskId: id(30), taskRevision: "1" };
  try {
    assert.equal((await post(first, { origin: "https://elsewhere.example" })).status, 403);
    assert.equal((await post({ ...first, taskTitle: "client title injection" })).status, 400);
    denyRun = true; assert.equal((await post(first)).status, 503); assert.equal(store.bindingHistory(runKey).length, 0); denyRun = false;
    const response = await post(first); assert.equal(response.status, 200); const receipt = (await response.json()).receipt;
    assert.equal(receipt.binding.taskTitle, "PrivateA Task"); assert.equal(receipt.binding.taskRevision, "1");
    assert.equal(store.run(otherKey)!.binding, null, "another Run in the same Session must remain unbound");
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_BODY|PRIVATE_ACCEPTANCE|PRIVATE_OWNER/);
    taskRevision = 2;
    const replay = await post(first); assert.equal(replay.status, 200); assert.deepEqual((await replay.json()).receipt, receipt);
    assert.equal((await post({ ...first, id: randomUUID(), expectedVersion: receipt.version })).status, 409, "changed native task revision must be reviewed");
    assert.equal((await post({ ...first, id: randomUUID(), taskRevision: "2" })).status, 409, "stale binding version must fail");
    const second = { ...first, id: randomUUID(), expectedVersion: receipt.version, projectId: id(2), taskId: id(31), taskRevision: "2" };
    const rebound = await post(second); assert.equal(rebound.status, 200); const secondReceipt = (await rebound.json()).receipt;
    assert.equal(store.bindingHistory(runKey).length, 2);
    projects = [id(2)];
    const current = await fetch(track + `/api/runs/${runKey}/binding`, { headers }); assert.equal(current.status, 200);
    const currentView = await current.json(); assert.equal(currentView.history.length, 1); assert.equal(currentView.current.taskId, id(31));
    assert.doesNotMatch(JSON.stringify(currentView), /PrivateA/);
    assert.equal((await post(first)).status, 404, "a historical receipt cannot disclose a revoked Project");
    projects = [id(1), id(2)]; holdTask = true;
    const pending = post({ ...first, id: randomUUID(), expectedVersion: secondReceipt.version, taskRevision: "2" });
    await waitingTask; projects = []; release();
    assert.equal((await pending).status, 404); assert.equal(store.bindingHistory(runKey).length, 2);
    assert.equal(nativeWrites, 0); assert.ok(nativeReads > 0);
  } finally { release(); await close(server); await close(native); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

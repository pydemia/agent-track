import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { configSchema } from "../apps/api/config.ts";
import { Sources } from "../apps/api/runner.ts";
import { createTrackServer } from "../apps/api/server.ts";
import { Store } from "../packages/storage/store.ts";
import { listenHttp } from "./helpers/http-listen.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("ordinary Native evidence remains usable when an unrelated protected collector fails, without skipping current grants", async t => {
  const root = await mkdtemp(join(tmpdir(), "track-ordinary-evidence-")), actor = "owner@example.test", at = new Date().toISOString();
  const cleanRoot = async () => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert(basename(root).startsWith("track-ordinary-evidence-")); await rm(root, { recursive: true, force: true }); };
  let projectAllowed = true, nativeAllowed = true, withdrawOnRead = false, nativeReads = 0, protectedReads = 0;
  const native = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method !== "GET") { response.writeHead(405).end("{}"); return; }
    if (request.url === `/api/v1/runs/${id(1)}` || request.url === `/api/v1/sessions/${id(2)}`) {
      nativeReads++;
      if (!nativeAllowed) { response.writeHead(403).end("{}"); return; }
      if (withdrawOnRead) projectAllowed = false;
      response.end(JSON.stringify(request.url.includes("/runs/") ? { id: id(1), session_id: id(2), status: "succeeded", created_at: at, started_at: at, completed_at: at }
        : { id: id(2), workspace_id: id(3), title: "PRIVATE_TITLE", provider: "test", mode: "single-agent" })); return;
    }
    response.writeHead(404).end("{}"); // Optional original APIs may be unsupported.
  });
  t.after(async () => { native.closeAllConnections(); if (native.listening) await new Promise<void>(done => native.close(() => done())); await cleanRoot(); });
  const nativeOrigin = await listenHttp(native);
  const config = configSchema.parse({ port: 14345, database: join(root, "track.sqlite"), publicOrigin: "http://127.0.0.1", auth: { mode: "local", user: actor },
    sources: [{ id: "native", kind: "demian", label: "Native", device: "fixture", users: [actor], baseUrl: nativeOrigin },
      { id: "projects", kind: "projects", label: "Projects", device: "fixture", users: [actor] },
      { id: "unrelated-codex", kind: "codex", label: "Codex", device: "fixture", users: [actor] }] });
  const store = new Store(":memory:"), key = store.observeRun({ sourceId: "native", runId: id(1), sessionId: id(2), workspaceId: id(3), title: "PRIVATE_TITLE", status: "succeeded", createdAt: at, startedAt: at, completedAt: at, observedAt: at });
  store.bind({ sourceId: "native", runId: id(1), projectSourceId: "projects", projectId: id(4), taskId: id(5), taskRevision: "1", projectTitle: "PRIVATE_PROJECT", taskTitle: "PRIVATE_TASK", provenance: "operator" }, actor);
  store.observeRun({ sourceId: "unrelated-codex", runId: id(99), sessionId: id(98), workspaceId: null, title: "PRIVATE_CODEX", status: "succeeded", createdAt: at, startedAt: at, completedAt: at, observedAt: at });
  const projectedSources: string[][] = [], originalSnapshot = store.snapshot.bind(store);
  store.snapshot = (user, views, now) => { projectedSources.push(views.map(view => view.id)); return originalSnapshot(user, views, now); };
  const sources = new Sources(store, () => config);
  sources.projects.refresh = async () => {};
  const originalProtectedRefresh = sources.assistantNative.refresh.bind(sources.assistantNative);
  const failedProtectedRefresh = async () => { protectedReads++; throw new Error("Unrelated protected collector unavailable"); };
  sources.assistantNative.refresh = failedProtectedRefresh;
  sources.views = () => [{ id: "native", kind: "demian", label: "Native", device: "fixture", state: "connected", lastObservedAt: at, detail: "fixture", capabilities: [] },
    { id: "projects", kind: "projects", label: "Projects", device: "fixture", state: "connected", lastObservedAt: at, detail: "fixture", capabilities: [], authorizedProjectIds: projectAllowed ? [id(4)] : [] },
    { id: "unrelated-codex", kind: "codex", label: "Codex", device: "fixture", state: "connected", lastObservedAt: at, detail: "fixture", capabilities: [] }];
  const { server } = createTrackServer(store, () => config, root, sources), origin = await listenHttp(server);
  try {
    for (const path of ["tools?include=model-requests", "lineage?after=0", "session-relations?kind=managed-children", "orchestration", "artifacts", "files"]) {
      const response = await fetch(`${origin}/api/runs/${key}/${path}`);
      assert.equal(response.status, 200, path);
      const body = await response.text(); assert(!body.includes("PRIVATE_"));
      assert.equal(protectedReads, 0, path);
    }
    assert(nativeReads > 0, "each supported read still checks the original Native Run/Session");
    assert(projectedSources.length > 0 && projectedSources.every(ids => !ids.includes("unrelated-codex")), "ordinary reads do not project unrelated Run relations");
    sources.assistantNative.refresh = originalProtectedRefresh;
    const ownerSnapshot = await (await fetch(origin + "/api/snapshot")).json();
    sources.assistantNative.refresh = failedProtectedRefresh;
    assert(ownerSnapshot.runs.some((run: { sourceId: string }) => run.sourceId === "unrelated-codex"), "general dashboard retains all authorized sources");
    withdrawOnRead = true;
    const withdrawn = await fetch(`${origin}/api/runs/${key}/tools?include=model-requests`);
    assert.equal(withdrawn.status, 404); assert(!((await withdrawn.text()).includes("PRIVATE_")));
    withdrawOnRead = false; projectAllowed = true; nativeAllowed = false;
    const denied = await (await fetch(`${origin}/api/runs/${key}/tools?include=model-requests`)).json();
    assert.equal(denied.state, "forbidden"); assert.deepEqual(denied.calls, []);
    nativeAllowed = true; config.sources[0]!.assistantNativeSourceId = "protected-assistant";
    const before = nativeReads, protectedResponse = await fetch(`${origin}/api/runs/${key}/tools?include=model-requests`);
    assert.equal(protectedResponse.status, 503, "protected Source keeps its original collection fence");
    assert(protectedReads > 0); assert.equal(nativeReads, before);
  } finally {
    sources.stop(); server.closeAllConnections(); native.closeAllConnections();
    await Promise.all([new Promise<void>(done => server.close(() => done())), new Promise<void>(done => native.close(() => done()))]);
    store.close(); await cleanRoot();
  }
});

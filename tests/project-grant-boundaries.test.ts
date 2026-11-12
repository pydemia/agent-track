import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { artifactEvidence } from "../apps/api/evidence.ts";
import { commandPorts } from "../apps/api/commands.ts";
import type { Config } from "../apps/api/config.ts";
import { Store } from "../packages/storage/store.ts";
import type { SourceView } from "../packages/contracts/index.ts";

test("bound Project policy is freshly read after awaited native evidence and command observations", async () => {
  const store = new Store(":memory:"); const now = new Date().toISOString();
  const runId = "00000000-0000-4000-8000-000000000001"; const sessionId = "00000000-0000-4000-8000-000000000002";
  const user = "owner@example.com"; let policy = true; let cachedGrant = true; let revokeAt = "artifact";
  const native = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === `/api/v1/runs/${runId}`) {
      if (revokeAt === "run") policy = false;
      response.end(JSON.stringify({ id: runId, session_id: sessionId, status: "running", created_at: now, started_at: now, completed_at: null }));
    } else if (request.url === `/api/v1/sessions/${sessionId}`) response.end(JSON.stringify({ id: sessionId, workspace_id: "workspace", title: "fixture" }));
    else if (request.url === `/api/v1/sessions/${sessionId}/artifacts`) {
      if (revokeAt === "artifact") policy = false;
      response.end(JSON.stringify({ object: "list", limit: 100, data: [] }));
    } else { response.writeHead(404); response.end("{}"); }
  });
  await new Promise<void>((resolve) => native.listen(0, "127.0.0.1", resolve));
  const address = native.address(); assert.ok(address && typeof address !== "string");
  const source: Config["sources"][number] = { id: "runtime", kind: "demian", label: "fixture", device: "fixture", users: [user], baseUrl: `http://127.0.0.1:${address.port}`,
    runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 };
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user }, sources: [source] };
  const key = store.observeRun({ sourceId: source.id, runId, sessionId, workspaceId: "workspace", title: "fixture", status: "running", createdAt: now, startedAt: now, completedAt: null, observedAt: now });
  store.bind({ sourceId: source.id, runId, projectSourceId: "projects", projectId: "project", projectTitle: "Project", taskId: "task", taskTitle: "Task", taskRevision: "1", provenance: "operator" }, user);
  const views = (): SourceView[] => [
    { id: source.id, kind: "demian", label: "fixture", device: "fixture", state: "connected", lastObservedAt: now, detail: "fixture", capabilities: ["run.read"] },
    { id: "projects", kind: "projects", label: "fixture", device: "fixture", state: "connected", lastObservedAt: now, detail: "fixture", capabilities: ["projects.read"], authorizedProjectIds: cachedGrant ? ["project"] : [] },
  ];
  const snapshot = (actor: string) => store.snapshot(actor, views());
  let refreshes = 0;
  const refresh = async () => { refreshes++; cachedGrant = policy; };
  try {
    await assert.rejects(artifactEvidence(() => config, snapshot, user, key, refresh), (error: unknown) => error instanceof Error && "status" in error && error.status === 404);
    assert.equal(cachedGrant, false, "evidence must not reuse its earlier allowed Project grant");
    assert.equal(refreshes, 2, "artifact grants are refreshed before and after the native read");
    policy = true; cachedGrant = true; revokeAt = "run";
    const ports = commandPorts(store, () => config, snapshot, user, key, false, refresh);
    await assert.rejects(ports.readRun(), (error: unknown) => error instanceof Error && "code" in error && error.code === "source_forbidden");
    assert.equal(cachedGrant, false, "command observation must refresh policy before returning to the dispatcher");
    assert.equal(refreshes, 4, "command observation retains its own two grant refreshes");
  } finally { native.closeAllConnections(); await new Promise<void>((resolve) => native.close(() => resolve())); store.close(); }
});

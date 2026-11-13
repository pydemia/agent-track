import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createTrackServer } from "../apps/api/server.ts";
import { Sources } from "../apps/api/runner.ts";
import type { Config } from "../apps/api/config.ts";
import { Store } from "../packages/storage/store.ts";

const runId = "00000000-0000-4000-8000-000000000001", sessionId = "00000000-0000-4000-8000-000000000002";
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();assert(address && typeof address !== "string");return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())); }

test("HTTP opt-in preserves old tool replies and rejects malformed negotiation before any native read", async t => {
  const at = new Date().toISOString(), user = "owner@example.test";let nativeReads = 0;
  const native = createServer((request, response) => {
    nativeReads++;response.setHeader("content-type", "application/json");
    if (request.url === `/api/v1/runs/${runId}`) { response.end(JSON.stringify({ id: runId, session_id: sessionId, status: "succeeded", created_at: at, started_at: at, completed_at: at }));return; }
    if (request.url === `/api/v1/sessions/${sessionId}`) { response.end(JSON.stringify({ id: sessionId, workspace_id: "workspace", title: "Fixture" }));return; }
    if (request.url === `/api/v1/runs/${runId}/events?after=0`) {
      response.setHeader("content-type", "text/event-stream");
      response.end(["model.request", "model.request.completed"].map((type, index) => `id: ${index + 1}\ndata: ${JSON.stringify({
        api_version: "2026-09-01", run_id: runId, sequence_text: String(index + 1), created_at: at, type,
        data: { sessionId: "PRIVATE_NATIVE_SESSION", provider: "codex", model: "gpt-6-astra", durationMs: 5, prompt: "PRIVATE_PROMPT" },
      })}\n\n`).join(""));return;
    }
    response.writeHead(404).end("{}");
  });
  const nativeOrigin = await listen(native);t.after(() => close(native));
  const store = new Store(":memory:");t.after(() => store.close());
  const config: Config = { port: 0, database: ":memory:", publicOrigin: "http://127.0.0.1", auth: { mode: "local", user }, sources: [{
    id: "native", kind: "demian", label: "Fixture", device: "fixture", users: [user], baseUrl: nativeOrigin,
    runIds: [runId], discoverActive: false, discoverHistory: false, repositoryRoots: [], maxFiles: 1, sinceDays: 7,
  }] };
  const key = store.observeRun({ sourceId: "native", runId, sessionId, workspaceId: "workspace", title: "Fixture", status: "succeeded", createdAt: at, startedAt: at, completedAt: at, observedAt: at });
  for (const sequence of ["1", "2"]) store.ingest({ sourceId: "native", runId, sequence, type: "model.request", occurredAt: at, data: { redacted: true } });
  const sources = new Sources(store, () => config);
  sources.views = () => [{ id: "native", kind: "demian", label: "Fixture", device: "fixture", state: "connected", lastObservedAt: at, detail: "Fixture", capabilities: ["session.link"] }];
  sources.refreshProjectGrants = async () => {};
  const { server } = createTrackServer(store, () => config, "dist/web", sources), base = await listen(server);t.after(() => close(server));
  const path = base + `/api/runs/${key}/tools`;
  for (const query of ["?include=other", "?include=", "?include=model-requests&include=model-requests", "?include=model-requests&extra=1"]) {
    const response = await fetch(path + query);assert.equal(response.status, 400);await response.body?.cancel();
  }
  const write = await fetch(path + "?include=model-requests", { method: "POST" });assert.equal(write.status, 405);await write.body?.cancel();assert.equal(nativeReads, 0);
  const legacy = await (await fetch(path)).json() as Record<string, unknown>;
  assert.equal(legacy.modelRequests, undefined);assert.equal(legacy.modelRequestCoverage, undefined);assert.equal(legacy.complete, true);
  const enhanced = await (await fetch(path + "?include=model-requests")).json() as { modelRequestCoverage: string; modelRequests: Array<{ phase: string }> };
  assert.equal(enhanced.modelRequestCoverage, "native-model-lifecycle");assert.equal(enhanced.modelRequests[0]?.phase, "ended");
  assert.doesNotMatch(JSON.stringify(enhanced), /PRIVATE_|prompt|sessionId/);
  assert.equal(nativeReads, 10, "each variant reuses one SSE read plus before/after Run+Session checks");
});

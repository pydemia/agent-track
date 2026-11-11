import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTrackServer } from "../apps/api/server.ts";
import type { Config } from "../apps/api/config.ts";
import type { Sources } from "../apps/api/runner.ts";
import type { SourceView } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }

test("file HTTP evidence reauthorizes native and Project access without rewriting immutable journal metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "track-file-api-")); const now = new Date().toISOString(); const user = "owner@example.com";
  const secret = "fixture-secret-with-more-than-32-characters"; const secretFile = join(dir, "key"); writeFileSync(secretFile, secret);
  let granted = true; let cachedGrant = true; let hold = false; let feedStatus = 200; let calls = 0;
  let nativeDenied = false; let revokeNativeDuringFeed = false;
  let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const frame = (n: number, type: string, data: object) => `id: ${n}\ndata: ${JSON.stringify({ api_version: "2026-09-01", run_id: id(1), sequence_text: String(n), type, created_at: now, data })}\n\n`;
  const native = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === `/api/v1/runs/${id(1)}`) {
      if (nativeDenied) { response.writeHead(403); response.end("{}"); return; }
      response.end(JSON.stringify({ id: id(1), session_id: id(2), status: "succeeded", created_at: now, started_at: now, completed_at: now })); return;
    }
    if (request.url === `/api/v1/sessions/${id(2)}`) { response.end(JSON.stringify({ id: id(2), workspace_id: id(3), title: "QA" })); return; }
    if (request.url === `/api/v1/runs/${id(1)}/events?after=0`) {
      calls++; if (hold) { entered(); await gate; }
      response.statusCode = feedStatus; if (feedStatus !== 200) { response.end("{}"); return; }
      response.setHeader("Content-Type", "text/event-stream");
      if (revokeNativeDuringFeed) nativeDenied = true;
      response.end(frame(1, "response.created", {}) + frame(2, "tool.requested", { executor: "codex-app-server", name: "fileChange", callId: "call",
        input: { changes: [{ path: "qa.txt", kind: { type: "add" }, diff: "PRIVATE_BODY" }] } }) + frame(3, "tool.completed", { executor: "codex-app-server", name: "fileChange", callId: "call", ok: true, preview: "PRIVATE_PREVIEW" })); return;
    }
    response.writeHead(404); response.end("{}");
  });
  const nativeBase = await listen(native); const store = new Store(":memory:");
  const key = store.observeRun({ sourceId: "native", runId: id(1), sessionId: id(2), workspaceId: id(3), title: "QA", status: "succeeded", createdAt: now, startedAt: now, completedAt: now, observedAt: now });
  for (let n = 1; n <= 3; n++) store.ingest({ sourceId: "native", runId: id(1), sequence: String(n), type: "response.created", occurredAt: now, data: { redacted: true } });
  store.bind({ sourceId: "native", runId: id(1), projectSourceId: "projects", projectId: id(4), taskId: id(5), taskRevision: "1", projectTitle: "QA Project", taskTitle: "QA Task", provenance: "operator" }, user);
  const original = store.db.prepare("SELECT ordinal,digest,payload FROM events ORDER BY ordinal").all();
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "https://track.example.com", auth: { mode: "proxy", secretFile, users: [user, "other@example.com"] },
    sources: [{ id: "native", kind: "demian", label: "fixture", device: "fixture", users: [user], baseUrl: nativeBase, runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] };
  const sources = { refreshProjectGrants: async () => { cachedGrant = granted; }, views: (actor: string): SourceView[] => actor !== user ? [] : [
    { id: "native", kind: "demian", label: "fixture", device: "fixture", state: "connected", lastObservedAt: now, detail: "fixture", capabilities: ["run.read"] },
    { id: "projects", kind: "projects", label: "fixture", device: "fixture", state: "connected", lastObservedAt: now, detail: "fixture", capabilities: ["projects.read"], authorizedProjectIds: cachedGrant ? [id(4)] : [] },
  ] } as unknown as Sources;
  const { server } = createTrackServer(store, () => config, dir, sources); const base = await listen(server);
  const get = (actor = user) => fetch(`${base}/api/runs/${key}/files`, { headers: { "x-track-proxy-key": secret, "x-forwarded-email": actor } });
  try {
    const success = await get(); assert.equal(success.status, 200); const body = await success.json();
    assert.equal(body.state, "connected"); assert.equal(body.changes[0].state, "reported"); assert.equal(body.complete, true);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|diffContent|"input"|preview|threadId/);
    assert.deepEqual(store.db.prepare("SELECT ordinal,digest,payload FROM events ORDER BY ordinal").all(), original);
    const before = calls; assert.equal((await get("other@example.com")).status, 404); assert.equal(calls, before);
    feedStatus = 403; const denied = await (await get()).json(); assert.equal(denied.state, "forbidden"); assert.deepEqual(denied.changes, []);
    feedStatus = 200; revokeNativeDuringFeed = true;
    const lateNativeDenial = await (await get()).json(); assert.equal(lateNativeDenial.state, "forbidden"); assert.deepEqual(lateNativeDenial.changes, []);
    nativeDenied = false; revokeNativeDuringFeed = false;
    feedStatus = 200; hold = true; const pending = get(); await waiting; granted = false; release();
    assert.equal((await pending).status, 404); assert.deepEqual(store.db.prepare("SELECT ordinal,digest,payload FROM events ORDER BY ordinal").all(), original);
  } finally { release(); await close(server); await close(native); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

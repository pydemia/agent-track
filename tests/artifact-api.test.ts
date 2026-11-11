import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTrackServer } from "../apps/api/server.ts";
import type { Config } from "../apps/api/config.ts";
import type { Sources } from "../apps/api/runner.ts";
import { Store } from "../packages/storage/store.ts";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }

test("artifact HTTP API enforces native and Track grants without caching denied metadata", async () => {
  const directory = mkdtempSync(join(tmpdir(), "track-artifact-api-"));
  const secret = "test-only-private-key-longer-than-32";
  const secretFile = join(directory, "key"); writeFileSync(secretFile, secret);
  const now = new Date().toISOString();
  let artifactStatus = 200;
  let artifactCalls = 0;
  let hold = false;
  let waiting!: () => void;
  const waitingRequest = new Promise<void>((resolve) => { waiting = resolve; });
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const native = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === `/api/v1/runs/${id(1)}`) response.end(JSON.stringify({ id: id(1), session_id: id(2), status: "succeeded", created_at: now, started_at: now, completed_at: now }));
    else if (request.url === `/api/v1/sessions/${id(2)}`) response.end(JSON.stringify({ id: id(2), workspace_id: id(3), title: "fixture" }));
    else if (request.url === `/api/v1/sessions/${id(2)}/artifacts`) {
      artifactCalls++;
      if (hold) { waiting(); await responseGate; }
      response.statusCode = artifactStatus;
      response.end(JSON.stringify(artifactStatus !== 200 ? {} : { object: "list", limit: 100, data: [{ version: 1, object: "demian.artifact", id: id(4), organization_id: id(5), workspace_id: id(3),
        session_id: id(2), owner_user_id: id(6), run_id: id(1), kind: "result", filename: "report.txt", media_type: "text/plain", size_bytes: 4,
        sha256: "a".repeat(64), representation: "original", source_artifact_id: null, source_sha256: null, created_at: now, revoked_at: null,
        content_base64: "PRIVATE_BYTES", outputText: "PRIVATE_OUTPUT" }] }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  const nativeBase = await listen(native);
  let users = ["owner@example.com", "other@example.com"];
  const config = (): Config => ({ port: 14345, database: ":memory:", publicOrigin: "https://track.example.com", auth: { mode: "proxy", secretFile, users },
    sources: [{ id: "native", kind: "demian", label: "native", device: "test", users: ["owner@example.com"], baseUrl: nativeBase,
      runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] });
  const sources = { views: (user: string) => user === "owner@example.com" ? [{ id: "native", kind: "demian", label: "native", device: "test", state: "connected", lastObservedAt: now,
    detail: "fixture", capabilities: ["run.read"] }] : [] } as unknown as Sources;
  const store = new Store(":memory:");
  const key = store.observeRun({ sourceId: "native", runId: id(1), sessionId: id(2), workspaceId: id(3), title: "fixture", status: "succeeded", createdAt: now, startedAt: now, completedAt: now, observedAt: now });
  const { server } = createTrackServer(store, config, directory, sources);
  const base = await listen(server);
  const get = (user = "owner@example.com") => fetch(`${base}/api/runs/${key}/artifacts`, { headers: { "x-track-proxy-key": secret, "x-forwarded-email": user } });
  try {
    const success = await get(); assert.equal(success.status, 200);
    const body = await success.json(); assert.equal(body.artifacts.length, 1); assert.equal(body.complete, false);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|owner_user_id|organization_id|content_base64/);
    assert.equal((await get("other@example.com")).status, 404); assert.equal(artifactCalls, 1);
    artifactStatus = 403;
    const denied = await (await get()).json(); assert.equal(denied.state, "forbidden"); assert.deepEqual(denied.artifacts, []);
    artifactStatus = 200; hold = true;
    const pending = get(); await waitingRequest;
    users = [];
    release();
    const revoked = await pending; assert.equal(revoked.status, 403);
    assert.doesNotMatch(await revoked.text(), /report.txt|PRIVATE_/);
  } finally { release(); await close(server); await close(native); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

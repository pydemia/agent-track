import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../packages/storage/store.ts";
import { createTrackServer } from "../apps/api/server.ts";
import type { Config } from "../apps/api/config.ts";
import type { Sources } from "../apps/api/runner.ts";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
}
test("cancel API composes owner, source grant, origin and native acknowledgement with durable replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "track-command-api-"));
  const secret = "test-only-private-proxy-key-at-least-32";
  const secretFile = join(directory, "proxy-key"); writeFileSync(secretFile, secret);
  const store = new Store(":memory:");
  const now = new Date().toISOString();
  let nativeStatus = "queued";
  let sends = 0;
  const native = createServer((request, response) => {
    const path = request.url;
    response.setHeader("Content-Type", "application/json");
    if (path === "/api/v1/sessions/session") { response.end(JSON.stringify({ id: "session", workspace_id: "ws", title: "controlled check" })); return; }
    if (path === "/api/v1/runs/run/cancel" && request.method === "POST") { sends++; nativeStatus = "cancelled"; }
    else if (path !== "/api/v1/runs/run") { response.writeHead(404); response.end("{}"); return; }
    response.end(JSON.stringify({ id: "run", session_id: "session", status: nativeStatus, created_at: now, started_at: null, completed_at: nativeStatus === "cancelled" ? now : null }));
  });
  const nativeBase = await listen(native);
  let cancelUsers = ["owner@example.com"];
  let owners = ["owner@example.com"];
  const config = (): Config => ({ port: 14345, database: join(directory, "unused.sqlite"), publicOrigin: "https://track.example.com",
    auth: { mode: "proxy", secretFile, users: owners }, sources: [{ id: "native", kind: "demian", label: "native", device: "test",
      users: ["owner@example.com"], cancelUsers, baseUrl: nativeBase, runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] });
  const sources = { views: () => [{ id: "native", kind: "demian", label: "native", device: "test", state: "connected", lastObservedAt: now,
    detail: "fixture", capabilities: ["run.read", "run.cancel"] }] } as unknown as Sources;
  const key = store.observeRun({ sourceId: "native", runId: "run", sessionId: "session", workspaceId: "ws", title: "controlled check",
    status: "queued", createdAt: now, startedAt: null, completedAt: null, observedAt: now });
  const { server } = createTrackServer(store, config, directory, sources);
  const base = await listen(server);
  const headers = { "x-track-proxy-key": secret, "x-forwarded-email": "owner@example.com", "content-type": "application/json",
    origin: "https://track.example.com", "sec-fetch-site": "same-origin" };
  const input = { kind: "cancel", runKey: key, expectedCursor: "0", idempotencyKey: "11111111-1111-4111-8111-111111111111", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const post = (extra = {}, body = input) => fetch(base + "/api/commands/cancel", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ origin: "https://untrusted.example" })).status, 403);
    assert.equal(sends, 0);
    const first = await post(); assert.equal(first.status, 200);
    const receipt = (await first.json()).receipt; assert.equal(receipt.state, "succeeded");
    assert.equal(sends, 1);
    const duplicate = await post(); assert.equal(duplicate.status, 200);
    assert.deepEqual((await duplicate.json()).receipt, receipt); assert.equal(sends, 1);
    const history = await fetch(base + `/api/commands?run=${key}`, { headers });
    assert.equal(history.status, 200); assert.equal((await history.json()).receipts.length, 1);
    cancelUsers = [];
    assert.equal((await post()).status, 403); assert.equal(sends, 1);
    cancelUsers = ["owner@example.com"]; owners = ["owner@example.com", "other@example.com"];
    assert.equal((await post()).status, 403); assert.equal(sends, 1);
  } finally { await close(server); await close(native); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

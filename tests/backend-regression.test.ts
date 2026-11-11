import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { Sources } from "../apps/api/runner.ts";
import { Store } from "../packages/storage/store.ts";
import type { Config } from "../apps/api/config.ts";

test("source kind changes clear cached connected state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "track-source-state-"));
  const store = new Store(":memory:");
  const source: Config["sources"][number] = {
    id: "local", kind: "codex", label: "Local", device: "test", users: ["owner@example.com"],
    logRoot: dir, repositoryRoots: [dir], runIds: [], discoverActive: false, maxFiles: 10, sinceDays: 7,
  };
  let current: Config = {
    port: 14345, database: join(dir, "test.sqlite"), publicOrigin: "https://track.example.com",
    auth: { mode: "local", user: "owner@example.com" }, sources: [source],
  };
  const sources = new Sources(store, () => current);
  const started = sources.start();
  try {
    for (let attempt = 0; attempt < 100 && sources.views("owner@example.com")[0]?.state !== "connected"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(sources.views("owner@example.com")[0]?.state, "connected");

    current = { ...current, sources: [{ ...source, kind: "assistant" }] };
    assert.equal(sources.views("owner@example.com")[0]?.state, "unsupported");
  } finally {
    sources.stop();
    await started;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a late successful stream cannot reopen cached Runs after another Run denies access", { timeout: 5000 }, async () => {
  const now = new Date().toISOString();
  let denied!: () => void;
  const deniedRequest = new Promise<void>((resolve) => { denied = resolve; });
  let opened!: () => void;
  const openedResponse = new Promise<void>((resolve) => { opened = resolve; });
  const native = createServer((request, response) => {
    if (request.url?.startsWith("/api/v1/runs/allowed/events")) {
      setTimeout(() => { response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n"); opened(); }, 50);
    } else if (request.url === "/api/v1/runs/denied") {
      response.writeHead(403); response.end("{}"); denied();
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(request.url === "/api/v1/sessions/session"
        ? { id: "session", workspace_id: "workspace", title: "fixture" }
        : { id: "allowed", session_id: "session", status: "running", created_at: now, started_at: now, completed_at: null }));
    }
  });
  await new Promise<void>((resolve) => native.listen(0, "127.0.0.1", resolve));
  const address = native.address(); assert.ok(address && typeof address !== "string");
  const store = new Store(":memory:");
  store.observeRun({ sourceId: "native", runId: "denied", sessionId: "session", workspaceId: "workspace", title: "old cached Run",
    status: "running", createdAt: now, startedAt: now, completedAt: null, observedAt: now });
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user: "owner@example.com" },
    sources: [{ id: "native", kind: "demian", label: "native", device: "test", users: ["owner@example.com"], baseUrl: `http://127.0.0.1:${address.port}`,
      runIds: ["allowed", "denied"], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] };
  const sources = new Sources(store, () => config);
  const running = sources.start();
  try {
    await Promise.all([deniedRequest, openedResponse]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const views = sources.views("owner@example.com");
    assert.equal(views[0]!.state, "forbidden");
    assert.equal(store.snapshot("owner@example.com", views).runs.length, 0);
  } finally { sources.stop(); await running; native.closeAllConnections(); await new Promise<void>((resolve) => native.close(() => resolve())); store.close(); }
});

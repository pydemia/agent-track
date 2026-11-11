import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test, { describe } from "node:test";
import { Sources } from "../apps/api/runner.ts";
import type { Config } from "../apps/api/config.ts";
import { Store } from "../packages/storage/store.ts";

const user = "owner@example.com";
const now = "2026-11-12T01:00:00.000Z";
const observation = (id: string) => ({ id, session_id: "session", status: "running",
  created_at: now, started_at: now, completed_at: null });
const json = (response: ServerResponse, value: unknown, status = 200) => {
  response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
};
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.ok(predicate(), "source observation did not reach the expected condition");
}
async function fixture(native: Server, runIds = ["first"], options: { seed?: boolean; discover?: boolean; sessions?: string[] } = {}) {
  await new Promise<void>(resolve => native.listen(0, "127.0.0.1", resolve));
  const address = native.address(); assert.ok(address && typeof address !== "string");
  const store = new Store(":memory:");
  if (options.seed !== false) store.observeRun({ sourceId: "native", runId: "first", sessionId: "session", workspaceId: "workspace",
    title: "previous observation", status: "running", createdAt: now, startedAt: now,
    completedAt: null, observedAt: now });
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost",
    auth: { mode: "local", user }, sources: [{ id: "native", kind: "demian", label: "native", device: "test",
      users: [user], baseUrl: `http://127.0.0.1:${address.port}`, runIds, discoverActive: options.discover ?? false,
      ...(options.sessions ? { assignmentSessionIds: options.sessions } : {}),
      repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] };
  const sources = new Sources(store, () => config);
  const running = sources.start();
  return { sources, store, config, state: () => sources.views(user)[0]!,
    snapshot: () => store.snapshot(user, sources.views(user)),
    close: async () => {
      sources.stop(); native.closeAllConnections(); await running;
      await new Promise<void>(resolve => native.close(() => resolve())); store.close();
    } };
}

describe("native source observation and authorization", { concurrency: true }, () => {
test("unreachable native source does not expose persisted Runs before fresh authorization", async () => {
  let requests = 0;
  const f = await fixture(createServer((_request, response) => { requests++; json(response, {}, 503); }));
  try {
    await until(() => requests > 0 && f.state().detail.includes("원본 연결 실패"));
    assert.equal(f.state().state, "forbidden");
    assert.equal(f.snapshot().runs.length, 0);
    assert.equal(f.state().lastObservedAt, null);
    assert.deepEqual(f.state().capabilities, []);
  } finally { await f.close(); }
});

test("a configured source without Runs or discovery cannot claim a successful observation", async () => {
  let requests = 0;
  const f = await fixture(createServer((_request, response) => { requests++; json(response, {}, 503); }), [], { seed: false });
  try {
    await delay(25);
    assert.equal(f.state().state, "forbidden");
    assert.equal(f.state().lastObservedAt, null);
    assert.equal(requests, 0);
  } finally { await f.close(); }
});

test("authenticated empty discovery is distinct from an unconfigured observation scope", async () => {
  const paths: string[] = [];
  const f = await fixture(createServer((request, response) => { paths.push(request.url!); json(response, { data: [] }); }), [], { seed: false, discover: true });
  try {
    await until(() => f.state().state === "connected");
    assert.deepEqual(paths, ["/api/v1/workspaces"]);
    assert.ok(f.state().lastObservedAt);
    assert.equal(f.snapshot().runs.length, 0);
  } finally { await f.close(); }
});

test("an empty Run set validates explicitly configured Sessions before enabling first-Run assignment", async () => {
  const paths: string[] = [];
  const f = await fixture(createServer((request, response) => {
    paths.push(request.url!); json(response, { id: request.url!.split("/").at(-1), workspace_id: "workspace" });
  }), [], { seed: false, sessions: ["one", "two"] });
  try {
    await until(() => f.state().state === "connected");
    assert.deepEqual(paths, ["/api/v1/sessions/one", "/api/v1/sessions/two"]);
    assert.ok(f.state().lastObservedAt); assert.equal(f.snapshot().runs.length, 0);
  } finally { await f.close(); }
});

test("empty-Run Session checks reject denial and mismatched response identity", async () => {
  for (const mode of ["denied", "mismatch"] as const) {
    let reads = 0;
    const f = await fixture(createServer((_request, response) => {
      reads++; json(response, { id: "other", workspace_id: "workspace" }, mode === "denied" ? 403 : 200);
    }), [], { seed: false, sessions: ["one"] });
    try {
      await until(() => reads > 0 && /인증\/조회|원본 연결 실패/.test(f.state().detail));
      assert.equal(f.state().state, "forbidden"); assert.equal(f.state().lastObservedAt, null);
      assert.deepEqual(f.state().capabilities, []);
    } finally { await f.close(); }
  }
});

test("another Run opening later cannot erase a failed stream in the same authorization cycle", async () => {
  let firstStream: ServerResponse | undefined;
  let laterRead: ServerResponse | undefined;
  let lastStream: ServerResponse | undefined;
  const f = await fixture(createServer((request, response) => {
    if (request.url?.startsWith("/api/v1/runs/first/events")) {
      firstStream = response; response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n");
    } else if (request.url === "/api/v1/runs/later") laterRead = response;
    else if (request.url?.startsWith("/api/v1/runs/later/events")) {
      lastStream = response; response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n");
    } else json(response, request.url === "/api/v1/sessions/session"
      ? { id: "session", workspace_id: "workspace", title: "fixture" } : observation("first"));
  }), ["first", "later"]);
  try {
    await until(() => !!laterRead && !!firstStream);
    firstStream!.destroy();
    await until(() => /이벤트 연결|원본 연결 실패/.test(f.state().detail));
    json(laterRead!, observation("later"));
    await until(() => !!lastStream); await delay(25);
    assert.equal(f.state().state, "forbidden");
    assert.equal(f.snapshot().runs.length, 0);
    assert.equal(f.state().lastObservedAt, null);
  } finally { await f.close(); }
});

test("a transport error cannot downgrade a denied source into visible stale observations", async () => {
  let stream: ServerResponse | undefined;
  const f = await fixture(createServer((request, response) => {
    if (request.url?.startsWith("/api/v1/runs/first/events")) {
      stream = response; response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n");
    } else if (request.url === "/api/v1/runs/denied") json(response, {}, 403);
    else json(response, request.url === "/api/v1/sessions/session"
      ? { id: "session", workspace_id: "workspace", title: "fixture" } : observation("first"));
  }), ["first", "denied"]);
  try {
    await until(() => f.state().state === "forbidden" && f.state().detail.includes("인증/조회"));
    assert.ok(stream);
    await until(() => stream!.destroyed);
    stream.destroy(); await delay(25);
    assert.equal(f.state().state, "forbidden");
    assert.equal(f.snapshot().runs.length, 0);
  } finally { await f.close(); }
});

test("denial survives an outage and is cleared only by a complete fresh observation cycle", { timeout: 25_000 }, async () => {
  let mode: "denied" | "outage" | "allowed" = "denied";
  let outageObserved!: () => void;
  const outage = new Promise<void>(resolve => { outageObserved = resolve; });
  const f = await fixture(createServer((request, response) => {
    if (mode !== "allowed") { json(response, {}, mode === "denied" ? 403 : 503); if (mode === "outage") outageObserved(); }
    else if (request.url?.includes("/events?")) {
      response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n");
    } else json(response, request.url === "/api/v1/sessions/session"
      ? { id: "session", workspace_id: "workspace", title: "fixture" } : observation("first"));
  }));
  try {
    await until(() => f.state().detail.includes("인증/조회"));
    mode = "outage"; await outage;
    await until(() => f.state().detail.includes("원본 연결 실패"));
    assert.equal(f.state().state, "forbidden"); assert.equal(f.snapshot().runs.length, 0);
    mode = "allowed";
    // The real collector interval exercises the next generation, not a mocked state.
    for (let attempt = 0; attempt < 120 && f.state().state !== "connected"; attempt++) await delay(100);
    assert.equal(f.state().state, "connected"); assert.equal(f.snapshot().runs[0]?.stale, false);
  } finally { await f.close(); }
});

test("an existing source grant does not publish a newly discovered Run whose stream is unavailable", { timeout: 15_000 }, async () => {
  let newStreamRequested!: () => void;
  const requestSeen = new Promise<void>(resolve => { newStreamRequested = resolve; });
  const f = await fixture(createServer((request, response) => {
    if (request.url?.includes("/events?")) {
      if (request.url.includes("/new/")) { json(response, {}, 503); newStreamRequested(); }
      else { response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n"); }
    } else if (request.url === "/api/v1/sessions/session") json(response, { id: "session", workspace_id: "workspace", title: "fixture" });
    else json(response, observation(request.url!.split("/").at(-1)!));
  }));
  try {
    await until(() => f.state().state === "connected");
    f.config.sources[0]!.runIds.push("new");
    await requestSeen; await until(() => f.state().state === "disconnected");
    assert.deepEqual(f.snapshot().runs.map(run => run.runId), ["first"]);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM runs WHERE run_id='new'").get()!.count, 0);
    assert.equal(f.snapshot().runs[0]?.stale, true);
  } finally { await f.close(); }
});

test("post-denial recovery cannot reuse the stream opened before the denial", { timeout: 25_000 }, async () => {
  let mode: "allowed" | "denied" | "stream-denied" = "allowed";
  let streamReads = 0; let recoveredRead = false;
  const f = await fixture(createServer((request, response) => {
    if (mode === "denied") { json(response, {}, 403); return; }
    if (request.url?.includes("/events?")) {
      streamReads++;
      if (mode === "stream-denied") json(response, {}, 403);
      else { response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n"); }
    } else {
      if (mode === "stream-denied") recoveredRead = true;
      json(response, request.url === "/api/v1/sessions/session"
        ? { id: "session", workspace_id: "workspace", title: "fixture" } : observation("first"));
    }
  }));
  try {
    await until(() => f.state().state === "connected");
    assert.equal(streamReads, 1); mode = "denied";
    for (let attempt = 0; attempt < 120 && f.state().state !== "forbidden"; attempt++) await delay(100);
    assert.equal(f.state().state, "forbidden"); mode = "stream-denied";
    for (let attempt = 0; attempt < 120 && !recoveredRead; attempt++) await delay(100);
    assert.ok(recoveredRead); await delay(50);
    assert.equal(streamReads, 2, "recovery must make a fresh event authorization request");
    assert.equal(f.state().state, "forbidden"); assert.equal(f.snapshot().runs.length, 0);
  } finally { await f.close(); }
});

test("an outage after a fully authorized observation preserves stale Runs without claiming connected", async () => {
  let stream: ServerResponse | undefined;
  const f = await fixture(createServer((request, response) => {
    if (request.url?.startsWith("/events") || request.url?.includes("/events?")) {
      stream = response; response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n");
    } else json(response, request.url === "/api/v1/sessions/session"
      ? { id: "session", workspace_id: "workspace", title: "fixture" } : observation("first"));
  }));
  try {
    await until(() => f.state().state === "connected");
    const lastObservedAt = f.state().lastObservedAt;
    assert.ok(lastObservedAt); stream!.destroy();
    await until(() => f.state().state !== "connected");
    assert.equal(f.state().state, "disconnected");
    assert.equal(f.state().lastObservedAt, lastObservedAt);
    assert.equal(f.snapshot().runs[0]?.stale, true);
  } finally { await f.close(); }
});
});

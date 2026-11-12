import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { SessionRelations, SessionRelationCursors } from "../apps/api/session-relations.ts";
import { createTrackServer } from "../apps/api/server.ts";
import { Sources } from "../apps/api/runner.ts";
import { CommandError } from "../packages/commands/index.ts";
import type { Config, SourceConfig } from "../apps/api/config.ts";
import type { RunView, Snapshot, SourceView } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = "owner@example.test", now = new Date().toISOString(), session = id(2);
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
async function fixture(t: test.TestContext, timeout = 10_000) {
  const granted = new Set([id(90)]), urls: string[] = [];
  const state = { denied: false, denyAfterPage: false, hang: false, extra: false, refresh: async () => {} };
  const raw = (n: number) => ({ object: "demian.managed_child_relation", kind: "managed_child", session_id: session,
    run_id: id(n), operation_id: id(100 + n), parent_invocation_id: "parent", child_invocation_id: `child-${n}`, status: "running" });
  const native = createServer((request, response) => {
    urls.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    if (request.url === `/api/v1/runs/${id(1)}`) {
      if (state.denied) { response.writeHead(403).end("{}"); return; }
      response.end(JSON.stringify({ id: id(1), session_id: session, status: "running", created_at: now, started_at: now, completed_at: null })); return;
    }
    if (request.url === `/api/v1/sessions/${session}`) {
      response.end(JSON.stringify({ id: session, workspace_id: id(91), title: "PRIVATE_NATIVE_TITLE" })); return;
    }
    if (request.url?.startsWith(`/api/v1/sessions/${session}/relations/managed-children?`)) {
      if (state.hang) return;
      const url = new URL(request.url, "http://fixture.test"), after = url.searchParams.get("after");
      if (state.denyAfterPage) state.denied = true;
      response.end(JSON.stringify({ object: "list", session_id: session, data: after ? [raw(5)] : [raw(3), raw(4)],
        next_cursor: after ? null : id(4), has_more: !after, availability: "available", coverage: "managed-child-receipts",
        ...(state.extra ? { output: "PRIVATE_RAW" } : {}) })); return;
    }
    if (request.url?.includes("/relations/peer-processing?")) {
      response.end(JSON.stringify({ object: "list", session_id: session, data: [], next_cursor: null, has_more: false,
        availability: "unconfigured", coverage: "peer-processing-receipts" })); return;
    }
    response.writeHead(404).end("{}");
  });
  t.after(() => close(native));
  const origin = await listen(native);
  const source: SourceConfig = { id: "native", kind: "demian", label: "Native", device: "fixture", users: [user], baseUrl: origin,
    runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 };
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://127.0.0.1:14345",
    auth: { mode: "local", user }, sources: [source] };
  const run = (n: number): RunView => ({ key: `key${n}`, sourceId: source.id, runId: id(n), sessionId: session,
    workspaceId: id(91), title: `Run ${n}`, status: "running", createdAt: now, startedAt: now, completedAt: null, observedAt: now,
    cursor: "0", highWater: "0", incomplete: false, stale: false, sourceLabel: "Native", device: "fixture", sourceState: "connected",
    sourceUrl: null, workspaceKey: null, projectKey: "project", capabilities: ["session.link"],
    binding: { sourceId: source.id, runId: id(n), projectSourceId: "projects", projectId: n === 4 ? id(92) : id(90), taskId: null,
      taskRevision: null, projectTitle: "PRIVATE_PROJECT", taskTitle: null, provenance: "operator" } });
  const runs = [1, 3, 4, 5].map(run);
  const views = (): SourceView[] => [{ id: source.id, kind: source.kind, label: source.label, device: source.device,
    state: "connected", lastObservedAt: now, detail: "Fixture", capabilities: ["session.link"] },
  { id: "projects", kind: "projects", label: "Projects", device: "fixture", state: "connected", lastObservedAt: now,
    detail: "Fixture", capabilities: [], authorizedProjectIds: [...granted] }];
  const snapshot = () => ({ runs, sources: views() }) as Snapshot;
  const service = new SessionRelations(() => config, snapshot, () => state.refresh(), undefined, timeout);
  return { service, config, source, state, runs, views, urls, granted };
}
const isStatus = (status: number) => (error: unknown) => error instanceof CommandError && error.status === status;

test("native HTTP read intersects current Track Project grants and encrypts hidden UUID continuations", async t => {
  const f = await fixture(t);
  const first = await f.service.read(user, "key1", "managed-children");
  assert.equal(first.state, "connected"); assert.equal(first.relations.length, 1);
  assert.equal(first.relations[0]!.runId, id(3)); assert.equal(first.omitted, 1); assert(first.hasMore && first.nextCursor);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_|00000000-0000-4000-8000-000000000004/);
  assert(!Buffer.from(first.nextCursor, "base64url").toString("utf8").includes(id(4)));
  const second = await f.service.read(user, "key1", "managed-children", first.nextCursor);
  assert.equal(second.relations[0]!.runId, id(5)); assert.equal(second.hasMore, false);
  assert(f.urls.some(url => url.includes(`after=${id(4)}`)));
  assert(f.urls.every(url => url.startsWith("GET ")));
});

test("encrypted cursor rejects kind, actor, scope, tamper, expiry and process changes", () => {
  let now = 100; const codec = new SessionRelationCursors(() => now), token = codec.encode(id(3), "owner/session/kind/source");
  assert.equal(codec.decode(token, "owner/session/kind/source"), id(3));
  for (const value of ["7", token.slice(0, -1) + (token.endsWith("A") ? "B" : "A")]) assert.throws(() => codec.decode(value, "owner/session/kind/source"), isStatus(400));
  assert.throws(() => codec.decode(token, "other/session/kind/source"), isStatus(400));
  assert.throws(() => new SessionRelationCursors().decode(token, "owner/session/kind/source"), isStatus(400));
  now += 15 * 60_000; assert.throws(() => codec.decode(token, "owner/session/kind/source"), isStatus(400));
});

test("Project change invalidates continuation and final Project revocation cannot return buffered metadata", async t => {
  const f = await fixture(t); const first = await f.service.read(user, "key1", "managed-children");
  f.granted.add(id(92)); await assert.rejects(f.service.read(user, "key1", "managed-children", first.nextCursor), isStatus(400));
  let refreshes = 0; f.state.refresh = async () => { if (++refreshes === 2) f.granted.clear(); };
  await assert.rejects(f.service.read(user, "key1", "managed-children"), isStatus(404));
});

test("source rotation and actor revocation are checked after the native page", async t => {
  for (const change of ["source", "actor"] as const) {
    const f = await fixture(t); let refreshes = 0;
    f.state.refresh = async () => { if (++refreshes === 2) {
      if (change === "source") f.source.baseUrl = "https://changed.example.test";
      else f.config.auth = { mode: "local", user: "other@example.test" };
    } };
    await assert.rejects(f.service.read(user, "key1", "managed-children"), isStatus(404));
  }
});

test("credential content rotation and oversized files cannot return relation metadata", async t => {
  const directory = mkdtempSync(join(tmpdir(), "track-relations-credential-"));
  t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert(basename(directory).startsWith("track-relations-credential-")); rmSync(directory, { recursive: true, force: true }); });
  const credential = join(directory, "native.key"); writeFileSync(credential, randomBytes(32).toString("base64url"));
  const f = await fixture(t); f.source.tokenFile = credential;
  let refreshes = 0; f.state.refresh = async () => { if (++refreshes === 2) writeFileSync(credential, randomBytes(32).toString("base64url")); };
  await assert.rejects(f.service.read(user, "key1", "managed-children"), isStatus(404));
  f.urls.length = 0; f.state.refresh = async () => {};
  writeFileSync(credential, "x".repeat(65_537));
  const value = await f.service.read(user, "key1", "managed-children");
  assert.equal(value.state, "disconnected"); assert.deepEqual(value.relations, []); assert.equal(f.urls.length, 0);
});

test("native revocation, malformed private response and total deadline clear all relation data", async t => {
  for (const change of ["revoke", "extra", "hang"] as const) {
    const f = await fixture(t, change === "hang" ? 150 : 10_000);
    if (change === "revoke") f.state.denyAfterPage = true;
    if (change === "extra") f.state.extra = true;
    if (change === "hang") f.state.hang = true;
    const value = await f.service.read(user, "key1", "managed-children");
    assert.equal(value.state, change === "revoke" ? "forbidden" : "disconnected");
    assert.deepEqual(value.relations, []); assert.equal(value.nextCursor, null); assert.equal(value.hasMore, false);
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|parent|child-3/);
  }
});

test("unconfigured peer registry is distinguished from an available empty relation list", async t => {
  const f = await fixture(t); const value = await f.service.read(user, "key1", "peer-processing");
  assert.equal(value.state, "unconfigured"); assert.equal(value.coverage, "peer-processing-receipts"); assert.deepEqual(value.relations, []);
});

test("monotonic total deadline rejects overdue microtasks before the timer can run", async t => {
  const f = await fixture(t); let refreshes = 0, clock = performance.now();
  t.mock.method(performance, "now", () => clock);
  const service = new SessionRelations(() => f.config, () => ({ runs: f.runs, sources: f.views() }) as Snapshot,
    async () => { if (++refreshes === 2) clock += 1_001; }, () => ({
      observe: async () => f.runs[0]!,
      sessionRelations: async () => ({ kind: "managed-children", sessionId: session, relations: [], nextCursor: null, hasMore: false,
        availability: "available", coverage: "managed-child-receipts" }),
    }), 1_000);
  const value = await service.read(user, "key1", "managed-children");
  assert.equal(refreshes, 2);
  assert.equal(value.state, "disconnected"); assert.deepEqual(value.relations, []); assert.equal(value.nextCursor, null);
});

test("Track HTTP route rejects invalid/duplicate query, write and foreign actor without native reads", async t => {
  const f = await fixture(t), store = new Store(":memory:"); t.after(() => store.close());
  const keys = f.runs.map(({ key: _key, ...row }) => store.observeRun({ sourceId: row.sourceId, runId: row.runId,
    sessionId: row.sessionId, workspaceId: row.workspaceId, title: row.title, status: row.status, createdAt: row.createdAt,
    startedAt: row.startedAt, completedAt: row.completedAt, observedAt: row.observedAt }));
  const sources = new Sources(store, () => f.config); sources.views = () => f.views(); sources.refreshProjectGrants = () => f.state.refresh();
  const { server } = createTrackServer(store, () => f.config, "dist/web", sources), base = await listen(server); t.after(() => close(server));
  const path = `/api/runs/${keys[0]}/session-relations`;
  for (const query of ["", "?kind=other", "?kind=managed-children&kind=managed-children", "?kind=managed-children&after=7"]) {
    const response = await fetch(base + path + query); assert.equal(response.status, 400); await response.body?.cancel();
  }
  const write = await fetch(base + path + "?kind=managed-children", { method: "POST" }); assert.equal(write.status, 405); await write.body?.cancel();
  const originalAuth = f.config.auth; f.config.auth = { mode: "local", user: "other@example.test" };
  const foreign = await fetch(base + path + "?kind=managed-children"); assert.equal(foreign.status, 404); await foreign.body?.cancel();
  f.config.auth = originalAuth;
  assert.equal(f.urls.length, 0);
  const response = await fetch(base + path + "?kind=managed-children"); assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/); const value = await response.json() as { relations: unknown[] };
  assert.equal(value.relations.length, 2);
  assert.equal(Number(store.db.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n), 4, "relation reads do not discover or create Runs");
  let refreshes = 0; f.state.refresh = async () => { if (++refreshes === 2) f.config.auth = { mode: "local", user: "other@example.test" }; };
  const revoked = await fetch(base + path + "?kind=managed-children"); assert.equal(revoked.status, 401);
  assert.doesNotMatch(await revoked.text(), /PRIVATE_|child-|operationId/);
});

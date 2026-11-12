import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { flowViewAuthorization } from "../apps/api/flow-view-authority.ts";
import { FlowViews } from "../apps/api/flow-views.ts";
import { FlowViewRepository } from "../packages/storage/flow-views.ts";
import { Store } from "../packages/storage/store.ts";
import { CommandError } from "../packages/commands/index.ts";
import type { Config } from "../apps/api/config.ts";
import type { Sources } from "../apps/api/runner.ts";
import type { SourceView } from "../packages/contracts/index.ts";
import type { FlowViewContent } from "../packages/contracts/flow-views.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = "alice@example.test", runId = uuid(1), sessionId = uuid(2), at = "2026-11-13T00:00:00.000Z";
const failure = (status: number) => (error: unknown) => error instanceof CommandError && error.status === status;

test("saved views use real native GET authorization, fail closed on denial/rebound identity, and do not execute work", async t => {
  let denied = false, wrongSession = false, calls = 0, forbiddenMethod = false, afterSession = () => {};
  const native = createServer((request, response) => {
    calls++; forbiddenMethod ||= request.method !== "GET";
    response.setHeader("Content-Type", "application/json");
    if (denied) { response.writeHead(403); response.end("{}"); return; }
    if (request.url === `/api/v1/runs/${runId}`) { response.end(JSON.stringify({ id: runId, session_id: wrongSession ? uuid(9) : sessionId, status: "succeeded", created_at: at, started_at: at, completed_at: at })); return; }
    if (request.url?.startsWith("/api/v1/sessions/")) { afterSession(); response.end(JSON.stringify({ id: wrongSession ? uuid(9) : sessionId, workspace_id: uuid(3), title: "Native" })); return; }
    response.writeHead(404); response.end("{}");
  });
  await new Promise<void>(resolve => native.listen(0, "127.0.0.1", resolve));
  const address = native.address(); assert(address && typeof address !== "string");
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user: actor }, sources: [
    { id: "native", kind: "demian", label: "Native", device: "fixture", baseUrl: `http://127.0.0.1:${address.port}`, users: [actor], runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 },
  ] };
  const view: SourceView = { id: "native", kind: "demian", label: "Native", device: "fixture", state: "connected", lastObservedAt: at, detail: "", capabilities: [] };
  const store = new Store(":memory:");
  t.after(async () => { native.closeAllConnections(); await new Promise<void>(resolve => native.close(() => resolve())); store.close(); });
  const key = store.observeRun({ sourceId: "native", runId, sessionId, workspaceId: uuid(3), title: "Native", status: "succeeded", createdAt: at, startedAt: at, completedAt: at, observedAt: at });
  const sources = { refreshProjectGrants: async () => {}, views: () => [view] } as unknown as Sources;
  const authorize = flowViewAuthorization(() => config, sources, user => store.snapshot(user, [view]));
  const refs = { tasks: [], runs: [{ sourceId: "native", runId, key }], assistants: [] };
  const confirm = await authorize(actor, refs); confirm(); assert.equal(calls, 2);
  await assert.rejects(authorize("bob@example.test", refs), failure(404)); assert.equal(calls, 2);
  await assert.rejects(authorize(actor, { ...refs, runs: [{ sourceId: "native", runId, key: "different-run" }] }), failure(404)); assert.equal(calls, 2);
  denied = true; await assert.rejects(authorize(actor, refs), failure(404)); denied = false;
  wrongSession = true; await assert.rejects(authorize(actor, refs), failure(404)); wrongSession = false;
  view.state = "disconnected"; const before = calls; await assert.rejects(authorize(actor, refs), failure(503)); assert.equal(calls, before); view.state = "connected";
  afterSession = () => { config.sources[0]!.users = []; };
  await assert.rejects(authorize(actor, refs), failure(404)); config.sources[0]!.users = [actor]; afterSession = () => {};
  await assert.rejects(authorize(actor, refs, performance.now() - 1), failure(503));
  assert.equal(forbiddenMethod, false); assert.equal(store.db.prepare("SELECT count(*) AS n FROM receipts").get()?.n, 0);
});

test("a later saved-view read cannot publish earlier labels after a grant changes, and revoked HTTP actor prevents commit", async t => {
  const store = new Store(":memory:"); t.after(() => store.close()); const repo = new FlowViewRepository(store.db);
  const content: FlowViewContent = { version: 1, contextId: "a".repeat(64), name: "Private old name", anchors: { tasks: [{ sourceId: "projects", projectId: uuid(4), taskId: uuid(5) }], runs: [], assistants: [] }, state: { by: "task", depth: "detail", bundles: [], overrides: [], focus: null } };
  repo.put(actor, uuid(6), 0, content); repo.put(actor, uuid(7), 0, content);
  let reads = 0, granted = true;
  const service = new FlowViews(repo, async () => { reads++; if (reads === 2) granted = false; return () => { if (!granted) throw new CommandError(404, "scope", "hidden"); }; });
  await assert.rejects(service.list(actor, content.contextId), failure(404));
  const save = new FlowViews(repo, async () => () => {});
  await assert.rejects(save.save(actor, { id: uuid(8), expectedRevision: 0, content }, () => false), failure(401));
  assert.equal(repo.get(actor, uuid(8)), undefined);
  assert.equal(repo.get(actor, uuid(6))?.revision, 1);
});

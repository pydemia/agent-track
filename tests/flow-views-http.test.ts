import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { createTrackServer } from "../apps/api/server.ts";
import { Store } from "../packages/storage/store.ts";
import type { Config } from "../apps/api/config.ts";
import type { Sources } from "../apps/api/runner.ts";
import type { FlowViewContent } from "../packages/contracts/flow-views.ts";

const actor = "alice@example.test", projectId = "11111111-1111-4111-8111-111111111111", taskId = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333", contextId = "a".repeat(64);
const content: FlowViewContent = { version: 1, contextId, name: "Private work group", anchors: { tasks: [{ sourceId: "projects", projectId, taskId }], runs: [], assistants: [] },
  state: { by: "project", depth: "structure", bundles: [], overrides: [], focus: null } };

test("saved flow HTTP persists account views, CAS conflicts and current native permissions without native writes", async t => {
  let granted = true, sourceDown = false, reads = 0, afterRead = () => {};
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user: actor },
    sources: [{ id: "projects", kind: "projects", label: "Projects", device: "test", users: [actor, "bob@example.test"], baseUrl: "http://127.0.0.1:1", repositoryRoots: [], runIds: [], discoverActive: false, maxFiles: 100, sinceDays: 7 }] };
  const sources = { refreshProjectGrants: async () => {}, views: () => [{ id: "projects", kind: "projects", state: sourceDown ? "disconnected" : "connected", authorizedProjectIds: granted ? [projectId] : [] }],
    projects: { client: () => ({ task: async () => { reads++; afterRead(); return { id: taskId, projectId, title: "Native title is never persisted", revision: "1", state: "todo", requiresTest: false }; } }) } } as unknown as Sources;
  const store = new Store(":memory:");
  const { server } = createTrackServer(store, () => config, "dist/web", sources);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  const address = server.address(); assert(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}/api/flow-views`;
  const save = (expectedRevision = 0, origin = "http://localhost", body: unknown = { id, expectedRevision, content }) => fetch(base, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const list = () => fetch(`${base}?contextId=${contextId}`);
  assert.equal((await save(0, "http://foreign.test")).status, 403); assert.equal(reads, 0);
  assert.equal((await save(0, "http://localhost", { id, expectedRevision: 0, content, actor: "bob@example.test" })).status, 400);
  const first = await save(); assert.equal(first.status, 200); assert.match(first.headers.get("cache-control")!, /no-store/);
  const firstBody = await first.json() as { view: { revision: number } }; assert.equal(firstBody.view.revision, 1);
  assert.equal((await save()).status, 409);
  assert.equal((await save(1)).status, 200);
  let response = await list(); assert.equal(response.status, 200); assert.match(await response.text(), /Private work group/);
  assert.equal((await fetch(`${base}?contextId=${contextId}&contextId=${contextId}`)).status, 400);
  assert.equal((await fetch(base, { method: "PUT" })).status, 405);
  config.auth = { mode: "local", user: "bob@example.test" };
  response = await list(); assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /Private work group/);
  assert.equal((await fetch(`${base}/${id}`, { method: "DELETE", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 2 }) })).status, 404);
  config.auth = { mode: "local", user: actor };
  granted = false; response = await list(); assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /Private work group/);
  assert.equal((await save(2)).status, 404);
  granted = true; sourceDown = true; response = await list(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /Private work group|Native title/);
  sourceDown = false; afterRead = () => { granted = false; };
  assert.equal((await save(2)).status, 404);
  assert.equal(store.db.prepare("SELECT revision FROM saved_flow_views WHERE actor=? AND id=?").get(actor, id)?.revision, 2);
  granted = true; afterRead = () => { config.auth = { mode: "local", user: "bob@example.test" }; };
  response = await save(2); assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /Private work group/);
  assert.equal(store.db.prepare("SELECT revision FROM saved_flow_views WHERE actor=? AND id=?").get(actor, id)?.revision, 2);
  config.auth = { mode: "local", user: actor }; afterRead = () => {};
  assert.equal((await fetch(`${base}/${id}`, { method: "DELETE", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) })).status, 409);
  assert.equal((await fetch(`${base}/${id}`, { method: "DELETE", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 2 }) })).status, 200);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM saved_flow_views").get()?.n, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM receipts").get()?.n, 0);
});

test("one saved-view deadline includes the body and grant refresh; late completion never commits", { timeout: 10_000 }, async t => {
  let release: (() => void) | undefined, reads = 0;
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user: actor }, sources: [
    { id: "projects", kind: "projects", label: "Projects", device: "test", users: [actor], repositoryRoots: [], runIds: [], discoverActive: false, maxFiles: 10, sinceDays: 7 },
  ] };
  const sources = { refreshProjectGrants: () => new Promise<void>(resolve => { release = resolve; }), views: () => [{ id: "projects", kind: "projects", state: "connected", authorizedProjectIds: [projectId] }],
    projects: { client: () => ({ task: async () => { reads++; return { id: taskId, projectId, title: "Hidden", revision: "1", state: "todo", requiresTest: false }; } }) } } as unknown as Sources;
  const store = new Store(":memory:");
  const { server } = createTrackServer(store, () => config, "dist/web", sources, 40);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { release?.(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  const address = server.address(); assert(address && typeof address !== "string"); const url = `http://127.0.0.1:${address.port}/api/flow-views`;
  const pending = await fetch(url, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ id, expectedRevision: 0, content }) });
  assert.equal(pending.status, 503); assert.equal(reads, 0);
  release?.(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM saved_flow_views").get()?.n, 0);
  const slow = await new Promise<number>((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" } }, response => {
      response.resume(); response.once("end", () => { req.end('"id":"late"}'); resolve(response.statusCode!); });
    }); req.on("error", reject); req.write('{');
  });
  assert.equal(slow, 408); assert.equal(reads, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM saved_flow_views").get()?.n, 0);
});

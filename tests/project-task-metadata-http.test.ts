import assert from "node:assert/strict";
import test from "node:test";
import { createTrackServer } from "../apps/api/server.ts";
import type { Sources } from "../apps/api/runner.ts";
import type { Config } from "../apps/api/config.ts";
import { Store } from "../packages/storage/store.ts";

const projectId = "11111111-1111-4111-8111-111111111111", taskId = "22222222-2222-4222-8222-222222222222";
const user = "reader@example.test";
const task = { id: taskId, projectId, title: "Authorized metadata", revision: "7", state: "todo", requiresTest: true };

test("HTTP task metadata enforces read-only scope and rejects actor/grant changes after native read", async t => {
  let granted = true, reads = 0, afterRead = () => {};
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user }, sources: [] };
  const sources = { refreshProjectGrants: async () => {}, views: () => [{ id: "projects", kind: "projects", state: "connected", authorizedProjectIds: granted ? [projectId] : [] }],
    projects: { client: () => ({ task: async () => { reads++; afterRead(); return task; } }) } } as unknown as Sources;
  const store = new Store(":memory:");
  const { server } = createTrackServer(store, () => config, "dist/web", sources);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/projects/projects/${projectId}/tasks/${taskId}`;
  const response = await fetch(url);
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(await response.json(), { actor: user, sourceId: "projects", projectId, task });
  const baseline = reads;
  assert.equal((await fetch(url + "?cursor=0")).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers: { origin: "http://localhost" } })).status, 405);
  assert.equal(reads, baseline);
  afterRead = () => { granted = false; };
  const revoked = await fetch(url); assert.equal(revoked.status, 404); assert.doesNotMatch(await revoked.text(), /Authorized metadata|revision/);
  granted = true; afterRead = () => { config.auth = { mode: "local", user: "changed@example.test" }; };
  const changed = await fetch(url); assert.equal(changed.status, 401); assert.doesNotMatch(await changed.text(), /Authorized metadata|revision/);
});

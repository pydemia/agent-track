import assert from "node:assert/strict";
import test from "node:test";
import { createTrackServer } from "../apps/api/server.ts";
import type { Sources } from "../apps/api/runner.ts";
import type { Config, SourceConfig } from "../apps/api/config.ts";
import { Store } from "../packages/storage/store.ts";
import { listenHttp } from "./helpers/http-listen.ts";

const projectId = "11111111-1111-4111-8111-111111111111", taskId = "22222222-2222-4222-8222-222222222222", user = "reader@example.test";
test("HTTP Task body review bypasses unrelated Native collection, retaining initial/final Project and actor checks", async t => {
  let granted = true, reads = 0, projectRefreshes = 0, afterRead = () => {};
  const source = { id: "projects", kind: "projects", users: [user], projectsUser: user, repositoryRoots: [] } as unknown as SourceConfig;
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user }, sources: [source] };
  const task = { id: taskId, projectId, title: "원본 업무", revision: "1", state: "todo", requiresTest: true };
  const sources = {
    refreshProjectGrants: async () => { throw new Error("Unrelated Native collector must not run"); },
    views: () => [],
    projects: {
      refresh: async () => { projectRefreshes++; },
      catalog: () => granted ? [{ id: projectId, title: "Project", archived: false }] : [],
      client: () => ({ taskReview: async () => { reads++; afterRead(); return { task, body: "PRIVATE_TASK_BODY", acceptanceCriteria: ["수용 기준"], complete: true }; } }),
    },
  } as unknown as Sources;
  const store = new Store(":memory:"), { server } = createTrackServer(store, () => config, "dist/web", sources), origin = await listenHttp(server);
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); store.close(); });
  const url = `${origin}/api/projects/projects/${projectId}/tasks/${taskId}/review`;
  const ok = await fetch(url); assert.equal(ok.status, 200); assert.equal((await ok.json()).body, "PRIVATE_TASK_BODY"); assert.equal(reads, 1); assert(projectRefreshes >= 2);
  afterRead = () => { granted = false; };
  const denied = await fetch(url); assert.equal(denied.status, 404); assert.doesNotMatch(await denied.text(), /PRIVATE_TASK_BODY/);
  granted = true; afterRead = () => { config.auth = { mode: "local", user: "other@example.test" }; };
  const changed = await fetch(url); assert(changed.status >= 400); assert.doesNotMatch(await changed.text(), /PRIVATE_TASK_BODY/);
});

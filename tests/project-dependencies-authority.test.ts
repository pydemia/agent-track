import assert from "node:assert/strict";
import test from "node:test";
import { projectDependencies, type DependencyAuthority } from "../apps/api/project-dependencies.ts";
import { ProjectsSourceError } from "../packages/adapters/projects/index.ts";
import type { Config } from "../apps/api/config.ts";
import type { ProjectDependencyPage } from "../packages/contracts/project-dependencies.ts";

function fixture() {
  const user = "reader@example.test";
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user }, sources: [{
    id: "projects", kind: "projects", label: "Projects", device: "fixture", users: [user], baseUrl: "http://localhost:1",
    projectsUser: user, projectsAccountId: "11111111-1111-4111-8111-111111111111", projectsPrincipalId: "readonly", projectsCredentialFile: "fixture.json",
    runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7,
  }] };
  let allowed = ["requested", "owner", "endpoint"];
  let reads = 0, checks = 0;
  let afterRead = () => {};
  const task = (id: string, projectId: string) => ({ id, projectId, title: id, revision: "4", state: "todo", requiresTest: true });
  const page: ProjectDependencyPage = { sourceId: "projects", projectId: "requested", supported: true, observedAt: new Date().toISOString(), hasMore: false,
    dependencies: [{ id: "link", projectId: "owner", relation: "depends_on", fromTask: task("a", "requested"), toTask: task("b", "endpoint"), fromRevision: "1", toRevision: "2" }] };
  const authority: DependencyAuthority = {
    refreshProjectGrants: async () => { checks++; },
    views: () => [{ id: "projects", kind: "projects", label: "Projects", device: "fixture", state: "connected", lastObservedAt: null, detail: "fixture", capabilities: ["projects.read", "tasks.read"], authorizedProjectIds: allowed }],
    projects: { client: () => ({ dependencies: async () => { reads++; afterRead(); return page; } }) },
  };
  return { user, config, authority, page, read: () => projectDependencies(() => config, authority, user, "projects", "requested"),
    allow: (ids: string[]) => { allowed = ids; }, after: (fn: () => void) => { afterRead = fn; }, counts: () => ({ reads, checks }) };
}
const denied = (error: unknown) => error instanceof ProjectsSourceError && error.status === 404;

test("dependency metadata refreshes current native grants before and after the read", async () => {
  const f = fixture(); assert.deepEqual(await f.read(), f.page); assert.deepEqual(f.counts(), { reads: 1, checks: 2 });
  assert.equal(f.page.dependencies[0]?.fromTask.state, "todo");
});

test("requested scope denial prevents any dependency request", async () => {
  const f = fixture(); f.allow(["endpoint", "owner"]); await assert.rejects(f.read(), denied); assert.equal(f.counts().reads, 0);
});

test("post-read revocation of owner or either endpoint discloses no relation", async () => {
  for (const id of ["requested", "owner", "endpoint"]) {
    const f = fixture(); f.after(() => f.allow(["requested", "owner", "endpoint"].filter((candidate) => candidate !== id)));
    await assert.rejects(f.read(), denied); assert.deepEqual(f.counts(), { reads: 1, checks: 2 });
  }
});

test("actor removal or source identity changes cannot return an older allowed page", async () => {
  for (const mutate of [(config: Config) => { config.auth = { mode: "local", user: "other@example.test" }; }, (config: Config) => { config.sources[0]!.baseUrl = "http://localhost:2"; }]) {
    const f = fixture(); f.after(() => mutate(f.config)); await assert.rejects(f.read(), denied);
  }
});

test("response identity mismatches are rejected even when its projects are allowed", async () => {
  for (const field of ["sourceId", "projectId"] as const) {
    const f = fixture(); f.page[field] = "different"; await assert.rejects(f.read(), denied);
  }
});

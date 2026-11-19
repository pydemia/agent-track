import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../packages/storage/store.ts";
import { TaskAssignments } from "../apps/api/task-assignment.ts";
import type { Config, SourceConfig } from "../apps/api/config.ts";
import type { Sources } from "../apps/api/runner.ts";

const projectId = "11111111-1111-4111-8111-111111111111", taskId = "22222222-2222-4222-8222-222222222222", user = "owner@example.test";
function fixture(withdraw = false) {
  const store = new Store(":memory:");
  const source = { id: "projects", kind: "projects", users: [user], projectsUser: user,
    baseUrl: "https://projects.example.test", projectsCredentialFile: "private.json", projectsAccountId: "account", projectsPrincipalId: "reader", repositoryRoots: [] } as unknown as SourceConfig;
  const config = { auth: { mode: "proxy", users: [user] }, sources: [source] } as unknown as Config;
  let refreshes = 0, reads = 0;
  const projects = {
    refresh: async () => { refreshes++; },
    catalog: () => withdraw && refreshes > 1 ? [] : [{ id: projectId, title: "Project", archived: false }],
    client: () => ({ taskReview: async () => { reads++; return { task: { id: taskId, projectId, title: "업무", revision: "1", state: "todo", requiresTest: true }, body: "실행 설명", acceptanceCriteria: ["결과 확인"], complete: true }; } }),
  };
  const sources = { projects, refreshProjectGrants: async () => { throw Error("Unrelated Native collector must not run"); } } as unknown as Sources;
  return { store, service: new TaskAssignments(store, () => config, sources), counts: () => ({ refreshes, reads }) };
}

test("Task body review rechecks only its Project grants and does not wait for unrelated Native collection", async () => {
  const f = fixture(); try {
    const value = await f.service.review(user, "projects", projectId, taskId);
    assert.equal(value.body, "실행 설명"); assert.deepEqual(value.acceptanceCriteria, ["결과 확인"]);
    assert.deepEqual(f.counts(), { refreshes: 2, reads: 1 });
  } finally { f.store.close(); }
});

test("Project withdrawal after reading the body discards that buffered content", async () => {
  const f = fixture(true); try {
    await assert.rejects(f.service.review(user, "projects", projectId, taskId), error => error instanceof Error && !error.message.includes("실행 설명"));
    assert.deepEqual(f.counts(), { refreshes: 2, reads: 1 });
  } finally { f.store.close(); }
});

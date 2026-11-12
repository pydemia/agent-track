import assert from "node:assert/strict";
import test from "node:test";
import { projectTaskMetadata } from "../apps/api/project-task-metadata.ts";
import type { Sources } from "../apps/api/runner.ts";
import { ProjectsSourceError } from "../packages/adapters/projects/index.ts";
import type { ProjectTaskMetadata } from "../packages/contracts/index.ts";

const user = "reader@example.test";
const sourceId = "projects-main";
const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const task: ProjectTaskMetadata = { id: taskId, projectId, title: "Visible task", revision: "7", state: "todo", requiresTest: true };
const denied = (error: unknown) => error instanceof ProjectsSourceError && error.status === 404;

function fixture() {
  let allowed = [projectId];
  let calls: string[] = [];
  let taskRead: () => Promise<ProjectTaskMetadata> = async () => task;
  const sources = {
    refreshProjectGrants: async () => { calls.push("refresh"); },
    views: () => [{ id: sourceId, kind: "projects", state: "connected", authorizedProjectIds: allowed }],
    projects: { client: (actualSource: string, actualUser: string) => ({ task: (actualTask: string, actualProject: string) => {
      calls.push("read");
      assert.equal(actualSource, sourceId); assert.equal(actualUser, user);
      assert.equal(actualTask, taskId); assert.equal(actualProject, projectId);
      return taskRead();
    } }) },
  } as unknown as Pick<Sources, "refreshProjectGrants" | "views" | "projects">;
  return {
    sources,
    calls: () => calls,
    allow: (ids: string[]) => { allowed = ids; },
    read: () => projectTaskMetadata(sources, user, sourceId, projectId, taskId),
    taskRead: (read: () => Promise<ProjectTaskMetadata>) => { taskRead = read; },
  };
}

test("refreshes grants on both sides and returns only metadata", async () => {
  const f = fixture();
  assert.deepEqual(await f.read(), { actor: user, sourceId, projectId, task });
  assert.deepEqual(f.calls(), ["refresh", "read", "refresh"]);
});

test("rejects invalid IDs and unauthorized scopes before native read", async () => {
  for (const [source, project, taskValue] of [["bad/id", projectId, taskId], [sourceId, "bad", taskId], [sourceId, projectId, "bad"]]) {
    const f = fixture();
    await assert.rejects(projectTaskMetadata(f.sources, user, source!, project!, taskValue!),
      (error: unknown) => error instanceof ProjectsSourceError && error.status === 400);
    assert.deepEqual(f.calls(), []);
  }
  const f = fixture(); f.allow([]);
  await assert.rejects(f.read(), denied);
  assert.deepEqual(f.calls(), ["refresh"]);
});

test("a post-read revoke blocks disclosure and a rejected native read still refreshes grants", async () => {
  const revoked = fixture();
  revoked.taskRead(async () => { revoked.allow([]); return task; });
  await assert.rejects(revoked.read(), denied);
  assert.deepEqual(revoked.calls(), ["refresh", "read", "refresh"]);

  const rejected = fixture();
  rejected.taskRead(async () => { throw new Error("native unavailable"); });
  await assert.rejects(rejected.read(), /native unavailable/);
  assert.deepEqual(rejected.calls(), ["refresh", "read", "refresh"]);
});

test("rejects tuple mismatch and unexpected private metadata", async () => {
  for (const value of [
    { ...task, id: "33333333-3333-4333-8333-333333333333" },
    { ...task, projectId: "33333333-3333-4333-8333-333333333333" },
    { ...task, body: "private" },
  ]) {
    const f = fixture(); f.taskRead(async () => value as ProjectTaskMetadata);
    await assert.rejects(f.read(), denied);
  }
});

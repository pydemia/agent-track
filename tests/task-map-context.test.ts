import assert from "node:assert/strict";
import test from "node:test";
import { removeDeniedTaskContext, removeDeniedTaskQuery } from "../apps/web/src/task-map-context.ts";

test("a denied Project removes its Task URL identifiers while preserving unrelated navigation", () => {
  assert.equal(removeDeniedTaskContext({ sourceId: "projects", projectId: "a", taskId: "private-task" }, "projects", "a"), null);
  const query = removeDeniedTaskQuery("?view=map&run=allowed-run&taskSource=projects&taskProject=a&task=private-task&q=kept", "projects", "a");
  assert.equal(query, "view=map&run=allowed-run&q=kept");
});

test("a late denial for the old Project preserves the newly selected Project and URL", () => {
  const current = { sourceId: "projects", projectId: "new", taskId: "new-task" };
  assert.equal(removeDeniedTaskContext(current, "projects", "old"), current);
  assert.equal(removeDeniedTaskQuery("?view=map&taskSource=projects&taskProject=new&task=new-task", "projects", "old"), null);
  assert.equal(removeDeniedTaskContext(current, "other-source", "new"), current);
  assert.equal(removeDeniedTaskQuery("?taskSource=projects&taskProject=new", "other-source", "new"), null);
});

test("dependency query denial is Project-scoped even when its focused Task has changed", () => {
  assert.equal(removeDeniedTaskContext({ sourceId: "projects", projectId: "a", taskId: "another-task" }, "projects", "a"), null);
  assert.equal(removeDeniedTaskQuery("?view=map&taskSource=projects&taskProject=a&task=another-task", "projects", "a"), "view=map");
  assert.equal(removeDeniedTaskContext(null, "projects", "a"), null);
});

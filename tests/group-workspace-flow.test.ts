import assert from "node:assert/strict";
import { test } from "node:test";
import type { SourceView } from "../packages/contracts/index.ts";
import { groupModelSubset, groupWorkspaceFlow, type GroupTaskRecord } from "../packages/projection/group-workspace-flow.ts";
const source: SourceView = { id: "projects", kind: "projects", label: "P", state: "connected", device: "test", detail: "", lastObservedAt: null,
  capabilities: [], authorizedProjectIds: ["p"] };
const record = (id: string, state = "todo"): GroupTaskRecord => ({ ref: { sourceId: "projects", projectId: "p", taskId: id },
  task: { id, projectId: "p", title: "same title", revision: "1", state, requiresTest: false } });
const a = record("a"), b = record("b", "in_review"), c = record("c");
const dependency = { sourceId: "projects", projectId: "p", supported: true, hasMore: false, observedAt: "2026-11-13T00:00:00.000Z",
  dependencies: [{ id: "d", projectId: "p", relation: "depends_on" as const, fromTask: b.task, toTask: a.task, fromRevision: "1", toRevision: "1" }] };

test("a Task-only scope remains a map with independent native task states and no invented execution", () => {
  const model = groupWorkspaceFlow([a, b], [], [], [], [source], []);
  assert.equal(model.nodes.length, 2); assert.equal(model.edges.length, 0);
  assert.deepEqual(model.nodes.map(node => node.status), ["todo", "in_review"]);
  assert.ok(model.nodes.every(node => node.taskRef)); assert.equal(model.incomplete, true);
});

test("an actual dependency retains prerequisite direction and raw relationship evidence", () => {
  const model = groupWorkspaceFlow([a, b], [], [], [], [source], [dependency]);
  const edge = model.edges.find(edge => edge.kind === "dependency")!;
  assert.equal(model.nodes.find(node => node.key === edge.from)?.id, "a");
  assert.equal(model.nodes.find(node => node.key === edge.to)?.id, "b");
  assert.match(edge.detail, /Relation ID: d/); assert.equal(model.boundaryDependencies, 0);
});

test("a boundary is separately accessible with its actual endpoints, never an internal group dependency", () => {
  const model = groupWorkspaceFlow([a, c], [], [], [], [source], [dependency, dependency]);
  assert.equal(model.boundaryDependencies, 1); assert.equal(model.edges.length, 0);
  assert.equal(model.boundaries[0]?.from.id, "a"); assert.equal(model.boundaries[0]?.to.id, "b");
  assert.equal(model.nodes.some(node => node.id === "b"), false);
  const denied = groupWorkspaceFlow([a, c], [], [], [], [{ ...source, authorizedProjectIds: [] }], [dependency]);
  assert.equal(denied.boundaryDependencies, 0);
});

test("a subgroup's missing observations stay empty instead of widening to the entire model", () => {
  const model = groupWorkspaceFlow([a, b], [], [], [], [source], [dependency]);
  const selected = groupModelSubset(model, [model.nodes[0]!.key]);
  assert.equal(selected.nodes.length, 1); assert.equal(selected.edges.length, 0);
  assert.equal(groupModelSubset(model, ["missing"]).nodes.length, 0);
  assert.equal(model.nodes.length, 2);
});

import assert from "node:assert/strict";
import test from "node:test";
import { nativeFlowGroupDefinitions, withTaskBundles, flowGroupKey, groupsForNodes } from "../packages/projection/flow-group-definitions.ts";
import { projectFlowGroups } from "../packages/projection/flow-groups.ts";
import type { MissionNode, MissionEdge } from "../packages/projection/mission-flow.ts";
const node = (key: string, kind: string, runKey?: string, sourceId = "native"): MissionNode => ({ key, kind, id: key, label: key,
  status: "observed", description: "metadata", sourceId, ...(runKey ? { runKey } : {}), details: [], sequences: [] });
const edge = (from: string, to: string, kind: string): MissionEdge => ({ key: JSON.stringify([from, to, kind]), from, to,
  kind, sourceId: "native", label: kind, detail: "explicit source evidence", sequences: [] });

test("Task groups follow explicit bindings and keep a Session shared by different Tasks outside both", () => {
  const model = { nodes: [node("a", "task"), node("b", "task"), node("s", "session"), node("r1", "run", "run1"), node("r2", "run", "run2")],
    edges: [edge("a", "r1", "task-binding"), edge("b", "r2", "task-binding"), edge("s", "r1", "ownership"), edge("s", "r2", "ownership")] };
  const defs = nativeFlowGroupDefinitions(model, "task");
  assert.equal(defs.filter(group => group.kind === "task").length, 2);
  assert.equal(defs.some(group => group.memberKeys.includes("s")), false);
  const projection = projectFlowGroups(model, defs, new Set());
  assert.equal(projection.invalidGroups.length, 0); assert.equal(projection.parents.has("s"), false);
  assert.equal(projection.groups.find(group => group.key === flowGroupKey("task", "a"))!.counts.uniqueRun, 1);
});

test("source-qualified Session ownership and invocation/tool references build nested native groups", () => {
  const model = { nodes: [node("s", "session"), node("r", "run", "run"), node("i1", "invocation", "run"), node("i2", "invocation", "run"), node("tool", "tool", "run")],
    edges: [edge("s", "r", "ownership"), edge("i1", "i2", "invocation-parent"), edge("i2", "tool", "tool-of")] };
  const defs = nativeFlowGroupDefinitions(model, "session");
  const projection = projectFlowGroups(model, defs, new Set()); assert.deepEqual(projection.invalidGroups, []);
  assert.equal(defs.find(group => group.key === flowGroupKey("invocation", "i2"))!.parentKey, flowGroupKey("invocation", "i1"));
  assert.equal(projection.parents.get("tool"), flowGroupKey("invocation", "i2"));
  assert.equal(defs.find(group => group.kind === "run")!.parentKey, flowGroupKey("session", "s"));
  const crossSource = { ...model, nodes: model.nodes.map(n => n.key === "tool" ? { ...n, sourceId: "other" } : n) };
  assert.equal(projectFlowGroups(crossSource, nativeFlowGroupDefinitions(crossSource, "session"), new Set()).parents.has("tool"), false);
});

test("a named view bundle changes presentation only and disappears entirely if any Task is absent", () => {
  const model = { nodes: [node("a", "task"), node("b", "task"), node("r", "run", "run")], edges: [edge("a", "r", "task-binding")] };
  const before = JSON.stringify(model); const bundle = { key: "view-bundle", label: "PRIVATE_VIEW_TITLE", taskKeys: ["a", "b"] };
  const defs = withTaskBundles(model, nativeFlowGroupDefinitions(model, "task"), [bundle]);
  const result = projectFlowGroups(model, defs, new Set([bundle.key]));
  assert.deepEqual(result.invalidGroups, []); assert.ok(result.nodes.some(n => n.key === bundle.key));
  assert.equal(result.groups.find(g => g.key === bundle.key)!.counts.uniqueRun, 1);
  const withdrawn = { ...model, nodes: model.nodes.filter(n => n.key !== "b") };
  const later = withTaskBundles(withdrawn, nativeFlowGroupDefinitions(withdrawn, "task"), [bundle]);
  assert.equal(JSON.stringify(later).includes("PRIVATE_VIEW_TITLE"), false);
  assert.equal(JSON.stringify(model), before);
});

test("Project groups retain source identity and native Task IDs; grouping does not create business edges", () => {
  const tasks = [node("a", "task", undefined, "one"), node("b", "task", undefined, "two")]
    .map(n => ({ ...n, id: "same-task", details: [{ label: "Project ID", value: "same-project" }] }));
  const model = { nodes: tasks, edges: [edge("a", "b", "dependency")] };
  const defs = nativeFlowGroupDefinitions(model, "project");
  assert.equal(defs.length, 2); assert.notEqual(defs[0]!.key, defs[1]!.key);
  const result = projectFlowGroups(model, defs, new Set()); assert.deepEqual(result.edges, model.edges);
  assert.equal(nativeFlowGroupDefinitions(model, "none").length, 0);
});

test("revealing a hidden node or boundary relation expands the direct group and every ancestor", () => {
  const defs = [
    { key: "task", label: "task", kind: "task", basis: "binding" as const, sourceId: "native", memberKeys: ["a"], description: "explicit" },
    { key: "run", label: "run", kind: "run", basis: "native" as const, sourceId: "native", memberKeys: ["r"], parentKey: "task", description: "explicit" },
    { key: "call", label: "call", kind: "invocation", basis: "native" as const, sourceId: "native", memberKeys: ["tool"], parentKey: "run", description: "explicit" },
    { key: "other", label: "other", kind: "task", basis: "binding" as const, sourceId: "native", memberKeys: ["b"], description: "explicit" },
  ];
  assert.deepEqual([...groupsForNodes(defs, ["tool"])], ["call", "run", "task"]);
  assert.deepEqual([...groupsForNodes(defs, ["tool", "b"])], ["call", "run", "task", "other"]);
  const model = { nodes: [node("a", "task"), node("r", "run", "r"), node("tool", "tool", "r"), node("b", "task")], edges: [edge("tool", "b", "dependency")] };
  const collapsed = new Set(defs.map(group => group.key));
  for (const key of groupsForNodes(defs, ["tool", "b"])) collapsed.delete(key);
  const shown = projectFlowGroups(model, defs, collapsed);
  assert.ok(shown.nodes.some(n => n.key === "tool")); assert.ok(shown.nodes.some(n => n.key === "b"));
  assert.equal(shown.edges[0]!.key, model.edges[0]!.key);
});

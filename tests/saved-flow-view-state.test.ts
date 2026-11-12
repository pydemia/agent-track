import assert from "node:assert/strict";
import test from "node:test";
import type { FlowViewContent } from "../packages/contracts/flow-views.ts";
import type { MissionNode, MissionEdge } from "../packages/projection/mission-flow.ts";
import { captureFlowViewAnchors, reconcileSavedFlowView } from "../packages/projection/saved-flow-view-state.ts";
import { flowGroupKey } from "../packages/projection/flow-group-definitions.ts";
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const node = (key: string, kind: string, sourceId = "native"): MissionNode => ({ key, kind, sourceId, id: key,
  label: "NATIVE_PRIVATE_NAME", status: "observed", description: "native authority", details: [], sequences: [] });
const task = (n: number, source = "native"): MissionNode => ({ ...node(`${source}-t${n}`, "task", source), id: uuid(n),
  taskRef: { sourceId: source, projectId: uuid(99), taskId: uuid(n) } });
const run = (source = "native"): MissionNode => ({ ...node(`${source}-r`, "run", source), id: "same-run", runKey: `${source}-run-key` });
const assistant = (kind = "assistant-role"): MissionNode => ({ ...node(kind, kind), id: kind === "assistant-execution" ? uuid(50) : kind,
  assistantExecutionRef: { sourceId: "native", executionId: uuid(50) } });
const bundleKey = flowGroupKey("view-task-bundle", uuid(70));
const content = (nodes: MissionNode[]): FlowViewContent => ({ version: 1, contextId: "a".repeat(64), name: "My view",
  anchors: captureFlowViewAnchors(nodes)!, state: { by: "task", depth: "structure", bundles: [], overrides: [], focus: null } });
const bundled = (nodes: MissionNode[]) => {
  const saved = content(nodes); saved.state.bundles = [{ key: bundleKey, label: "My bundle", taskKeys: nodes.filter(n => n.kind === "task").map(n => n.key) }];
  saved.state.overrides = [[bundleKey, true]]; saved.state.focus = bundleKey; return saved;
};
const model = (nodes: MissionNode[], edges: MissionEdge[] = []) => ({ nodes, edges });

test("source-qualified identities separate same IDs and capture deduplicates explicit aliases deterministically", () => {
  const nodes = [task(1), task(1, "other"), run(), run("other"), assistant(), assistant("assistant-execution"), assistant("assistant-work-package")];
  const anchors = captureFlowViewAnchors(nodes)!;
  assert.equal(anchors.tasks.length, 2); assert.equal(anchors.runs.length, 2); assert.equal(anchors.assistants.length, 1);
  assert.deepEqual(captureFlowViewAnchors([...nodes, { ...nodes[0]!, key: "alias" }, structuredClone(nodes[0]!)]), anchors);
  assert.deepEqual(captureFlowViewAnchors([...nodes].reverse()), anchors);
  assert.doesNotMatch(JSON.stringify(anchors), /PRIVATE|authority|label/);
});

test("missing, invalid and foreign explicit references fail closed without inference", () => {
  for (const malformed of [node("t", "task"), node("r", "run"), node("a", "assistant-role"), node("a", "assistant-execution"),
    node("a", "assistant-work-package"), { ...task(1), taskRef: { ...task(1).taskRef!, sourceId: "foreign" } },
    { ...task(1), id: uuid(2) }, { ...task(1), taskRef: { ...task(1).taskRef!, projectId: "bad" } },
    { ...assistant(), assistantExecutionRef: { sourceId: "foreign", executionId: uuid(50) } },
    { ...assistant("assistant-execution"), id: uuid(51) }]) assert.equal(captureFlowViewAnchors([run("safe"), malformed]), null);
  assert.equal(captureFlowViewAnchors([]), null);
  assert.equal(captureFlowViewAnchors([node("tool", "tool")]), null);
});

test("unobserved references and non-unit run keys never supply actual anchors", () => {
  const refs = [task(1), run(), assistant()].map(n => ({ ...n, status: "unobserved" }));
  assert.equal(captureFlowViewAnchors(refs), null);
  assert.deepEqual(captureFlowViewAnchors([...refs, task(2), { ...run(), key: "tool", kind: "tool" }]), captureFlowViewAnchors([task(2)]));
  assert.equal(reconcileSavedFlowView(content([run()]), model(refs)), null);
});

test("conflicting node keys, task projects and Run identity/key assignments reject", () => {
  for (const nodes of [[task(1), { ...task(2), key: task(1).key }], [run(), { ...run(), label: "different" }],
    [task(1), { ...task(1), key: "alias", taskRef: { ...task(1).taskRef!, projectId: uuid(98) } }],
    [run(), { ...run(), key: "alias", runKey: "conflict" }], [run(), { ...run("other"), runKey: run().runKey! }]])
    assert.equal(captureFlowViewAnchors(nodes), null);
});

test("capture enforces nonempty total 32 bound across anchor kinds", () => {
  const tasks = Array.from({ length: 30 }, (_, i) => task(i));
  assert.ok(captureFlowViewAnchors([...tasks, run(), assistant()]));
  assert.equal(captureFlowViewAnchors([...tasks, run(), assistant(), task(31)]), null);
});

test("every saved anchor must remain, while newly observed anchors are allowed", () => {
  const nodes = [task(1), run(), assistant()]; const saved = content(nodes);
  assert.deepEqual(reconcileSavedFlowView(saved, model([...nodes, task(2)])), saved.state);
  for (let i = 0; i < nodes.length; i++) assert.equal(reconcileSavedFlowView(saved, model(nodes.filter((_, j) => i !== j))), null);
  assert.equal(reconcileSavedFlowView(content([task(1)]), model([task(1, "foreign")])), null);
  assert.equal(reconcileSavedFlowView(content([run()]), model([{ ...run(), runKey: "replacement" }])), null);
});

test("bundles require all current Task members to be explicitly saved anchors", () => {
  const nodes = [task(1), task(2), run()]; const saved = bundled(nodes);
  assert.deepEqual(reconcileSavedFlowView(saved, model(nodes)), saved.state);
  assert.equal(reconcileSavedFlowView(saved, model(nodes.slice(1))), null);
  saved.anchors = captureFlowViewAnchors([run()])!;
  assert.equal(reconcileSavedFlowView(saved, model(nodes)), null);
});

test("bundle key format, exact serialization and collisions fail closed", () => {
  const nodes = [task(1), task(2)];
  for (const key of ["bad", flowGroupKey("task", uuid(70)), flowGroupKey("view-task-bundle", "bad"), ` ${bundleKey}`, nodes[0]!.key]) {
    const saved = bundled(nodes); saved.state.bundles[0]!.key = key;
    assert.equal(reconcileSavedFlowView(saved, model(nodes)), null);
  }
  assert.equal(reconcileSavedFlowView(bundled(nodes), model([...nodes, node(bundleKey, "tool")])), null);
});

test("structural changes filter stale groups and node keys without adding names or authority", () => {
  const nodes = [task(1), run()]; const saved = content(nodes); const key = flowGroupKey("task", nodes[0]!.key);
  const edge: MissionEdge = { key: "binding", from: nodes[0]!.key, to: nodes[1]!.key, kind: "task-binding", sourceId: "native", label: "binding", detail: "explicit", sequences: [] };
  saved.state.overrides = [[key, true], ["unknown", false], [nodes[0]!.key, true]]; saved.state.focus = key;
  assert.deepEqual(reconcileSavedFlowView(saved, model(nodes, [edge]))!.overrides, [[key, true]]);
  const result = reconcileSavedFlowView(saved, model(nodes))!;
  assert.deepEqual(result.overrides, []); assert.equal(result.focus, null);
  assert.deepEqual(Object.keys(result).sort(), ["bundles", "by", "depth", "focus", "overrides"]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|authority|My view/);
});

test("none hides bundle presentation but preserves validated bundles and does not mutate frozen inputs", () => {
  const nodes = [task(1), task(2)]; const saved = bundled(nodes); saved.state.by = "none";
  const current = model(nodes); const before = JSON.stringify({ saved, current });
  const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); } };
  freeze(saved); freeze(current);
  const result = reconcileSavedFlowView(saved, current)!;
  assert.deepEqual(result.bundles, saved.state.bundles); assert.equal(result.by, "none"); assert.equal(result.depth, "structure");
  assert.deepEqual(result.overrides, []); assert.equal(result.focus, null);
  assert.equal(JSON.stringify({ saved, current }), before);
  result.bundles[0]!.label = "changed"; assert.equal(saved.state.bundles[0]!.label, "My bundle");
});

test("runtime content schema rejects invalid state, extra authority and duplicate anchors", () => {
  const saved = content([task(1)]);
  for (const invalid of [null, { ...saved, authority: "owner" }, { ...saved, state: { ...saved.state, by: "invalid" } },
    { ...saved, anchors: { ...saved.anchors, tasks: [...saved.anchors.tasks, ...saved.anchors.tasks] } }])
    assert.equal(reconcileSavedFlowView(invalid as FlowViewContent, model([task(1)])), null);
});

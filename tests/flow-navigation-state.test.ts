import assert from "node:assert/strict";
import test from "node:test";
import type { MissionNode, MissionEdge } from "../packages/projection/mission-flow.ts";
import type { FlowGroupSummary } from "../packages/projection/flow-groups.ts";
import {
  flowNavigationGraph, reconcileFlowHistory, pushFlowHistory, popFlowHistory, validFlowNavigationView,
  type FlowNavigationFrame, type FlowNavigationHistory, type FlowNavigationView,
} from "../apps/web/src/flow-navigation-state.ts";

const node = (key: string): MissionNode => ({ key, id: "same-bare-id", kind: "run", sourceId: "source-a",
  runKey: "run-a", label: "LABEL", status: "STATUS", description: "DETAIL", details: [], sequences: ["1"] });
const nodes = [node("a"), node("b")];
const edges: MissionEdge[] = [{ key: "edge", from: "a", to: "b", kind: "dependency", sourceId: "source-a",
  label: "LABEL", detail: "DETAIL", sequences: ["1"] }];
const groups: FlowGroupSummary[] = [{ key: "group", kind: "run", sourceId: "source-a", basis: "native",
  parentKey: "parent", memberKeys: ["a", "b"], leafKeys: ["a", "b"], childGroupKeys: [],
  label: "LABEL", description: "DETAIL", counts: { run: 2 }, statusCounts: { STATUS: 2 },
  internalEdges: 1, boundaryEdges: 0, cyclicMembers: 0 }];
const graph = flowNavigationGraph(nodes, edges, groups);
const empty = (): FlowNavigationHistory => ({ scope: "scope", graph, frames: [] });
const frame = (focus: string | null): FlowNavigationFrame => ({ focus, targets: ["a", "b"],
  overrides: [["group", true], ["parent", false]], selection: { kind: "edge", key: "edge" },
  view: { x: -20, y: 13, zoom: 1.5, width: 1024, height: 768 } });
const push = (history: FlowNavigationHistory, value: FlowNavigationFrame) => pushFlowHistory(history, "scope", graph, value);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test("metadata refresh and reordered inputs preserve identity and saved screen", () => {
  const before = freeze({ nodes: structuredClone(nodes), edges: structuredClone(edges), groups: structuredClone(groups) });
  assert.equal(flowNavigationGraph(before.nodes, before.edges, before.groups), graph);
  const refreshed = flowNavigationGraph([...nodes].reverse().map(n => ({ ...n, label: "new", status: "failed",
    description: "new", details: [{ label: "raw", value: "private detail" }], sequences: ["99"], callId: "new" })),
  [...edges].reverse().map(e => ({ ...e, label: "new", detail: "new", sequences: ["99"] })),
  [...groups].reverse().map(g => ({ ...g, label: "new", description: "new", counts: {}, statusCounts: {},
    internalEdges: 99, boundaryEdges: 99, cyclicMembers: 99, memberKeys: ["b", "a", "a"], leafKeys: ["b", "a"] })));
  assert.equal(refreshed, graph);
  assert.doesNotMatch(graph, /LABEL|STATUS|DETAIL|private detail/);
  const saved = push(empty(), frame("group"));
  assert.deepEqual(reconcileFlowHistory(saved, "scope", refreshed), saved);
  const extraEdge = { ...edges[0]!, key: "second-edge", from: "b", to: "a" };
  const extraGroup = { ...groups[0]!, key: "second-group" };
  assert.equal(flowNavigationGraph(nodes, [...edges, extraEdge], [...groups, extraGroup]),
    flowNavigationGraph([...nodes].reverse(), [extraEdge, ...edges], [extraGroup, ...groups]));
});

test("each native identity, endpoint, and group membership change invalidates all old frames", () => {
  const variants: Array<[string, string]> = [];
  for (const key of ["key", "kind", "sourceId", "id", "runKey"] as const) {
    variants.push([`node ${key}`, flowNavigationGraph([{ ...nodes[0]!, [key]: "changed" }, nodes[1]!], edges, groups)]);
  }
  for (const key of ["key", "from", "to", "kind", "sourceId"] as const) {
    variants.push([`edge ${key}`, flowNavigationGraph(nodes, [{ ...edges[0]!, [key]: "changed" }], groups)]);
  }
  for (const patch of [{ key: "changed" }, { kind: "changed" }, { sourceId: "changed" }, { basis: "view" as const },
    { parentKey: "changed" }, { parentKey: undefined }, { memberKeys: ["a"] }, { leafKeys: ["a"] }]) {
    const { parentKey, ...withoutParent } = { ...groups[0]!, ...patch };
    variants.push([`group ${JSON.stringify(patch)}`, flowNavigationGraph(nodes, edges,
      [parentKey === undefined ? withoutParent : { ...withoutParent, parentKey }])]);
  }
  variants.push(["node removal", flowNavigationGraph(nodes.slice(1), edges, groups)],
    ["edge removal", flowNavigationGraph(nodes, [], groups)], ["group removal", flowNavigationGraph(nodes, edges, [])]);
  const privateFrame = frame("PRIVATE-OLD-KEY");
  privateFrame.targets = ["PRIVATE-OLD-KEY"];
  privateFrame.selection = { kind: "node", key: "PRIVATE-OLD-KEY" };
  privateFrame.overrides = [["PRIVATE-OLD-KEY", true]];
  const history = freeze(push(empty(), privateFrame));
  for (const [name, changed] of variants) {
    assert.notEqual(changed, graph, name);
    assert.deepEqual(reconcileFlowHistory(history, "scope", changed), { scope: "scope", graph: changed, frames: [] }, name);
    for (const target of [undefined, null, "PRIVATE-OLD-KEY"]) {
      const result = popFlowHistory(history, "scope", changed, target);
      assert.equal(result.frame, null, name);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE-OLD-KEY/, name);
    }
    const next = pushFlowHistory(history, "scope", changed, frame(null));
    assert.equal(next.frames.length, 1);
    assert.doesNotMatch(JSON.stringify(next), /PRIVATE-OLD-KEY/);
  }
});

test("scope change clears saved frames before examining them, including on push and pop", () => {
  const history = { scope: "old", graph, get frames(): FlowNavigationFrame[] { throw new Error("old frames accessed"); } };
  assert.deepEqual(reconcileFlowHistory(history, "scope", graph), empty());
  assert.deepEqual(popFlowHistory(history, "scope", graph), { history: empty(), frame: null });
  assert.deepEqual(push(history, frame(null)).frames, [frame(null)]);
  const topologyHistory = { ...empty(), get frames(): FlowNavigationFrame[] { throw new Error("old frames accessed"); } };
  assert.deepEqual(popFlowHistory(topologyHistory, "scope", "new-graph"), {
    history: { scope: "scope", graph: "new-graph", frames: [] }, frame: null,
  });
});

test("back, nearest ancestor and nearest global restore selection, camera and collapse overrides", () => {
  const frames = [frame(null), frame("parent"), frame(null), frame("parent"), frame("child")];
  frames.forEach((f, i) => { f.view!.x = i; f.overrides[0]![1] = i % 2 === 0; });
  frames[3]!.selection = { kind: "node", key: "a" };
  const history = freeze(frames.reduce(push, empty()));
  for (const [target, index] of [[undefined, 4], ["parent", 3], [null, 2]] as const) {
    const result = popFlowHistory(history, "scope", graph, target);
    assert.deepEqual(result.frame, frames[index]);
    assert.deepEqual(result.history.frames, frames.slice(0, index));
  }
  const firstRoot = popFlowHistory(popFlowHistory(history, "scope", graph, null).history, "scope", graph, null);
  assert.deepEqual(firstRoot.frame, frames[0]);
  assert.deepEqual(firstRoot.history.frames, []);
});

test("absent targets and empty histories preserve reconciled history", () => {
  const history = freeze(push(empty(), frame("group")));
  for (const target of [null, "absent"]) {
    const result = popFlowHistory(history, "scope", graph, target);
    assert.equal(result.frame, null);
    assert.deepEqual(result.history, history);
    assert.notEqual(result.history.frames[0], history.frames[0]);
  }
  assert.deepEqual(popFlowHistory(empty(), "scope", graph), { history: empty(), frame: null });
});

test("history keeps only latest 32 frames", () => {
  let history = empty();
  for (let i = 0; i < 40; i++) history = push(freeze(history), frame(String(i)));
  assert.deepEqual(history.frames.map(f => f.focus), Array.from({ length: 32 }, (_, i) => String(i + 8)));
  for (let i = 39; i >= 8; i--) {
    const result = popFlowHistory(history, "scope", graph);
    assert.equal(result.frame!.focus, String(i));
    history = result.history;
  }
  assert.equal(popFlowHistory(history, "scope", graph).frame, null);
});

test("view validation rejects nonfinite and invalid dimensions safely; invalid cameras become null", () => {
  const valid = frame(null).view!;
  assert.equal(validFlowNavigationView(valid), true);
  assert.equal(validFlowNavigationView({ ...valid, zoom: 64 }), true);
  const invalid: unknown[] = [null, undefined, {}, "camera"];
  for (const key of ["x", "y", "zoom", "width", "height"] as const) {
    for (const value of [NaN, Infinity, -Infinity, "1", undefined]) invalid.push({ ...valid, [key]: value });
  }
  for (const key of ["zoom", "width", "height"] as const) {
    for (const value of [0, -1]) invalid.push({ ...valid, [key]: value });
  }
  invalid.push({ ...valid, zoom: 64.01 });
  for (const value of invalid) {
    assert.equal(validFlowNavigationView(value as FlowNavigationView), false);
    assert.deepEqual(push(empty(), { ...frame(null), view: value as FlowNavigationView }).frames, [{ ...frame(null), view: null }]);
  }
});

test("capture, reconciliation and restore clone every mutable field and omit extra properties", () => {
  const input = Object.assign(frame("group"), { privateDetail: "EXTRA" });
  Object.assign(input.view!, { raw: "EXTRA" });
  Object.assign(input.selection!, { label: "EXTRA" });
  const history = push(empty(), input);
  input.targets.push("mutated"); input.overrides[0]![1] = false;
  input.selection!.key = "mutated"; input.view!.x = 999;
  assert.deepEqual(history.frames, [frame("group")]);
  assert.doesNotMatch(JSON.stringify(history), /EXTRA/);
  const saved = freeze(push(history, frame("child")));
  const restored = popFlowHistory(saved, "scope", graph);
  for (const copy of [restored.frame!, restored.history.frames[0]!, reconcileFlowHistory(saved, "scope", graph).frames[0]!]) {
    copy.targets.push("mutated"); copy.overrides[0]![1] = false;
    copy.selection!.key = "mutated"; copy.view!.x = 999;
  }
  assert.deepEqual(saved.frames, [frame("group"), frame("child")]);
  assert.deepEqual(push(empty(), freeze(frame("group"))).frames, [frame("group")]);
});

test("malformed frames are discarded without retaining unexpected data", () => {
  const history = freeze(push(empty(), frame(null)));
  for (const patch of [{ focus: 1 }, { targets: [1] }, { targets: null }, { overrides: [["group", "true"]] },
    { overrides: [["group", true, "extra"]] }, { selection: { kind: "other", key: "a" } }, { selection: undefined }]) {
    assert.deepEqual(push(history, { ...frame("group"), ...patch } as FlowNavigationFrame), history);
  }
  assert.deepEqual(push(history, null as unknown as FlowNavigationFrame), history);
});

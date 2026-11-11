import assert from "node:assert/strict";
import test from "node:test";
import { layoutGroupedFlow } from "../apps/web/src/flow-group-layout.ts";
import type { FlowNode, FlowEdge } from "../apps/web/src/ui/flow-canvas.tsx";

const leaf = (id: string, parentId?: string): FlowNode => ({ id, type: "pyd-flow-node", position: { x: 0, y: 0 }, width: 240, height: 136,
  data: { title: id }, ...(parentId ? { parentId, extent: "parent" } : {}) });
const container = (id: string, parentId?: string): FlowNode => ({ ...leaf(id, parentId), type: "pyd-flow-group", width: 320, height: 180,
  data: { title: id, group: { collapsed: false, basis: "native", partial: false, cyclicMembers: 0 } } });
const edge = (id: string, source: string, target: string): FlowEdge => ({ id, source, target, type: "pyd-flow-edge" });

test("nested groups fit their children below the header and place parents before children", () => {
  const nodes = [leaf("a", "inner"), leaf("b", "inner"), leaf("c", "outer"), container("inner", "outer"), container("outer")];
  const original = JSON.stringify(nodes);
  const graph = layoutGroupedFlow(nodes, [edge("ab", "a", "b"), edge("bc", "b", "c")]);
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  for (const child of graph.nodes.filter(node => node.parentId)) {
    const parent = byId.get(child.parentId!)!;
    assert.ok(child.position.x >= 0); assert.ok(child.position.y >= 124);
    assert.ok(child.position.x + child.width! < parent.width!);
    assert.ok(child.position.y + child.height! < parent.height!);
    assert.ok(graph.nodes.indexOf(parent) < graph.nodes.indexOf(child));
  }
  assert.equal(JSON.stringify(nodes), original);
});

test("wide groups in successive dependency columns do not overlap", () => {
  const nodes = [container("left"), leaf("a", "left"), leaf("b", "left"), container("right"), leaf("c", "right")];
  const graph = layoutGroupedFlow(nodes, [edge("ab", "a", "b"), edge("bc", "b", "c")]);
  const left = graph.nodes.find(node => node.id === "left")!; const right = graph.nodes.find(node => node.id === "right")!;
  assert.ok(left.width! > 500);
  assert.ok(left.position.x + left.width! < right.position.x);
  assert.deepEqual(graph.edges.map(item => [item.source, item.target]), [["a", "b"], ["b", "c"]]);
});

test("record order remains evidence without moving sibling tools into causal dependency columns", () => {
  const flowEdge = { ...edge("record", "a", "b"), className: "mission-edge-record-order" };
  const graph = layoutGroupedFlow([container("run"), leaf("a", "run"), leaf("b", "run")], [flowEdge], ["a", "b"]);
  const a = graph.nodes.find(node => node.id === "a")!; const b = graph.nodes.find(node => node.id === "b")!;
  assert.equal(a.position.x, b.position.x); assert.ok(a.position.y < b.position.y);
  assert.equal(graph.edges[0], flowEdge);
});

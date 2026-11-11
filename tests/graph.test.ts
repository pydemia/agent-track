import assert from "node:assert/strict";
import { test } from "node:test";
import { analyseGraph, executionGraph, type ExecutionGraph } from "../packages/projection/graph.ts";
import type { RelationView, RunView } from "../packages/contracts/index.ts";

const time = "2026-11-11T12:00:00.000Z";
function run(sourceId: string, runId: string): RunView {
  return { sourceId, runId, sessionId: "session", workspaceId: "workspace", title: "observed", status: "running", createdAt: time,
    startedAt: time, completedAt: null, observedAt: time, key: JSON.stringify([sourceId, runId]), cursor: "0", highWater: "0", incomplete: false,
    stale: false, binding: null, sourceLabel: sourceId, device: "test", sourceState: "connected", sourceUrl: null,
    workspaceKey: null, projectKey: null, capabilities: [] };
}
function relation(root: RunView, kind: RelationView["kind"], from: string, to: string): RelationView {
  return { key: JSON.stringify([root.key, kind, from, to]), runKey: root.key, kind, from, to, evidenceSequence: "1", observedAt: time };
}

test("execution map distinguishes ownership, logical invocations and unobserved Run references without inflating actual Runs", () => {
  const selected = run("source-a", "root");
  const relations = [relation(selected, "invocation", "run:root", "invocation:child"),
    relation(selected, "cowork", "invocation:child", "member:member"),
    relation(selected, "managed-child", "run:root", "run:child")];
  const graph = executionGraph(selected, [selected, run("source-b", "child")], relations);
  assert.equal(graph.nodes.filter((node) => node.runKey).length, 1);
  assert.equal(graph.nodes.find((node) => node.kind === "run" && node.id === "child")?.runKey, undefined);
  assert.deepEqual(new Set(graph.edges.map((edge) => edge.kind)), new Set(["context", "invocation", "cowork", "managed-child"]));
  const observed = run("source-a", "child");
  assert.equal(executionGraph(selected, [selected, observed], relations).nodes.filter((node) => node.runKey).length, 2);
  assert.equal(executionGraph(selected, [selected], [relation(run("source-b", "root"), "peer", "run:root", "session:private")]).nodes.some((node) => node.id === "private"), false);
});

test("graph analysis separates cyclic components, their acyclic descendants and isolated nodes", () => {
  const keys = ["a", "b", "c", "d", "isolated", "self"];
  const graph: ExecutionGraph = { nodes: keys.map((key) => ({ key, kind: "invocation", id: key, label: key })),
    edges: [["a", "b"], ["b", "a"], ["b", "c"], ["c", "d"], ["self", "self"]].map(([from, to], index) => ({ key: String(index), from: from!, to: to!, kind: "invocation" })) };
  const result = analyseGraph(graph);
  assert.deepEqual(result.cyclic, new Set(["a", "b", "self"]));
  assert.deepEqual(result.isolated, new Set(["isolated"]));
  assert.equal(result.layers.get("a"), result.layers.get("b"));
  assert.ok(result.layers.get("c")! > result.layers.get("b")!);
  assert.ok(result.layers.get("d")! > result.layers.get("c")!);
});

test("large execution chains are analysed iteratively without recursion overflow", () => {
  const graph: ExecutionGraph = { nodes: Array.from({ length: 10_000 }, (_, index) => ({ key: String(index), id: String(index), label: String(index), kind: "invocation" })),
    edges: Array.from({ length: 9999 }, (_, index) => ({ key: String(index), from: String(index), to: String(index + 1), kind: "invocation" })) };
  const result = analyseGraph(graph);
  assert.equal(result.cyclic.size, 0); assert.equal(result.layers.get("9999"), 9999);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { MissionEdge, MissionNode } from "../packages/projection/mission-flow.ts";
import { projectFlowGroups, type FlowGroupDefinition } from "../packages/projection/flow-groups.ts";

const node = (key: string, kind = "task", sourceId = "native", runKey?: string): MissionNode => ({
  key, id: key, kind, label: key, status: "observed", description: "metadata", sourceId,
  ...(runKey === undefined ? {} : { runKey }), details: [], sequences: ["12"],
});
const edge = (key: string, from: string, to: string, sourceId = "native", kind = "dependency"): MissionEdge => ({
  key, from, to, kind, sourceId, label: "original", detail: "metadata", sequences: [key],
});
const group = (key: string, memberKeys: string[], parentKey?: string): FlowGroupDefinition => ({
  key, memberKeys, label: `Label ${key}`, kind: "bundle", basis: "view", sourceId: "view-source",
  description: "Authorized metadata", ...(parentKey === undefined ? {} : { parentKey }),
});
const project = (nodes: MissionNode[], edges: MissionEdge[], groups: FlowGroupDefinition[], collapsed: string[] = []) =>
  projectFlowGroups({ nodes, edges }, groups, new Set(collapsed));

test("nested groups retain expanded containers, hide only collapsed descendants, and expose visible parents", () => {
  const nodes = [node("a"), node("b"), node("c"), node("outside", "run", "other")];
  const edges = [edge("ab", "a", "b"), edge("bc", "b", "c")];
  const groups = [group("outer", ["c"]), group("inner", ["a", "b"], "outer")];
  const expanded = project(nodes, edges, groups);
  assert.deepEqual(expanded.nodes.map((node) => node.key), ["a", "b", "c", "inner", "outer", "outside"]);
  assert.deepEqual([...expanded.parents], [["a", "inner"], ["b", "inner"], ["c", "outer"], ["inner", "outer"]]);
  assert.deepEqual(expanded.edges, edges);
  const collapsed = project(nodes, edges, groups, ["inner"]);
  assert.deepEqual(collapsed.nodes.map((node) => node.key), ["c", "inner", "outer", "outside"]);
  assert.deepEqual([...collapsed.parents], [["c", "outer"], ["inner", "outer"]]);
  assert.equal(collapsed.edges[0]!.from, "inner");
  assert.equal(collapsed.edges[0]!.to, "c");
  const outer = project(nodes, edges, groups, ["inner", "outer"]);
  assert.deepEqual(outer.nodes.map((node) => node.key), ["outer", "outside"]);
  assert.equal(outer.parents.size, 0);
  assert.equal(outer.edges.length, 0);
  assert.deepEqual(outer.groups.find((group) => group.key === "outer")!.leafKeys, ["a", "b", "c"]);
});

test("collapse aggregates only equal source, direction and kind and retains actual sequence evidence", () => {
  const nodes = [node("a"), node("b"), node("x", "task", "remote")];
  const edges = [edge("one", "a", "x"), edge("two", "b", "x"), edge("remote", "b", "x", "remote"),
    edge("reverse", "x", "a"), edge("ownership", "a", "x", "native", "ownership")];
  const result = project(nodes, edges, [group("g", ["a", "b"])], ["g"]);
  assert.equal(result.edges.length, 4);
  const aggregate = result.edges.find((edge) => edge.label === "original · 2개 관계")!;
  assert.equal(aggregate.from, "g"); assert.equal(aggregate.to, "x");
  assert.equal(aggregate.sourceId, "native"); assert.equal(aggregate.kind, "dependency");
  assert.deepEqual(aggregate.sequences, []);
  assert.match(aggregate.detail, /새로운 의존 관계가 아닙니다/);
  assert.deepEqual(result.edgeEvidence.get(aggregate.key)!.map((edge) => edge.sequences), [["one"], ["two"]]);
  assert.ok(result.edges.some((edge) => edge.sourceId === "remote"));
  assert.ok(result.edges.some((edge) => edge.from === "x" && edge.to === "g"));
  assert.deepEqual(project(nodes, edges, [group("g", ["a", "b"])]).edges.map((edge) => edge.key),
    [...edges].sort((a, b) => a.key < b.key ? -1 : 1).map((edge) => edge.key));
});

test("hidden internal dependency cycles remain in summaries; cycles through outsiders do not count", () => {
  const nodes = [node("a"), node("b"), node("c"), node("x")];
  const edges = [edge("ab", "a", "b"), edge("ba", "b", "a"), edge("cx", "c", "x"), edge("xc", "x", "c"),
    edge("own", "b", "c", "native", "ownership")];
  const result = project(nodes, edges, [group("g", ["a", "b", "c"])], ["g"]);
  assert.equal(result.groups[0]!.cyclicMembers, 2);
  assert.equal(result.groups[0]!.internalEdges, 3);
  assert.equal(result.groups[0]!.boundaryEdges, 2);
  assert.equal(result.edges.length, 2);
  assert.equal(result.nodes.find((node) => node.key === "g")!.details.find((detail) => detail.label === "cyclicMembers")!.value, "2");
  assert.equal(project([node("a")], [edge("self", "a", "a")], [group("g", ["a"])], ["g"]).groups[0]!.cyclicMembers, 1);
});

test("counts retain native kinds and uniqueRun uses only native run nodes and source-qualified run identity", () => {
  const nodes = [node("r1", "run", "s", "r"), node("alias", "run", "s", "r"), node("r2", "run", "t", "r"),
    node("i", "invocation", "s", "invented"), node("m", "member", "s", "invented"), node("cowork", "group"), node("unobserved-run", "run")];
  const result = projectFlowGroups({ nodes, edges: [], incomplete: true }, [group("g", nodes.map((node) => node.key))], new Set());
  const summary = result.groups[0]!;
  assert.equal(summary.counts.run, 4); assert.equal(summary.counts.uniqueRun, 2);
  assert.equal(summary.counts.group, 1); assert.equal(summary.counts.container, undefined);
  assert.equal(summary.statusCounts.observed, 7);
  const container = result.nodes.find((node) => node.key === "g")!;
  assert.equal(container.kind, "container"); assert.equal(container.status, "group-summary");
  assert.equal(container.id, "g"); assert.equal(container.sourceId, "view-source");
  assert.match(container.description, /basis: view/); assert.deepEqual(container.sequences, []);
  assert.ok(container.details.some((detail) => detail.label === "partial" && detail.value === "true"));
});

test("duplicate keys, missing leaves/parents, membership collisions and parent cycles fail closed", () => {
  const nodes = [node("a"), node("b"), node("safe")];
  const definitions = [group("dup", ["a"]), { ...group("dup", ["b"]), label: "PRIVATE STALE LABEL" },
    group("stale", ["private-missing-member"]), group("collision1", ["a"]), group("collision2", ["a"]),
    group("cycle1", [], "cycle2"), group("cycle2", [], "cycle1"), group("orphan", [], "private-missing-parent"),
    group("bad-root", []), group("bad-child", ["missing"], "bad-root"), group("bad-sibling", ["b"], "bad-root"),
    group("good", ["safe"])];
  const result = project(nodes, [edge("ab", "a", "b")], definitions, definitions.map((group) => group.key));
  assert.deepEqual(result.groups.map((group) => group.key), ["good"]);
  assert.deepEqual(result.nodes.map((node) => node.key), ["a", "b", "good"]);
  assert.deepEqual(result.invalidGroups, ["bad-child", "bad-root", "bad-sibling", "collision1", "collision2", "cycle1", "cycle2", "dup", "orphan", "stale"]);
  assert.equal(result.parents.size, 0);
  assert.deepEqual(result.edges.map((edge) => edge.key), ["ab"]);
  assert.doesNotMatch(JSON.stringify({ nodes: result.nodes, edges: result.edges, groups: result.groups }), /PRIVATE|private-|bad-|cycle|collision|stale|dup/);
  assert.deepEqual(project(nodes, [], [group("a", ["b"])]).invalidGroups, ["a"]);
  const overlap = project(nodes, [], [group("parent", ["a"]), group("child", ["a"], "parent"), group("good", ["safe"])]);
  assert.deepEqual(overlap.invalidGroups, ["child", "parent"]);
  assert.deepEqual(overlap.groups.map((group) => group.key), ["good"]);
});

test("reordering definitions and members preserves output and keys without mutating frozen inputs", () => {
  const model = { nodes: [node("a"), node("b"), node("x")], edges: [edge("ax", "a", "x"), edge("bx", "b", "x")] };
  const definitions = [group("g", []), group("h", ["b", "a"], "g")];
  const before = JSON.stringify({ model, definitions });
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  };
  freeze(model); freeze(definitions);
  const first = projectFlowGroups(model, definitions, new Set(["g"]));
  const second = projectFlowGroups(model, [...definitions].reverse().map((group) => ({ ...group, memberKeys: [...group.memberKeys].reverse() })), new Set(["g"]));
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ model, definitions }), before);
});

test("160-node graph preserves all original boundary evidence across nested groups", () => {
  const nodes = Array.from({ length: 160 }, (_, index) => node(`n${index}`, index % 8 === 0 ? "run" : "task", "native", index % 8 === 0 ? `actual-run-${index}` : undefined));
  const edges = nodes.slice(1).map((node, index) => edge(`e${index}`, `n${index}`, node.key));
  const groups = [group("root", []), ...Array.from({ length: 8 }, (_, index) =>
    group(`g${index}`, nodes.slice(index * 20, index * 20 + 20).map((node) => node.key), "root"))];
  const expanded = project(nodes, edges, groups);
  assert.equal(expanded.nodes.length, 169); assert.equal(expanded.edges.length, 159);
  assert.equal(expanded.groups.find((group) => group.key === "root")!.counts.uniqueRun, 20);
  const collapsed = project(nodes, edges, groups, groups.slice(1).map((group) => group.key));
  assert.equal(collapsed.nodes.length, 9); assert.equal(collapsed.edges.length, 7);
  assert.equal([...collapsed.edgeEvidence.values()].flat().length, 7);
});

test("10,000-node dependency chain and 10,000-deep hierarchy do not overflow the call stack", () => {
  const nodes = Array.from({ length: 10_000 }, (_, index) => node(`n${index}`));
  const edges = nodes.slice(1).map((node, index) => edge(`e${index}`, `n${index}`, node.key));
  const chain = project(nodes, edges, [group("chain", nodes.map((node) => node.key))], ["chain"]);
  assert.equal(chain.groups[0]!.internalEdges, 9_999); assert.equal(chain.groups[0]!.cyclicMembers, 0);
  const cycle = project(nodes, [...edges, edge("back", "n9999", "n0")], [group("chain", nodes.map((node) => node.key))], ["chain"]);
  assert.equal(cycle.groups[0]!.cyclicMembers, 10_000); assert.equal(cycle.edges.length, 0);
  const deep = Array.from({ length: 10_000 }, (_, index) => group(`g${index}`, index === 9_999 ? ["leaf"] : [], index ? `g${index - 1}` : undefined));
  const expanded = project([node("leaf")], [], deep);
  assert.equal(expanded.nodes.length, 10_001); assert.equal(expanded.parents.size, 10_000);
  const collapsed = project([node("leaf")], [], deep, ["g0", "g9999"]);
  assert.deepEqual(collapsed.nodes.map((node) => node.key), ["g0"]);
  assert.equal(collapsed.groups.length, 10_000); assert.equal(collapsed.parents.size, 0);
  const cyclic = deep.map((definition, index) => index === 0 ? { ...definition, parentKey: "g9999" } : definition);
  assert.equal(project([node("leaf")], [], cyclic).invalidGroups.length, 10_000);
});

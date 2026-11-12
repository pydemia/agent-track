import assert from "node:assert/strict";
import test from "node:test";
import { flowGroupContext } from "../packages/projection/flow-group-context.ts";
import { missionEntityKey, type MissionEdge, type MissionNode } from "../packages/projection/mission-flow.ts";

const node = (id: string, kind = "task", status = "pending", sourceId = "source-a"): MissionNode => ({
  key: missionEntityKey(sourceId, kind, id), id, kind, status, sourceId,
  label: "not status evidence", description: "not completion evidence", details: [], sequences: [],
});
const run = (id: string, sourceId = "source-a"): MissionNode => ({
  ...node(id, "run", "running", sourceId), runKey: JSON.stringify([sourceId, id]),
});
const edge = (id: string, from: MissionNode, to: MissionNode, kind = "dependency"): MissionEdge => ({
  key: JSON.stringify([from.sourceId, "edge", id]), from: from.key, to: to.key,
  kind, sourceId: from.sourceId, label: "failed output waiting", detail: "not evidence", sequences: [],
});
const group = (nodes: MissionNode[]) => ({ leafKeys: nodes.map(node => node.key) });

test("keeps explicit statuses separate by kind, counts members once and excludes unrelated kinds", () => {
  const nodes = [node("t", "task", "completed"), node("r", "run", "completed"),
    node("e", "assistant-execution", "completed"), node("a", "assistant-role", "pending"),
    node("i", "invocation", "unknown"), node("tool1", "tool", "failed"), node("tool2", "tool", "failed"),
    node("artifact", "artifact", "completed"), node("permission", "permission", "waiting_for_permission"),
    node("session", "session", "failed"), node("group", "group", "completed")];
  const result = flowGroupContext({ leafKeys: [...group(nodes).leafKeys, nodes[0]!.key] }, nodes, []);
  assert.equal(result.memberCount, nodes.length);
  assert.equal(result.partial, false);
  assert.deepEqual(result.statusByKind, [
    { kind: "assistant-execution", states: [{ state: "completed", count: 1 }] },
    { kind: "assistant-role", states: [{ state: "pending", count: 1 }] },
    { kind: "invocation-reference", states: [{ state: "unknown", count: 1 }] },
    { kind: "run", states: [{ state: "completed", count: 1 }] },
    { kind: "task", states: [{ state: "completed", count: 1 }] },
    { kind: "tool", states: [{ state: "failed", count: 2 }] },
  ]);
  assert.deepEqual(Object.keys(result).sort(), ["artifacts", "concerns", "dependencies", "memberCount", "partial", "statusByKind"]);
});

test("concerns require exact explicit kind/status pairs, never permission lifecycle or labels", () => {
  const cases: Array<[string, string, string]> = [
    ["run", "waiting_for_permission", "approval_wait"],
    ["assistant-role", "awaiting_connection", "runtime_wait"],
    ["assistant-role", "awaiting_runtime", "runtime_wait"],
    ["task", "in_review", "review"],
    ...["run", "assistant-execution", "assistant-role", "invocation", "tool"].map(kind => [kind, "failed", "failed"] as [string, string, string]),
  ];
  const positive = cases.map(([kind, status], index) => node(`yes-${index}`, kind, status));
  const excluded = ["task", "run", "assistant-execution", "assistant-role", "invocation", "tool", "permission", "artifact"]
    .flatMap(kind => ["queued", "pending", "cancelled", "waiting", "Failed"].map(status => node(`${kind}-${status}`, kind, status)));
  excluded.push(node("p1", "permission", "waiting_for_permission"), node("p2", "permission", "failed"),
    node("task-failure", "task", "failed"), node("role-permission", "assistant-role", "waiting_for_permission"),
    node("run-runtime", "run", "awaiting_runtime"), node("execution-review", "assistant-execution", "in_review"));
  for (const value of excluded) value.details = [{ label: "status", value: "failed waiting_for_permission in_review" }];
  const result = flowGroupContext(group([...positive, ...excluded]), [...positive, ...excluded], []);
  assert.deepEqual(result.concerns, positive.map((value, index) => ({ nodeKey: value.key, kind: cases[index]![2] }))
    .sort((a, b) => a.nodeKey < b.nodeKey ? -1 : 1));
});

test("source-qualified equal IDs remain distinct; current membership excludes outsiders and withdrawn leaves", () => {
  const local = node("same", "task", "in_review");
  const remote = node("same", "task", "completed", "source-b");
  const withdrawn = node("PRIVATE-WITHDRAWN", "run", "failed");
  const outsider = node("outside", "tool", "failed");
  const before = flowGroupContext(group([local, remote]), [local, remote, outsider], []);
  assert.equal(before.memberCount, 2);
  assert.deepEqual(before.statusByKind, [{ kind: "task", states: [{ state: "completed", count: 1 }, { state: "in_review", count: 1 }] }]);
  const result = flowGroupContext(group([local, withdrawn]), [local, remote, outsider], []);
  assert.equal(result.partial, true);
  assert.equal(result.memberCount, 1);
  assert.deepEqual(result.concerns, [{ nodeKey: local.key, kind: "review" }]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-WITHDRAWN|outside|source-b/);
  assert.equal(flowGroupContext(group([local]), [local], [], true).partial, true);
  assert.deepEqual(flowGroupContext({ leafKeys: [] }, [], []), {
    partial: false, memberCount: 0, statusByKind: [], concerns: [], dependencies: [], artifacts: [],
  });
});

test("dependencies preserve internal and boundary orientation irrespective of observed task status", () => {
  const a = node("a", "task", "completed"); const b = node("b", "task", "cancelled");
  const x = node("x", "task", "failed"); const y = node("y", "task", "unknown"); const r = run("r");
  const edges = [edge("internal", a, b), edge("incoming", x, a), edge("outgoing", b, y), edge("self", a, a),
    edge("outside", x, y), edge("run-dependency", r, a), edge("ownership", a, b, "ownership"),
    edge("chronology", a, b, "record-order")];
  const result = flowGroupContext(group([a, b, r]), [a, b, x, y, r], edges);
  assert.deepEqual(result.dependencies, [
    { edgeKey: edges[1]!.key, fromKey: x.key, toKey: a.key, direction: "incoming" },
    { edgeKey: edges[0]!.key, fromKey: a.key, toKey: b.key, direction: "internal" },
    { edgeKey: edges[2]!.key, fromKey: b.key, toKey: y.key, direction: "outgoing" },
    { edgeKey: edges[3]!.key, fromKey: a.key, toKey: a.key, direction: "internal" },
  ]);
  assert.equal(result.partial, false);
  assert.equal(flowGroupContext(group([a]), [a], []).dependencies.length, 0);
});

test("missing, withdrawn, ambiguous and mismatched-source endpoints never survive in dependencies", () => {
  const a = node("a"); const missing = node("PRIVATE-MISSING"); const conflict = node("PRIVATE-CONFLICT");
  const remote = node("a", "task", "pending", "source-b");
  const edges = [edge("PRIVATE-MISSING-EDGE", missing, a), edge("PRIVATE-CONFLICT-EDGE", a, conflict), edge("PRIVATE-WRONG-SOURCE", a, remote)];
  const result = flowGroupContext(group([a]), [a, remote, conflict, { ...conflict, status: "failed" }], edges);
  assert.equal(result.partial, true);
  assert.deepEqual(result.dependencies, []);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-/);
  const valid = edge("present", a, missing);
  assert.equal(flowGroupContext(group([a]), [a, missing], [valid]).dependencies.length, 1);
  assert.equal(flowGroupContext(group([a]), [a], [valid]).dependencies.length, 0);
});

test("only explicit member Run artifact edges distinguish outputs and associations from references", () => {
  const r = run("r"); const outside = run("outside"); const unobserved = node("unobserved", "run", "unobserved");
  const task = node("task");
  const artifacts = ["output", "association", "generic", "chronology", "outside", "unobserved", "task", "reverse", "wrong-run", "remote"]
    .map(id => node(id, "artifact", "observed-reference", id === "remote" ? "source-b" : "source-a"));
  const [output, association, generic, chronology, external, unknown, taskArtifact, reverse, wrongRun, remote] = artifacts as
    [MissionNode, MissionNode, MissionNode, MissionNode, MissionNode, MissionNode, MissionNode, MissionNode, MissionNode, MissionNode];
  wrongRun.runKey = outside.runKey!;
  const edges = [edge("output", r, output, "artifact-output"), edge("association", r, association, "artifact-association"),
    edge("generic", r, generic, "artifact"), edge("chronology", r, chronology, "record-order"),
    edge("outside", outside, external, "artifact-output"), edge("unobserved", unobserved, unknown, "artifact-output"),
    edge("task", task, taskArtifact, "artifact-output"), edge("reverse", reverse, r, "artifact-output"),
    edge("wrong-run", r, wrongRun, "artifact-output"), edge("remote", r, remote, "artifact-output")];
  const members = [r, unobserved, task, ...artifacts];
  const result = flowGroupContext(group(members), [...members, outside], edges);
  assert.deepEqual(result.artifacts, artifacts.map(value => value === output
    ? { nodeKey: value.key, relationship: "output", edgeKey: edges[0]!.key }
    : value === association ? { nodeKey: value.key, relationship: "association", edgeKey: edges[1]!.key }
      : { nodeKey: value.key, relationship: "reference" }).sort((a, b) => a.nodeKey < b.nodeKey ? -1 : 1));
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.concerns, []);
  // Withdrawing the producer from membership removes output provenance immediately.
  assert.deepEqual(flowGroupContext(group([output]), [r, output], [edges[0]!]).artifacts,
    [{ nodeKey: output.key, relationship: "reference" }]);
});

test("conflicting identities fail closed regardless of order, while identical observations deduplicate", () => {
  const a = node("a"); const b = node("b"); const bad = node("PRIVATE-NODE", "run", "failed");
  const e = edge("valid", a, b); const badEdge = edge("PRIVATE-EDGE", a, b);
  const nodes = [a, structuredClone(a), b, bad, { ...bad, sourceId: "other" }, bad];
  const edges = [e, structuredClone(e), badEdge, { ...badEdge, kind: "ownership" }, badEdge];
  const selected = group([a, b, bad]);
  const result = flowGroupContext(selected, nodes, edges);
  assert.equal(result.memberCount, 2);
  assert.equal(result.partial, true);
  assert.deepEqual(result.dependencies, [{ edgeKey: e.key, fromKey: a.key, toKey: b.key, direction: "internal" }]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-|other/);
  assert.deepEqual(result, flowGroupContext(selected, [...nodes].reverse(), [...edges].reverse()));
  assert.equal(flowGroupContext(group([a]), [a, { ...a, label: "conflicting label" }], []).memberCount, 0);
  assert.equal(flowGroupContext(group([a, b]), [a, b], [e, { ...e, to: a.key }]).dependencies.length, 0);
});

test("frozen inputs are unchanged and all output arrays are deterministic under reordering", () => {
  const r = run("r"); const a = node("a"); const b = node("b", "task", "in_review");
  const output = node("out", "artifact"); const outside = node("outside");
  const nodes = [r, a, b, output, outside];
  const edges = [edge("z", r, output, "artifact-association"), edge("a", r, output, "artifact-output"),
    edge("dep", a, b), edge("boundary", outside, a)];
  const selected = group([r, a, b, output]);
  const before = structuredClone({ selected, nodes, edges });
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") {
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    }
  };
  freeze(selected); freeze(nodes); freeze(edges);
  const result = flowGroupContext(selected, nodes, edges);
  assert.deepEqual(result, flowGroupContext({ leafKeys: [...selected.leafKeys].reverse() }, [...nodes].reverse(), [...edges].reverse()));
  assert.deepEqual({ selected, nodes, edges }, before);
  assert.deepEqual(result.artifacts, [
    { nodeKey: output.key, relationship: "output", edgeKey: edges[1]!.key },
  ]);
  result.dependencies[0]!.fromKey = "changed output";
  assert.deepEqual({ selected, nodes, edges }, before);
});

test("Run aliases count once and conflicting Run or artifact producer observations stay partial", () => {
  const first = run("r"); const alias = { ...first, key: "alias-key" };
  const other = run("other"); const output = node("out", "artifact");
  const values = [first, alias, output];
  const one = flowGroupContext(group(values), values, [edge("one", first, output, "artifact-output"), edge("alias", alias, output, "artifact-output")]);
  assert.deepEqual(one.statusByKind, [{ kind: "run", states: [{ state: "running", count: 1 }] }]);
  assert.equal(one.artifacts.length, 1); assert.equal(one.artifacts[0]!.relationship, "output");
  const conflict = { ...alias, status: "failed" };
  const denied = flowGroupContext(group([first, conflict, output]), [first, conflict, output], [edge("one", first, output, "artifact-output")]);
  assert.equal(denied.partial, true); assert.deepEqual(denied.statusByKind, []); assert.deepEqual(denied.concerns, []);
  assert.deepEqual(denied.artifacts, [{ nodeKey: output.key, relationship: "reference" }]);
  const ambiguous = flowGroupContext(group([first, other, output]), [first, other, output], [
    edge("one", first, output, "artifact-output"), edge("other", other, output, "artifact-output"),
  ]);
  assert.equal(ambiguous.partial, true); assert.deepEqual(ambiguous.artifacts, [{ nodeKey: output.key, relationship: "reference" }]);
});

test("a conflicting alias outside a nested group prevents status and output claims inside it", () => {
  const r = run("r"); const outside = { ...r, key: "outside-alias", status: "failed" };
  const output = node("out", "artifact");
  const selected = group([r, output]);
  const result = flowGroupContext(selected, [r, outside, output], [edge("one", r, output, "artifact-output")]);
  assert.equal(result.partial, true); assert.deepEqual(result.statusByKind, []); assert.deepEqual(result.concerns, []);
  assert.deepEqual(result.artifacts, [{ nodeKey: output.key, relationship: "reference" }]);
  const consistent = flowGroupContext(selected, [r, { ...outside, status: r.status }, output], []);
  assert.equal(consistent.partial, false);
  assert.deepEqual(consistent.statusByKind, [{ kind: "run", states: [{ state: "running", count: 1 }] }]);
});

test("a single contradictory artifact Run reference is partial without any other invalid edges", () => {
  const r = run("r"); const artifact = { ...node("a", "artifact"), runKey: run("different").runKey! };
  const result = flowGroupContext(group([r, artifact]), [r, artifact], [edge("one", r, artifact, "artifact-output")]);
  assert.equal(result.partial, true);
  assert.deepEqual(result.artifacts, [{ nodeKey: artifact.key, relationship: "reference" }]);
});

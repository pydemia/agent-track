import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunView } from "../packages/contracts/index.ts";
import { assistantAttemptFlowGroups, withAssistantAttempts } from "../packages/projection/assistant-attempt-flow.ts";
import type { MissionEdge, MissionFlow, MissionNode } from "../packages/projection/mission-flow.ts";

const at = "2026-11-14T00:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Attempt = NonNullable<RunView["assistantAttempt"]>;

function attempt(ordinal: number, n: number, command: Attempt["command"] = null): Attempt {
  return { assistantSourceId: "assistant-source", executionId: id(10), roleId: id(11),
    attemptId: id(n), ordinal, command };
}

function run(n: number, ordinal: number, command: Attempt["command"] = null,
  scope: { sourceId?: string; assistantSourceId?: string; roleId?: string; taskId?: string | null;
    workspaceId?: string | null } = {}): RunView {
  const sourceId = scope.sourceId ?? "native";
  const runId = id(100 + n);
  const taskId = scope.taskId === undefined ? id(30) : scope.taskId;
  return { sourceId, runId, sessionId: id(200), workspaceId: scope.workspaceId === undefined ? "workspace" : scope.workspaceId,
    title: `Run ${n}`, status: n === 1 ? "failed" : "running", createdAt: at, startedAt: at, completedAt: null,
    observedAt: at, key: JSON.stringify([sourceId, runId]), cursor: "1", highWater: "1", incomplete: false,
    stale: false, binding: taskId ? { sourceId, runId, projectSourceId: "projects", projectId: id(31), taskId,
      taskRevision: "1", projectTitle: "Project", taskTitle: "Task", provenance: "operator" } : null,
    sourceLabel: sourceId, device: "fixture", sourceState: "connected", sourceUrl: null,
    workspaceKey: null, projectKey: null, capabilities: [],
    assistantAttempt: { ...attempt(ordinal, n, command), assistantSourceId: scope.assistantSourceId ?? "assistant-source",
      roleId: scope.roleId ?? id(11) } };
}

function node(value: RunView): MissionNode {
  return { key: JSON.stringify([value.sourceId, "run", value.runId]), kind: "run", id: value.runId,
    label: value.title, status: value.status, description: "actual Run", sourceId: value.sourceId,
    runKey: value.key, details: [
      { label: "실행 ID", value: value.runId }, { label: "출처", value: value.sourceId },
      { label: "Workspace ID", value: value.workspaceId ?? "" },
    ], sequences: [] };
}

function model(runs: RunView[], edges: MissionEdge[] = []): MissionFlow & { taskMapMarker: string } {
  return { nodes: runs.map(node), edges, hiddenNodes: 0, eventCount: 0, incomplete: false,
    taskMapMarker: "preserved" };
}

const intent = (kind: "retry" | "resume", predecessor: string, commandId: string) => ({
  id: commandId, kind, predecessorAttemptId: predecessor, provenance: "coordinator-intent" as const,
});

test("failed A → retry B → resume C uses only explicit intent and preserves generic fields", () => {
  const a = run(1, 1);
  const b = run(2, 2, intent("retry", a.assistantAttempt!.attemptId, id(2)));
  const c = run(3, 3, intent("resume", b.assistantAttempt!.attemptId, id(3)));
  const output = withAssistantAttempts(model([a, b, c]), [c, a, b]);
  assert.equal(output.taskMapMarker, "preserved");
  assert.deepEqual(output.edges.map(edge => [edge.kind, edge.label, edge.from, edge.to]), [
    ["assistant-resume-intent", "재개 요청", node(b).key, node(c).key],
    ["assistant-retry-intent", "재시도 요청", node(a).key, node(b).key],
  ].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))));
  assert.deepEqual(output.edges.map(edge => edge.sequences), [[], []]);
  assert.ok(output.edges.every(edge => edge.sourceId === "native" && edge.detail.includes("coordinator-intent") && edge.detail.includes("Command ID")));
  assert.equal(output.nodes.filter(value => value.assistantAttemptRef).length, 3);
  const groups = assistantAttemptFlowGroups(output);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.memberKeys, [node(a).key, node(b).key, node(c).key].sort());
  assert.equal(groups[0]!.kind, "assistant-role-attempts");
  assert.equal(groups[0]!.basis, "native");
  assert.match(groups[0]!.description, /Coordinator.*Native/);
});

test("current Run without optional metadata remains unchanged", () => {
  const current = run(1, 1);
  delete (current as Partial<RunView>).assistantAttempt;
  const base = model([current]);
  const output = withAssistantAttempts(base, [current]);
  assert.deepEqual(output, base);
  assert.equal(assistantAttemptFlowGroups(output).length, 0);
});

test("source, Assistant execution, role, Task, workspace and stale scope never cross-link", () => {
  const a = run(1, 1);
  const variations = [
    run(2, 2, intent("retry", a.assistantAttempt!.attemptId, id(2)), { sourceId: "native-b" }),
    run(3, 2, intent("retry", a.assistantAttempt!.attemptId, id(3)), { assistantSourceId: "assistant-b" }),
    run(4, 2, intent("retry", a.assistantAttempt!.attemptId, id(4)), { roleId: id(12) }),
    run(5, 2, intent("retry", a.assistantAttempt!.attemptId, id(5)), { taskId: id(32) }),
    run(6, 2, intent("retry", a.assistantAttempt!.attemptId, id(6)), { workspaceId: "workspace-b" }),
  ];
  for (const other of variations) {
    const output = withAssistantAttempts(model([a, other]), [a, other]);
    assert.equal(output.edges.length, 0);
  }
  const stale = { ...run(7, 2, intent("retry", a.assistantAttempt!.attemptId, id(7))), stale: true };
  assert.equal(withAssistantAttempts(model([a, stale]), [a, stale]).edges.length, 0);
});

test("malformed metadata and ambiguous Run identities fail closed", () => {
  const valid = run(1, 1);
  const malformed = { ...run(2, 2), assistantAttempt: { ...attempt(34, 2) } } as unknown as RunView;
  assert.equal(withAssistantAttempts(model([valid, malformed]), [valid, malformed]).nodes
    .find(n => n.id === malformed.runId)!.assistantAttemptRef, undefined);

  const duplicateAttempt = run(2, 2);
  duplicateAttempt.assistantAttempt = { ...duplicateAttempt.assistantAttempt!, attemptId: valid.assistantAttempt!.attemptId };
  assert.equal(withAssistantAttempts(model([valid, duplicateAttempt]), [valid, duplicateAttempt]).edges.length, 0);
  assert.equal(withAssistantAttempts(model([valid, duplicateAttempt]), [valid, duplicateAttempt]).nodes.some(n => n.assistantAttemptRef), false);

  const duplicateOrdinal = run(2, 1);
  assert.equal(withAssistantAttempts(model([valid, duplicateOrdinal]), [valid, duplicateOrdinal]).nodes.some(n => n.assistantAttemptRef), false);

  const conflict = { ...valid, key: "conflicting-key" };
  assert.equal(withAssistantAttempts(model([valid]), [valid, conflict]).nodes.some(n => n.assistantAttemptRef), false);
});

test("missing predecessor is explicit, incomplete and never a dangling edge", () => {
  const child = run(2, 2, intent("retry", id(99), id(2)));
  const output = withAssistantAttempts(model([child]), [child]);
  assert.equal(output.edges.length, 0);
  assert.equal(output.incomplete, true);
  assert.match(output.nodes[0]!.details.find(detail => detail.label === "선행 Attempt 관측")!.value,
    /관측되지 않았습니다.*실패한 의존성/);
});

test("projection and grouping do not mutate inputs and are stable across Run order", () => {
  const a = run(1, 1);
  const b = run(2, 2, intent("retry", a.assistantAttempt!.attemptId, id(2)));
  const base = model([a, b]);
  const before = structuredClone({ base, a, b });
  const first = withAssistantAttempts(base, [a, b]);
  const second = withAssistantAttempts(base, [b, a]);
  assert.deepEqual({ base, a, b }, before);
  assert.deepEqual(first, second);
  assert.deepEqual(assistantAttemptFlowGroups(first), assistantAttemptFlowGroups(second));
  assert.deepEqual(assistantAttemptFlowGroups(first), assistantAttemptFlowGroups({ ...first, nodes: [...first.nodes].reverse() }));
});

test("repeated projection is idempotent and withdrawal removes previous intent edges and inspector metadata", () => {
  const a = run(1, 1), b = run(2, 2, intent("retry", id(1), id(2)));
  const first = withAssistantAttempts(model([a, b]), [a, b]);
  assert.deepEqual(withAssistantAttempts(first, [a, b]), first);
  const withdrawn = withAssistantAttempts(first, [{ ...a, stale: true }, { ...b, stale: true }]);
  assert.equal(withdrawn.edges.some(edge => edge.kind.endsWith("-intent")), false);
  assert.equal(withdrawn.nodes.some(node => node.assistantAttemptRef || node.assistantAttemptScope), false);
  assert.equal(withdrawn.nodes.some(node => node.details.some(detail => detail.label === "Attempt ID")), false);
  assert.deepEqual(assistantAttemptFlowGroups(withdrawn), []);
});

test("identical UUID in another role or source cannot shadow the valid predecessor", () => {
  const a = run(1, 1), b = run(2, 2, intent("retry", id(1), id(2)));
  for (const scope of [{ sourceId: "another-native" }, { roleId: id(90) }]) {
    const other = run(3, 1, null, scope); other.assistantAttempt!.attemptId = id(1);
    const runs = [a, b, other], base = model(runs);
    const left = withAssistantAttempts(base, runs), right = withAssistantAttempts(base, [other, b, a]);
    assert.deepEqual(left, right);
    assert.equal(left.edges.filter(edge => edge.kind === "assistant-retry-intent").length, 1);
    assert.equal(left.edges.find(edge => edge.kind === "assistant-retry-intent")!.from, node(a).key);
  }
});

test("group scope uses structured evidence when source label differs from ID or workspace is unknown", () => {
  const a = run(1, 1, null, { workspaceId: null }); a.sourceLabel = "실제 표시 이름";
  const base = model([a]); base.nodes[0]!.details = [{ label: "출처", value: a.sourceLabel }];
  const groups = assistantAttemptFlowGroups(withAssistantAttempts(base, [a]));
  assert.equal(groups.length, 1); assert.deepEqual(groups[0]!.memberKeys, [node(a).key]);
});

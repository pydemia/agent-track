import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantRunAttemptSchema, externalKey, type RunView, type SourceView } from "../packages/contracts/index.ts";
import type { AssistantExecutionView } from "../packages/contracts/assistant-view.ts";
import { Store } from "../packages/storage/store.ts";
import { missionFlow } from "../packages/projection/mission-flow.ts";
import { assistantFlow, assistantRoleKey, withAssistantExecutions } from "../packages/projection/assistant-flow.ts";
import { nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";
import { projectFlowGroups } from "../packages/projection/flow-groups.ts";
import { groupWorkspaceFlow, isDetailedGroup } from "../packages/projection/group-workspace-flow.ts";
import { createGroupWorkspaceScope, resolveGroupWorkspaceScope } from "../packages/projection/group-workspace-scope.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-14T00:00:00.000Z";
function run(n: number): RunView {
  const runId = id(n);
  return { sourceId: "protected", runId, key: externalKey("protected", runId), sessionId: id(20), workspaceId: id(21),
    title: `역할 실행 ${n}`, status: n === 1 ? "failed" : n === 2 ? "cancelled" : "running", createdAt: at,
    startedAt: at, completedAt: n < 3 ? at : null, observedAt: at, cursor: "0", highWater: "0", incomplete: false,
    stale: false, sourceLabel: "Protected", device: "test", sourceState: "connected", sourceUrl: null,
    workspaceKey: null, projectKey: null, capabilities: ["run.read"],
    binding: { sourceId: "protected", runId, projectSourceId: "projects", projectId: "project", taskId: "task",
      taskRevision: "1", projectTitle: "프로젝트", taskTitle: "업무", provenance: "source" },
    assistantAttempt: { assistantSourceId: "assistant", executionId: id(30), roleId: id(31), attemptId: id(n + 10), ordinal: n,
      command: n === 1 ? null : { id: id(n + 10), kind: n === 2 ? "retry" : "resume",
        predecessorAttemptId: id(n + 9), provenance: "coordinator-intent" } },
  };
}
const sources: SourceView[] = [
  { id: "protected", kind: "demian", label: "Protected", device: "test", state: "connected", capabilities: [], lastObservedAt: at, detail: "" },
  { id: "assistant", kind: "assistant", label: "Assistant", device: "test", state: "connected", capabilities: [], lastObservedAt: at, detail: "" },
  { id: "projects", kind: "projects", label: "Projects", device: "test", state: "connected", capabilities: [], lastObservedAt: at, detail: "", authorizedProjectIds: ["project"] },
];
const task = { id: "task", projectId: "project", title: "업무", revision: "2", state: "in_progress", requiresTest: false };
function execution(): AssistantExecutionView {
  return { sourceId: "assistant", sourceLabel: "Assistant", device: "test", native: {
    id: id(30), instructionId: id(32), instructionRevision: "1", revision: "7", state: "running", errorCode: null,
    task: { projectId: "project", taskId: "task", revision: "1", state: "todo", observedAt: at }, createdAt: at, updatedAt: at,
    roles: [{ id: id(31), assignmentId: "assignment", workPackageId: "package", membershipId: "membership", membershipRevision: "1",
      teamId: "team", teamLabel: "팀", label: "개발", agentLabel: "Agent", responsibility: "contributor", state: "running", attempts: 3,
      runtime: { taskId: "current-task", threadId: null, turnId: null, demian: null }, observation: { queuedAt: null, startedAt: at, endedAt: null,
        seconds: null, timingComplete: false, basis: "external_run_wall_timestamps_unverified" } }],
  }, currentTask: { projectsSourceId: "projects", projectKey: "project:" + "a".repeat(43),
    project: { id: "project", title: "프로젝트", revision: "1", accessRevision: "1", archived: false }, task, observedAt: at } };
}

test("selected source-bound Run expands its actual role history with explicit intent edges and nested Run groups", () => {
  const runs = [run(1), run(2), run(3)], model = missionFlow(runs[1]!, runs, [], []);
  assert.equal(model.nodes.filter(node => node.kind === "run" && node.assistantAttemptRef).length, 3);
  assert.deepEqual(model.edges.filter(edge => edge.kind.endsWith("-intent")).map(edge => edge.label).sort(), ["재개 요청", "재시도 요청"].sort());
  const definitions = nativeFlowGroupDefinitions(model, "run"), attempt = definitions.find(group => group.kind === "assistant-role-attempts")!;
  assert.ok(attempt); assert.equal(definitions.filter(group => group.kind === "run" && group.parentKey === attempt.key).length, 3);
  const projected = projectFlowGroups(model, definitions, new Set());
  assert.deepEqual(projected.invalidGroups, []);
  const collapsed = projectFlowGroups(model, definitions, new Set([attempt.key]));
  assert.equal(collapsed.nodes.some(node => node.key === attempt.key), true);
  assert.equal(collapsed.nodes.some(node => node.kind === "run"), false);
  assert.equal(isDetailedGroup(attempt.kind), false);
});

test("legacy membership remains visible in a role group without inventing retry order; bounded views have no dangling edges", () => {
  const runs = [run(1), run(2)]; runs[1]!.assistantAttempt!.command = null;
  const model = missionFlow(runs[0]!, runs, [], []);
  assert.equal(model.nodes.filter(node => node.kind === "run").length, 2);
  assert.equal(model.edges.some(edge => edge.kind.endsWith("-intent")), false);
  const bounded = missionFlow(run(1), [run(1), run(2), run(3)], [], [], { maxNodes: 2 });
  const keys = new Set(bounded.nodes.map(node => node.key));
  assert.ok(bounded.hiddenNodes > 0); assert.equal(bounded.incomplete, true);
  assert.ok(bounded.edges.every(edge => keys.has(edge.from) && keys.has(edge.to)));
});

test("Assistant, Task map and group workspace keep the same historical Run identity and navigable role hierarchy", () => {
  const runs = [run(1), run(2), run(3)], input = execution();
  const model = assistantFlow([input], sources, { runs });
  assert.equal(model.nodes.filter(node => node.kind === "run" && node.assistantAttemptRef).length, 3);
  const roleKey = assistantRoleKey("assistant", id(30), id(31));
  assert.equal(model.nodes.find(node => node.key === roleKey)!.status, "running");
  const defs = nativeFlowGroupDefinitions(model, "task");
  const attempt = defs.find(group => group.kind === "assistant-role-attempts")!;
  assert.ok(attempt.memberKeys.includes(roleKey));
  assert.equal(defs.find(group => group.key === attempt.parentKey)!.kind, "assistant-execution");
  const projected = projectFlowGroups(model, defs, new Set()); assert.deepEqual(projected.invalidGroups, []);
  const summary = projected.groups.find(group => group.key === attempt.key)!;
  const scope = createGroupWorkspaceScope("owner", summary, model.nodes, model.edges);
  assert.ok(scope); assert.equal(scope.runRefs.length, 3);
  assert.equal(resolveGroupWorkspaceScope(scope, "owner", runs, sources, [input])!.runs.length, 3);
  const record = { ref: { sourceId: "projects", projectId: "project", taskId: "task" }, task };
  const workspace = groupWorkspaceFlow([record], runs, [], [input], sources, []);
  assert.equal(workspace.nodes.filter(node => node.kind === "run" && node.assistantAttemptRef).length, 3);
  assert.equal(workspace.edges.filter(edge => edge.kind.endsWith("-intent")).length, 2);
  assert.deepEqual(projectFlowGroups(workspace, nativeFlowGroupDefinitions(workspace, "task"), new Set()).invalidGroups, []);
  const combined = withAssistantExecutions({ nodes: [] as typeof model.nodes, edges: [] as typeof model.edges, hiddenNodes: 0, incomplete: false, focusPresent: false }, [input], sources,
    { sourceId: "projects", projectId: "project", focusTaskId: "task" }, runs);
  assert.equal(combined.focusPresent, true); assert.equal(combined.nodes.filter(node => node.kind === "run").length, 3);
});

test("separate Tasks, roles and stale sources cannot expand selected historical scope", () => {
  const a = run(1), other = run(2);
  for (const mutate of [
    (run: RunView) => { run.binding!.taskId = "another"; },
    (run: RunView) => { run.assistantAttempt!.roleId = id(99); },
    (run: RunView) => { run.stale = true; },
    (run: RunView) => { run.workspaceId = id(99); },
  ]) {
    const b = structuredClone(other); mutate(b);
    const model = missionFlow(a, [a, b], [], []);
    assert.equal(model.nodes.some(node => node.runKey === b.key), false);
    assert.equal(model.edges.some(edge => edge.kind.endsWith("-intent")), false);
  }
});

test("one logical role across two Native sources keeps attempt groups as siblings with separate Run leaves", () => {
  const a = run(1), b = run(1);
  b.sourceId = "protected-b"; b.key = externalKey(b.sourceId, b.runId); b.binding!.sourceId = b.sourceId;
  const grants = [...sources, { ...sources[0]!, id: b.sourceId }];
  const model = assistantFlow([execution()], grants, { runs: [a, b] });
  const defs = nativeFlowGroupDefinitions(model, "task");
  const attempts = defs.filter(group => group.kind === "assistant-role-attempts");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]!.parentKey, attempts[1]!.parentKey);
  assert.equal(defs.find(group => group.key === attempts[0]!.parentKey)!.kind, "assistant-execution");
  const projection = projectFlowGroups(model, defs, new Set()); assert.deepEqual(projection.invalidGroups, []);
  for (const attempt of attempts) {
    const leaves = projection.groups.find(group => group.key === attempt.key)!.leafKeys;
    const memberRuns = model.nodes.filter(node => leaves.includes(node.key) && node.kind === "run");
    assert.equal(memberRuns.length, 1); assert.equal(memberRuns[0]!.sourceId, attempt.sourceId);
  }
});

test("selected Run filtering cannot discard a conflicting observation before attempt identity checks", () => {
  const a = run(1), b = run(2), conflict = structuredClone(a);
  conflict.assistantAttempt!.roleId = id(999);
  for (const rows of [[a, conflict, b], [conflict, b]]) {
    const model = missionFlow(a, rows, [], []);
    assert.equal(model.edges.some(edge => edge.kind.endsWith("-intent")), false);
    assert.equal(model.nodes.some(node => node.assistantAttemptRef), false);
  }
});

test("read-side attempt metadata persists outside immutable event journal and can be cleared by current-only observation", () => {
  const store = new Store(":memory:");
  try {
    const a = run(1), { key, cursor, highWater, incomplete, stale, binding, sourceLabel, device, sourceState, sourceUrl, workspaceKey, projectKey, capabilities, ...observation } = a;
    store.observeRun(observation); store.bind(binding!, "owner");
    store.ingest({ sourceId: a.sourceId, runId: a.runId, sequence: "1", type: "run.failed", occurredAt: at, data: { status: "failed", redacted: true } });
    const events = store.events(key), before = JSON.stringify(events);
    assert.deepEqual(store.snapshot("owner", sources).runs[0]!.assistantAttempt, a.assistantAttempt);
    const { assistantAttempt, ...currentOnly } = observation; store.observeRun(currentOnly);
    assert.equal(store.snapshot("owner", sources).runs[0]!.assistantAttempt, undefined);
    assert.equal(JSON.stringify(store.events(key)), before);
    assert.equal(assistantRunAttemptSchema.safeParse({ ...a.assistantAttempt, prompt: "PRIVATE" }).success, false);
    assert.equal(assistantRunAttemptSchema.safeParse({ ...run(2).assistantAttempt, attemptId: id(999) }).success, false);
  } finally { store.close(); }
});

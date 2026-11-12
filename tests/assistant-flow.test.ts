import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantExecutionView } from "../packages/contracts/assistant-view.ts";
import type { SourceView } from "../packages/contracts/index.ts";
import { assistantEntityKey, assistantFlow, assistantFlowGroups, assistantRoleKey, withAssistantExecutions } from "../packages/projection/assistant-flow.ts";
import { dependencyEntityKey } from "../packages/projection/project-dependencies-flow.ts";
import { externalKey, type RunView } from "../packages/contracts/index.ts";
import { projectFlowGroups } from "../packages/projection/flow-groups.ts";
import { flowGroupKey, nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";

const at = "2026-11-12T00:00:00Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function sources(): SourceView[] {
  return [{ id: "assistant", kind: "assistant", label: "Assistant", device: "test", state: "connected",
    lastObservedAt: at, detail: "", capabilities: [] },
  { id: "projects", kind: "projects", label: "Projects", device: "test", state: "connected",
    lastObservedAt: at, detail: "", capabilities: [], authorizedProjectIds: ["project"] }];
}
function execution(n = 1): AssistantExecutionView {
  return { sourceId: "assistant", sourceLabel: "Assistant", device: "test", native: {
    id: uuid(n), instructionId: uuid(90), instructionRevision: "2", revision: "3", state: "completed", errorCode: null,
    task: { projectId: "project", taskId: "same", revision: "4", state: "in_progress", observedAt: at },
    createdAt: at, updatedAt: at, roles: [{ id: uuid(80), assignmentId: "assignment", workPackageId: "package",
      teamId: "team", membershipId: "membership", membershipRevision: "6", label: "개발", teamLabel: "팀",
      agentLabel: "에이전트", responsibility: "contributor", state: "completed", attempts: 1,
      runtime: { taskId: "same", threadId: "same", turnId: "same" },
      observation: { queuedAt: null, startedAt: at, endedAt: at, seconds: 0, timingComplete: true,
        basis: "server_dispatch_to_terminal_including_sdk_preparation" } }],
  }, currentTask: { projectsSourceId: "projects", projectKey: "project:" + "a".repeat(43), project: { id: "project", title: "프로젝트", revision: "7", accessRevision: "8", archived: false },
    task: { id: "same", projectId: "project", title: "현재 업무", state: "todo", revision: "9", requiresTest: true }, observedAt: at } };
}
const value = (node: { details: Array<{ label: string; value: string }> }, label: string) =>
  node.details.find(item => item.label === label)?.value;

function linkedExecution() {
  const input = execution();
  input.native = { ...input.native, roles: input.native.roles.map(role => ({ ...role,
    runtime: { ...role.runtime, threadId: null, turnId: null, demian: null },
    observation: { ...role.observation, seconds: null, timingComplete: false, basis: "external_run_wall_timestamps_unverified" as const } })) };
  const run: RunView = { sourceId: "demian", runId: uuid(200), sessionId: uuid(201), workspaceId: uuid(202),
    key: externalKey("demian", uuid(200)), status: "succeeded", title: "Native result", createdAt: at, startedAt: at, completedAt: at,
    observedAt: at, cursor: "17", highWater: "17", incomplete: false, stale: false, binding: null,
    sourceLabel: "Demian", device: "test", sourceState: "connected", sourceUrl: null, workspaceKey: null, projectKey: null, capabilities: [] };
  input.demianLinks = { state: "connected", links: [{ roleId: input.native.roles[0]!.id, sourceId: run.sourceId,
    runKey: run.key, runId: run.runId, sessionId: run.sessionId, workspaceId: run.workspaceId!,
    operationId: input.native.roles[0]!.id, status: run.status, observedAt: at }], omitted: 0, complete: false, detail: "Native receipt" };
  const grants: SourceView[] = [...sources(), { id: "demian", kind: "demian", label: "Demian", device: "test",
    state: "connected", lastObservedAt: at, detail: "", capabilities: [] }];
  return { input, run, grants };
}

test("v2 typed role-to-native edge keeps real Run identity and nested groups without synthetic Task binding", () => {
  const { input, run, grants } = linkedExecution();
  const before = structuredClone(input);
  const model = assistantFlow([input], grants, { runs: [run] });
  const native = model.nodes.find(node => node.kind === "run")!;
  assert.equal(native.key, dependencyEntityKey(run.sourceId, "run", run.runId));
  assert.equal(native.runKey, run.key);
  assert.equal(model.nodes.filter(node => node.kind === "run").length, 1);
  const relation = model.edges.find(edge => edge.kind === "assistant-demian-runtime")!;
  assert.equal(relation.from, assistantRoleKey(input.sourceId, input.native.id, input.native.roles[0]!.id));
  assert.equal(relation.to, native.key);
  assert.ok(relation.detail.includes(`Operation ID: ${input.native.roles[0]!.id}`));
  assert.ok(relation.detail.includes(`Run ID: ${run.runId}`));
  assert.match(relation.detail, /원본 operation 영수증/);
  assert.equal(model.edges.some(edge => edge.kind === "task-binding" && edge.to === native.key), false);
  const groups = nativeFlowGroupDefinitions(model, "session");
  const collapsed = projectFlowGroups(model, groups, new Set(groups.map(group => group.key)));
  assert.deepEqual(collapsed.invalidGroups, []);
  const boundary = collapsed.edges.find(edge => edge.kind === "assistant-demian-runtime")!;
  assert.ok(boundary);
  assert.deepEqual(collapsed.edgeEvidence.get(boundary.key), [relation]);
  assert.deepEqual(input, before);
});

test("native denial, stale/missing Run and mismatched IDs remove cached cross-app edges and details", () => {
  for (const change of ["source", "stale", "missing", "session", "workspace", "project", "relation"] as const) {
    const { input, run, grants } = linkedExecution();
    if (change === "source") grants[2]!.state = "forbidden";
    if (change === "stale") run.stale = true;
    if (change === "session") run.sessionId = uuid(300);
    if (change === "workspace") run.workspaceId = uuid(300);
    if (change === "project") grants[1]!.authorizedProjectIds = [];
    if (change === "relation") input.demianLinks!.state = "forbidden";
    const model = assistantFlow([input], grants, { runs: change === "missing" ? [] : [run] });
    assert.equal(model.edges.some(edge => edge.kind === "assistant-demian-runtime"), false, change);
    assert.equal(model.nodes.some(node => node.kind === "run"), false, change);
    assert.doesNotMatch(JSON.stringify(model), new RegExp(run.runId));
  }
});

test("Task Map merges the native Run and Session once and preserves operation edge evidence", () => {
  const { input, run, grants } = linkedExecution();
  const native = assistantFlow([input], grants, { runs: [run] });
  const nodes = native.nodes.filter(node => ["task", "session", "run"].includes(node.kind));
  const edges = native.edges.filter(edge => edge.kind === "ownership");
  const base = { nodes, edges, hiddenNodes: 0, incomplete: false, focusPresent: true };
  const model = withAssistantExecutions(base, [input], grants, { sourceId: "projects", projectId: "project" }, [run]);
  assert.equal(model.nodes.filter(node => node.kind === "run").length, 1);
  assert.equal(model.nodes.filter(node => node.kind === "session").length, 1);
  assert.equal(model.edges.filter(edge => edge.kind === "ownership").length, 1);
  assert.equal(model.edges.filter(edge => edge.kind === "assistant-demian-runtime").length, 1);
});

test("typed source-qualified identities preserve native roles and never create Demian Runs", () => {
  const a = execution(); const b = execution(2); const c = execution(); c.sourceId = "other";
  const grants = [...sources(), { ...sources()[0]!, id: "other" }];
  const model = assistantFlow([a, b, c], grants);
  assert.equal(model.nodes.filter(node => node.kind === "task").length, 1);
  assert.equal(model.nodes.filter(node => node.kind === "assistant-execution").length, 3);
  assert.equal(model.nodes.filter(node => node.kind === "assistant-role").length, 3);
  assert.equal(model.nodes.filter(node => node.kind === "assistant-thread").length, 2);
  assert.ok(model.nodes.some(node => node.key === assistantRoleKey(a.sourceId, a.native.id, a.native.roles[0]!.id)));
  assert.equal(new Set(model.nodes.map(node => node.key)).size, model.nodes.length);
  assert.ok(model.nodes.every(node => node.runKey === undefined && node.kind !== "run"));
  for (const kind of ["assistant-runtime-task", "assistant-thread", "assistant-turn"])
    assert.equal(model.nodes.find(node => node.key === assistantEntityKey("assistant", kind, "same"))?.status, "observed");
  assert.equal(model.nodes.find(node => node.key === dependencyEntityKey("projects", "task", "same"))?.status, "todo");
  assert.deepEqual(new Set(model.edges.map(edge => edge.kind)), new Set(["assistant-task-binding", "assistant-role", "assistant-runtime-reference"]));
  assert.ok(model.edges.every(edge => /Source ID:.*provenance:/.test(edge.detail)));
  const grouped = projectFlowGroups(model, assistantFlowGroups(model), new Set());
  assert.deepEqual(grouped.invalidGroups, []);
  assert.ok(grouped.groups.every(group => group.counts.uniqueRun === 0));
});

test("the same current Task snapshot observed at different times keeps all native executions", () => {
  const a = execution(), b = execution(2); b.currentTask!.observedAt = "2026-11-12T00:01:00Z";
  const model = assistantFlow([a, b], sources());
  assert.equal(model.nodes.filter(node => node.kind === "task").length, 1);
  assert.equal(model.nodes.filter(node => node.kind === "assistant-execution").length, 2);
});

test("Task grouping joins a real Run and native Assistant execution without converting or double-counting either", () => {
  const input = execution(); const native = assistantFlow([input], sources());
  const task = native.nodes.find(node => node.kind === "task")!;
  const run = { ...native.nodes.find(node => node.kind === "assistant-execution")!, key: "real-demian-run", id: "same", kind: "run", sourceId: "demian", runKey: "tracked-run" };
  const base = { nodes: [task, run], edges: [{ key: "explicit-binding", from: task.key, to: run.key, kind: "task-binding", sourceId: "demian", label: "명시 연결", detail: "operator", sequences: [] }],
    hiddenNodes: 0, incomplete: false, focusPresent: true };
  const before = structuredClone(base);
  const model = withAssistantExecutions(base, [input], sources(), { sourceId: "projects", projectId: "project", focusTaskId: "same" });
  assert.deepEqual(base, before);
  const grouped = projectFlowGroups(model, nativeFlowGroupDefinitions(model, "project"), new Set());
  assert.deepEqual(grouped.invalidGroups, []);
  const taskGroup = grouped.groups.find(group => group.kind === "task")!;
  assert.equal(taskGroup.counts.uniqueRun, 1);
  assert.equal(taskGroup.counts["assistant-execution"], 1);
  assert.equal(grouped.groups.find(group => group.kind === "assistant-execution")!.parentKey, taskGroup.key);
  assert.equal(model.nodes.filter(node => node.kind === "task").length, 1);
  assert.ok(model.edges.every(edge => model.nodes.some(node => node.key === edge.from) && model.nodes.some(node => node.key === edge.to)));
  const conflict = structuredClone(input); conflict.currentTask!.task.revision = "10";
  assert.equal(withAssistantExecutions(base, [conflict], sources(), { sourceId: "projects", projectId: "project" }).nodes.find(node => node.kind === "task")!.status, "unknown");
});

test("historical Task metadata remains distinct from the fresh task and mismatches are omitted", () => {
  const input = execution(); const model = assistantFlow([input], sources());
  const node = model.nodes.find(node => node.kind === "assistant-execution")!;
  assert.equal(value(node, "기록 당시 Task revision"), "4");
  assert.equal(value(node, "현재 Task revision"), "9");
  assert.equal(value(node, "기록 당시 Task 상태"), "in_progress");
  assert.equal(value(node, "현재 Task 상태"), "todo");
  for (const mutate of [
    (e: AssistantExecutionView) => { e.currentTask = null; },
    (e: AssistantExecutionView) => { e.currentTask!.task.id = "different"; },
    (e: AssistantExecutionView) => { e.currentTask!.task.projectId = "different"; },
    (e: AssistantExecutionView) => { e.currentTask!.project.id = "different"; },
    (e: AssistantExecutionView) => { e.native.task = null; },
  ]) {
    const bad = execution(); mutate(bad);
    assert.deepEqual(assistantFlow([bad], sources()).nodes, []);
  }
});

test("exact scope and current source grants are required without guessed source identity", () => {
  const input = execution();
  assert.equal(assistantFlow([input], sources(), { projectsSourceId: "projects", projectId: "project", taskId: "same" }).nodes.length, 6);
  for (const options of [{ projectsSourceId: "other" }, { projectId: "other" }, { taskId: "sam" }, { taskId: "" }])
    assert.equal(assistantFlow([input], sources(), options).nodes.length, 0);
  for (const index of [0, 1]) for (const state of ["forbidden", "disconnected", "unsupported"] as const) {
    const grants = sources(); grants[index]!.state = state;
    assert.equal(assistantFlow([input], grants).nodes.length, 0);
  }
  const grants = sources(); grants[1]!.authorizedProjectIds = [];
  assert.equal(assistantFlow([input], grants).nodes.length, 0);
  assert.equal(assistantFlow([input], sources().slice(0, 1)).nodes.length, 0);
  const unlinked = execution(); unlinked.native.task = null; unlinked.currentTask = null;
  assert.equal(assistantFlow([unlinked], sources().slice(0, 1)).nodes.length, 5);
  for (const options of [{ projectsSourceId: "projects" }, { projectId: "project" }, { taskId: "same" }])
    assert.equal(assistantFlow([unlinked], sources(), options).nodes.length, 0);
});

test("shared references remain outside execution groups and nested work packages have disjoint direct membership", () => {
  const a = execution(); const b = execution(2);
  a.native.roles.push({ ...structuredClone(a.native.roles[0]!), id: uuid(81) });
  b.native.roles[0]!.runtime.taskId = "other-task"; b.native.roles[0]!.runtime.turnId = "other-turn";
  const model = assistantFlow([a, b], sources()); const groups = assistantFlowGroups(model);
  const thread = assistantEntityKey("assistant", "assistant-thread", "same");
  assert.ok(groups.every(group => !group.memberKeys.includes(thread)));
  const parent = groups.find(group => group.key === flowGroupKey("assistant-execution", assistantEntityKey("assistant", "assistant-execution", a.native.id)))!;
  assert.equal(parent.parentKey, undefined);
  const child = groups.find(group => group.kind === "assistant-work-package")!;
  assert.equal(child.parentKey, parent.key); assert.equal(child.memberKeys.length, 2);
  assert.match(child.description, /현재 WorkExecution/);
  const members = groups.flatMap(group => group.memberKeys);
  assert.equal(members.length, new Set(members).size);
  assert.ok(!members.includes(dependencyEntityKey("projects", "task", "same")));
  const collapsed = projectFlowGroups(model, groups, new Set(groups.map(group => group.key)));
  assert.deepEqual(collapsed.invalidGroups, []);
  assert.ok(collapsed.nodes.some(node => node.key === thread));
  assert.ok(collapsed.edges.some(edge => edge.to === thread));
  // Ownership metadata preserves the second execution even in an externally trimmed model.
  const trimmed = { nodes: model.nodes.filter(node => node.key !== assistantEntityKey("assistant", "assistant-execution", b.native.id) &&
    node.key !== assistantRoleKey("assistant", b.native.id, b.native.roles[0]!.id)), edges: model.edges };
  assert.ok(assistantFlowGroups(trimmed).every(group => !group.memberKeys.includes(thread)));
});

test("determinism, immutable inputs, duplicate identity fail-closed and metadata-only output", () => {
  const a = execution(); const b = execution(2);
  const inputs = [a, b]; const grants = sources(); const before = structuredClone({ inputs, grants });
  const model = assistantFlow(inputs, grants);
  assert.deepEqual(assistantFlow([...inputs].reverse(), [...grants].reverse()), model);
  assert.deepEqual(assistantFlowGroups({ nodes: [...model.nodes].reverse(), edges: [...model.edges].reverse() }), assistantFlowGroups(model));
  assert.deepEqual({ inputs, grants }, before);
  assert.deepEqual(assistantFlow([a, structuredClone(a)], grants), assistantFlow([a], grants));
  const conflict = structuredClone(a); conflict.native.state = "failed";
  assert.equal(assistantFlow([a, conflict], grants).nodes.length, 0);
  assert.equal(assistantFlow([conflict, a], grants).nodes.length, 0);
  const roleConflict = execution(); roleConflict.native.roles.push(structuredClone(roleConflict.native.roles[0]!));
  assert.equal(assistantFlow([roleConflict], grants).nodes.length, 0);
  assert.equal(assistantFlow([a], [...grants, { ...grants[0]!, state: "forbidden" }]).nodes.length, 0);
  const taskConflict = execution(2); taskConflict.currentTask!.task.projectId = "other";
  taskConflict.currentTask!.project.id = "other"; taskConflict.native.task!.projectId = "other";
  grants[1]!.authorizedProjectIds!.push("other");
  assert.equal(assistantFlow([a, taskConflict], grants).nodes.length, 0);
  const extra = { ...execution(), body: "secret-body", result: "secret-result", tooltext: "secret-tool" };
  assert.doesNotMatch(JSON.stringify(assistantFlow([extra], sources())), /secret-/);
  const duplicateNode = { ...model.nodes.find(node => node.kind === "assistant-execution")!, status: "failed" };
  const ambiguous = assistantFlowGroups({ ...model, nodes: [...model.nodes, duplicateNode] });
  assert.ok(ambiguous.every(group => !group.memberKeys.includes(duplicateNode.key)));
});

test("bounded selection prioritizes Tasks then executions then roles and never leaves dangling edges", () => {
  const inputs = Array.from({ length: 110 }, (_, i) => {
    const view = execution(i + 1); view.native.roles[0]!.runtime = { taskId: `task-${i}`, threadId: `thread-${i}`, turnId: `turn-${i}` }; return view;
  });
  const normal = assistantFlow(inputs, sources()); assert.equal(normal.nodes.length, 240);
  assert.equal(normal.hiddenNodes, 551 - 240); assert.equal(normal.incomplete, true);
  const capped = assistantFlow(inputs, sources(), { maxNodes: 1000 }); assert.equal(capped.nodes.length, 500);
  for (const maxNodes of [0, 1, 2, 120, 240, 500]) {
    const model = assistantFlow(inputs, sources(), { maxNodes }); const keys = new Set(model.nodes.map(node => node.key));
    assert.equal(model.nodes.length, maxNodes);
    assert.ok(model.edges.every(edge => keys.has(edge.from) && keys.has(edge.to)));
    assert.equal(model.hiddenNodes, 551 - maxNodes);
    assert.deepEqual(projectFlowGroups(model, assistantFlowGroups(model), new Set()).invalidGroups, []);
  }
  assert.equal(assistantFlow(inputs, sources(), { maxNodes: 1 }).nodes[0]!.kind, "task");
  assert.equal(assistantFlow(inputs, sources(), { maxNodes: 2 }).nodes[1]!.kind, "assistant-execution");
  assert.equal(assistantFlow([execution()], sources()).incomplete, true);
});

test("zero observed seconds is retained and missing timing stays unknown", () => {
  const a = execution(); const b = execution(2); b.native.roles[0]!.observation.seconds = null;
  b.native.roles[0]!.observation.startedAt = null; b.native.roles[0]!.observation.endedAt = null;
  b.native.roles[0]!.observation.timingComplete = false;
  const model = assistantFlow([a, b], sources());
  const roles = model.nodes.filter(node => node.kind === "assistant-role");
  assert.equal(value(roles.find(node => value(node, "Execution ID") === a.native.id)!, "관측 시간 (초)"), "0");
  const unknown = roles.find(node => value(node, "Execution ID") === b.native.id)!;
  assert.equal(value(unknown, "관측 시간 (초)"), "unknown");
  assert.equal(value(unknown, "시작 관측 시각"), "unknown");
  assert.equal(value(unknown, "시간 관측 근거"), "server_dispatch_to_terminal_including_sdk_preparation");
});

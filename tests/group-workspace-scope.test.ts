import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunView, SourceView } from "../packages/contracts/index.ts";
import type { AssistantExecutionView } from "../packages/contracts/assistant-view.ts";
import type { MissionNode, MissionEdge } from "../packages/projection/mission-flow.ts";
import type { FlowGroupSummary } from "../packages/projection/flow-groups.ts";
import { assistantEntityKey, assistantFlow, assistantRoleKey } from "../packages/projection/assistant-flow.ts";
import { groupAssistantRoles, groupAssistantFlowSubset } from "../packages/projection/group-workspace-flow.ts";
import { createGroupWorkspaceScope as create, resolveGroupWorkspaceScope as resolve } from "../packages/projection/group-workspace-scope.ts";

function node(key: string, kind = "run", sourceId = "a", id = "same"): MissionNode {
  return { key, kind, sourceId, id, label: "identical human title", status: "observed", description: "secret",
    details: [{ label: "secret", value: "secret" }], sequences: ["999"], ...(kind === "run" ? { runKey: `${sourceId}:${id}` } : {}) };
}
function group(nodes: MissionNode[]): FlowGroupSummary {
  return { key: "group", label: "user label", kind: "test", basis: "native", sourceId: "a", memberKeys: [],
    leafKeys: nodes.map(node => node.key), childGroupKeys: [], counts: {}, statusCounts: {},
    internalEdges: 0, boundaryEdges: 0, cyclicMembers: 0, description: "secret" };
}
function source(id = "a", kind: SourceView["kind"] = "demian"): SourceView {
  return { id, kind, label: id, state: "connected", capabilities: [], detail: "", device: "test", lastObservedAt: null,
    authorizedProjectIds: ["p"] };
}
function run(sourceId = "a"): RunView {
  return { sourceId, runId: "same", key: `${sourceId}:same`, sessionId: "s", workspaceId: null, title: "title", status: "running",
    createdAt: "now", startedAt: null, completedAt: null, observedAt: "now", cursor: "0", highWater: "0", incomplete: false,
    stale: false, binding: null, sourceLabel: "source", device: "test", sourceState: "connected", sourceUrl: null,
    workspaceKey: null, projectKey: null, capabilities: [] };
}
function task(): MissionNode {
  return { ...node("task", "task", "projects", "t"), taskRef: { sourceId: "projects", projectId: "p", taskId: "t" } };
}
function edge(from: string, to: string, kind = "task-binding"): MissionEdge {
  return { key: `${from}:${to}`, from, to, kind, sourceId: "projects", label: "secret", detail: "secret", sequences: [] };
}
function execution(sourceId = "assistant"): AssistantExecutionView {
  return { sourceId, sourceLabel: "Assistant", device: "test", currentTask: null, native: {
    id: "same", instructionId: "instruction", instructionRevision: "1", revision: "1", state: "completed", errorCode: null,
    task: null, createdAt: "now", updatedAt: "now", roles: [{ id: "role", assignmentId: "assignment", workPackageId: "package",
      teamId: "team", membershipId: "membership", membershipRevision: "1", label: "same", teamLabel: "same", agentLabel: "same",
      responsibility: "contributor", state: "completed", attempts: 1, runtime: { taskId: null, threadId: null, turnId: null },
      observation: { queuedAt: null, startedAt: null, endedAt: null, seconds: null, timingComplete: false,
        basis: "server_dispatch_to_terminal_including_sdk_preparation" } }] } };
}

test("source-qualified native identities and Run aliases dedupe without copying raw metadata", () => {
  const nodes = [node("a"), node("alias"), node("b", "run", "b")];
  const scope = create("actor", group(nodes), nodes, [])!;
  assert.equal(scope.runRefs.length, 2);
  assert.deepEqual(scope.nodeKeys, ["a", "alias", "b"]);
  assert.doesNotMatch(JSON.stringify(scope), /secret|999/);
  assert.deepEqual(resolve(scope, "actor", [run(), run("b")], [source(), source("b")], [])?.runs, [run(), run("b")]);
  assert.equal(create("actor", group(nodes), [...nodes, { ...node("conflict"), runKey: "other" }], []), null);
  assert.equal(create("actor", group(nodes), [...nodes, { ...nodes[0]!, sourceId: "other" }], []), null);
});

test("invocation leaf resolves actual parent Run outside selected subgroup, not ancestry/order/labels", () => {
  const child = { ...node("child", "invocation"), runKey: "a:same" };
  const parent = node("parent");
  const unknown = { ...node("peer", "run", "missing"), status: "unobserved" };
  delete unknown.runKey;
  const nodes = [child, parent, unknown];
  const scope = create("actor", group([child, unknown]), nodes, [edge("child", "peer", "record-order")])!;
  assert.deepEqual(scope.nodeKeys, ["child", "peer"]);
  assert.deepEqual(scope.runRefs, [{ sourceId: "a", runId: "same", key: "a:same" }]);
  assert.ok(resolve(scope, "actor", [run()], [source()], []));
  assert.equal(create("actor", group([child]), [child], []), null);
  assert.equal(create("actor", group([unknown]), nodes, []), null);
  assert.equal(create("actor", group([node("title-only", "invocation")]), [node("title-only", "invocation"), parent],
    [edge("parent", "title-only", "record-order")]), null);
});

test("Task-only scope stays empty of Runs and requires current qualified Projects grant", () => {
  const t = task(), scope = create("actor", group([t]), [t], [])!;
  assert.deepEqual(scope.taskRefs, [t.taskRef]);
  assert.deepEqual(resolve(scope, "actor", [run()], [source("projects", "projects")], []), { runs: [], executions: [] });
  for (const sources of [[], [source("wrong", "projects")], [{ ...source("projects", "projects"), authorizedProjectIds: [] }],
    [{ ...source("projects", "projects"), state: "disconnected" as const }]]) assert.equal(resolve(scope, "actor", [], sources, []), null);
  const { taskRef: omitted, ...untyped } = t;
  assert.equal(create("actor", group([t]), [untyped], []), null);
});

test("binding edges capture exact expected Task and reject changed binding atomically", () => {
  const t = task(), n = node("run"), scope = create("actor", group([n]), [t, n], [edge(t.key, n.key)])!;
  const r = run();
  r.binding = { sourceId: "a", runId: "same", projectSourceId: "projects", projectId: "p", taskId: "t",
    projectTitle: "P", taskTitle: "T", taskRevision: "1", provenance: "operator" };
  const sources = [source(), source("projects", "projects")];
  assert.ok(resolve(scope, "actor", [r], sources, []));
  assert.equal(resolve(scope, "actor", [{ ...r, binding: { ...r.binding, taskId: "other" } }], sources, []), null);
  assert.equal(resolve(scope, "actor", [{ ...r, binding: null }], sources, []), null);
  assert.equal(resolve(scope, "other actor", [r], sources, []), null);
  assert.equal(resolve(scope, "actor", [r], [source()], []), null);
});

test("one missing, ambiguous or forbidden Run clears entire scope; stale/disconnected remain visible", () => {
  const nodes = [node("a"), node("b", "run", "b")], scope = create("actor", group(nodes), nodes, [])!;
  const sources = [source(), source("b")];
  assert.equal(resolve(scope, "actor", [run()], sources, []), null);
  assert.equal(resolve(scope, "actor", [run(), { ...run("b"), sourceState: "forbidden" }], sources, []), null);
  assert.equal(resolve(scope, "actor", [run(), run("b"), { ...run("b"), runId: "conflict" }], sources, []), null);
  assert.ok(resolve(scope, "actor", [run(), { ...run("b"), stale: true, sourceState: "disconnected" }], sources, []));
  assert.equal(create("actor", group(nodes), [nodes[0]!], []), null);
});

test("Assistant role has exact execution owner even with same labels and native IDs across sources", () => {
  const views = [execution(), execution("assistant2")];
  const sources = [source("assistant", "assistant"), source("assistant2", "assistant")];
  const model = assistantFlow(views, sources);
  const roles = model.nodes.filter(node => node.kind === "assistant-role");
  const scope = create("actor", group(roles), model.nodes, model.edges)!;
  assert.equal(scope.assistantRefs.length, 2);
  assert.deepEqual(resolve(scope, "actor", [], sources, views)?.executions, views);
  assert.equal(resolve(scope, "actor", [], sources, [views[0]!]), null);
  assert.equal(resolve(scope, "actor", [], [sources[0]!], views), null);
  assert.equal(resolve(scope, "actor", [], sources, [views[0]!, { ...views[1]!, native: { ...views[1]!.native, roles: [] } }]), null);
  assert.equal(create("actor", group(roles), roles.map(({ assistantExecutionRef, ...node }) => node), []), null);
});

test("Assistant current Task mismatch and grant revocation invalidate all selected executions", () => {
  const view = execution();
  view.native.task = { projectId: "p", taskId: "t", revision: "1", state: "todo", observedAt: "now" };
  view.currentTask = { projectsSourceId: "projects", projectKey: "project", observedAt: "now",
    project: { id: "p", title: "P", revision: "1", accessRevision: "1", archived: false },
    task: { id: "t", projectId: "p", title: "T", revision: "1", state: "todo", requiresTest: false } };
  const sources = [source("assistant", "assistant"), source("projects", "projects")];
  const model = assistantFlow([view], sources);
  assert.deepEqual(model.nodes.find(node => node.kind === "task")?.taskRef, task().taskRef);
  const scope = create("actor", group(model.nodes.filter(node => node.kind === "assistant-role")), model.nodes, model.edges)!;
  assert.ok(resolve(scope, "actor", [], sources, [view]));
  assert.equal(resolve(scope, "actor", [], [sources[0]!], [view]), null);
  assert.equal(resolve(scope, "actor", [], sources, [{ ...view, currentTask: null }]), null);
  assert.equal(resolve(scope, "actor", [], sources, [{ ...view, native: { ...view.native,
    task: { ...view.native.task, taskId: "other" } } }]), null);
});

test("bounds, duplicate leaves and anchorless groups fail closed; inputs are not mutated", () => {
  const n = node("run"), g = group([n]), before = structuredClone({ n, g });
  const scope = create("actor", g, [n], [])!;
  resolve(scope, "actor", [run()], [source()], []);
  assert.deepEqual({ n, g }, before);
  assert.equal(create("actor", { ...g, leafKeys: [n.key, n.key] }, [n], []), null);
  assert.equal(create("actor", { ...g, leafKeys: Array.from({ length: 2001 }, (_, i) => `${i}`) }, [], []), null);
  const nodes = Array.from({ length: 257 }, (_, i) => node(`node${i}`, "run", `source${i}`));
  assert.equal(create("actor", group(nodes), nodes, []), null);
  assert.equal(resolve({ ...scope, runRefs: [] }, "actor", [], [], []), null);
});

test("selected Assistant role includes only its explicitly authorized boundary Run and rechecks the receipt", () => {
  const view = execution();
  view.native.task = { projectId: "p", taskId: "t", revision: "1", state: "todo", observedAt: "now" };
  view.currentTask = { projectsSourceId: "projects", projectKey: "project", observedAt: "now",
    project: { id: "p", title: "P", revision: "1", accessRevision: "1", archived: false },
    task: { id: "t", projectId: "p", title: "T", revision: "1", state: "todo", requiresTest: false } };
  const r = { ...run(), workspaceId: "w" };
  view.demianLinks = { state: "connected", complete: false, omitted: 0, detail: "receipt", links: [{
    roleId: "role", sourceId: r.sourceId, runId: r.runId, runKey: r.key, sessionId: r.sessionId,
    workspaceId: "w", operationId: "op", status: "running", observedAt: "now" }] };
  const sources = [source(), source("projects", "projects"), source("assistant", "assistant")];
  const model = assistantFlow([view], sources, { runs: [r, run("unrelated")] });
  const role = model.nodes.find(node => node.kind === "assistant-role")!;
  const subset = groupAssistantFlowSubset(model, [role.key]);
  assert.deepEqual(subset.nodes.map(node => node.kind).sort(), ["assistant-role", "run"]);
  assert.deepEqual(subset.edges.map(edge => edge.kind), ["assistant-demian-runtime"]);
  assert.equal(groupAssistantFlowSubset(model, ["missing"]).nodes.length, 0);
  const scope = create("actor", group([role]), model.nodes, model.edges)!;
  assert.deepEqual(scope.nodeKeys, [role.key]); // execution context does not change exclusive visual ownership
  assert.equal(scope.runRefs.length, 1);
  assert.equal(scope.runRefs[0]!.key, r.key);
  assert.deepEqual(resolve(scope, "actor", [r], sources, [view])?.runs, [r]);
  for (const changed of [
    { ...view, demianLinks: { ...view.demianLinks, links: [] } },
    { ...view, demianLinks: { ...view.demianLinks, links: [{ ...view.demianLinks.links[0]!, operationId: "different" }] } },
    { ...view, demianLinks: { ...view.demianLinks, state: "forbidden" as const } },
  ]) assert.equal(resolve(scope, "actor", [r], sources, [changed]), null);
  assert.equal(resolve(scope, "actor", [{ ...r, workspaceId: "other" }], sources, [view]), null);
  assert.equal(resolve(scope, "actor", [r], sources.filter(source => source.id !== "projects"), [view]), null);
  const { demianLinks: omitted, ...withoutReceipt } = view;
  const noReceipt = assistantFlow([withoutReceipt], sources, { runs: [r] });
  assert.equal(create("actor", group([role]), noReceipt.nodes, noReceipt.edges)?.runRefs.length, 0);
});

test("Assistant subgroup role tables do not widen to same-label peers or other sources", () => {
  const view = execution();
  const second = structuredClone(view.native.roles[0]!); second.id = "other"; second.runtime.taskId = "task-2";
  view.native.roles.push(second);
  const first = assistantRoleKey(view.sourceId, view.native.id, "role");
  assert.deepEqual(groupAssistantRoles(view, [first]).map(role => role.id), ["role"]);
  assert.deepEqual(groupAssistantRoles(view, [assistantEntityKey(view.sourceId, "assistant-runtime-task", "task-2")]).map(role => role.id), ["other"]);
  assert.deepEqual(groupAssistantRoles(view, [assistantRoleKey("foreign", view.native.id, "role")]), []);
  assert.deepEqual(groupAssistantRoles(view, ["missing"]), []);
  assert.equal(groupAssistantRoles(view).length, 2);
});

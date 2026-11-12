import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventView, RelationView, RunView } from "../packages/contracts/index.ts";
import { missionFlow } from "../packages/projection/mission-flow.ts";
import { flowGroupContext } from "../packages/projection/flow-group-context.ts";
import { nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";
import { projectFlowGroups } from "../packages/projection/flow-groups.ts";

const at = "2026-11-11T12:00:00.000Z";
function run(sourceId: string, runId: string, sessionId: string, taskId: string | null = "task"): RunView {
  return { sourceId, runId, sessionId, workspaceId: "workspace", title: `${sourceId}/${runId}`, status: "running", createdAt: at,
    startedAt: at, completedAt: null, observedAt: at, key: JSON.stringify([sourceId, runId]), cursor: "0", highWater: "0", incomplete: false,
    stale: false, binding: taskId ? { sourceId, runId, projectSourceId: "projects", projectId: "project", taskId, taskRevision: "1",
      projectTitle: "Project", taskTitle: "Task", provenance: "operator" } : null,
    sourceLabel: sourceId, device: "test", sourceState: "connected", sourceUrl: null, workspaceKey: null, projectKey: null, capabilities: [] };
}
function relation(owner: RunView, kind: RelationView["kind"], from: string, to: string, sequence = "1"): RelationView {
  return { key: JSON.stringify([owner.key, kind, from, to]), runKey: owner.key, kind, from, to, evidenceSequence: sequence, observedAt: at };
}
function event(runValue: RunView, sequence: string, type: string, data: EventView["data"]): EventView {
  return { sourceId: runValue.sourceId, runId: runValue.runId, sequence, type, occurredAt: at, data, key: `${runValue.key}:${sequence}`, receivedAt: at };
}

test("cancelled invocation remains cancelled inside its collapsed group without inventing a sibling end", () => {
  const selected = run("source", "cancelled-run", "session", null);
  selected.status = "cancelled";
  const events = [
    event(selected, "1", "agent.invocation.started", { redacted: true, invocationId: "cancelled" }),
    event(selected, "2", "agent.invocation.started", { redacted: true, invocationId: "open" }),
    event(selected, "3", "agent.invocation.cancelled", { redacted: true, invocationId: "cancelled" }),
  ];
  const model = missionFlow(selected, [], [], events, { mode: "execution" });
  const cancelled = model.nodes.find((node) => node.kind === "invocation" && node.id === "cancelled")!;
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.details.some((detail) => detail.label === "상태" && detail.value === "취소 이벤트 관측"));
  assert.equal(model.nodes.find((node) => node.kind === "invocation" && node.id === "open")!.status, "unfinished");
  const definitions = nativeFlowGroupDefinitions(model, "run");
  const own = definitions.find((group) => group.kind === "invocation" && group.memberKeys.includes(cancelled.key))!;
  const grouped = projectFlowGroups(model, definitions, new Set([own.key]));
  const summary = grouped.groups.find((group) => group.key === own.key)!;
  assert.equal(summary.statusCounts.cancelled, 1);
  const context = flowGroupContext(summary, model.nodes, model.edges);
  assert.deepEqual(context.statusByKind, [{ kind: "invocation", states: [{ state: "cancelled", count: 1 }] }]);
  assert.equal(context.concerns.length, 0);
});

test("mission binds exact task runs across sources and retains typed relation evidence without inventing observed Runs", () => {
  const selected = run("source-a", "root", "session-1");
  const sameTaskOtherSession = run("source-b", "root", "session-2");
  const sameTaskOtherSource = run("source-a", "third", "session-3");
  const unrelated = run("source-a", "unrelated", "session-4", "different-task");
  const relations = [
    relation(selected, "invocation", "run:root", "invocation:child", "7"),
    relation(selected, "managed-child", "run:root", "run:ghost", "8"),
    relation(selected, "cowork", "invocation:child", "member:member-1", "10"),
    relation(selected, "dependency", "artifact:input", "artifact:output", "11"),
    relation(selected, "artifact", "run:root", "artifact:result", "12"),
    relation(sameTaskOtherSession, "peer", "run:root", "session:remote", "9"),
    relation(sameTaskOtherSession, "invocation", "run:root", "invocation:child", "13"),
    relation(unrelated, "artifact", "run:unrelated", "artifact:private"),
  ];
  const result = missionFlow(selected, [sameTaskOtherSession, sameTaskOtherSource, unrelated], relations, []);
  assert.equal(result.nodes.filter((node) => node.kind === "run" && node.runKey).length, 3);
  assert.equal(result.nodes.some((node) => node.kind === "run" && node.id === "ghost" && node.runKey), false);
  assert.ok(result.nodes.some((node) => node.kind === "run" && node.id === "ghost" && node.status === "unobserved"));
  assert.equal(result.nodes.some((node) => node.id === "private"), false);
  assert.deepEqual(new Set(result.edges.filter((edge) => ["invocation", "managed-child", "peer"].includes(edge.kind)).map((edge) => edge.kind)),
    new Set(["invocation", "managed-child", "peer"]));
  assert.deepEqual(new Set(result.edges.filter((edge) => ["cowork", "dependency", "artifact"].includes(edge.kind)).map((edge) => edge.kind)),
    new Set(["cowork", "dependency", "artifact"]));
  assert.equal(result.nodes.filter((node) => node.kind === "invocation" && node.id === "child").length, 2);
  assert.equal(new Set(result.nodes.filter((node) => node.kind === "invocation" && node.id === "child").map((node) => node.key)).size, 2);
  assert.ok(result.edges.some((edge) => edge.kind === "task-binding" && edge.label === "같은 작업"));
});

test("execution mode separates parallel tool spans, orders disjoint units as metadata and handles IDs beyond Number precision", () => {
  const selected = run("source-a", "root", "session-1", null);
  const events = [
    event(selected, "9007199254740993", "agent.invocation.started", { redacted: true, invocationId: "parent" }),
    event(selected, "9007199254740994", "agent.invocation.started", { redacted: true, invocationId: "child", parentInvocationId: "parent" }),
    event(selected, "9007199254740995", "tool.requested", { redacted: true, invocationId: "child", callId: "first", tool: "read" }),
    event(selected, "9007199254740996", "tool.completed", { redacted: true, invocationId: "child", callId: "first", tool: "read" }),
    event(selected, "9007199254740997", "tool.started", { redacted: true, invocationId: "child", callId: "parallel-a", tool: "search" }),
    event(selected, "9007199254740998", "tool.started", { redacted: true, invocationId: "child", callId: "parallel-b", tool: "fetch" }),
    event(selected, "9007199254740999", "tool.completed", { redacted: true, invocationId: "child", callId: "parallel-a", tool: "search" }),
    event(selected, "9007199254741000", "tool.completed", { redacted: true, invocationId: "child", callId: "parallel-b", tool: "fetch" }),
    event(selected, "9007199254741001", "tool.requested", { redacted: true, callId: "no-parent", tool: "shell" }),
  ];
  const result = missionFlow(selected, [], [], events, { mode: "execution" });
  assert.equal(result.nodes.some((node) => node.kind === "workspace" || node.kind === "session"), false);
  assert.equal(result.eventCount, events.length);
  assert.ok(result.nodes.some((node) => node.kind === "invocation" && node.id === "parent"));
  assert.ok(result.edges.some((edge) => edge.kind === "invocation-parent"));
  assert.ok(result.edges.some((edge) => edge.kind === "record-order"));
  const parallelKeys = result.nodes.filter((node) => node.kind === "tool" && ["parallel-a", "parallel-b"].some((id) => node.id.includes(id))).map((node) => node.key);
  assert.equal(result.edges.some((edge) => edge.kind === "record-order" && parallelKeys.includes(edge.from) && parallelKeys.includes(edge.to)), false);
  const orphanEdge = result.edges.find((edge) => edge.kind === "tool-of" && edge.label === "상위 호출 미상");
  assert.ok(orphanEdge);
  assert.equal(result.nodes.find((node) => node.key === orphanEdge?.from)?.kind, "run");
  assert.ok(result.nodes.some((node) => node.kind === "tool" && node.sequences.includes("9007199254740996")));
});

test("source-scoped IDs, duplicate events, unknown parents, permission IDs, caps, gaps and flags are safe and read only", () => {
  const selected = run("source-a", "root", "session");
  const foreign = run("source-b", "root", "session");
  const events = [
    event(selected, "1", "agent.invocation.started", { redacted: true, invocationId: "same" }),
    event(selected, "1", "agent.invocation.started", { redacted: true, invocationId: "same" }),
    event(selected, "3", "permission.requested", { redacted: true, invocationId: "missing-parent", permissionId: "permission-1", status: "waiting_for_permission" }),
    event(foreign, "1", "tool.started", { redacted: true, callId: "foreign", tool: "hidden" }),
  ];
  const rels = [relation(selected, "invocation", "invocation:parent", "invocation:same")];
  const before = structuredClone({ selected, runs: [foreign], relations: rels, events });
  const full = missionFlow(selected, [foreign], rels, events, { mode: "execution", hasMoreEvents: true });
  assert.equal(full.nodes.filter((node) => node.kind === "invocation" && node.id === "same").length, 1);
  assert.equal(full.nodes.find((node) => node.kind === "invocation" && node.id === "same")?.status, "started");
  assert.ok(full.nodes.some((node) => node.kind === "invocation" && node.id === "missing-parent" && node.status === "unobserved"));
  assert.ok(full.nodes.some((node) => node.kind === "permission" && node.id === "permission-1"));
  assert.equal(full.nodes.some((node) => node.kind === "tool" && node.id.includes("foreign")), false);
  assert.equal(full.incomplete, true);
  assert.ok(full.nodes.some((node) => node.key.includes("source-a")));
  const capped = missionFlow(selected, [foreign], rels, events, { mode: "execution", maxNodes: 2 });
  assert.equal(capped.nodes.length, 2);
  assert.ok(capped.hiddenNodes > 0);
  assert.ok(capped.edges.every((edge) => capped.nodes.some((node) => node.key === edge.from) && capped.nodes.some((node) => node.key === edge.to)));
  assert.deepEqual({ selected, runs: [foreign], relations: rels, events }, before);
});

test("mission follows explicit managed child Runs across sessions without assigning their Task", () => {
  const parent = run("source", "parent", "one"); const child = run("source", "child", "two", null); const grandchild = run("source", "grandchild", "three", null);
  const unrelated = run("other", "child", "four", null);
  const rels = [relation(parent, "managed-child", "run:parent", "run:child"), relation(child, "managed-child", "run:child", "run:grandchild")];
  const result = missionFlow(parent, [child, grandchild, unrelated], rels, []);
  assert.equal(result.nodes.filter((node) => node.kind === "run" && node.runKey).length, 3);
  assert.equal(result.edges.filter((edge) => edge.kind === "managed-child").length, 2);
  assert.equal(result.edges.filter((edge) => edge.kind === "task-binding").length, 1);
  assert.equal(result.nodes.some((node) => node.sourceId === "other"), false);
});

test("record order uses minimal successors instead of a complete edge mesh", () => {
  const selected = run("source", "root", "one");
  const events = [1, 2, 3].flatMap((value) => [event(selected, String(value * 2 - 1), "tool.started", { redacted: true, callId: String(value), invocationId: "inv", tool: "tool" }),
    event(selected, String(value * 2), "tool.completed", { redacted: true, callId: String(value), invocationId: "inv", tool: "tool" })]);
  const result = missionFlow(selected, [], [], events, { includeExecution: true });
  assert.equal(result.edges.filter((edge) => edge.kind === "record-order").length, 2);
  assert.equal(result.nodes.filter((node) => node.kind === "tool" && node.status === "completed").length, 3);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { EventView, RelationView, RunView } from "../packages/contracts/index.ts";
import { coworkMemberKey, missionFlow } from "../packages/projection/mission-flow.ts";
import { nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";
import { flowGroupContext } from "../packages/projection/flow-group-context.ts";

const at = "2026-11-13T01:00:00.000Z";
const run: RunView = { sourceId: "native", runId: "run", sessionId: "session", workspaceId: null,
  title: "Cowork", status: "succeeded", createdAt: at, startedAt: at, completedAt: at, observedAt: at,
  key: "run-key", cursor: "8", highWater: "8", incomplete: false, stale: false, binding: null,
  sourceLabel: "Native", device: "QA", sourceState: "connected", sourceUrl: null, workspaceKey: null,
  projectKey: null, capabilities: [] };
const event = (sequence: string, type: string, groupId: string, memberId?: string): EventView => ({
  key: sequence, sourceId: run.sourceId, runId: run.runId, type, sequence, occurredAt: at, receivedAt: at,
  data: { redacted: true, groupId, ...(memberId ? { memberId } : {}) },
});
const relation = (from: string, to: string, sequence: string): RelationView => ({
  key: `${from}/${to}`, runKey: run.key, kind: "cowork", from, to, evidenceSequence: sequence, observedAt: at,
});
const relations = [relation("run:run", "group:a", "1"), relation("group:a", "member:reviewer", "2"),
  relation("run:run", "group:b", "5"), relation("group:b", "member:reviewer", "6")];

test("group-scoped member lifecycle survives repeated member IDs without merging outcomes", () => {
  const events = [event("1", "cowork.group.started", "a"), event("2", "cowork.member.started", "a", "reviewer"),
    event("3", "cowork.member.completed", "a", "reviewer"), event("4", "cowork.group.completed", "a"),
    event("5", "cowork.group.started", "b"), event("6", "cowork.member.started", "b", "reviewer"),
    event("7", "cowork.member.failed", "b", "reviewer"), event("8", "cowork.group.completed", "b")];
  const before = JSON.stringify({ relations, events });
  const model = missionFlow(run, [], relations, events, { mode: "execution" });
  const members = model.nodes.filter(node => node.kind === "member");
  assert.equal(members.length, 2);
  assert.equal(members.find(node => node.id === coworkMemberKey("a", "reviewer"))!.status, "ended");
  assert.equal(members.find(node => node.id === coworkMemberKey("b", "reviewer"))!.status, "failed");
  assert.ok(members.every(node => node.label === "reviewer"));
  const definitions = nativeFlowGroupDefinitions(model, "run");
  const groupA = definitions.find(group => group.kind === "cowork" && group.memberKeys.includes(members.find(node => node.status === "ended")!.key))!;
  const context = flowGroupContext({ leafKeys: groupA.memberKeys }, model.nodes, model.edges);
  assert.deepEqual(context.statusByKind, [
    { kind: "group", states: [{ state: "ended", count: 1 }] },
    { kind: "member", states: [{ state: "ended", count: 1 }] },
  ]);
  assert.equal(context.dependencies.length, 0);
  assert.equal(model.edges.some(edge => edge.kind === "dependency" || edge.kind === "invocation-parent"), false);
  assert.equal(JSON.stringify({ relations, events }), before);
});

test("only exact same-source Run lifecycle changes cowork references; missing ends stay unknown", () => {
  const events = [event("1", "cowork.group.started", "a"), event("2", "cowork.member.started", "a", "reviewer"),
    event("3", "cowork.member.progress", "a", "reviewer"),
    { ...event("4", "cowork.member.completed", "a", "reviewer"), sourceId: "other" },
    { ...event("5", "cowork.group.completed", "a"), runId: "other" },
    event("6", "tool.completed", "a", "reviewer")];
  const model = missionFlow(run, [], relations, events, { mode: "execution" });
  assert.ok(model.nodes.filter(node => node.kind === "member" || node.kind === "group")
    .every(node => node.status === (node.id === "a" || node.id === coworkMemberKey("a", "reviewer") ? "unfinished" : "observed-reference")));
  const live = missionFlow({ ...run, status: "running", completedAt: null }, [], relations, events);
  assert.equal(live.nodes.find(node => node.id === "a")!.status, "started");
});

test("conflicting terminal types remain ambiguous and completion never means success", () => {
  const events = [event("1", "cowork.group.completed", "a"), event("2", "cowork.group.failed", "a"),
    event("3", "cowork.member.completed", "a", "reviewer")];
  const model = missionFlow(run, [], relations, events, { mode: "execution" });
  assert.equal(model.nodes.find(node => node.id === "a")!.status, "ambiguous");
  const member = model.nodes.find(node => node.id === coworkMemberKey("a", "reviewer"))!;
  assert.equal(member.status, "ended");
  assert.ok(member.details.some(detail => detail.value === "시작 이벤트 미조회"));
  assert.ok(member.details.some(detail => detail.value.includes("결과 상태 미제공")));
});

test("explicit cowork parent nests under its invocation, without inventing member invocation joins", () => {
  const parent = { ...event("1", "agent.invocation.started", "ignored"), data: { redacted: true as const, invocationId: "coordinator" } };
  const model = missionFlow(run, [], [...relations, relation("invocation:coordinator", "group:a", "2")],
    [parent, event("2", "cowork.group.started", "a")], { mode: "execution" });
  const groups = nativeFlowGroupDefinitions(model, "run");
  const coordinator = model.nodes.find(node => node.kind === "invocation" && node.id === "coordinator")!;
  const parentGroup = groups.find(group => group.memberKeys.includes(coordinator.key))!;
  const cowork = groups.find(group => group.kind === "cowork" && group.label.endsWith("a"))!;
  assert.equal(cowork.parentKey, parentGroup.key);
  assert.equal(model.edges.some(edge => edge.kind === "invocation-parent"), false);
});

test("start after terminal is ambiguous even when events arrive out of sequence", () => {
  const events = [event("9007199254740995", "cowork.group.started", "a"),
    event("9007199254740993", "cowork.group.completed", "a")];
  for (const ordered of [events, [...events].reverse()]) {
    const model = missionFlow(run, [], relations, ordered);
    assert.equal(model.nodes.find(node => node.id === "a")!.status, "ambiguous");
    assert.equal(model.incomplete, true);
  }
});

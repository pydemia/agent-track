import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEvent } from "../packages/adapters/demian/index.ts";
import { Store } from "../packages/storage/store.ts";
import type { RunObservation, SourceView } from "../packages/contracts/index.ts";
import { coworkMemberKey, missionFlow } from "../packages/projection/mission-flow.ts";
import { nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";
import { projectFlowGroups } from "../packages/projection/flow-groups.ts";
import { flowGroupContext } from "../packages/projection/flow-group-context.ts";

const at = "2026-11-13T03:00:00.000Z";
const raw = (sequence: number, type: string, data: Record<string, unknown>) => ({
  api_version: "2026-09-01", run_id: "run", sequence_text: String(sequence), created_at: at, type, data,
});
const plan = { version: 1, members: [{ memberId: "sort", dependsOn: [] as string[] }, { memberId: "verify", dependsOn: ["sort"] }] };
const observation: RunObservation = { sourceId: "native", runId: "run", sessionId: "session", workspaceId: null,
  title: "Metadata fixture", status: "succeeded", createdAt: at, startedAt: at, completedAt: at, observedAt: at };
const source: SourceView = { id: "native", kind: "demian", label: "Native", device: "fixture", state: "connected", lastObservedAt: at, detail: "fixture", capabilities: ["run.read", "events.read"] };
function fixture(extra: ReturnType<typeof raw>[] = [], value = plan) {
  const db = new Store(":memory:"); const key = db.observeRun(observation);
  const input = [
    raw(1, "agent.invocation.started", { invocationId: "coordinator" }),
    raw(2, "cowork.group.started", { groupId: "group", parentInvocationId: "coordinator", flow: value }),
    raw(3, "cowork.member.started", { groupId: "group", memberId: "sort" }),
    raw(4, "agent.invocation.started", { invocationId: "sort-call", parentInvocationId: "coordinator", groupId: "group", memberId: "sort" }),
    raw(5, "tool.started", { invocationId: "sort-call", callId: "read-call", tool: "read" }),
    raw(6, "tool.completed", { invocationId: "sort-call", callId: "read-call", tool: "read" }),
    raw(7, "agent.invocation.completed", { invocationId: "sort-call" }),
    raw(8, "cowork.member.completed", { groupId: "group", memberId: "sort" }),
    raw(9, "cowork.member.started", { groupId: "group", memberId: "verify" }),
    raw(10, "agent.invocation.started", { invocationId: "verify-call", parentInvocationId: "coordinator", groupId: "group", memberId: "verify" }),
    raw(11, "agent.invocation.completed", { invocationId: "verify-call" }),
    raw(12, "cowork.member.completed", { groupId: "group", memberId: "verify" }),
    raw(13, "cowork.group.completed", { groupId: "group" }),
    raw(14, "agent.invocation.completed", { invocationId: "coordinator" }), ...extra,
  ];
  for (const item of input) db.ingest(normalizeEvent("native", item));
  const snapshot = db.snapshot("actor", [source]), events = db.events(key, "0", 100).events;
  const run = snapshot.runs[0]!;
  return { db, run, events, snapshot, model: missionFlow(run, [run], snapshot.relations, events, { mode: "execution" }) };
}

test("legacy cowork metadata replays byte-identically and never promotes plans from members or scheduling", () => {
  const item = raw(1, "cowork.group.started", { groupId: "g", parentInvocationId: "p", execution: "sequential",
    executionPlan: [{ stage: 1, members: ["a", "b"] }], members: [{ memberId: "a", dependsOn: ["b"], task: "PRIVATE" }], goal: "PRIVATE" });
  const expected = { sourceId: "native", runId: "run", sequence: "1", type: item.type, occurredAt: at,
    data: { parentInvocationId: "p", groupId: "g", redacted: true } };
  assert.equal(JSON.stringify(normalizeEvent("native", item)), JSON.stringify(expected));
  const db = new Store(":memory:"); try {
    db.observeRun(observation); db.ingest(expected);
    assert.equal(db.ingest(normalizeEvent("native", item)), "duplicate");
  } finally { db.close(); }
});

test("versioned plans admit IDs only; invalid, oversized, foreign and arbitrary tool plans are not promoted", () => {
  const value = normalizeEvent("native", raw(1, "cowork.group.started", { groupId: "g", flow: plan, goal: "PRIVATE", members: [{ agent: "PRIVATE" }] }));
  assert.deepEqual(value.data.coworkPlan, plan); assert.doesNotMatch(JSON.stringify(value), /PRIVATE|goal|agent/);
  assert.equal(normalizeEvent("native", raw(1, "tool.completed", { groupId: "g", flow: plan })).data.coworkPlan, undefined);
  for (const flow of [null, { ...plan, goal: "PRIVATE" }, { ...plan, members: [plan.members[0], plan.members[0]] },
    { version: 1, members: [{ memberId: "a", dependsOn: ["foreign"] }, { memberId: "b", dependsOn: [] }] },
    { version: 1, members: Array.from({ length: 65 }, (_, id) => ({ memberId: `m${id}`, dependsOn: [] })) }]) {
    const result = normalizeEvent("native", raw(1, "cowork.group.started", { groupId: "g", flow }));
    assert.equal(result.data.coworkPlan, undefined); assert.equal(result.data.coworkPlanIssue, "invalid");
  }
  assert.equal(normalizeEvent("native", raw(1, "cowork.group.started", { groupId: "g", flow: { version: 2 } })).data.coworkPlanIssue, "unsupported");
});

test("JSONB object key reordering preserves normalized plan bytes and immutable replay", () => {
  const first = normalizeEvent("native", raw(1, "cowork.group.started", { groupId: "g", flow: plan }));
  const jsonbOrder = { members: plan.members, version: 1 };
  assert.notEqual(JSON.stringify(plan), JSON.stringify(jsonbOrder));
  const replay = normalizeEvent("native", raw(1, "cowork.group.started", { groupId: "g", flow: jsonbOrder }));
  assert.equal(JSON.stringify(first), JSON.stringify(replay));
  const db = new Store(":memory:"); try {
    db.observeRun(observation); db.ingest(first); assert.equal(db.ingest(replay), "duplicate");
  } finally { db.close(); }
});

test("canonical HTTP event shape through SQLite creates exact member dependency and nested call/tool groups", () => {
  const f = fixture(); try {
    const deps = f.model.edges.filter(edge => edge.kind === "cowork-dependency");
    assert.equal(deps.length, 1);
    const from = f.model.nodes.find(node => node.key === deps[0]!.from)!, to = f.model.nodes.find(node => node.key === deps[0]!.to)!;
    assert.equal(from.id, coworkMemberKey("group", "sort")); assert.equal(to.id, coworkMemberKey("group", "verify"));
    assert.deepEqual(deps[0]!.sequences, ["2"]);
    const definitions = nativeFlowGroupDefinitions(f.model, "run");
    const cowork = definitions.find(group => group.kind === "cowork")!;
    const member = definitions.find(group => group.kind === "cowork-member" && group.memberKeys.includes(from.key))!;
    const invocation = f.model.nodes.find(node => node.id === "sort-call")!;
    const invocationGroup = definitions.find(group => group.memberKeys.includes(invocation.key))!;
    assert.equal(member.parentKey, cowork.key); assert.equal(invocationGroup.parentKey, member.key);
    const tool = f.model.nodes.find(node => node.kind === "tool")!;
    assert.ok(invocationGroup.memberKeys.includes(tool.key));
    const projection = projectFlowGroups(f.model, definitions, new Set(definitions.filter(group => group.kind === "cowork-member").map(group => group.key)));
    assert.equal(projection.invalidGroups.length, 0);
    const edge = projection.edges.find(edge => edge.kind === "cowork-dependency")!;
    assert.equal(edge.from, member.key); assert.equal(projection.edgeEvidence.get(edge.key)![0]!.key, deps[0]!.key);
    const summary = projection.groups.find(group => group.key === cowork.key)!;
    assert.equal(flowGroupContext(summary, f.model.nodes, f.model.edges).dependencies.length, 1);
    assert.equal(f.model.nodes.filter(node => node.kind === "run").length, 1);
  } finally { f.db.close(); }
});

test("sequential no-dependency plan and legacy events do not invent prerequisite edges", () => {
  const f = fixture([], { version: 1, members: plan.members.map(member => ({ ...member, dependsOn: [] })) }); try {
    assert.equal(f.model.edges.filter(edge => edge.kind === "cowork-dependency").length, 0);
    assert.equal(f.model.edges.filter(edge => edge.kind === "cowork-invocation").length, 2);
  } finally { f.db.close(); }
});

test("different group plans and invocation membership conflicts remain partial without chosen dependency or join", () => {
  const f = fixture([
    raw(15, "cowork.group.started", { groupId: "group", flow: { version: 1, members: plan.members.map(member => ({ ...member, dependsOn: [] })) } }),
    raw(16, "agent.invocation.started", { invocationId: "sort-call", groupId: "other-group", memberId: "sort" }),
  ]); try {
    assert.equal(f.model.incomplete, true);
    assert.equal(f.model.edges.some(edge => edge.kind === "cowork-dependency"), false);
    assert.equal(f.model.edges.some(edge => edge.kind === "cowork-invocation" && f.model.nodes.find(node => node.key === edge.to)?.id === "sort-call"), false);
  } finally { f.db.close(); }
});

test("explicit member absent from a declared plan does not silently expand the group", () => {
  const f = fixture([raw(15, "agent.invocation.started", { invocationId: "orphan-call", groupId: "group", memberId: "foreign" })]); try {
    assert.equal(f.model.incomplete, true);
    assert.equal(f.model.edges.some(edge => edge.kind === "cowork-invocation" && f.model.nodes.find(node => node.key === edge.to)?.id === "orphan-call"), false);
  } finally { f.db.close(); }
});

test("explicit cyclic member dependencies survive collapsed summaries as cycles", () => {
  const f = fixture([], { version: 1, members: [{ memberId: "sort", dependsOn: ["verify"] }, { memberId: "verify", dependsOn: ["sort"] }] }); try {
    const definitions = nativeFlowGroupDefinitions(f.model, "run"), group = definitions.find(group => group.kind === "cowork")!;
    const projection = projectFlowGroups(f.model, definitions, new Set([group.key]));
    assert.equal(projection.groups.find(item => item.key === group.key)!.cyclicMembers, 2);
  } finally { f.db.close(); }
});

test("lifecycle evidence for a member outside the plan marks a conflict and suppresses plan dependencies", () => {
  const f = fixture([raw(15, "cowork.member.started", { groupId: "group", memberId: "foreign" }),
    raw(16, "cowork.member.completed", { groupId: "group", memberId: "foreign" })]); try {
    assert.equal(f.model.incomplete, true);
    assert.equal(f.model.edges.some(edge => edge.kind === "cowork-dependency"), false);
    assert.ok(f.model.nodes.some(node => node.id === coworkMemberKey("group", "foreign")));
  } finally { f.db.close(); }
});

test("node cap propagates partial observation into every surviving group summary", () => {
  const f = fixture(); try {
    const model = missionFlow(f.run, [f.run], f.snapshot.relations, f.events, { mode: "execution", maxNodes: 3 });
    assert.ok(model.hiddenNodes > 0); assert.equal(model.incomplete, true);
    const projection = projectFlowGroups(model, nativeFlowGroupDefinitions(model, "run"), new Set());
    for (const group of projection.groups) assert.equal(flowGroupContext(group, model.nodes, model.edges, model.incomplete).partial, true);
  } finally { f.db.close(); }
});

test("foreign source and Run plan/join events never alter the current graph", () => {
  const f = fixture(); try {
    const foreign = [f.events[1]!, f.events[3]!].flatMap(event => [
      { ...event, sourceId: "PRIVATE-OTHER-SOURCE", data: { ...event.data, groupId: "PRIVATE-GROUP" } },
      { ...event, runId: "PRIVATE-OTHER-RUN", data: { ...event.data, groupId: "PRIVATE-GROUP" } },
    ]);
    const model = missionFlow(f.run, [f.run], f.snapshot.relations, [...f.events, ...foreign], { mode: "execution" });
    assert.deepEqual(model, f.model);
    assert.doesNotMatch(JSON.stringify(model), /PRIVATE/);
  } finally { f.db.close(); }
});

test("multiple explicit member invocations stay under one member scope without inflating Run counts", () => {
  const f = fixture([raw(15, "agent.invocation.started", { invocationId: "sort-retry", parentInvocationId: "coordinator", groupId: "group", memberId: "sort" }),
    raw(16, "agent.invocation.completed", { invocationId: "sort-retry" })]); try {
    const definitions = nativeFlowGroupDefinitions(f.model, "run");
    const member = definitions.find(group => group.kind === "cowork-member" && group.label.endsWith("sort"))!;
    for (const id of ["sort-call", "sort-retry"]) {
      const node = f.model.nodes.find(node => node.id === id)!;
      assert.equal(definitions.find(group => group.memberKeys.includes(node.key))!.parentKey, member.key);
    }
    assert.equal(f.model.nodes.filter(node => node.kind === "run").length, 1);
    assert.equal(f.model.edges.filter(edge => edge.kind === "cowork-dependency").length, 1);
  } finally { f.db.close(); }
});

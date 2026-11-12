import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunView, EventView, RelationView } from "../packages/contracts/index.ts";
import type { SessionRelation, SessionRelationsEvidence } from "../packages/contracts/session-relations.ts";
import { missionEntityKey, missionFlow } from "../packages/projection/mission-flow.ts";
import { withNativeLineage } from "../packages/projection/lineage-flow.ts";
import { withSessionRelations } from "../packages/projection/session-relations-flow.ts";
import { nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";
import { projectFlowGroups } from "../packages/projection/flow-groups.ts";
import { flowGroupContext } from "../packages/projection/flow-group-context.ts";

const at = "2026-11-11T12:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function run(id = 1, sourceId = "source-a"): RunView {
  return { sourceId, runId: uuid(id), sessionId: uuid(100), workspaceId: "workspace", title: `Run ${id}`,
    status: "running", createdAt: at, startedAt: at, completedAt: null, observedAt: at,
    key: JSON.stringify([sourceId, uuid(id)]), cursor: "0", highWater: "0", incomplete: false,
    stale: false, binding: null, sourceLabel: sourceId, device: "test", sourceState: "connected",
    sourceUrl: null, workspaceKey: null, projectKey: null, capabilities: [] };
}
function managed(target = run(2), operation = 10): SessionRelation {
  return { kind: "managed-child", sessionId: target.sessionId, runId: target.runId,
    operationId: uuid(operation), status: "succeeded", parentInvocationId: "reused", childInvocationId: "reused" };
}
function peer(target = run(2), operation = 20): SessionRelation {
  return { kind: "peer-processing", sessionId: target.sessionId, runId: target.runId,
    operationId: uuid(operation), status: "succeeded", connectionId: "connection", conversationId: "conversation", messageId: "message" };
}
function page(rows: SessionRelation[], selected = run()): SessionRelationsEvidence {
  const child = rows[0]?.kind !== "peer-processing";
  return { runKey: selected.key, sourceId: selected.sourceId, sessionId: selected.sessionId,
    kind: child ? "managed-children" : "peer-processing", state: "connected", relations: rows,
    nextCursor: null, hasMore: false, omitted: 0,
    coverage: child ? "managed-child-receipts" : "peer-processing-receipts", observedAt: at, detail: "receipt window" };
}
const base = (selected = run()) => missionFlow(selected, [], [], []);

test("managed-child parent references do not inflate observed invocation counts", () => {
  const selected = run();
  const event = (sequence: string, type: string, invocationId: string, parentInvocationId?: string): EventView => ({
    key: sequence, sourceId: selected.sourceId, runId: selected.runId, sequence, type, occurredAt: at, receivedAt: at,
    data: { redacted: true, invocationId, ...(parentInvocationId ? { parentInvocationId } : {}) },
  });
  // Reduced from a real 17-event explicit managed-child Run: the parent ID
  // exists as relationship evidence, but its lifecycle/Run was not executed.
  const events = [event("4", "agent.invocation.started", "child", "parent"), event("16", "agent.invocation.completed", "child")];
  const relations: RelationView[] = [{ key: "relationship", runKey: selected.key, kind: "invocation",
    from: "invocation:parent", to: "invocation:child", evidenceSequence: "4", observedAt: at }];
  const receipt = { ...managed(selected), parentInvocationId: "parent", childInvocationId: "child" };
  const graph = (input: EventView[]) => withSessionRelations(missionFlow(selected, [selected], relations, input,
    { mode: "execution" }), selected, [selected], [page([receipt], selected)]);
  const model = graph(events), definitions = nativeFlowGroupDefinitions(model, "run");
  const projected = projectFlowGroups(model, definitions, new Set());
  const summary = projected.groups.find(group => group.kind === "run")!;
  assert.equal(summary.counts.invocation, 1);
  assert.equal(summary.counts["invocation-reference"], 1);
  assert.equal(definitions.filter(group => group.kind === "invocation").length, 1);
  assert.equal(definitions.filter(group => group.kind === "invocation-reference").length, 1);
  const parent = model.nodes.find(node => node.kind === "managed-parent-reference")!;
  assert.equal(parent.runKey, undefined);
  assert.equal(parent.status, "unknown");
  assert.ok(model.edges.some(edge => edge.from === parent.key && edge.kind === "managed-child"));
  assert.equal(flowGroupContext(summary, model.nodes, model.edges).statusByKind.find(row => row.kind === "invocation")?.states[0]?.count, 1);
  const observed = graph([event("2", "agent.invocation.started", "parent"), event("3", "agent.invocation.completed", "parent"), ...events]);
  const observedGroups = projectFlowGroups(observed, nativeFlowGroupDefinitions(observed, "run"), new Set());
  assert.equal(observedGroups.groups.find(group => group.kind === "run")?.counts.invocation, 2);
  assert.equal(observedGroups.groups.find(group => group.kind === "run")?.counts["invocation-reference"] ?? 0, 0);
});

test("peer context groups are nested while processing Runs retain native Session ownership", () => {
  const selected = run(), target = run(2);
  const output = withSessionRelations(base(), selected, [selected, target], [page([peer(target)])]);
  const definitions = nativeFlowGroupDefinitions(output, "session");
  const connection = definitions.find(group => group.kind === "peer-connection-context")!;
  const conversation = definitions.find(group => group.kind === "peer-conversation-context")!;
  assert(connection && conversation); assert.equal(conversation.parentKey, connection.key);
  assert(!conversation.memberKeys.some(key => output.nodes.find(node => node.key === key)?.kind === "run"));
  const projected = projectFlowGroups(output, definitions, new Set([conversation.key]));
  assert.equal(projected.groups.find(group => group.key === conversation.key)!.counts.uniqueRun ?? 0, 0);
  assert(projected.edges.some(edge => edge.kind === "peer-processing" && edge.from === conversation.key));
  assert(projected.edgeEvidence.size > 0);
  assert.equal(nativeFlowGroupDefinitions(output, "none").length, 0);
});

test("two processing receipts in one conversation keep one structural parent and a two-message group", () => {
  const selected = run(), first = run(2), second = run(3);
  const a = { ...peer(first, 20), messageId: "message-a" } as SessionRelation;
  const b = { ...peer(second, 21), messageId: "message-b" } as SessionRelation;
  const output = withSessionRelations(base(), selected, [selected, first, second], [page([a, b])]);
  const conversation = output.nodes.find(node => node.kind === "peer-conversation")!;
  assert.equal(output.edges.filter(edge => edge.to === conversation.key && edge.kind === "reference").length, 1);
  const definitions = nativeFlowGroupDefinitions(output, "session");
  const group = definitions.find(item => item.kind === "peer-conversation-context")!; assert(group);
  const projected = projectFlowGroups(output, definitions, new Set([group.key]));
  assert.equal(projected.groups.find(item => item.key === group.key)!.counts["peer-message"], 2);
  assert.equal(output.nodes.filter(node => node.kind === "run").length, 3);
});

test("relation target Runs join the existing native Session group with Korean edge labels", () => {
  const selected = run(); const child = run(2); const peerRun = run(3);
  const model = base(selected);
  const output = withSessionRelations(model, selected, [child, peerRun],
    [page([managed(child)]), page([peer(peerRun)])]);
  const session = model.nodes.find(node => node.kind === "session")!;
  const groups = nativeFlowGroupDefinitions(output, "session");
  const sessionGroup = groups.find(group => group.kind === "session" && group.memberKeys.includes(session.key))!;
  assert.ok(sessionGroup);
  for (const target of [child, peerRun]) {
    const key = missionEntityKey(target.sourceId, "run", target.runId);
    assert.ok(output.edges.some(edge => edge.from === session.key && edge.to === key && edge.kind === "ownership"));
    const runGroup = groups.find(group => group.kind === "run" && group.memberKeys.includes(key));
    assert.ok(runGroup ? runGroup.parentKey === sessionGroup.key : sessionGroup.memberKeys.includes(key));
  }
  assert.deepEqual(output.nodes.filter(node => node.kind === "session"), [session]);
  const labels: Record<string, string> = { "managed-child": "관리형 child 호출", "peer-processing": "peer 처리",
    "relation-evidence": "영수증 근거", reference: "문맥 참조", ownership: "소속 참조" };
  for (const edge of output.edges.slice(model.edges.length)) assert.equal(edge.label, labels[edge.kind]);
});

test("execution base gains no Session nodes or inferred Session ownership", () => {
  const selected = run(); const child = run(2);
  const execution = missionFlow(selected, [], [], [], { mode: "execution" });
  for (const model of [execution, { ...execution, nodes: [...execution.nodes,
    ...base(run(1, "foreign")).nodes.filter(node => node.kind === "session")] }]) {
    const output = withSessionRelations(model, selected, [child], [page([managed(child)]), page([peer(child)])]);
    assert.deepEqual(output.nodes.filter(node => node.kind === "session"), model.nodes.filter(node => node.kind === "session"));
    assert.equal(nativeFlowGroupDefinitions(output, "session").some(group => group.kind === "session"), false);
    assert.equal(output.edges.some(edge => edge.kind === "ownership" &&
      output.nodes.find(node => node.key === edge.from)?.kind === "session"), false);
  }
});

test("managed child uses a real Run and an unknown session-scoped parent, never selected invocation", () => {
  const selected = run(); const child = run(2);
  const model = withNativeLineage(base(), selected, [{ sequence: "1", invocationId: "reused",
    nativeThreadId: "thread", nativeTurnId: "turn", nativeItemId: null, executor: "executor",
    provider: "provider", attempt: 1, phase: "turn_started", observedAt: at }]);
  const output = withSessionRelations(model, selected, [selected, child], [page([managed()])]);
  const parent = output.nodes.find(node => node.kind === "managed-parent-reference")!;
  assert.equal(parent.status, "unknown"); assert.equal(parent.runKey, undefined);
  assert.ok(nativeFlowGroupDefinitions(output, "run").every(group => !group.memberKeys.includes(parent.key)));
  const selectedInvocation = missionEntityKey(selected.sourceId, "invocation", "reused", selected.runId);
  assert.deepEqual(output.nodes.find(node => node.key === selectedInvocation), model.nodes.find(node => node.key === selectedInvocation));
  assert.ok(parent.details.some(detail => detail.label === "Parent Run ID" && detail.value === "unknown"));
  const childKey = missionEntityKey(child.sourceId, "invocation", "reused", child.runId);
  assert.ok(output.edges.some(edge => edge.from === parent.key && edge.to === childKey && edge.kind === "managed-child"));
  assert.ok(output.edges.some(edge => edge.from === missionEntityKey(child.sourceId, "run", child.runId) && edge.to === childKey && edge.kind === "ownership"));
  assert.equal(output.nodes.find(node => node.key === childKey)?.status, "observed-reference");
  assert.equal(output.nodes.filter(node => node.kind === "run" && node.runKey).length, 2);
  assert.equal(output.nodes.find(node => node.kind === "run" && node.id === child.runId)?.status, "running");
  assert.ok(output.nodes.some(node => node.details.some(detail => detail.label === "Receipt status" && detail.value === "succeeded")));
  assert.ok(output.incomplete);
});

test("existing actual Runs and invocation lifecycle survive, with reused IDs separated by Run and source", () => {
  const selected = run(); const child = run(2); const other = run(3); const foreign = run(2, "source-b");
  const model = base(); model.nodes.push(...base(child).nodes.filter(node => node.kind === "run"),
    ...base(foreign).nodes.filter(node => node.kind === "run"));
  const childKey = missionEntityKey(child.sourceId, "invocation", "reused", child.runId);
  model.nodes.push({ key: childKey, kind: "invocation", id: "reused", label: "Observed invocation",
    status: "completed", description: "Existing lifecycle", sourceId: child.sourceId, runKey: child.key,
    details: [], sequences: ["1", "2"] });
  const output = withSessionRelations(model, selected, [selected, child, other, foreign],
    [page([managed(child), managed(other, 11)]), page([managed(foreign)], foreign)]);
  const actual = output.nodes.filter(node => node.kind === "run" && node.runKey);
  assert.equal(actual.length, 4); assert.equal(new Set(actual.map(node => node.key)).size, 4);
  assert.equal(output.nodes.filter(node => node.kind === "invocation").length, 2);
  assert.deepEqual(output.nodes.find(node => node.key === childKey), model.nodes.find(node => node.key === childKey));
  assert.deepEqual(output.nodes.find(node => node.key === missionEntityKey(foreign.sourceId, "run", foreign.runId)),
    model.nodes.find(node => node.key === missionEntityKey(foreign.sourceId, "run", foreign.runId)));
  assert.equal(output.nodes.some(node => node.kind === "invocation" && node.sourceId === foreign.sourceId), false);
});

test("peer context uses tuple IDs, local message to Run receipts, no invented sessions or dependencies", () => {
  const rows = [peer(), { ...peer(run(2), 21), conversationId: "another" },
    { ...peer(run(2), 22), connectionId: "another" }] as SessionRelation[];
  const model = base(); const output = withSessionRelations(model, run(), [run(2)], [page(rows)]);
  assert.equal(output.nodes.filter(node => node.kind === "peer-message").length, 3);
  assert.equal(output.edges.filter(edge => edge.kind === "peer-processing").length, 3);
  assert.deepEqual(output.nodes.filter(node => node.kind === "session"), model.nodes.filter(node => node.kind === "session"));
  assert.equal(output.edges.some(edge => ["dependency", "record-order", "task-binding"].includes(edge.kind)), false);
  for (const edge of output.edges.filter(edge => edge.kind === "peer-processing")) {
    assert.equal(output.nodes.find(node => node.key === edge.from)?.kind, "peer-message");
    assert.equal(output.nodes.find(node => node.key === edge.to)?.runKey, run(2).key);
  }
});

test("duplicate receipts collapse and conflicting identities are dropped without arbitrary winners", () => {
  const model = base(); const receipt = page([managed()]);
  const once = withSessionRelations(model, run(), [run(2)], [receipt]);
  assert.deepEqual(withSessionRelations(model, run(), [run(2), run(2)], [receipt, receipt]), once);
  const conflict = page([{ ...managed(), status: "failed" }]);
  const output = withSessionRelations(model, run(), [run(2)], [receipt, conflict]);
  assert.deepEqual(output.nodes, model.nodes);
  assert.deepEqual(output, withSessionRelations(model, run(), [run(2)], [conflict, receipt]));
  assert.deepEqual(withSessionRelations(model, run(), [run(2), { ...run(2), title: "conflict" }], [receipt]).nodes, model.nodes);
  const targetConflict = page([managed(run(3))]);
  assert.deepEqual(withSessionRelations(model, run(), [run(2), run(3)], [receipt, targetConflict]).nodes, model.nodes);
});

test("missing, denied, stale and hidden scopes contribute no graph data", () => {
  const model = base(); const receipt = page([managed()]);
  for (const targets of [[], [{ ...run(2), stale: true }], [{ ...run(2), sourceState: "forbidden" as const }],
    [{ ...run(2), sessionId: uuid(999) }], [run(2, "foreign")]]) {
    assert.deepEqual(withSessionRelations(model, run(), targets, [receipt]).nodes, model.nodes);
  }
  for (const hidden of [{ ...receipt, runKey: "hidden" }, { ...receipt, sourceId: "hidden" },
    { ...receipt, sessionId: uuid(999) }, { ...receipt, state: "forbidden" as const },
    page([{ ...managed(), sessionId: uuid(999) }])]) {
    assert.deepEqual(withSessionRelations(model, run(), [run(2)], [hidden]).nodes, model.nodes);
  }
  assert.deepEqual(withSessionRelations(model, run(), [run(2)], [receipt,
    { ...receipt, state: "forbidden", relations: [] }]).nodes, model.nodes);
  assert.deepEqual(withSessionRelations(model, { ...run(), stale: true }, [run(2)], [receipt]).nodes, model.nodes);
});

test("projection is immutable, deterministic, bounded with no dangling edges and preserves base flags", () => {
  const model = base(); model.hiddenNodes = 7; model.incomplete = true;
  const selected = run(); const targets = Array.from({ length: 100 }, (_, i) => run(i + 2));
  const evidence = targets.map((target, i) => page([managed(target, i + 1000), managed(target, i + 2000)]));
  const inputs = structuredClone({ model, selected, targets, evidence });
  const output = withSessionRelations(model, selected, targets, evidence);
  assert.deepEqual({ model, selected, targets, evidence }, inputs);
  assert.ok(output.nodes.length <= 240); assert.ok(output.hiddenNodes > 7); assert.ok(output.incomplete);
  assert.deepEqual(output.nodes.slice(0, model.nodes.length), model.nodes);
  assert.deepEqual(output.edges.slice(0, model.edges.length), model.edges);
  const keys = new Set(output.nodes.map(node => node.key));
  assert.equal(keys.size, output.nodes.length);
  assert.ok(output.edges.every(edge => keys.has(edge.from) && keys.has(edge.to)));
  assert.deepEqual(output, withSessionRelations(model, selected, [...targets].reverse(),
    [...evidence].reverse().map(item => ({ ...item, relations: [...item.relations].reverse() }))));
  assert.deepEqual(withSessionRelations(model, selected, targets, []), model);
});

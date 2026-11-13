import assert from "node:assert/strict";
import { test } from "node:test";
import { externalKey, type RunView } from "../packages/contracts/index.ts";
import { nativeCommandPairs, withNativeCommandFlow } from "../packages/projection/native-command-flow.ts";
import { missionFlow } from "../packages/projection/mission-flow.ts";
import { nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";
import { projectFlowGroups } from "../packages/projection/flow-groups.ts";
import { withAssistantExecutions } from "../packages/projection/assistant-flow.ts";
import { groupWorkspaceFlow } from "../packages/projection/group-workspace-flow.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-14T00:00:00.000Z";
function run(n: number): RunView {
  const runId = id(n);
  return { key: externalKey("native", runId), sourceId: "native", runId, sessionId: id(40), workspaceId: id(41),
    title: `Run ${n}`, status: n === 1 ? "failed" : n === 2 ? "cancelled" : "queued", createdAt: at, startedAt: at,
    completedAt: n < 3 ? at : null, observedAt: at, cursor: "0", highWater: "0", incomplete: false, stale: false,
    sourceLabel: "Native", device: "test", sourceState: "connected", sourceUrl: null, workspaceKey: null, projectKey: null,
    capabilities: [], binding: { sourceId: "native", runId, projectSourceId: "projects", projectId: "p", taskId: "t",
      taskRevision: "1", projectTitle: "Project", taskTitle: "Task", provenance: "operator" },
    ...(n > 1 ? { nativeCommandLink: { state: "observed" as const, receipt: { commandId: id(n + 10), kind: n === 2 ? "retry" as const : "resume" as const,
      sourceRunId: id(n - 1), targetRunId: runId, sessionId: id(40), rootRunId: id(1), relation: n === 2 ? "retry_of" as const : "continues" as const,
      acceptedAt: at, provenance: "native-command-receipt" as const } } } : {}),
  };
}
const edgeKinds = (model: { edges: { kind: string }[] }) => model.edges.filter(edge => edge.kind.startsWith("native-command-")).map(edge => edge.kind).sort();

test("actual retry/resume receipt chain expands mission endpoints and preserves statuses, Task groups and receipt evidence", () => {
  const runs = [run(1), run(2), run(3)], before = structuredClone(runs), model = missionFlow(runs[2]!, runs, [], []);
  assert.deepEqual(edgeKinds(model), ["native-command-resume", "native-command-retry"]);
  assert.deepEqual(model.nodes.filter(node => node.kind === "run").map(node => node.status).sort(), ["cancelled", "failed", "queued"]);
  const groups = nativeFlowGroupDefinitions(model, "task"), projection = projectFlowGroups(model, groups, new Set());
  assert.deepEqual(projection.invalidGroups, []); assert.equal(projection.groups.find(group => group.kind === "task")!.counts.uniqueRun, 3);
  const receipt = model.edges.find(edge => edge.kind === "native-command-resume")!;
  assert.match(receipt.detail, /native-command-receipt.*continues/s); assert.match(receipt.detail, /실행 성공/);
  assert.equal(receipt.sequences.length, 0); assert.deepEqual(runs, before);
});

test("continue connects a new root without assigning the predecessor Task to the new Run", () => {
  const a = run(1), b = run(2); b.binding = null;
  const link = b.nativeCommandLink; assert.ok(link?.state === "observed");
  b.nativeCommandLink = { state: "observed", receipt: { ...link.receipt,
    kind: "continue", relation: "continues", rootRunId: b.runId } };
  const model = missionFlow(b, [a, b], [], []);
  assert.deepEqual(edgeKinds(model), ["native-command-continue"]);
  assert.equal(model.nodes.some(node => node.kind === "task"), false); assert.equal(b.binding, null);
  assert.equal(model.nodes.find(node => node.runKey === b.key)!.nativeCommandRef!.rootRunId, b.runId);
});

test("execution detail keeps a selected Run scope and explains the predecessor outside this view", () => {
  const a = run(1), b = run(2), model = missionFlow(b, [a, b], [], [], { mode: "execution" });
  assert.equal(model.nodes.filter(node => node.kind === "run").length, 1); assert.deepEqual(edgeKinds(model), []);
  assert.equal(model.incomplete, true); assert.match(model.nodes.find(node => node.runKey === b.key)!.details.find(detail => detail.label === "후속 관계 조회")!.value, /보기 범위 밖/);
});

test("source, Session, workspace, duplicate Run and conflicting command identities cannot create a receipt edge", () => {
  for (const change of [
    (a: RunView, _b: RunView, _rows: RunView[]) => { a.sourceId = "foreign"; },
    (a: RunView, _b: RunView, _rows: RunView[]) => { a.sessionId = id(99); },
    (a: RunView, _b: RunView, _rows: RunView[]) => { a.workspaceId = id(99); },
    (a: RunView, _b: RunView, _rows: RunView[]) => { a.stale = true; },
    (a: RunView, _b: RunView, rows: RunView[]) => { rows.push({ ...a }); },
    (_a: RunView, b: RunView, rows: RunView[]) => { const c = run(3); if (c.nativeCommandLink?.state === "observed" && b.nativeCommandLink?.state === "observed") c.nativeCommandLink.receipt.commandId = b.nativeCommandLink.receipt.commandId; rows.push(c); },
  ]) {
    const a = run(1), b = run(2), rows = [a, b]; change(a, b, rows);
    assert.equal(nativeCommandPairs(rows).some(pair => pair.to.runId === b.runId), false);
  }
});

test("repeated projection is idempotent, withdrawal removes derived IDs, and equal command UUIDs across sources stay independent", () => {
  const a = run(1), b = run(2), rows = [a, b], model = missionFlow(b, rows, [], []);
  assert.deepEqual(withNativeCommandFlow(model, rows), model);
  const withdrawn = withNativeCommandFlow(model, rows.map(run => ({ ...run, nativeCommandLink: { state: "unavailable" as const, reason: "source-unavailable" as const } })));
  assert.deepEqual(edgeKinds(withdrawn), []); assert.equal(withdrawn.nodes.some(node => node.nativeCommandRef), false);
  assert.equal(withdrawn.nodes.some(node => node.details.some(detail => detail.label === "원본 명령 ID")), false);
  const foreign = rows.map(run => ({ ...structuredClone(run), sourceId: "foreign", key: externalKey("foreign", run.runId),
    binding: run.binding ? { ...run.binding, sourceId: "foreign" } : null }));
  assert.equal(nativeCommandPairs([...rows, ...foreign]).length, 2);
});

test("Task-map merge and group workspace retain one Native receipt edge per command without synthetic sequence evidence", () => {
  const rows = [run(1), run(2), run(3)], base = missionFlow(rows[0]!, rows, [], []);
  const mapped = withAssistantExecutions({ ...base, focusPresent: true }, [], [], { sourceId: "projects", projectId: "p", focusTaskId: "t" }, rows);
  assert.deepEqual(edgeKinds(mapped), ["native-command-resume", "native-command-retry"]);
  const workspace = groupWorkspaceFlow([{ ref: { sourceId: "projects", projectId: "p", taskId: "t" },
    task: { id: "t", projectId: "p", title: "Task", revision: "2", state: "todo", requiresTest: false } }], rows, [], [], [], []);
  assert.deepEqual(edgeKinds(workspace), edgeKinds(mapped));
});

test("bounded command flow has no dangling edges and missing metadata leaves the legacy model unchanged", () => {
  const rows = [run(1), run(2), run(3)], bounded = missionFlow(rows[2]!, rows, [], [], { maxNodes: 2 });
  const keys = new Set(bounded.nodes.map(node => node.key));
  assert.ok(bounded.hiddenNodes > 0); assert.equal(bounded.incomplete, true);
  assert.ok(bounded.edges.every(edge => keys.has(edge.from) && keys.has(edge.to)));
  const legacy = run(1), base = missionFlow(legacy, [legacy], [], []);
  assert.equal(withNativeCommandFlow(base, [legacy]), base);
});

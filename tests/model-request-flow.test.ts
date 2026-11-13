import assert from "node:assert/strict";
import test from "node:test";
import type { RunView } from "../packages/contracts/index.ts";
import type { ModelRequestObservation } from "../packages/contracts/model-requests.ts";
import { missionFlow, missionEntityKey } from "../packages/projection/mission-flow.ts";
import { withModelRequests } from "../packages/projection/model-request-flow.ts";
import { nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";
import { projectFlowGroups } from "../packages/projection/flow-groups.ts";
import { flowGroupContext } from "../packages/projection/flow-group-context.ts";

const at = "2026-11-13T06:00:00Z";
const run = { key: "run", sourceId: "native", runId: "root", sessionId: "session", title: "QA", status: "failed", binding: null,
  incomplete: false, stale: false, sourceState: "connected", cursor: "4", highWater: "4" } as RunView;
const call = (id = "1", invocationId: string | null = null): ModelRequestObservation => ({ id, contextKey: "a".repeat(64),
  invocationId, provider: "codex", model: "gpt-6-astra", phase: "ended", started: { sequence: id, occurredAt: at },
  ended: { sequence: String(BigInt(id) + 1n), occurredAt: at }, reportedDurationMs: 4233, sequences: [id, String(BigInt(id) + 1n)] });
const page = (models = [call()]) => ({ runKey: run.key, modelRequestCoverage: "native-model-lifecycle" as const, modelRequests: models,
  complete: true, throughSequence: "4", targetSequence: "4" });
const base = () => missionFlow(run, [], [], [], { mode: "execution" });

test("source model lifecycle stays visible after a failed Run without turning an SDK end into success", () => {
  const input = base(), copy = structuredClone(input), result = withModelRequests(input, run, page());
  const model = result.nodes.find(node => node.kind === "model-request")!;
  assert.equal(model.status, "ended"); assert.match(model.description, /成功|성공/);
  assert(model.details.some(detail => detail.label === "SDK 보고 소요 시간" && detail.value.startsWith("4233 ms")));
  assert.equal(result.nodes.find(node => node.kind === "run")?.status, "failed");
  assert(result.edges.some(edge => edge.to === model.key && edge.kind === "model-request"));
  assert.deepEqual(input, copy);
  const groups = projectFlowGroups(result, nativeFlowGroupDefinitions(result, "run"), new Set());
  const context = flowGroupContext(groups.groups[0]!, result.nodes, result.edges, result.incomplete);
  assert.deepEqual(context.statusByKind.find(row => row.kind === "model-request")?.states, [{ state: "ended", count: 1 }]);
});

test("scoped evidence disappears for a different Run, stale/disconnected source, absent coverage or missing scope", () => {
  assert.equal(withModelRequests(base(), run, { ...page(), runKey: "other" }).nodes.length, 1);
  const { runKey: _, ...unscoped } = page();
  assert.equal(withModelRequests(base(), run, unscoped).nodes.length, 1);
  assert.equal(withModelRequests(base(), { ...run, stale: true }, page()).nodes.length, 1);
  assert.equal(withModelRequests(base(), { ...run, sourceState: "disconnected" }, page()).nodes.length, 1);
  assert.equal(withModelRequests(base(), run, { runKey: run.key, complete: true, targetSequence: "0", throughSequence: "0" }).nodes.length, 1);
});

test("explicit invocation ownership nests model observations and retains collapsed boundary evidence", () => {
  const input = base(), root = input.nodes[0]!, invocationKey = missionEntityKey(run.sourceId, "invocation", "inv", run.runId);
  input.nodes.push({ ...root, key: invocationKey, kind: "invocation", id: "inv", label: "Agent", status: "completed" });
  input.edges.push({ key: "inv-owner", from: root.key, to: invocationKey, kind: "invocation", label: "호출", detail: "explicit", sourceId: run.sourceId, sequences: ["1"] });
  const result = withModelRequests(input, run, page([call("1", "inv")]));
  const definitions = nativeFlowGroupDefinitions(result, "run"), group = definitions.find(value => value.kind === "invocation")!;
  assert(group.memberKeys.some(key => result.nodes.find(node => node.key === key)?.kind === "model-request"));
  const collapsed = projectFlowGroups(result, definitions, new Set([group.key]));assert.equal(collapsed.invalidGroups.length, 0);
  assert(collapsed.groups.some(value => value.key === group.key && value.internalEdges > 0));
});

test("only same-context nonoverlapping observed requests get record-order edges; limits retain a partial marker", () => {
  const result = withModelRequests(base(), run, page([call("1"), call("3")]));
  assert.equal(result.edges.filter(edge => edge.kind === "record-order").length, 1);
  assert.equal(result.edges.filter(edge => edge.kind === "dependency").length, 0);
  const separate = withModelRequests(base(), run, page([call("1"), { ...call("3"), contextKey: "b".repeat(64) }]));
  assert.equal(separate.edges.filter(edge => edge.kind === "record-order").length, 0);
  const capped = withModelRequests(base(), run, page([call("1"), call("3")]), 2);
  assert.equal(capped.hiddenNodes, 1); assert.equal(capped.incomplete, true);
  assert(capped.edges.every(edge => capped.nodes.some(node => node.key === edge.from) && capped.nodes.some(node => node.key === edge.to)));
});

test("a reference-only invocation cannot become the model's observed execution parent", () => {
  const input = base(), root = input.nodes[0]!;
  const reference = { ...root, key: missionEntityKey(run.sourceId, "invocation", "inv", run.runId), kind: "invocation", id: "inv", label: "호출 참조", status: "unobserved" };
  input.nodes.push(reference);
  const result = withModelRequests(input, run, page([call("1", "inv")]));
  const model = result.nodes.find(value => value.kind === "model-request")!;
  assert.equal(result.edges.find(edge => edge.to === model.key)?.from, root.key);
  const groups = nativeFlowGroupDefinitions(result, "run");
  assert(!groups.find(group => group.kind === "invocation-reference")?.memberKeys.includes(model.key));
});

test("open or end-only evidence never invents a successful completion or another observed start", () => {
  const result = withModelRequests(base(), run, page([{ ...call(), phase: "started", ended: null }, { ...call("3"), phase: "end-only", started: null }]));
  assert.deepEqual(result.nodes.filter(node => node.kind === "model-request").map(node => node.status), ["unfinished", "unknown"]);
  assert.equal(result.incomplete, true);
});

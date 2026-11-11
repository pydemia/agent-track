import test from "node:test";
import assert from "node:assert/strict";
import type { MissionFlow } from "../packages/projection/mission-flow.ts";
import type { RunView } from "../packages/contracts/index.ts";
import type { NativeLineageObservation } from "../packages/adapters/demian/lineage.ts";
import { withNativeLineage } from "../packages/projection/lineage-flow.ts";

const run = { key: "run", sourceId: "native" } as RunView;
const base: MissionFlow = { eventCount: 2, incomplete: false, hiddenNodes: 0, nodes: [
  { key: "root", kind: "run", runKey: "run", id: "run", sourceId: "native", label: "Run", status: "succeeded", description: "", details: [], sequences: [] },
  { key: "tool", kind: "tool", runKey: "run", callId: "item", id: "call", sourceId: "native", label: "Tool", status: "completed", description: "", details: [], sequences: ["8", "12"] },
], edges: [{ key: "orphan", from: "root", to: "tool", kind: "tool-of", label: "상위 호출 미상", detail: "", sourceId: "native", sequences: ["8", "12"] }] };
const row: NativeLineageObservation = { sequence: "7", invocationId: "invocation", nativeItemId: "item", nativeThreadId: "thread", nativeTurnId: "turn",
  phase: "tool_started", attempt: 1, executor: "codex-app-server", provider: "codex-native", observedAt: "2026-11-11T12:00:00Z" };

test("native lineage joins exact item IDs without inventing invocation lifecycle or changing the journal model", () => {
  const before = structuredClone(base); const result = withNativeLineage(base, run, [row, { ...row, sequence: "11", phase: "tool_completed" }]);
  assert.equal(result.nodes.find((node) => node.kind === "invocation")?.status, "observed");
  assert.equal(result.edges.filter((edge) => edge.kind === "native-tool").length, 1);
  assert.equal(result.edges.some((edge) => edge.key === "orphan"), false);
  assert.ok(result.nodes.find((node) => node.key === "tool")?.details.some((detail) => detail.label === "Native item" && detail.value === "item"));
  assert.equal(result.nodes.some((node) => node.kind === "invocation" && ["completed", "succeeded"].includes(node.status)), false);
  assert.deepEqual(base, before);
});

test("lineage ambiguity and display limits do not guess a parent or exceed the node bound", () => {
  const ambiguous = withNativeLineage(base, run, [row, { ...row, sequence: "10", attempt: 2 }]);
  assert.equal(ambiguous.nodes.find((node) => node.key === "tool")?.status, "ambiguous");
  assert.equal(ambiguous.edges.some((edge) => edge.kind === "native-tool"), false);
  const capped = withNativeLineage(base, run, [row], false, 2);
  assert.equal(capped.nodes.length, 2); assert.equal(capped.hiddenNodes, 1); assert.equal(capped.incomplete, true);
  assert.ok(capped.edges.every((edge) => capped.nodes.some((node) => node.key === edge.from) && capped.nodes.some((node) => node.key === edge.to)));
});

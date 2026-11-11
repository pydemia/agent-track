import test from "node:test";
import assert from "node:assert/strict";
import { missionFlow } from "../packages/projection/mission-flow.ts";
import { withToolEvidence } from "../packages/projection/tool-flow.ts";
import type { RunView } from "../packages/contracts/index.ts";
import type { ToolEvidencePage } from "../packages/adapters/demian/tool-evidence.ts";

const at = "2026-11-11T12:00:00Z";
const run = { key: "run", sourceId: "native", runId: "root", sessionId: "session", title: "QA", status: "succeeded", binding: null,
  incomplete: false, stale: false, cursor: "2", highWater: "2" } as RunView;
const page: ToolEvidencePage = { calls: [{ invocationId: "inv", callId: "call", tool: "read", outcome: "failed", requested: [{ type: "tool.requested", sequence: "1", occurredAt: at }],
  started: [], ended: [{ type: "tool.completed", sequence: "2", occurredAt: "2026-11-11T12:00:01Z", ok: false }] }], scanned: 2, limit: 2000,
  targetSequence: "2", throughSequence: "2", targetReached: true, gaps: false, truncated: false, omittedCalls: 0, unidentifiedEvents: 0, complete: true };
test("tool supplement supplies failures and request intervals without inventing an execution start or Run completion", () => {
  const base = missionFlow(run, [], [], [], { mode: "execution" }); const before = structuredClone(base);
  const result = withToolEvidence(base, run, page); const tool = result.nodes.find((node) => node.kind === "tool")!;
  assert.equal(tool.status, "failed"); assert.equal(tool.details.find((detail) => detail.label === "실행 시작 관측")?.value, "원본 제공 없음");
  assert.equal(tool.details.find((detail) => detail.label === "요청→종료 관측 구간")?.value, "1000 ms (대기 포함; 실행 시간과 구별)");
  assert.equal(result.nodes.find((node) => node.kind === "run")?.status, "succeeded");
  assert.equal(result.nodes.find((node) => node.kind === "invocation")?.status, "unobserved"); assert.deepEqual(base, before);
  const capped = withToolEvidence(base, run, page, 1); assert.equal(capped.nodes.length, 1); assert.equal(capped.hiddenNodes, 1);
  assert.ok(capped.edges.every((edge) => capped.nodes.some((node) => node.key === edge.from) && capped.nodes.some((node) => node.key === edge.to)));
});
test("the same invocation and call IDs in different Runs remain distinct and partial evidence does not declare success", () => {
  const other = { ...run, key: "other", runId: "other" };
  const base = missionFlow(run, [], [], [], { mode: "execution" });
  const otherBase = missionFlow(other, [], [], [], { mode: "execution" });
  const first = withToolEvidence(base, run, page); const second = withToolEvidence(otherBase, other, page);
  assert.notEqual(first.nodes.find((node) => node.kind === "tool")?.key, second.nodes.find((node) => node.kind === "tool")?.key);
  const incomplete = withToolEvidence(base, run, { ...page, complete: false, calls: [{ ...page.calls[0]!, outcome: "succeeded" }] });
  assert.equal(incomplete.nodes.find((node) => node.kind === "tool")?.status, "completed"); assert.equal(incomplete.incomplete, true);
});

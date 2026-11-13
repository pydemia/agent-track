import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MissionFlow } from "../packages/projection/mission-flow.ts";
import { missionUnitKind } from "../packages/projection/mission-flow.ts";
import { nativeEvidenceSummary, withNativeRunEvidence } from "../packages/projection/native-run-evidence.ts";
import { publicNativeRunEvidence } from "../packages/contracts/native-run-evidence.ts";
import type { RunView } from "../packages/contracts/index.ts";
import { NativeRunEvidence } from "../apps/web/src/NativeRunEvidence.tsx";
import { nativeEvidenceFixture } from "./fixtures/native-run-evidence.ts";

const page = nativeEvidenceFixture(), run = { key: "run", runId: page.run.id, sourceId: "protected" } as RunView;
const base: MissionFlow = { eventCount: 8, incomplete: false, hiddenNodes: 0, edges: [], nodes: [{
  key: "root", kind: "run", id: run.runId, runKey: run.key, sourceId: run.sourceId, label: "Run", status: "succeeded", description: "", sequences: [], details: [],
}] };
test("native evidence shows real turn/item references while invocation lifecycle stays unobserved", () => {
  const original = structuredClone(base), result = withNativeRunEvidence(base, run, page.events.data, false);
  const invocation = result.nodes.find(node => node.kind === "invocation")!;
  assert.equal(missionUnitKind(invocation), "invocation-reference");
  assert.equal(result.nodes.filter(node => node.kind === "native-turn").length, 1);
  assert.equal(result.nodes.filter(node => node.kind === "native-item").length, 1);
  assert.deepEqual(result.nodes.find(node => node.kind === "native-turn")!.sequences, ["4", "5"]);
  assert.equal(result.edges.filter(edge => edge.label === "Native turn 참조").length, 1);
  assert.equal(result.edges.some(edge => edge.kind === "dependency" || edge.kind === "chronology"), false);
  assert.equal(result.nodes.some(node => node.kind === "model-request"), false);
  assert.deepEqual(base, original);
  const bounded = withNativeRunEvidence(base, run, page.events.data, true, 2);
  assert.equal(bounded.nodes.length, 2); assert(bounded.incomplete); assert(bounded.hiddenNodes > 0);
  assert(bounded.edges.every(edge => bounded.nodes.some(node => node.key === edge.from) && bounded.nodes.some(node => node.key === edge.to)));
  const foreign = page.events.data.map(record => ({ ...record, runId: "foreign" }));
  assert.deepEqual(withNativeRunEvidence(base, run, foreign, false), base);
});
test("duplicate usage reports retain latest per-scope observation, never a fabricated overall total", () => {
  const summary = nativeEvidenceSummary([...page.events.data].reverse());
  assert.equal(summary.usage.length, 2);
  assert.deepEqual(summary.usage.map(row => [row.sequence, row.observation.usage.totalTokens]), [["7", 3200], ["7", 3200]]);
  const html = renderToStaticMarkup(createElement(NativeRunEvidence, { value: {
    scope: "scope", state: "connected", page: publicNativeRunEvidence(page), records: page.events.data, hasMore: false, detail: "현재 관측",
  } }));
  assert.match(html, /gpt-6.1-sol/); assert.match(html, /3,200/); assert.doesNotMatch(html, /6,400/);
  assert.match(html, /부분 관측/); assert.match(html, /포괄 범위 미확인/); assert.match(html, /제공자 연산 시간이 아닙니다/);
  assert.match(html, /answer.txt/); assert.doesNotMatch(html, /acting_user_id|binding_sha256/);
});

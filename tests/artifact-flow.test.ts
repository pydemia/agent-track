import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArtifactEvidence, ArtifactMetadata, RunView } from "../packages/contracts/index.ts";
import { withArtifactEvidence } from "../packages/projection/artifact-flow.ts";
import { nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";
import { missionEntityKey, missionFlow, type MissionFlow } from "../packages/projection/mission-flow.ts";

const at = "2026-11-11T12:00:00.000Z";
const runId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
function uuidFromName(name: string): string {
  const suffix = [...name].map(character => character.codePointAt(0)!.toString(16).padStart(4, "0")).join("");
  return `00000000-0000-4000-8000-${BigInt(`0x${suffix || "0"}`).toString(16).slice(-12).padStart(12, "0")}`;
}
function run(id = runId, session = sessionId): RunView {
  return { key: JSON.stringify(["source", id]), sourceId: "source", runId: id, sessionId: session,
    workspaceId: "workspace", title: id, status: "failed", createdAt: at, startedAt: at,
    completedAt: null, observedAt: at, cursor: "1", highWater: "1", incomplete: false,
    stale: false, binding: null, sourceLabel: "source", device: "test", sourceState: "connected",
    sourceUrl: null, workspaceKey: null, projectKey: null, capabilities: [] };
}
function artifact(id: string, kind: ArtifactMetadata["kind"] = "result"): ArtifactMetadata {
  return { id: uuidFromName(id), runId, sessionId, kind, filename: `${id}.txt`, mediaType: "text/plain",
    sizeBytes: 12, sha256: "a".repeat(64), representation: "reference", createdAt: at };
}
function evidence(rows: ArtifactMetadata[], selected = run()): ArtifactEvidence {
  return { state: "connected", runKey: selected.key, observedAt: at, detail: "metadata window",
    artifacts: rows, scanned: rows.length, limit: 100, complete: false };
}
const base = (selected = run()): MissionFlow => missionFlow(selected, [], [], []);

test("explicit result and attachment kinds create distinct noncausal edge meanings", () => {
  const selected = run();
  const output = withArtifactEvidence(base(selected), selected,
    evidence([artifact("output", "result"), artifact("reference", "attachment")]));
  const result = output.edges.find(edge => edge.kind === "artifact-output")!;
  const attachment = output.edges.find(edge => edge.kind === "artifact-association")!;
  assert.equal(result.label, "실행 결과");
  assert.equal(attachment.label, "Run 귀속 참조");
  assert.match(attachment.detail, /실행 입력·인과 의존성 아님/);
  assert.equal(output.edges.some(edge => ["dependency", "record-order", "task-binding"].includes(edge.kind)), false);
  assert.equal(output.nodes.find(node => node.key === result.to)?.status, "observed-reference");
  assert.equal(output.nodes.find(node => node.key === result.to)?.details.some(detail => detail.label === "크기 (bytes)" && detail.value === "12"), true);
});

test("artifact leaves join matching native Run and Session groups without adding Runs", () => {
  const selected = run();
  const output = withArtifactEvidence(base(selected), selected, evidence([artifact("leaf")]));
  const leaf = output.nodes.find(node => node.kind === "artifact")!;
  assert.equal(leaf.runKey, selected.key);
  const groups = nativeFlowGroupDefinitions(output, "session");
  const session = groups.find(group => group.kind === "session")!;
  const runGroup = groups.find(group => group.kind === "run")!;
  assert.equal(runGroup.parentKey, session.key);
  assert.ok(runGroup.memberKeys.includes(leaf.key));
  assert.equal(output.nodes.filter(node => node.kind === "run").length, 1);
});

test("stale, denied, foreign Run and foreign Session scopes add no artifact graph", () => {
  const selected = run(); const baseModel = base(selected); const page = evidence([artifact("x")]);
  for (const [source, scope] of [
    [selected, { ...page, state: "forbidden" as const }],
    [{ ...selected, stale: true }, page],
    [{ ...selected, sourceState: "forbidden" as const }, page],
    [selected, { ...page, runKey: "foreign" }],
    [selected, evidence([{ ...artifact("x"), runId: otherId }])],
    [selected, evidence([{ ...artifact("x"), sessionId: otherId }])],
  ] as Array<[RunView, ArtifactEvidence]>) {
    const input = base(source);
    const output = withArtifactEvidence(input, source, scope);
    assert.deepEqual(output.nodes.filter(node => node.kind === "artifact"), []);
    assert.deepEqual(output.edges.filter(edge => edge.kind.startsWith("artifact-")), []);
    assert.equal(input.nodes.some(node => node.kind === "artifact"), false);
  }
  assert.deepEqual(baseModel, base(run()));
});

test("conflicting duplicate IDs are omitted deterministically", () => {
  const selected = run();
  const rows = [artifact("same"), { ...artifact("same"), filename: "contradiction.txt" }, artifact("good")];
  const output = withArtifactEvidence(base(selected), selected, evidence(rows));
  assert.deepEqual(output.nodes.filter(node => node.kind === "artifact").map(node => node.id), [uuidFromName("good")]);
  assert.deepEqual(output, withArtifactEvidence(base(selected), selected, evidence([...rows].reverse())));
});

test("compatible references upgrade while conflicting node identities remain untouched", () => {
  const selected = run(); const model = base(selected);
  const compatibleId = uuidFromName("known");
  const compatibleKey = missionEntityKey(selected.sourceId, "artifact", compatibleId);
  const compatible = { key: compatibleKey, kind: "artifact", id: compatibleId, label: "Opaque", status: "unobserved",
    description: "Old reference", sourceId: selected.sourceId, details: [], sequences: ["8", "9"] };
  const conflictId = uuidFromName("collision");
  const conflictKey = missionEntityKey(selected.sourceId, "artifact", conflictId);
  const conflict = { key: conflictKey, kind: "artifact", id: conflictId, label: "Actual filename", status: "observed-reference",
    description: "Existing actual metadata", sourceId: selected.sourceId, runKey: "another-run",
    details: [{ label: "SHA-256", value: "b".repeat(64) }, { label: "Run ID", value: otherId }], sequences: [] };
  model.nodes.push(compatible, conflict);
  const output = withArtifactEvidence(model, selected, evidence([artifact("known"), artifact("collision")]));
  const upgraded = output.nodes.find(node => node.key === compatibleKey)!;
  assert.equal(upgraded.runKey, selected.key);
  assert.ok(upgraded.details.some(detail => detail.label === "SHA-256"));
  assert.equal(upgraded.label, "known.txt");
  assert.equal(upgraded.status, "observed-reference");
  assert.match(upgraded.description, /Run 완료나 Task 수용 상태를 뜻하지 않음/);
  assert.deepEqual(upgraded.sequences, []);
  assert.ok(upgraded.details.some(detail => detail.label === "기존 sequence provenance" && detail.value === "8, 9"));
  assert.ok(upgraded.details.some(detail => detail.label === "Source ID" && detail.value === selected.sourceId));
  assert.ok(upgraded.details.some(detail => detail.label === "Run ID" && detail.value === selected.runId));
  assert.ok(upgraded.details.some(detail => detail.label === "Session ID" && detail.value === selected.sessionId));
  assert.deepEqual(output.nodes.find(node => node.key === conflictKey), conflict);
  assert.equal(output.edges.some(edge => edge.to === conflictKey), false);
  assert.equal(output.hiddenNodes, model.hiddenNodes + 1);
  assert.match(output.edges.find(edge => edge.to === compatibleKey)!.detail, /Artifact ID .* · result · Source source · Run .* · Session/);
});

test("malformed filename, hash and representation are rejected before projection", () => {
  const selected = run();
  const valid = artifact("safe");
  const malformed = [
    { ...valid, filename: "../secret.txt" },
    { ...valid, sha256: "not-a-hash" },
    { ...valid, representation: "raw-body" },
  ] as ArtifactMetadata[];
  const output = withArtifactEvidence(base(selected), selected, evidence(malformed));
  assert.equal(output.nodes.some(node => node.kind === "artifact"), false);
  assert.equal(output.edges.some(edge => edge.kind.startsWith("artifact-")), false);
});

test("projection is immutable, bounded, deterministic and preserves base counters", () => {
  const selected = run(); const model = base(selected);
  model.hiddenNodes = 4; model.eventCount = 17; model.incomplete = true;
  const rows = Array.from({ length: 8 }, (_, index) => artifact(`item-${index}`));
  const inputSnapshot = structuredClone({ model, selected, page: evidence(rows) });
  const output = withArtifactEvidence(model, selected, evidence(rows), model.nodes.length + 3);
  assert.deepEqual({ model, selected, page: evidence(rows) }, inputSnapshot);
  assert.ok(output.nodes.length <= model.nodes.length + 3);
  assert.equal(output.hiddenNodes, 9);
  assert.equal(output.eventCount, 17);
  assert.equal(output.incomplete, true);
  assert.deepEqual(output.nodes.slice(0, model.nodes.length), model.nodes);
  assert.deepEqual(output.edges.slice(0, model.edges.length), model.edges);
  const keys = new Set(output.nodes.map(node => node.key));
  assert.ok(output.edges.every(edge => keys.has(edge.from) && keys.has(edge.to)));
  assert.deepEqual(output, withArtifactEvidence(model, selected, evidence([...rows].reverse()), model.nodes.length + 3));
});

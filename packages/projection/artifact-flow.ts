import type { ArtifactEvidence, ArtifactMetadata, RunView } from "../contracts/index.ts";
import { artifactMetadataSchema } from "../contracts/artifacts.ts";
import { missionEntityKey, type MissionEdge, type MissionFlow, type MissionNode } from "./mission-flow.ts";

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value !== null && typeof value === "object") {
    return JSON.stringify(Object.entries(value).sort(([a], [b]) => compare(a, b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Add bounded metadata-only artifact references for the exact selected Run. */
export function withArtifactEvidence(
  model: MissionFlow,
  selected: RunView,
  evidence: ArtifactEvidence | null,
  maxNodes = 240,
): MissionFlow {
  const result = structuredClone(model);
  if (!evidence) return result;
  const scoped = evidence.runKey === selected.key;
  if (!scoped || evidence.state !== "connected" || selected.sourceState !== "connected" || selected.stale) return result;
  result.incomplete = true; // The artifact endpoint is explicitly partial.

  const variants = new Map<string, Map<string, ArtifactMetadata>>();
  for (const candidate of evidence.artifacts) {
    const parsed = artifactMetadataSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const row = parsed.data;
    if (row.runId !== selected.runId || row.sessionId !== selected.sessionId) continue;
    const byValue = variants.get(row.id) ?? new Map<string, ArtifactMetadata>();
    byValue.set(canonical(row), row);
    variants.set(row.id, byValue);
  }
  const rows = [...variants.entries()].filter(([, values]) => values.size === 1)
    .map(([, values]) => values.values().next().value as ArtifactMetadata)
    .sort((a, b) => compare(b.createdAt, a.createdAt) || compare(a.id, b.id))
    .slice(0, 100);
  const nodes = new Map(result.nodes.map(node => [node.key, node]));
  const edges = new Map(result.edges.map(edge => [edge.key, edge]));
  const root = result.nodes.find(node => node.kind === "run" && node.sourceId === selected.sourceId &&
    node.id === selected.runId && node.runKey === selected.key);
  if (!root) return result;
  let omitted = 0;
  for (const row of rows) {
    const key = missionEntityKey(selected.sourceId, "artifact", row.id);
    const existing = nodes.get(key);
    if (existing && (existing.kind !== "artifact" || existing.id !== row.id ||
      existing.sourceId !== selected.sourceId || (existing.runKey && existing.runKey !== selected.key))) {
      omitted++;
      continue;
    }
    const expectedDetails = new Map<string, string>([
      ["Artifact ID", row.id], ["종류", row.kind], ["파일 이름", row.filename],
      ["Media type", row.mediaType], ["크기 (bytes)", String(row.sizeBytes)],
      ["SHA-256", row.sha256], ["표현", row.representation], ["생성 시각", row.createdAt],
      ["Source ID", selected.sourceId], ["Run ID", row.runId], ["Session ID", row.sessionId],
    ]);
    if (existing && existing.details.some(detail => expectedDetails.has(detail.label) &&
      expectedDetails.get(detail.label) !== detail.value)) {
      omitted++;
      continue;
    }
    const kind = row.kind === "result" ? "artifact-output" : "artifact-association";
    const label = row.kind === "result" ? "실행 결과" : "Run 귀속 참조";
    const edgeKey = JSON.stringify([selected.sourceId, root.key, key, kind]);
    const edge = edges.get(edgeKey);
    if (edge && (edge.sourceId !== selected.sourceId || edge.from !== root.key || edge.to !== key || edge.kind !== kind)) {
      omitted++;
      continue;
    }
    if (!existing && result.nodes.length >= Math.max(0, maxNodes)) { omitted++; continue; }
    const node: MissionNode = existing ?? {
      key, kind: "artifact", id: row.id, label: row.filename, status: "observed-reference",
      description: "Run에서 관측한 artifact 메타데이터; Run 완료나 Task 수용 상태를 뜻하지 않음", sourceId: selected.sourceId,
      runKey: selected.key, details: [], sequences: [],
    };
    if (existing && !node.runKey && row.runId === selected.runId && row.sessionId === selected.sessionId) node.runKey = selected.key;
    if (existing && node.sequences.length) {
      const provenance = node.sequences.join(", ");
      if (!node.details.some(detail => detail.label === "기존 sequence provenance" && detail.value === provenance)) {
        node.details.push({ label: "기존 sequence provenance", value: provenance });
      }
      node.sequences = [];
    }
    node.label = row.filename;
    node.status = "observed-reference";
    node.description = "Run에서 관측한 artifact 메타데이터; Run 완료나 Task 수용 상태를 뜻하지 않음";
    const values: Array<[string, string]> = [
      ["Artifact ID", row.id], ["종류", row.kind], ["파일 이름", row.filename],
      ["Media type", row.mediaType], ["크기 (bytes)", String(row.sizeBytes)],
      ["SHA-256", row.sha256], ["표현", row.representation], ["생성 시각", row.createdAt],
      ["Source ID", selected.sourceId], ["Run ID", row.runId], ["Session ID", row.sessionId],
      ["관측 시각", evidence.observedAt], ["Evidence detail", evidence.detail],
      ["Coverage", `최신 메타데이터 최대 100개; partial (scanned=${evidence.scanned}, limit=${evidence.limit})`],
    ];
    for (const [label, value] of values) if (value && !node.details.some(detail => detail.label === label && detail.value === value)) node.details.push({ label, value });
    if (!existing) { result.nodes.push(node); nodes.set(key, node); }
    const detail = `Artifact ID ${row.id} · ${row.kind} · Source ${selected.sourceId} · Run ${row.runId} · Session ${row.sessionId} · 관측 ${evidence.observedAt}${row.kind === "attachment" ? " · 실행 입력·인과 의존성 아님" : ""}`;
    if (edge) {
      edge.label = label;
      edge.detail = detail;
    } else {
      const edge: MissionEdge = { key: edgeKey, from: root.key, to: node.key, kind, label,
        detail, sourceId: selected.sourceId, sequences: [] };
      result.edges.push(edge); edges.set(edgeKey, edge);
    }
  }
  result.hiddenNodes += omitted;
  result.incomplete ||= omitted > 0;
  return result;
}

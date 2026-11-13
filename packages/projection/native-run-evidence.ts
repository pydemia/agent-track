import type { RunView } from "../contracts/index.ts";
import type { NativeEvidenceRecord } from "../contracts/native-run-evidence.ts";
import type { NativeLineageObservation } from "../adapters/demian/lineage.ts";
import { withNativeLineage } from "./lineage-flow.ts";
import { missionEntityKey, type MissionFlow, type MissionNode } from "./mission-flow.ts";

/** Repeated SDK reports replace the same scope; scopes are never added together. */
export function nativeEvidenceSummary(records: readonly NativeEvidenceRecord[]) {
  const models = new Map<string, { model: string; sequence: string }>();
  const usage = new Map<string, { observation: NativeEvidenceRecord["usageObservations"][number]; sequence: string }>();
  for (const record of [...records].sort((a, b) => a.sequence.length - b.sequence.length || a.sequence.localeCompare(b.sequence))) {
    if (record.selectedModel) models.set(record.selectedModel, { model: record.selectedModel, sequence: record.sequence });
    for (const observation of record.usageObservations)
      usage.set(JSON.stringify([observation.scope, observation.source, observation.invocationId ?? null]), { observation, sequence: record.sequence });
  }
  return { models: [...models.values()], usage: [...usage.values()] };
}

export function withNativeRunEvidence(base: MissionFlow, run: RunView, records: readonly NativeEvidenceRecord[], incomplete: boolean, maxNodes = 160): MissionFlow {
  const current = records.filter(record => record.runId === run.runId);
  const rows: NativeLineageObservation[] = current.flatMap(record => record.lineage ? [{
    sequence: record.sequence, observedAt: record.occurredAt, attempt: record.lineage.attempt,
    executor: record.lineage.executor, provider: record.lineage.provider, phase: record.lineage.phase,
    invocationId: record.lineage.invocationId, nativeThreadId: record.lineage.nativeThreadKey,
    nativeTurnId: record.lineage.nativeTurnKey, nativeItemId: record.lineage.nativeItemKey,
  }] : []);
  const model = withNativeLineage(base, run, rows, incomplete, maxNodes);
  const root = model.nodes.find(node => node.kind === "run" && node.runKey === run.key);
  if (!root) return model;
  const summary = nativeEvidenceSummary(current);
  for (const selected of summary.models) root.details.push({ label: `원본 선택 모델 · seq ${selected.sequence}`, value: selected.model });
  for (const { observation, sequence } of summary.usage) root.details.push({ label: `Usage · seq ${sequence}`, value:
    `${observation.scope} / ${observation.coverage} · ${observation.source} · ${JSON.stringify(observation.usage)}` });
  const omitted = new Set<string>();
  const add = (node: MissionNode) => {
    const existing = model.nodes.find(item => item.key === node.key);
    if (existing) return existing;
    if (model.nodes.length >= maxNodes) { omitted.add(node.key); return undefined; }
    model.nodes.push(node); return node;
  };
  const connect = (from: MissionNode, to: MissionNode, kind: string, label: string, sequence: string) => {
    const key = JSON.stringify([run.sourceId, from.key, to.key, kind]);
    let edge = model.edges.find(item => item.key === key);
    if (!edge) { edge = { key, from: from.key, to: to.key, kind, label, sourceId: run.sourceId, sequences: [],
      detail: "동일 Run의 원본 lineage가 명시한 식별자 참조입니다. 실행 순서·의존관계·호출 생명주기를 뜻하지 않습니다." }; model.edges.push(edge); }
    if (!edge.sequences.includes(sequence)) edge.sequences.push(sequence);
  };
  for (const record of current) {
    const lineage = record.lineage; if (!lineage) continue;
    const turn = add({ key: missionEntityKey(run.sourceId, "native-turn", lineage.nativeTurnKey, run.runId), kind: "native-turn",
      id: lineage.nativeTurnKey, sourceId: run.sourceId, runKey: run.key, label: `Native turn · ${lineage.nativeTurnKey.slice(0, 10)}`,
      status: "observed-reference", description: "원본 thread·turn 참조 · SDK 식별자는 출처 범위 hash로 표시합니다.",
      sequences: [], details: [{ label: "Native thread key (hash)", value: lineage.nativeThreadKey },
        { label: "Native turn key (hash)", value: lineage.nativeTurnKey }, { label: "Executor / provider", value: `${lineage.executor} / ${lineage.provider}` }] });
    if (!turn) continue;
    turn.sequences.push(record.sequence);
    turn.details.push({ label: `관측 · seq ${record.sequence}`, value: `${lineage.phase} · ${record.occurredAt} · 시도 ${lineage.attempt}` });
    const invocation = lineage.invocationId && model.nodes.find(node => node.kind === "invocation" && node.sourceId === run.sourceId && node.runKey === run.key && node.id === lineage.invocationId);
    connect(invocation || root, turn, "native-lineage", "Native turn 참조", record.sequence);
    if (!lineage.nativeItemKey) continue;
    const item = add({ key: missionEntityKey(run.sourceId, "native-item", lineage.nativeItemKey, run.runId), kind: "native-item",
      id: lineage.nativeItemKey, sourceId: run.sourceId, runKey: run.key, label: `${lineage.phase} · ${lineage.nativeItemKey.slice(0, 10)}`,
      status: "observed-reference", description: "원본에서 관측한 native item 참조 · 본문과 도구 결과는 포함하지 않습니다.",
      sequences: [], details: [{ label: "Native item key (hash)", value: lineage.nativeItemKey }] });
    if (item) {
      item.sequences.push(record.sequence); item.details.push({ label: `관측 · seq ${record.sequence}`, value: `${lineage.phase} · ${record.occurredAt}` });
      connect(turn, item, "native-item-reference", "Native item 참조", record.sequence);
    }
  }
  model.hiddenNodes += omitted.size; model.incomplete ||= omitted.size > 0;
  return model;
}

import type { RunView } from "../contracts/index.ts";
import type { NativeLineageObservation } from "../adapters/demian/lineage.ts";
import { missionEntityKey, type MissionFlow, type MissionNode } from "./mission-flow.ts";

const ordered = (values: string[]) => [...new Set(values)].sort((a, b) => a.length - b.length || a.localeCompare(b));
/** Exact source/run/item/invocation joins; lineage never supplies an invented parent. */
export function withNativeLineage(base: MissionFlow, run: RunView, rows: NativeLineageObservation[], incomplete = false, maxNodes = 160): MissionFlow {
  const model = structuredClone(base); model.incomplete ||= incomplete;
  const root = model.nodes.find((node) => node.kind === "run" && node.runKey === run.key);
  if (!root) return model;
  const detail = (node: MissionNode, label: string, value: string) => {
    if (!node.details.some((item) => item.label === label && item.value === value)) node.details.push({ label, value });
  };
  const invocations = new Map<string, MissionNode>();
  const omitted = new Set<string>();
  for (const row of rows) if (row.invocationId) {
    let invocation = model.nodes.find((node) => node.kind === "invocation" && node.sourceId === run.sourceId && node.runKey === run.key && node.id === row.invocationId);
    if (!invocation) {
      if (model.nodes.length >= maxNodes) { omitted.add(row.invocationId); continue; }
      invocation = { key: missionEntityKey(run.sourceId, "invocation", row.invocationId, run.runId), kind: "invocation", id: row.invocationId, label: `Native 호출 ${row.invocationId}`,
        status: "observed-reference", description: "원본 native lineage의 호출 참조 · 호출 생명주기 미관측", sourceId: run.sourceId, runKey: run.key, details: [], sequences: [] };
      model.nodes.push(invocation);
    }
    if (["unobserved", "unknown", "observed-reference"].includes(invocation.status)) { invocation.status = "observed-reference"; invocation.description = "원본 native lineage의 호출 참조 · 호출 생명주기 미관측"; }
    invocations.set(row.invocationId, invocation);
    invocation.sequences = ordered([...invocation.sequences, row.sequence]);
    detail(invocation, "Invocation ID", row.invocationId); detail(invocation, "Native thread", row.nativeThreadId); detail(invocation, "Native turn", row.nativeTurnId);
    detail(invocation, "Executor / provider", `${row.executor} / ${row.provider}`); detail(invocation, "시도", String(row.attempt));
    let edge = model.edges.find((item) => item.from === root.key && item.to === invocation!.key && ["event-reference", "native-lineage"].includes(item.kind));
    if (!edge) {
      edge = { key: JSON.stringify([root.key, invocation.key, "native-lineage"]), from: root.key, to: invocation.key,
        kind: "native-lineage", label: "Native 호출 근거", detail: "별도 인가를 거친 원본 lineage의 명시된 invocation ID", sourceId: run.sourceId, sequences: [] };
      model.edges.push(edge);
    }
    edge.kind = "native-lineage"; edge.label = "Native 호출 근거"; edge.detail = "별도 인가를 거친 원본 lineage의 명시된 invocation ID";
    edge.sequences = ordered([...edge.sequences, row.sequence]);
  }
  for (const tool of model.nodes.filter((node) => node.kind === "tool" && node.sourceId === run.sourceId && node.runKey === run.key && node.callId)) {
    const matches = rows.filter((row) => row.nativeItemId === tool.callId && (row.phase === "tool_started" || row.phase === "tool_completed"));
    const identities = new Set(matches.map((row) => JSON.stringify([row.attempt, row.invocationId, row.nativeThreadId, row.nativeTurnId])));
    if (identities.size > 1 || matches.some((row) => tool.invocationId && row.invocationId !== tool.invocationId)) {
      tool.status = "ambiguous"; detail(tool, "Native 연결", "같은 호출 ID의 native 시도·invocation 근거가 모호하거나 다릅니다."); continue;
    }
    const first = matches[0]; if (!first) continue;
    detail(tool, "Native item", first.nativeItemId!); detail(tool, "Native thread", first.nativeThreadId); detail(tool, "Native turn", first.nativeTurnId);
    detail(tool, "Native 시도", String(first.attempt)); detail(tool, "Native phase", [...new Set(matches.map((row) => row.phase))].join(" → "));
    detail(tool, "Native 근거 seq", ordered(matches.map((row) => row.sequence)).join(", "));
    const parent = first.invocationId ? invocations.get(first.invocationId) : undefined;
    if (parent && !tool.invocationId) {
      model.edges = model.edges.filter((edge) => !(edge.kind === "tool-of" && edge.from === root.key && edge.to === tool.key));
      model.edges.push({ key: JSON.stringify([parent.key, tool.key, "native-tool"]), from: parent.key, to: tool.key, kind: "native-tool", label: "Native 도구 호출",
        detail: "동일 Run의 native_item_id와 callId가 정확히 일치", sourceId: run.sourceId, sequences: ordered(matches.map((row) => row.sequence)) });
    }
  }
  model.hiddenNodes += omitted.size; model.incomplete ||= omitted.size > 0;
  return model;
}

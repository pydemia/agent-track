import type { ToolEvidencePage } from "../adapters/demian/tool-evidence.ts";
import { terminalStatuses, type RunView } from "../contracts/index.ts";
import { missionEntityKey, type MissionFlow, type MissionNode } from "./mission-flow.ts";

const order = (values: string[]) => [...new Set(values)].sort((a, b) => a.length - b.length || a.localeCompare(b));
export function withToolEvidence(base: MissionFlow, run: RunView, page: ToolEvidencePage | null, maxNodes = 160): MissionFlow {
  if (!page) return base;
  const model = structuredClone(base); model.incomplete ||= !page.complete;
  const root = model.nodes.find((node) => node.kind === "run" && node.runKey === run.key); if (!root) return model;
  const detail = (node: MissionNode, label: string, value: string) => {
    node.details = node.details.filter((item) => item.label !== label); node.details.push({ label, value });
  };
  for (const call of page.calls) {
    const id = JSON.stringify([call.invocationId, call.callId]); const key = missionEntityKey(run.sourceId, "tool", id, run.runId);
    const marks = [...call.requested, ...call.started, ...call.ended]; const sequences = order(marks.map((mark) => mark.sequence));
    let node = model.nodes.find((value) => value.key === key);
    if (!node) {
      if (model.nodes.length >= maxNodes) { model.hiddenNodes++; model.incomplete = true; continue; }
      node = { key, kind: "tool", id, label: call.tool ?? `도구 ${call.callId}`, status: "unknown", description: "원본 도구 요청과 실행 근거",
        sourceId: run.sourceId, runKey: run.key, callId: call.callId, ...(call.invocationId ? { invocationId: call.invocationId } : {}), details: [], sequences: [] };
      model.nodes.push(node);
    }
    node.sequences = order([...node.sequences, ...sequences]);
    if (node.status === "ambiguous" || call.outcome === "ambiguous") node.status = "ambiguous";
    else if (call.outcome === "failed" || node.status === "failed") node.status = "failed";
    else if (call.outcome === "succeeded" && page.complete) node.status = "succeeded";
    else if (call.ended.length === 1) node.status = "completed";
    else if (call.started.length === 1) node.status = terminalStatuses.has(run.status) ? "unfinished" : "started";
    else node.status = "unknown";
    detail(node, "도구 호출 ID", call.callId); detail(node, "원본 결과", call.outcome === "succeeded" ? "성공 보고 (ok=true)" : call.outcome === "failed" ? "실패 보고" : call.outcome === "ambiguous" ? "근거 충돌" : "결과 성공 여부 미확인");
    // Request timestamps are never substituted for execution start.
    for (const [label, values] of [["요청 관측", call.requested], ["실행 시작 관측", call.started], ["종료 관측", call.ended]] as const) {
      detail(node, label, values.length === 1 ? values[0]!.occurredAt : values.length ? `${values.length}건 · 구간 미확정` : "원본 제공 없음");
    }
    const request = call.requested.length === 1 ? call.requested[0] : undefined;
    const end = call.ended.length === 1 ? call.ended[0] : undefined;
    if (request && end && node.status !== "ambiguous") {
      const ms = Date.parse(end.occurredAt) - Date.parse(request.occurredAt);
      detail(node, "요청→종료 관측 구간", ms >= 0 ? `${ms} ms (대기 포함; 실행 시간과 구별)` : "원본 시각 역행 · 미확정");
      node.description = ms >= 0 ? `요청→종료 ${(ms / 1000).toFixed(2)}초 · ${call.started.length ? "원본 시작 근거 있음" : "실행 시작 미제공"}` : "원본 시각 역행 · 구간 미확정";
    }
    detail(node, "원본 도구 근거 seq", sequences.join(", "));
    if (!page.complete) detail(node, "조회 범위", `부분 조회 · seq ${page.throughSequence}/${page.targetSequence}`);
    const existing = model.edges.find((edge) => edge.to === key && ["tool-of", "native-tool"].includes(edge.kind));
    if (existing) { existing.sequences = order([...existing.sequences, ...sequences]); continue; }
    let owner = root;
    if (call.invocationId) {
      const invocationKey = missionEntityKey(run.sourceId, "invocation", call.invocationId, run.runId);
      const known = model.nodes.find((value) => value.key === invocationKey);
      if (known) owner = known;
      else if (model.nodes.length < maxNodes) {
        owner = { key: invocationKey, kind: "invocation", id: call.invocationId, label: `호출 ${call.invocationId}`, status: "unobserved",
          description: "도구 이벤트의 명시된 호출 참조; 호출 생명주기 미관측", sourceId: run.sourceId, runKey: run.key, details: [{ label: "Invocation ID", value: call.invocationId }], sequences: [] };
        model.nodes.push(owner);
        model.edges.push({ key: JSON.stringify([root.key, owner.key, "tool-reference"]), from: root.key, to: owner.key, kind: "event-reference", label: "호출 참조", detail: "원본 도구 이벤트의 invocationId", sourceId: run.sourceId, sequences });
      } else { model.incomplete = true; model.hiddenNodes++; }
    }
    model.edges.push({ key: JSON.stringify([owner.key, key, "tool-of"]), from: owner.key, to: key, kind: "tool-of", label: owner === root ? "상위 호출 미확인" : "도구 호출",
      detail: owner === root ? "상위 호출 근거 없음 또는 표시 한도" : "원본 tool 이벤트의 명시된 invocationId", sourceId: run.sourceId, sequences });
  }
  return model;
}

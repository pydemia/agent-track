import type { RunView } from "../contracts/index.ts";
import type { ModelRequestEvidence } from "../contracts/model-requests.ts";
import { terminalStatuses } from "../contracts/index.ts";
import { missionEntityKey, missionUnitKind, type MissionFlow, type MissionNode } from "./mission-flow.ts";

type Evidence = ModelRequestEvidence & {
  runKey?: string; complete: boolean; throughSequence: string; targetSequence: string;
};

/** Add bounded source lifecycle observations without changing stored event digests. */
export function withModelRequests(input: MissionFlow, run: RunView, page: Evidence | null, maxNodes = 240): MissionFlow {
  const model = structuredClone(input);
  if (!page || page.runKey !== run.key || page.modelRequestCoverage !== "native-model-lifecycle" ||
      run.sourceState !== "connected" || run.stale) return model;
  model.incomplete ||= !page.complete || Boolean(page.unidentifiedModelEvents) || Boolean(page.omittedModelRequests);
  const root = model.nodes.find(node => node.kind === "run" && node.sourceId === run.sourceId && node.runKey === run.key);
  if (!root) return model;
  for (const request of page.modelRequests ?? []) {
    model.incomplete ||= request.phase === "ambiguous" || request.phase === "end-only" ||
      request.phase === "started" && terminalStatuses.has(run.status);
    if (model.nodes.length >= maxNodes) { model.hiddenNodes++; model.incomplete = true; continue; }
    const key = missionEntityKey(run.sourceId, "model-request", request.id, run.runId);
    const node: MissionNode = { key, kind: "model-request", id: request.id, label: `${request.phase === "end-only" ? "모델 종료 근거" : "모델 요청"} · ${request.model}`,
      status: request.phase === "started" ? terminalStatuses.has(run.status) ? "unfinished" : "started" :
        request.phase === "ended" ? "ended" : request.phase === "ambiguous" ? "ambiguous" : "unknown",
      description: request.phase === "ended" ? "SDK 요청 종료 관측 · 모델 성공·업무 수용과 별도" :
        request.phase === "end-only" ? "종료 이벤트만 관측 · 요청 시작·호출 수 미확인" :
          request.phase === "ambiguous" ? "중첩 또는 누락된 근거 · 시작/종료 대응 미확정" : "모델 요청 시작 관측 · 결과 미확인",
      sourceId: run.sourceId, runKey: run.key, sequences: request.sequences,
      details: [
        { label: "요청 모델", value: request.model }, { label: "요청 Provider profile", value: request.provider },
        { label: "요청 관측", value: request.started?.occurredAt ?? "시작 이벤트 미조회" },
        { label: "종료 관측", value: request.ended?.occurredAt ?? "대응 종료 미확인" },
        { label: "원본 근거 seq", value: request.sequences.join(", ") },
        { label: "범위", value: `seq ${page.throughSequence}/${page.targetSequence} · ${page.complete ? "현재 조회 창" : "부분 조회"}` },
        { label: "식별 기준", value: "Run과 시작 근거 seq의 화면 항목입니다. 원본 provider request ID는 제공되지 않습니다." },
        { label: "토큰·비용", value: "이 요청 단위의 원본 근거 미제공 · Run 합계를 나누어 배분하지 않음" },
      ] };
    if (request.reportedDurationMs !== undefined) node.details.push({ label: "SDK 보고 소요 시간", value: `${request.reportedDurationMs} ms · 성공·도구 실행 시간과 구별` });
    let owner = root;
    if (request.invocationId) {
      node.invocationId = request.invocationId;
      node.details.push({ label: "Invocation ID", value: request.invocationId });
      const parent = model.nodes.find(value => value.sourceId === run.sourceId && value.runKey === run.key &&
        missionUnitKind(value) === "invocation" && value.id === request.invocationId);
      if (parent) owner = parent;
      else node.details.push({ label: "상위 호출", value: "명시된 호출 ID의 생명주기를 현재 흐름에서 확인하지 못함" });
    }
    model.nodes.push(node);
    model.edges.push({ key: JSON.stringify([owner.key, node.key, "model-request"]), from: owner.key, to: node.key,
      kind: "model-request", label: "모델 요청 관측", detail: owner === root ? "원본 Run 범위의 모델 생명주기; 작업 의존·성공 보장 아님" :
        "원본 model 이벤트의 명시된 invocationId; 기록 순서로 호출 소속을 추정하지 않음", sourceId: run.sourceId, sequences: request.sequences });
  }
  const contexts = new Map<string, NonNullable<Evidence["modelRequests"]>>();
  for (const request of page.modelRequests ?? []) {
    if (request.phase !== "ended" || !request.started || !request.ended) continue;
    const list = contexts.get(request.contextKey) ?? []; list.push(request); contexts.set(request.contextKey, list);
  }
  const keys = new Set(model.nodes.map(node => node.key));
  for (const context of contexts.values()) {
    context.sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
    for (let index = 1; index < context.length; index++) {
      const before = context[index - 1]!, after = context[index]!;
      if (BigInt(before.ended!.sequence) >= BigInt(after.started!.sequence)) continue;
      const from = missionEntityKey(run.sourceId, "model-request", before.id, run.runId);
      const to = missionEntityKey(run.sourceId, "model-request", after.id, run.runId);
      if (!keys.has(from) || !keys.has(to)) continue;
      model.edges.push({ key: JSON.stringify([from, to, "record-order"]), from, to, kind: "record-order",
        label: "요청 기록 순서", detail: "같은 원본 실행 문맥에서 관측한 요청의 sequence 순서; 작업 의존·인과 관계 또는 전체 요청 이력 보장 아님",
        sourceId: run.sourceId, sequences: [before.ended!.sequence, after.started!.sequence] });
    }
  }
  return model;
}

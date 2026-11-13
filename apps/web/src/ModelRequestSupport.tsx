import type { ModelRequestEvidence } from "../../../packages/contracts/model-requests.ts";

export function ModelRequestSupport({ evidence, windowComplete }: {
  evidence: ModelRequestEvidence | null;
  windowComplete: boolean | undefined;
}) {
  if (evidence?.modelRequestCoverage !== "native-model-lifecycle") {
    return <p className="graph-legend" aria-label="모델 요청 근거 조회 상태">모델 요청 메타데이터를 아직 확인하지 못했습니다. 요청이 없다는 뜻은 아닙니다.</p>;
  }

  const requests = evidence.modelRequests;
  const started = requests?.filter(request => request.started !== null).length;
  const endOnly = requests?.filter(request => request.phase === "end-only").length;
  const ambiguous = requests?.filter(request => request.phase === "ambiguous").length;
  return <p className="graph-legend" aria-label="모델 요청 근거 요약">
    {requests === undefined ? "모델 요청 목록을 제공하지 않습니다." : `모델 요청 시작 관측 ${started}건 · 종료만 관측 ${endOnly}건 · 모호 ${ambiguous}건. 종료만 관측은 별도 요청 수로 계산하지 않습니다.`}
    {" "}종료 이벤트는 성공 여부를 뜻하지 않습니다.
    {" "}요청 모델과 실제 응답 모델은 구별합니다.
    {windowComplete === false ? " 이벤트 조회 구간이 불완전합니다." : ""}
    {evidence.unidentifiedModelEvents !== undefined ? ` 식별 불가 이벤트 ${evidence.unidentifiedModelEvents}건.` : ""}
    {evidence.omittedModelRequests !== undefined ? ` 표시 한도로 제외된 관측 ${evidence.omittedModelRequests}건.` : ""}
  </p>;
}

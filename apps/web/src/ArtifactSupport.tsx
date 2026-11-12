import type { useArtifactEvidence } from "./useArtifactEvidence.ts";

export function ArtifactSupport({ value }: { value: ReturnType<typeof useArtifactEvidence> }) {
  const page = value.evidence;
  return <details className="flow-raw-evidence"><summary>산출물·첨부 근거 <span>최근 세션 metadata</span></summary>
    <p>{!value.native ? "이 출처는 산출물 metadata 조회를 지원하지 않습니다." : !value.enabled
      ? "현재 원본 접근을 확인하지 못해 산출물과 이전 상세를 숨깁니다." : value.failed
        ? "산출물 metadata를 조회하지 못했습니다. 이전 조회 결과도 표시하지 않습니다." : page?.detail ?? "산출물 metadata 조회 중…"}</p>
    {value.native && <button className="text-button" disabled={!value.enabled || value.loading} onClick={value.refresh}>산출물 다시 조회</button>}
    {page && <p className="graph-legend">{page.state === "connected" ? `실행 결과 ${page.artifacts.filter(item => item.kind === "result").length}개 · 첨부 귀속 ${page.artifacts.filter(item => item.kind === "attachment").length}개 · 최근 세션 목록 ${page.scanned}/${page.limit}개 검사` : "현재 산출물 조회 범위 확인 불가"} · 관측 {new Date(page.observedAt).toLocaleString("ko-KR")}</p>}
    <p className="graph-legend">결과와 첨부 귀속을 구분합니다. 첨부는 실행 입력·의존 관계를 뜻하지 않으며 원문·다운로드·전체 과거 이력은 포함하지 않습니다.</p>
  </details>;
}

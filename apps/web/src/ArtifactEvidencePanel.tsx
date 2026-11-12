import type { RunView } from "../../../packages/contracts/index.ts";
import { useArtifactEvidence } from "./useArtifactEvidence.ts";

export function ArtifactEvidencePanel({ actor, run, onUnauthorized }: { actor: string; run: RunView; onUnauthorized: (reason: string) => void }) {
  const { native, enabled, evidence, loading, failed, refresh } = useArtifactEvidence(actor, run, onUnauthorized);
  return <section className="artifact-evidence" aria-label="Run 산출물 근거"><div className="section-heading"><h3>원본 산출물·첨부</h3>{native && <button className="text-button" disabled={loading || !enabled} onClick={refresh}>다시 조회</button>}</div>
    {!native ? <p className="empty-inline">이 출처는 산출물 metadata 조회를 지원하지 않습니다.</p>
      : !enabled ? <p className="inline-warning">원본 연결을 확인하지 못해 산출물 정보를 숨겼습니다.</p>
      : failed ? <p className="inline-error" role="alert">산출물 metadata를 불러오지 못했습니다. 원본 연결과 접근 권한을 다시 확인해 주세요.</p>
      : !evidence ? <p role="status">산출물 metadata 조회 중…</p>
      : <><p className="graph-legend">{evidence.detail}</p>
        {evidence.state === "connected" && (evidence.artifacts.length ? <ul className="artifact-list">{evidence.artifacts.map((artifact) => <li key={artifact.id}>
          <strong>{artifact.filename}</strong><span>{artifact.kind === "result" ? "실행 결과" : "첨부 귀속 참조 · 실행 입력·의존 관계를 뜻하지 않음"}</span><span>{artifact.mediaType} · {artifact.sizeBytes.toLocaleString("ko-KR")} bytes · {artifact.representation}</span>
          <code>{artifact.id}</code><small>SHA-256 {artifact.sha256}</small><time>{new Date(artifact.createdAt).toLocaleString("ko-KR")}</time>
        </li>)}</ul> : <p className="empty-inline">최근 세션 목록에서 이 Run의 산출물을 찾지 못했습니다. 전체 이력에 산출물이 없다는 뜻은 아닙니다.</p>)}
        <small>조회 {new Date(evidence.observedAt).toLocaleTimeString("ko-KR")} · {evidence.state === "connected" ? `최근 목록 ${evidence.scanned}/${evidence.limit}개 검사` : "조회 결과 확인 불가"} · 원문 저장·다운로드 없음</small></>}
  </section>;
}

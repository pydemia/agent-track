import { useEffect, useState } from "react";
import type { ArtifactEvidence, RunView } from "../../../packages/contracts/index.ts";

export function ArtifactEvidencePanel({ run, onUnauthorized }: { run: RunView; onUnauthorized: (reason: string) => void }) {
  const [evidence, setEvidence] = useState<ArtifactEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const native = run.capabilities.includes("session.link");
  useEffect(() => {
    if (!native || run.sourceState !== "connected") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(run.key)}/artifacts`, { signal: controller.signal });
        if (response.status === 401 || response.status === 403) {
          onUnauthorized("산출물 조회 권한이 해제되어 실행 데이터를 지웠습니다."); return;
        }
        if (!response.ok) throw new Error("Evidence unavailable");
        const body = await response.json() as ArtifactEvidence;
        if (controller.signal.aborted) return;
        if (body.runKey !== run.key || !Array.isArray(body.artifacts)) throw new Error("Evidence identity mismatch");
        setEvidence(body); setError("");
      } catch {
        if (!controller.signal.aborted) { setEvidence(null); setError("산출물 metadata를 불러오지 못했습니다. 원본 연결과 접근 권한을 다시 확인해 주세요."); }
      } finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(() => void load(), 15_000); }
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [run.key, run.sourceState, native, onUnauthorized, refresh]);
  return <section className="artifact-evidence" aria-label="Run 산출물 근거"><div className="section-heading"><h3>원본 산출물</h3>{native && <button className="text-button" disabled={loading || run.sourceState !== "connected"} onClick={() => setRefresh((value) => value + 1)}>다시 조회</button>}</div>
    {!native ? <p className="empty-inline">이 출처는 산출물 metadata 조회를 지원하지 않습니다.</p>
      : run.sourceState !== "connected" ? <p className="inline-warning">원본 연결을 확인하지 못해 산출물 정보를 숨겼습니다.</p>
      : error ? <p className="inline-error" role="alert">{error}</p>
      : !evidence ? <p role="status">산출물 metadata 조회 중…</p>
      : <><p className="graph-legend">{evidence.detail}</p>
        {evidence.state === "connected" && (evidence.artifacts.length ? <ul className="artifact-list">{evidence.artifacts.map((artifact) => <li key={artifact.id}>
          <strong>{artifact.filename}</strong><span>{artifact.mediaType} · {artifact.sizeBytes.toLocaleString("ko-KR")} bytes · {artifact.representation}</span>
          <code>{artifact.id}</code><small>SHA-256 {artifact.sha256}</small><time>{new Date(artifact.createdAt).toLocaleString("ko-KR")}</time>
        </li>)}</ul> : <p className="empty-inline">최근 세션 목록에서 이 Run의 산출물을 찾지 못했습니다. 전체 이력에 산출물이 없다는 뜻은 아닙니다.</p>)}
        <small>조회 {new Date(evidence.observedAt).toLocaleTimeString("ko-KR")} · {evidence.state === "connected" ? `최근 목록 ${evidence.scanned}/${evidence.limit}개 검사` : "조회 결과 확인 불가"} · 원문 저장·다운로드 없음</small></>}
  </section>;
}

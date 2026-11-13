import type { NativeRunEvidenceState } from "./useNativeRunEvidence.ts";
import { nativeEvidenceSummary } from "../../../packages/projection/native-run-evidence.ts";

const scopes = { invocation: "호출", "latest-model-request": "최근 모델 요청", "native-session": "Native session", unknown: "범위 미확인" };
const coverage = { complete: "완전 관측", partial: "부분 관측", unknown: "포괄 범위 미확인" };
const format = (value: number | undefined) => value === undefined ? "미관측" : value.toLocaleString("ko-KR");
export function NativeRunEvidence({ value }: { value: NativeRunEvidenceState }) {
  const summary = nativeEvidenceSummary(value.records);
  return <section className="run-trace" aria-label="Native 실행 상세 근거">
    <div className="section-heading"><div><span className="overline">NATIVE EVIDENCE</span><h3>원본 실행 상세</h3></div><small>{value.records.length}개 이벤트 범위</small></div>
    <p className="graph-legend" role="status">{value.detail}</p>
    {value.page && <>
      <dl className="evidence-summary"><div><dt>선택 모델</dt><dd>{summary.models.length ? summary.models.map(item => `${item.model} (seq ${item.sequence})`).join(" · ") : "미관측"}</dd></div>
        {value.page.timings.map(timing => <div key={timing.kind}><dt>{timing.kind === "queue" ? "Run 대기 구간" : "Run 경과 구간"}</dt><dd>
          {timing.endedAt ? `${(Date.parse(timing.endedAt) - Date.parse(timing.startedAt)).toLocaleString("ko-KR")} ms` : "종료 미관측"}
          <small> {timing.startedAt} → {timing.endedAt ?? "미관측"}</small></dd></div>)}
      </dl>
      <p className="graph-legend">선택 모델은 개별 모델 요청·응답 모델의 증거와 구별합니다. Run 경과 시간은 제공자 연산 시간이 아닙니다. Usage는 같은 범위의 마지막 보고를 표시하며 범위 간 합산하지 않습니다.</p>
      {summary.usage.length > 0 ? <div className="table-wrap"><table className="trace-tools"><caption>관측된 사용량 · 전체 Run 합계 아님</caption>
        <thead><tr><th scope="col">범위 · 출처</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Total</th><th scope="col">관측 범위</th></tr></thead>
        <tbody>{summary.usage.map(({ observation, sequence }) => <tr key={JSON.stringify([observation.scope, observation.source, observation.invocationId])}>
          <td>{scopes[observation.scope]}<small>{observation.source} · seq {sequence}</small>{observation.invocationId && <small>호출 참조 {observation.invocationId}</small>}</td>
          <td>{format(observation.usage.inputTokens)}</td><td>{format(observation.usage.outputTokens)}</td><td>{format(observation.usage.totalTokens)}</td>
          <td>{coverage[observation.coverage]}<small>Cached input {format(observation.usage.cachedInputTokens)} · Reasoning output {format(observation.usage.reasoningOutputTokens)}</small>
            {observation.costUsd !== undefined && <small>원본 보고 비용 USD {observation.costUsd}</small>}</td>
        </tr>)}</tbody></table></div> : <p className="empty-inline">사용량 근거 미관측</p>}
      <details className="flow-raw-evidence"><summary>검증된 산출물 메타데이터 · {value.page.artifacts.length}건</summary>
        {value.page.artifacts.map(artifact => <dl key={artifact.id}><div><dt>{artifact.filename}</dt><dd>{artifact.mediaType} · {artifact.sizeBytes.toLocaleString("ko-KR")} bytes<small>{artifact.createdAt}</small><code>SHA-256 {artifact.sha256}</code></dd></div></dl>)}
        <p className="graph-legend">조회 시 원본 bytes hash를 검증한 메타데이터입니다. 파일 본문은 포함하지 않습니다.{value.page.artifactState === "not-ready" ? " 성공 종료 전 산출물은 미조회 상태입니다." : ""}</p>
      </details>
      {value.hasMore && <p className="inline-warning">1,000개 조회 한도에 도달했습니다. 표시 범위 밖 근거가 남아 있습니다.</p>}
      {value.records.some(record => record.issues.length) && <p className="inline-warning">일부 모델·사용량·lineage 근거가 누락되었거나 검증되지 않았습니다. 완전한 Trace로 해석하지 마세요.</p>}
    </>}
  </section>;
}

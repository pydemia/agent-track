import React, { type ReactElement } from "react";
import type { ContextResult } from "./contracts.ts";

export type ExecutionContextSummaryProps = { result: ContextResult; label?: string };

const statusNames: Record<string, string> = {
  queued: "대기열", leasing: "할당 중", running: "실행 중", waiting_for_permission: "권한 대기", cancelling: "취소 중",
  succeeded: "성공", failed: "실패", cancelled: "취소됨", expired: "만료", interrupted: "중단", unknown: "알 수 없음",
};

export function ExecutionContextSummary({ result, label = "연결된 실행" }: ExecutionContextSummaryProps): ReactElement {
  if (result.state !== "connected" || !result.summary) return <section aria-label={label}>
    <p>{result.state === "forbidden" ? "실행 컨텍스트를 표시할 수 없습니다." : "실행 컨텍스트를 불러오지 못했습니다."}</p>
  </section>;

  const { summary } = result;
  const { coverage } = summary;
  const windowNote = ["관측 구간 · 일부일 수 있음", coverage.capped ? "최대 50개로 제한" : null,
    coverage.unavailable ? "일부 Run을 확인할 수 없음" : null].filter(Boolean).join(" · ");
  const visibleStatuses = Object.entries(summary.counts.byStatus).filter(([status, count]) => count > 0 && status in statusNames);

  return <section aria-label={label}>
    <h2>{label}</h2>
    <p>Run {summary.counts.runs}개 · 세션 {summary.counts.sessions}개</p>
    {visibleStatuses.length > 0 && <p aria-label="Run 상태별 개수">{visibleStatuses.map(([status, count]) =>
      <span key={status}>{statusNames[status]} {count}개 </span>)}</p>}
    <p>{windowNote}</p>
    {summary.context.kind === "task" && summary.task && <section aria-label="원본 업무">
      <h3>원본 업무</h3>
      <p>revision {summary.task.revision} · 상태 {summary.task.state}</p>
      <details><summary>업무 식별자</summary><code>{summary.task.id}</code></details>
      <p>테스트 필요: {summary.task.requiresTest ? "예" : "아니요"}</p>
    </section>}
    {summary.runs.length === 0 ? <p>관측 구간에 표시할 Run이 없습니다.</p> : <ul aria-label="연결된 Run">
      {summary.runs.map((run) => <li key={`${run.sourceId}:${run.runId}`}>
        <span>Run {run.runId.slice(0, 8)} · 세션 {run.sessionId.slice(0, 8)} · 상태 {statusNames[run.status] ?? run.status}</span>{" "}
        <a href={run.url}>Track에서 보기</a>{" "}
        <details><summary>원본 식별자</summary><p>출처 <code>{run.sourceId}</code></p><p>Run <code>{run.runId}</code></p><p>세션 <code>{run.sessionId}</code></p></details>
      </li>)}
    </ul>}
    {summary.trackUrl && <p><a href={summary.trackUrl}>Track에서 컨텍스트 보기</a></p>}
  </section>;
}

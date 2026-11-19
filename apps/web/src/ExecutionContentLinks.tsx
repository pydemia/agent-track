import { useEffect, useState } from "react";
import type { RunView, SourceView } from "../../../packages/contracts/index.ts";
import type { AssistantExecutionView } from "../../../packages/contracts/assistant-view.ts";
import { assistantExecutionOrigin, executionFailureMessage } from "./execution-origin.ts";
import { fetchAssistantExecution, AssistantWebError } from "./assistant-client.ts";
import "./task-content.css";

export function ExecutionContentLinks({ execution, sources }: { execution: AssistantExecutionView; sources: SourceView[] }) {
  const href = assistantExecutionOrigin(sources, execution);
  return <section className="execution-content-links" aria-label="Assistant 대화·응답·실패 상세">
    <h4>대화·응답·실패 상세</h4>
    {execution.native.errorCode && <p className="inline-warning">{executionFailureMessage(execution.native.errorCode)} <code>{execution.native.errorCode}</code></p>}
    {href ? <><a className="source-link" href={href} target="_blank" rel="noreferrer noopener">원본 Assistant 실행·응답 열기 ↗</a>
      <p className="graph-legend">해당 실행의 역할·오류와 결과를 확인합니다. 게시된 결과는 원본 화면의 ‘Note 결과 열기’ 또는 결과 조회에서 읽을 수 있습니다.</p></>
      : <p className="graph-legend">현재 원본 Assistant 링크를 사용할 수 없습니다. 출처 연결과 UI 주소를 확인해 주세요.</p>}
  </section>;
}

export function RunContentLinks({ run, sources, onUnauthorized }: { run: RunView; sources: SourceView[]; onUnauthorized: (reason: string) => void }) {
  const ref = run.assistantAttempt;
  const [result, setResult] = useState<{ stamp: string; execution: AssistantExecutionView } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const source = sources.find(item => item.id === run.sourceId);
  const owner = ref && sources.find(item => item.id === ref.assistantSourceId);
  const allowed = source?.state === "connected" && owner?.state === "connected" &&
    (!source.authorizedRunIds || source.authorizedRunIds.includes(run.runId));
  const stamp = JSON.stringify([run.key, ref, allowed, owner?.uiBaseUrl,
    sources.filter(item => item.kind === "projects").map(item => [item.id, item.state, [...(item.authorizedProjectIds ?? [])].sort()])]);
  useEffect(() => {
    setResult(null); setError("");
    if (!ref || !allowed) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    void fetchAssistantExecution(ref.assistantSourceId, ref.executionId, controller.signal).then(execution => {
      if (controller.signal.aborted) return;
      if (!execution.native.roles.some(role => role.id === ref.roleId)) throw new Error("Role no longer available");
      setResult({ stamp, execution });
    }).catch(reason => {
      if (controller.signal.aborted) return;
      setResult(null); setError("현재 원본 업무 실행을 확인할 수 없습니다.");
      if (reason instanceof AssistantWebError && reason.kind === "unauthorized") onUnauthorized("로그인이 만료되어 원본 실행 링크를 지웠습니다.");
      else timer = setTimeout(() => setRetry(value => value + 1), 15_000);
    });
    return () => { controller.abort(); clearTimeout(timer); };
  }, [stamp, allowed, retry, onUnauthorized]);
  if (!ref) {
    let href: string | null = null;
    try {
      if (source?.state === "connected" && run.sourceUrl) {
        const url = new URL(run.sourceUrl), registered = source.uiBaseUrl && new URL(source.uiBaseUrl);
        if (registered && url.origin === registered.origin && ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) href = url.href;
      }
    } catch { /* Unsupported original UI. */ }
    return <section className="execution-content-links" aria-label="실행 대화·응답 원본"><h4>대화·응답·실패 상세</h4>
      {href ? <><a className="source-link" href={href} target="_blank" rel="noreferrer noopener">원본 세션의 대화·응답 열기 ↗</a><p className="graph-legend">세션 전체로 이동합니다. 선택한 Run 전용 메시지 링크는 원본에서 제공하지 않습니다.</p></>
        : <p className="graph-legend">이 출처는 원본 대화·응답 링크를 제공하지 않습니다.</p>}</section>;
  }
  const execution = allowed && result?.stamp === stamp ? result.execution : null;
  return <section className="execution-content-links" aria-label="선택한 시도의 원본 내용">
    <p>선택한 시도 #{ref.ordinal} · {run.status === "failed" ? "실패" : run.status === "succeeded" ? "성공 종료" : run.status}</p>
    {run.status === "failed" && <p className="inline-warning">{executionFailureMessage(null)}</p>}
    {execution ? <><ExecutionContentLinks execution={execution} sources={sources} /><p className="graph-legend">위 링크는 이 시도의 부모 업무 실행입니다. 원본의 현재 결과에는 이후 재시도·재개의 결과가 포함될 수 있습니다.</p></>
      : <p role="status">{!allowed ? "현재 원본 접근을 확인할 수 없습니다." : error || "원본 업무 실행 링크 확인 중…"}{allowed && error && <button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>원본 링크 다시 확인</button>}</p>}
  </section>;
}

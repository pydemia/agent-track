import type { RunView } from "../../../packages/contracts/index.ts";
import type { ContentText } from "../../../packages/contracts/work-content.ts";
import type { MissionNode } from "../../../packages/projection/mission-flow.ts";
import { runWorkTitle } from "../../../packages/projection/work-content-flow.ts";
import type { useRunContent } from "./useRunContent.ts";
import "./work-content.css";
import { ConversationPanel } from "./ConversationPanel.tsx";

export function ReadableContent({ value }: { value: ContentText }) {
  return <><div className="work-readable" tabIndex={0}>{value.text}</div>{value.truncated && <p className="inline-warning">표시 한도까지 읽은 내용입니다. 전체 본문이 아닙니다.</p>}</>;
}

export function WorkContentPanel({ run, read, node }: { run: RunView; read: ReturnType<typeof useRunContent>; node?: MissionNode }) {
  const content = read.busy ? null : read.value?.content ?? null;
  const tool = node?.kind === "tool";
  const messages = tool ? content?.messages.filter(message => message.role === "tool" && !!node.callId && message.callId === node.callId) ?? [] : content?.messages ?? [];
  const step = node?.kind === "work-step" ? content?.steps.find(item => item.id === node.id) : null;
  return <section className="work-content-panel" aria-label="선택한 업무와 실행 시도 내용">
    <div className="work-content-heading"><small>{read.value?.attempt ? `실행 시도 ${read.value.attempt.ordinal} · ${read.value.attempt.current ? "현재 시도" : "이전 시도"}` : "선택한 실행"}</small>
      <h3>{node && (node.kind.startsWith("work-") || tool) ? node.label : run.binding?.taskTitle || content?.title || runWorkTitle(run)}</h3>
      <button type="button" className="text-button" onClick={read.retry}>내용 다시 확인</button></div>
    {read.busy && <p role="status">현재 권한으로 이 시도의 대화·응답을 읽는 중…</p>}
    {!content && !read.busy && <p role="status">{read.value?.detail || "원본 내용을 확인하지 못했습니다. 이전 본문은 표시하지 않습니다."}</p>}
    {content && <>
      {node && !node.kind.startsWith("work-") && node.kind !== "run" && !tool && <p className="graph-legend">선택한 항목이 속한 실행 시도의 내용입니다. 이 항목만의 응답으로 해석하지 않습니다.</p>}
      {content.incomplete && <p className="inline-warning">일부 기록 또는 본문이 생략된 조회 범위입니다.</p>}
      {tool ? <p className="graph-legend">선택한 도구 호출에 귀속된 본문만 표시합니다. 전체 Run 응답을 도구 결과로 대신하지 않습니다.</p>
        : <><section className="work-reading-section"><h4>업무 목적 · 실행 당시 요청</h4>{content.purpose ? <ReadableContent value={content.purpose} /> : <p>원본에 업무 목적이 기록되지 않았습니다.</p>}</section>
          {step ? <section className="work-reading-section"><h4>선택한 수행 작업</h4><small>원본 보고 상태 · {step.status}</small>{step.detail && <ReadableContent value={step.detail} />}</section>
            : !!content.steps.length && <section className="work-reading-section"><h4>수행 작업</h4><ol className="work-step-list">{content.steps.map(item => <li key={item.id}><strong>{item.title}</strong><small>{item.status}</small></li>)}</ol></section>}
          {content.failure && <section className="work-reading-section work-failure" aria-label="이 시도의 실패 원인"><h4>실패 원인</h4>
            {content.failure.message ? <ReadableContent value={content.failure.message} /> : <p>원본이 상세 오류 메시지를 남기지 않았습니다.</p>}<code>{content.failure.code}</code><small>{content.failure.basis === "native" ? "Native 실행에서 보고" : content.failure.basis === "coordinator" ? "업무 조정자에서 보고" : "원본 로그에서 보고"}</small></section>}
          <section className="work-reading-section"><h4>작업 결과 · 실제 응답</h4>{content.result ? <ReadableContent value={content.result} /> : <p>{content.failure ? "이 시도에서 확인된 응답이 없습니다." : "원본에 응답이 아직 기록되지 않았습니다."}</p>}
            <p className="graph-legend">이 시도의 결과입니다. 실행 종료와 Projects 업무 수용은 별도입니다.</p></section>
          {!!content.acceptanceCriteria.length && <details><summary>실행 당시 수용 기준</summary><ul>{content.acceptanceCriteria.map((value, index) => <li key={index}>{value}</li>)}</ul></details>}
        </>}
      <details className="work-messages" open={tool || node?.kind === "work-request" || node?.kind === "work-response"}><summary>대화·응답 {messages.length}개</summary>
        <p className="graph-legend">{content.coverage === "request-response" ? "이 시도의 요청과 응답입니다. 원본이 제공하지 않는 중간 대화는 포함하지 않습니다." : "선택한 실행에 귀속된 원본 메시지입니다. 내부 추론·시스템 메시지는 포함하지 않습니다."}</p>
        {messages.length ? messages.map(message => <article className="work-message" data-role={message.role} key={message.id}><header><strong>{message.role === "user" ? "요청" : message.role === "assistant" ? "응답" : message.tool || "도구"}</strong>{message.occurredAt && <time>{new Date(message.occurredAt).toLocaleString("ko-KR")}</time>}</header><ReadableContent value={message.text} /></article>)
          : <p>선택 범위에 귀속된 메시지를 원본에서 확인하지 못했습니다.</p>}
      </details>
      <details className="work-identifiers"><summary>출처·식별자</summary><dl><dt>Run</dt><dd>{run.runId}</dd><dt>Session</dt><dd>{run.sessionId}</dd><dt>출처</dt><dd>{run.sourceLabel}</dd><dt>관측</dt><dd>{content.observedAt}</dd></dl></details>
    </>}
    <ConversationPanel run={run} node={node} enabled={run.sourceState === "connected" && !run.stale} />
  </section>;
}

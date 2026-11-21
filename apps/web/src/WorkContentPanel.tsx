import { useContext, useId, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import type { ContentText, WorkContent } from "../../../packages/contracts/work-content.ts";
import type { MissionNode } from "../../../packages/projection/mission-flow.ts";
import { runWorkTitle } from "../../../packages/projection/work-content-flow.ts";
import { conversationMatches } from "../../../packages/projection/conversation-reading.ts";
import type { useRunContent } from "./useRunContent.ts";
import { GroupWorkspaceContext } from "./group-workspace-context.ts";
import { useConversationWindow } from "./useConversationWindow.ts";
import { ConversationPanel, JournalEntry } from "./ConversationPanel.tsx";
import { ReadableText } from "./ReadableText.tsx";
import "./work-content.css";

export function ReadableContent({ value }: { value: ContentText }) {
  return <><ReadableText text={value.text} />{value.truncated && <p className="inline-warning">표시 한도까지 읽은 내용입니다. 전체 본문이 아닙니다.</p>}</>;
}

function RunSummary({ content, node }: { content: WorkContent; node?: MissionNode }) {
  const step = node?.kind === "work-step" ? content.steps.find(item => item.id === node.id) : null;
  return <>
    <section className="work-reading-section"><h4>업무 목적 · 실행 당시 요청</h4>{content.purpose ? <ReadableContent value={content.purpose} /> : <p>원본에 업무 목적이 기록되지 않았습니다.</p>}</section>
    {step ? <section className="work-reading-section"><h4>선택한 수행 작업</h4><small>원본 보고 상태 · {step.status}</small>{step.detail && <ReadableContent value={step.detail} />}</section>
      : !!content.steps.length && <section className="work-reading-section"><h4>수행 작업</h4><ol className="work-step-list">{content.steps.map(item => <li key={item.id}><strong>{item.title}</strong><small>{item.status}</small></li>)}</ol></section>}
    {content.failure && <section className="work-reading-section work-failure" aria-label="이 시도의 실패 원인"><h4>실패 원인</h4>
      {content.failure.message ? <ReadableContent value={content.failure.message} /> : <p>원본이 상세 오류 메시지를 남기지 않았습니다. 구체 원인 미확정.</p>}<code>{content.failure.code}</code><small>{content.failure.basis === "native" ? "Native 실행에서 보고" : content.failure.basis === "coordinator" ? "업무 조정자에서 보고" : "원본 로그에서 보고"}</small></section>}
    <section className="work-reading-section"><h4>작업 결과 · 실제 응답</h4>{content.result ? <ReadableContent value={content.result} /> : <p>{content.failure ? "이 시도에서 확인된 응답이 없습니다." : "원본에 응답이 아직 기록되지 않았습니다."}</p>}
      <p className="graph-legend">실행 종료 · Agent의 보고 · 검증 · Projects 수용은 별도입니다.</p></section>
    {!!content.acceptanceCriteria.length && <details><summary>실행 당시 수용 기준</summary><ul>{content.acceptanceCriteria.map((value, index) => <li key={index}>{value}</li>)}</ul></details>}
  </>;
}

export function WorkContentPanel(props: { run: RunView; read: ReturnType<typeof useRunContent>; node?: MissionNode }) {
  const context = useContext(GroupWorkspaceContext);
  return <ContentReader key={JSON.stringify([context?.actor, props.run.key, props.run.binding, props.run.assistantAttempt, props.node?.key])} {...props} />;
}

function ContentReader({ run, read, node }: { run: RunView; read: ReturnType<typeof useRunContent>; node?: MissionNode }) {
  const context = useContext(GroupWorkspaceContext), id = useId();
  const [tab, setTab] = useState("summary");
  const scoped = node?.kind === "invocation" || node?.kind === "tool";
  const [journalRequested, setJournalRequested] = useState(scoped);
  const selectTab = (next: string) => { setTab(next); if (next !== "summary") setJournalRequested(true); };
  const content = read.value?.content ?? null;
  const journal = useConversationWindow(context?.actor ?? null, run, scoped ? node : undefined, !!content && journalRequested, context?.onUnauthorized ?? ignoreUnauthorized);
  const entries = journal.value?.page?.entries.filter(entry => conversationMatches(entry, node)) ?? [];
  const request = entries.find(entry => entry.kind === "message" && entry.role === "user");
  const latest = entries.filter(entry => entry.kind === "message" && entry.role === "assistant").at(-1);
  return <section className="work-content-panel" aria-label="선택한 업무와 실행 시도 내용">
    <div className="work-content-heading"><small>{read.value?.attempt ? `실행 시도 ${read.value.attempt.ordinal} · ${read.value.attempt.current ? "현재 시도" : "이전 시도"}` : scoped ? "선택한 호출 범위" : "선택한 실행"}</small>
      <h3>{node ? node.label : run.binding?.taskTitle || content?.title || runWorkTitle(run)}</h3>
      <button type="button" className="text-button" onClick={() => { read.retry(); journal.retry(); }}>내용 다시 확인</button></div>
    <div className="work-detail-tabs" role="tablist" aria-label="선택 범위의 상세 보기">{[["summary", "요약"], ["conversation", "대화"], ["tools", "도구"], ["evidence", "근거"]].map(([key, label]) => <button key={key} id={`${id}-${key}`} role="tab" type="button" aria-selected={tab === key} aria-controls={`${id}-${key}-panel`} tabIndex={tab === key ? 0 : -1}
      onKeyDown={event => { const keys = ["summary", "conversation", "tools", "evidence"], index = keys.indexOf(key!); const next = event.key === "ArrowRight" ? keys[(index + 1) % 4] : event.key === "ArrowLeft" ? keys[(index + 3) % 4] : event.key === "Home" ? keys[0] : event.key === "End" ? keys[3] : undefined; if (next) { event.preventDefault(); selectTab(next); document.getElementById(`${id}-${next}`)?.focus(); } }}
      onClick={() => selectTab(key!)}>{label}</button>)}</div>
    <section id={`${id}-summary-panel`} role="tabpanel" aria-labelledby={`${id}-summary`} hidden={tab !== "summary"}>
      {scoped ? <>
        <p className="graph-legend">{node.kind === "tool" ? "이 도구의 호출 입력과 실제 응답입니다." : "이 Agent에 귀속된 요청과 메시지입니다."} 전체 Run의 응답으로 대체하지 않습니다.</p>
        {node.kind === "tool" ? <ConversationPanel read={journal} node={node} kind="tools" /> : <>
          <h4>맡은 업무 · 전달받은 요청</h4>{request ? <JournalEntry entry={request} /> : <p>{journal.busy ? "해당 Agent의 요청을 찾는 중…" : "현재 탐색 범위에 전달받은 요청이 없습니다."}</p>}
          <h4>관측된 Agent 메시지</h4>{latest ? <JournalEntry entry={latest} /> : <p>현재 탐색 범위에 Agent 응답이 없습니다.</p>}
          <p className="inline-warning">최종 응답 미확인. 현재 원본은 진행·최종 구분을 제공하지 않아 마지막 메시지를 최종 결과로 확정하지 않습니다.</p>
          {journal.error && <p role="alert">{journal.error}</p>}
          {journal.value?.page?.next && <button type="button" onClick={journal.more} disabled={journal.busy}>이후 관련 기록 찾기</button>}
        </>}
        {content && <details className="run-context"><summary>전체 실행의 목적·결과 문맥</summary><RunSummary content={content} /></details>}
      </> : <>
        {read.busy && !content && <p role="status">현재 권한으로 이 시도의 본문을 읽는 중…</p>}
        {!content && !read.busy && <p role="status">{read.value?.detail || "원본 내용을 확인하지 못했습니다. 이전 본문은 표시하지 않습니다."}</p>}
        {content && <>{content.incomplete && <p className="inline-warning">일부 기록 또는 본문이 생략된 조회 범위입니다.</p>}<RunSummary content={content} {...(node ? { node } : {})} /></>}
      </>}
    </section>
    <section id={`${id}-conversation-panel`} role="tabpanel" aria-labelledby={`${id}-conversation`} hidden={tab !== "conversation"}>
      <ConversationPanel read={journal} {...(node ? { node } : {})} kind="messages" />
      {!scoped && content?.messages.length && journal.value?.page?.recording !== "messages-v2" ? <details className="work-messages" open><summary>요청·응답 본문 reader · {content.messages.length}개</summary>
        <p className="graph-legend">이 시도의 요청·응답입니다. 당시 미수집한 중간 기록을 복원한 내용이 아닙니다.</p>{content.messages.filter(message => message.role !== "tool").map(message => <article className="work-message" key={message.id}><header>{message.role === "user" ? "요청" : "응답"}</header><ReadableContent value={message.text} /></article>)}</details> : null}
    </section>
    <section id={`${id}-tools-panel`} role="tabpanel" aria-labelledby={`${id}-tools`} hidden={tab !== "tools"}><ConversationPanel read={journal} {...(node ? { node } : {})} kind="tools" /></section>
    <section id={`${id}-evidence-panel`} role="tabpanel" aria-labelledby={`${id}-evidence`} hidden={tab !== "evidence"}>
      <dl><dt>Run</dt><dd>{run.runId}</dd><dt>Session</dt><dd>{run.sessionId}</dd><dt>출처</dt><dd>{run.sourceLabel}</dd><dt>관측</dt><dd>{content?.observedAt ?? "본문 미확인"}</dd></dl>
      {node && <dl>{node.details.map((detail, index) => <div key={index}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}
      <p className="graph-legend">본문은 원본 그대로 보존합니다. 표시 이름·읽기 형식은 원본 업무·상태·관계의 변경이 아닙니다.</p>
    </section>
  </section>;
}
function ignoreUnauthorized() { /* A reader without account context is disabled. */ }

import type { MissionNode } from "../../../packages/projection/mission-flow.ts";
import type { ConversationEntry } from "../../../packages/contracts/conversation.ts";
import { conversationMatches } from "../../../packages/projection/conversation-reading.ts";
import type { useConversationWindow } from "./useConversationWindow.ts";
import { ReadableText } from "./ReadableText.tsx";

export { conversationMatches } from "../../../packages/projection/conversation-reading.ts";
export type ConversationRead = ReturnType<typeof useConversationWindow>;

export function JournalEntry({ entry }: { entry: ConversationEntry }) {
  return <article className="work-message" data-role={entry.role} data-kind={entry.kind}>
    <header><strong>{entry.kind === "tool-call" ? `${entry.tool} · 호출 입력` : entry.kind === "tool-result" ? `${entry.tool} · ${entry.isError ? "오류 응답" : "도구 응답"}` : entry.role === "user" ? "요청" : "Agent 메시지"}</strong>
      <time>{new Date(entry.occurredAt).toLocaleString("ko-KR")}</time></header>
    {entry.observation && <small>{entry.observation.agent} · {entry.observation.parentInvocationId ? "하위 Agent" : "상위 Agent"}</small>}
    {entry.contentSource !== "original" && <p className="inline-warning">{entry.contentSource === "preview" ? "원본이 제공한 미리보기입니다. 전체 응답이 아닙니다." : entry.contentSource === "unavailable" ? "원본 응답이 제공되지 않았습니다." : "과거 기록으로, 전체 원문인지 확인되지 않았습니다."}</p>}
    <ReadableText text={entry.text || "(빈 내용)"} label={entry.kind === "tool-call" ? "도구 입력" : entry.kind === "tool-result" ? "도구 응답" : "대화 본문"}
      format={entry.kind === "tool-call" ? "json" : entry.kind === "tool-result" ? "text" : "markdown"} />
    {(entry.offset > 0 || entry.end < entry.total) && <p className="graph-legend">긴 본문 중 {entry.offset + 1}–{entry.end} / {entry.total}자입니다. 페이지를 이동해 계속 읽을 수 있습니다.</p>}
    <details className="work-identifiers"><summary>호출·기록 출처</summary><dl><dt>저장 순서</dt><dd>{entry.sequence}</dd>{entry.callId && <><dt>도구 호출</dt><dd>{entry.callId}</dd></>}
      {entry.observation && <><dt>Agent 호출</dt><dd>{entry.observation.invocationId}</dd><dt>부모 호출</dt><dd>{entry.observation.parentInvocationId || "없음"}</dd></>}</dl></details>
  </article>;
}

export function ConversationPanel({ read, node, kind = "all" }: { read: ConversationRead; node?: MissionNode; kind?: "all" | "messages" | "tools" }) {
  const page = read.value?.page;
  const scoped = node?.kind === "tool" || node?.kind === "invocation";
  const entries = page?.entries.filter(entry => conversationMatches(entry, node) && (kind === "all" || (kind === "messages" ? entry.kind === "message" : entry.kind !== "message"))) ?? [];
  return <section className="conversation-panel" aria-label="중간 대화·도구 기록">
    <p className="graph-legend">{scoped ? "선택한 호출에 정확히 귀속된 기록입니다." : "선택한 실행 시도의 수집 기록입니다."} 저장 순서는 병렬 작업의 의존 관계를 뜻하지 않습니다.</p>
    <button type="button" className="text-button" disabled={read.busy} onClick={read.reset}>처음부터 다시 확인</button>
    {read.busy && <p role="status">현재 범위에 해당하는 기록을 찾는 중…</p>}
    {read.error && <p role="alert">{read.error}<button type="button" onClick={read.retry}>다시 조회</button></p>}
    {!read.busy && !read.error && !page && <p role="status">{read.value?.detail || "현재 접근 가능한 대화 기록이 없습니다."}</p>}
    {page && <>
      {page.recording === "legacy" && <p className="inline-warning">이전 수집 방식의 기록입니다. 당시 수집하지 않은 중간 대화·도구 응답은 복원할 수 없습니다.</p>}
      {page.incomplete && <p className="graph-legend">부분 기록입니다. 실행 중·실패·중단 또는 원문 미제공 항목이 있을 수 있습니다.</p>}
      {read.searched > 1 && <p className="graph-legend">현재 탐색에서 Run 원장 {read.searched}개 페이지를 확인했습니다.</p>}
      {!entries.length && <p>{page.next ? "확인한 페이지에 해당 범위·종류의 기록이 없습니다. 아직 읽지 않은 기록에서 계속 찾을 수 있습니다." : "현재 조회가 도달한 범위에 해당 종류의 기록이 없습니다. 원본이 미수집한 기록의 존재 여부는 확인할 수 없습니다."}</p>}
      {entries.map(entry => <JournalEntry key={entry.id} entry={entry} />)}
      <nav className="conversation-actions" aria-label="대화 기록 페이지">
        <button type="button" disabled={read.busy || !read.canBack} onClick={read.back}>이전 기록</button>
        <span>탐색 구간 {read.pageNumber}</span>
        <button type="button" disabled={read.busy || !page.next} onClick={read.more}>{scoped ? "이후 관련 기록 찾기" : "다음 기록"}</button>
      </nav>
      {scoped && <p className="graph-legend">원본 v1의 Run 단위 페이지를 매번 인가 후 최대 5페이지씩 탐색합니다. 호출 전용 전체 조회를 지원한다고 해석하지 않습니다.</p>}
    </>}
  </section>;
}

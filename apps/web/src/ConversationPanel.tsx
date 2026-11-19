import { useContext, useEffect, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import type { ConversationEntry, RunConversationView } from "../../../packages/contracts/conversation.ts";
import type { MissionNode } from "../../../packages/projection/mission-flow.ts";
import { GroupWorkspaceContext } from "./group-workspace-context.ts";
import { fetchConversation } from "./conversation-client.ts";
import { PrivateReadError } from "./private-json.ts";

export function conversationMatches(entry: ConversationEntry, node?: MissionNode) {
  if (node?.kind === "tool") return !!node.callId && entry.callId === node.callId &&
    (node.invocationId ? entry.observation?.invocationId === node.invocationId : entry.observation === null);
  if (node?.kind === "invocation") return entry.observation?.invocationId === node.id;
  return true;
}

export function ConversationPanel({ run, node, enabled }: { run: RunView; node?: MissionNode | undefined; enabled: boolean }) {
  const context = useContext(GroupWorkspaceContext);
  const scope = JSON.stringify([context?.actor, run.key, run.runId, run.sessionId, run.workspaceId, run.binding, run.assistantAttempt, run.sourceState, run.stale, enabled]);
  return context?.actor && context.onUnauthorized
    ? <ConversationReader key={scope} run={run} node={node} enabled={enabled && run.sourceState === "connected" && !run.stale} onUnauthorized={context.onUnauthorized} /> : null;
}

function ConversationReader({ run, node, enabled, onUnauthorized }: {
  run: RunView; node?: MissionNode | undefined; enabled: boolean; onUnauthorized: (reason: string) => void;
}) {
  const [open, setOpen] = useState(node?.kind === "tool" || node?.kind === "invocation");
  const [position, setPosition] = useState({ cursor: "0", previous: [] as string[] });
  const [retry, setRetry] = useState(0), [all, setAll] = useState(false);
  const [read, setRead] = useState<{ value: RunConversationView | null; busy: boolean }>({ value: null, busy: false });
  useEffect(() => {
    if (!open || !enabled) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      // Every page is freshly authorized. A failure removes the previous body.
      setRead(previous => ({ value: previous.value, busy: true }));
      try {
        const value = await fetchConversation(run, position.cursor, controller.signal);
        if (!controller.signal.aborted) setRead({ value, busy: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        setRead({ value: null, busy: false });
        if (error instanceof PrivateReadError && error.kind === "unauthorized") onUnauthorized("로그인이 만료되어 대화·도구 기록을 지웠습니다.");
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void load(), 20_000); }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, enabled, position.cursor, retry, onUnauthorized]);
  const page = open && enabled ? read.value?.page : null;
  const scoped = node?.kind === "tool" || node?.kind === "invocation";
  const entries = page?.entries.filter(entry => all || conversationMatches(entry, node)) ?? [];
  const navigate = (cursor: string, previous: string[]) => { setRead({ value: null, busy: true }); setPosition({ cursor, previous }); };
  return <details className="work-messages conversation-panel" open={open} onToggle={event => {
    const next = event.currentTarget.open; setOpen(next); if (!next) setRead({ value: null, busy: false });
  }}>
    <summary>중간 대화 · 도구 호출 · 응답</summary>
    <p className="graph-legend">선택한 실행 시도의 수집 기록입니다. 시간순은 저장 순서이며, 병렬 작업의 의존 관계를 뜻하지 않습니다.</p>
    {!enabled ? <p role="status">현재 실행 시도의 접근 권한을 확인한 뒤 기록을 읽을 수 있습니다.</p> : <>
      <div className="conversation-actions"><button type="button" className="text-button" disabled={read.busy} onClick={() => { navigate("0", []); setRetry(value => value + 1); }}>처음부터 다시 확인</button>
        {scoped && <label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />이 실행의 전체 대화 보기</label>}</div>
      {read.busy && <p role="status">현재 권한으로 기록을 읽는 중…</p>}
      {!read.busy && !page && <p role="status">{read.value?.detail || "대화 기록을 읽지 못했습니다. 다시 확인해 주세요."}</p>}
      {page && <>
        {page.recording === "legacy" && <p className="inline-warning">이 실행은 이전 수집 방식의 기록입니다. 당시 수집하지 않은 중간 대화·도구 응답은 복원할 수 없습니다.</p>}
        {page.incomplete && <p className="graph-legend">부분 기록입니다. 실행 중이거나 실패·중단되었거나, 원문이 제공되지 않은 항목이 있을 수 있습니다.</p>}
        {!entries.length && <p>{scoped && !all ? "현재 페이지에 이 호출과 정확히 연결되는 기록이 없습니다. 다음 페이지나 전체 대화에서 확인하세요." : "현재 페이지에 수집된 메시지가 없습니다."}</p>}
        {entries.map(entry => <article className="work-message" data-role={entry.role} data-kind={entry.kind} key={entry.id}>
          <header><strong>{entry.kind === "tool-call" ? `${entry.tool} · 호출 입력` : entry.kind === "tool-result" ? `${entry.tool} · ${entry.isError ? "오류 응답" : "도구 응답"}` : entry.role === "user" ? "요청" : "Agent 메시지"}</strong>
            <time>{new Date(entry.occurredAt).toLocaleString("ko-KR")}</time></header>
          {entry.observation && <small>{entry.observation.agent} · {entry.observation.parentInvocationId ? "하위 Agent" : "상위 Agent"}</small>}
          {entry.contentSource !== "original" && <p className="inline-warning">{entry.contentSource === "preview" ? "원본이 제공한 미리보기입니다. 전체 응답이 아닙니다." : entry.contentSource === "unavailable" ? "원본 응답이 제공되지 않았습니다." : "과거 기록으로, 전체 원문인지 확인되지 않았습니다."}</p>}
          <div className="work-readable" tabIndex={0}>{entry.text || "(빈 내용)"}</div>
          {(entry.offset > 0 || entry.end < entry.total) && <p className="graph-legend">긴 본문 중 {entry.offset + 1}–{entry.end} / {entry.total}자입니다. 페이지를 이동해 계속 읽을 수 있습니다.</p>}
          <details className="work-identifiers"><summary>호출·기록 출처</summary><dl><dt>저장 순서</dt><dd>{entry.sequence}</dd>{entry.callId && <><dt>도구 호출</dt><dd>{entry.callId}</dd></>}
            {entry.observation && <><dt>Agent 호출</dt><dd>{entry.observation.invocationId}</dd><dt>부모 호출</dt><dd>{entry.observation.parentInvocationId || "없음"}</dd></>}</dl></details>
        </article>)}
        <nav className="conversation-actions" aria-label="대화 기록 페이지">
          <button type="button" disabled={read.busy || !position.previous.length} onClick={() => navigate(position.previous.at(-1)!, position.previous.slice(0, -1))}>이전 기록</button>
          <span>{position.previous.length + 1}페이지</span>
          <button type="button" disabled={read.busy || !page.next} onClick={() => navigate(page.next!, [...position.previous, position.cursor])}>다음 기록</button>
        </nav>
      </>}
    </>}
  </details>;
}

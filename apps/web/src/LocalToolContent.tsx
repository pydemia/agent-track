import type { WorkContent } from "../../../packages/contracts/work-content.ts";
import type { MissionNode } from "../../../packages/projection/mission-flow.ts";
import { ReadableText } from "./ReadableText.tsx";

export function localToolMessages(content: WorkContent, node?: MissionNode) {
  // This reader is scoped to one local turn and has no invocation provenance.
  if (content.coverage !== "local-session-turn" || node?.kind === "invocation" || node?.invocationId) return [];
  return content.messages.filter(message => message.role === "tool" &&
    (node?.kind !== "tool" || !!node.callId && message.callId === node.callId));
}

export function LocalToolContent({ content, node }: { content: WorkContent; node?: MissionNode }) {
  const messages = localToolMessages(content, node);
  return <section className="local-tool-content" aria-label="로컬 실행의 도구 기록">
    <p className="graph-legend">선택한 로컬 실행의 도구 입력·출력 기록입니다. 이 reader는 입력/출력 종류를 별도 표기하지 않습니다. {content.incomplete ? "일부 기록이 생략됐을 수 있습니다." : ""}</p>
    {messages.length ? messages.map(message => <article className="work-message" data-role="tool" key={message.id}>
      <header><strong>{message.tool || "도구"} · 로컬 기록</strong>{message.occurredAt && <time>{new Date(message.occurredAt).toLocaleString("ko-KR")}</time>}</header>
      <ReadableText text={message.text.text} format="text" label="로컬 도구 본문" />
      {message.text.truncated && <p className="inline-warning">본문 reader의 표시 한도까지 읽은 내용입니다.</p>}
      <details><summary>기록 출처</summary><dl><dt>메시지</dt><dd>{message.id}</dd><dt>도구 호출</dt><dd>{message.callId || "미제공"}</dd></dl></details>
    </article>) : <p>이 호출 범위에 정확히 연결할 수 있는 로컬 도구 기록이 없습니다.</p>}
  </section>;
}

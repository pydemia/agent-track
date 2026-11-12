import type { EventView, RunView } from "../../../packages/contracts/index.ts";
import { projectTrace } from "../../../packages/projection/trace.ts";
import { useToolEvidence } from "./useToolEvidence.ts";

const compare = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
export function ActivityTrail({ run, events, hasMore, onTrace, onUnauthorized, scopeSequences }: { run: RunView; events: EventView[]; hasMore: boolean; onTrace: () => void; onUnauthorized: (reason: string) => void; scopeSequences?: ReadonlySet<string> }) {
  const tools = useToolEvidence(run, onUnauthorized);
  const scoped = events.filter((event) => event.sourceId === run.sourceId && event.runId === run.runId);
  const trace = projectTrace(run, scoped); const calls = [...trace.steps.flatMap((step) => step.tools), ...trace.unassigned];
  const grouped = new Set(calls.flatMap((call) => call.sequences));
  const items = calls.map((call) => {
    const native = tools.page?.calls.find((item) => item.callId === call.callId && item.invocationId === call.invocationId);
    const ordered = [...call.sequences].sort(compare); const first = scoped.find((event) => event.sequence === ordered[0]);
    return { key: call.key, sequence: ordered[0] ?? "0", title: `${call.tool ?? "도구 호출"} · ${native?.outcome === "failed" || call.phase === "failed" ? "실패 보고" : native?.outcome === "succeeded" ? "성공 보고" : native?.outcome === "ambiguous" || call.phase === "ambiguous" ? "근거 충돌" : call.phase === "completed" ? "완료 보고 · 성공 여부 미확인" : "종료 미확인"}`,
      detail: `호출 ${call.callId}${call.invocationId ? ` · invocation ${call.invocationId}` : " · 상위 호출 미확인"}`, at: first?.occurredAt ?? call.startedAt ?? call.completedAt,
      evidence: ordered.join(", ") };
  });
  const nativeCalls = (tools.page?.calls ?? []).filter(call => !scopeSequences || [...call.requested, ...call.started, ...call.ended].some(mark => scopeSequences.has(mark.sequence)));
  for (const call of nativeCalls) {
    if (calls.some((known) => known.callId === call.callId && known.invocationId === call.invocationId)) continue;
    const marks = [...call.requested, ...call.started, ...call.ended].sort((a, b) => compare(a.sequence, b.sequence));
    const first = marks[0]; if (!first) continue;
    items.push({ key: `native:${JSON.stringify([call.invocationId, call.callId])}`, sequence: first.sequence,
      title: `${call.tool ?? "도구 호출"} · ${call.outcome === "failed" ? "실패 보고" : call.outcome === "succeeded" ? "성공 보고" : call.outcome === "ambiguous" ? "근거 충돌" : "결과 미확인"}`,
      detail: `원본 도구 조회 · 호출 ${call.callId}${call.invocationId ? ` · invocation ${call.invocationId}` : ""}`, at: first.occurredAt, evidence: marks.map((mark) => mark.sequence).join(", ") });
  }
  for (const event of scoped) {
    if (grouped.has(event.sequence)) continue;
    const title = event.type.includes("permission") ? `승인 · ${event.type.includes("requested") ? "결정 요청" : "원본 상태 변경"}`
      : event.type.includes("handoff") || event.type.startsWith("peer.") ? "세션 인계·연결 근거"
      : event.type.startsWith("goal.") ? "목표 진행 근거"
      : event.type.startsWith("cowork.") ? "협업 상태 변경"
      : event.type.startsWith("agent.invocation.") ? "Agent 호출 상태 변경"
      : event.type.startsWith("artifact.") ? "산출물 근거"
      : event.type.startsWith("workspace.diff") ? "파일 변경 근거"
      : event.type.startsWith("run.") ? "실행 상태 변경" : null;
    if (!title) continue;
    const fields = [event.data.tool, event.data.status, event.data.path, event.data.permissionId, event.data.artifactId, event.data.invocationId].filter(Boolean);
    items.push({ key: event.key, sequence: event.sequence, title, detail: fields.join(" · ") || event.type, at: event.occurredAt, evidence: event.sequence });
  }
  items.sort((a, b) => compare(a.sequence, b.sequence));
  return <section className="activity-trail" aria-label="업무 경과와 실행 흔적"><div className="section-heading"><div><h2>업무 경과와 실행 흔적</h2><p>{run.binding?.taskTitle ?? run.title ?? run.runId}</p></div><button className="text-button" onClick={onTrace}>Trace에서 실행 구조 보기</button></div>
    <p className="graph-legend">무엇이 요청되고 바뀌었는지 시간순으로 확인합니다. 승인·도구의 완료 보고와 업무 검증·수용은 별도입니다.</p>
    {tools.native && <p className="graph-legend">{tools.page ? `원본 도구 결과 ${nativeCalls.length}건${scopeSequences ? " · 선택한 하위 범위와 sequence로 연결된 결과" : ""} · ${tools.page.complete ? "Run 도구 조회 완료" : "부분 조회"}` : tools.detail}</p>}
    {!scopeSequences && !!tools.page?.unidentifiedEvents && <p className="inline-warning">호출 ID가 없어 묶지 못한 원본 도구 이벤트 {tools.page.unidentifiedEvents}건이 있습니다.</p>}
    {(hasMore || run.incomplete) && <p className="inline-warning">아직 읽지 않았거나 수집되지 않은 경과가 있습니다.</p>}
    {items.length ? <ol className="event-list">{items.map((item) => <li key={item.key}><div className="event-marker" aria-hidden="true" /><div className="event-content"><div className="event-title"><strong>{item.title}</strong>{item.at && <time>{new Date(item.at).toLocaleString("ko-KR")}</time>}</div><p>{item.detail}</p><small>근거 seq {item.evidence}</small></div></li>)}</ol> : <p className="empty-inline">이 조회 범위에 작업 경과로 해석할 수 있는 근거가 없습니다. 아래 원본 이벤트의 범위·연결 상태도 확인하세요.</p>}
  </section>;
}

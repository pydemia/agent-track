import type { EventView, RunView } from "../../../packages/contracts/index.ts";
import { projectTrace, type ToolTrace, type TracePhase } from "../../../packages/projection/trace.ts";

const phaseNames: Record<TracePhase, string> = {
  started: "시작 관측 · 종료 미확인", completed: "완료 이벤트 관측", failed: "실패 이벤트 관측", cancelled: "취소 이벤트 관측", unfinished: "Run 종료 · 호출 종료 미확인", unknown: "알 수 없음", ambiguous: "근거 충돌 · 미확정",
};
function clock(value: string | null) { return value ? new Date(value).toLocaleTimeString("ko-KR") : "알 수 없음"; }
function ToolCalls({ tools }: { tools: ToolTrace[] }) {
  if (!tools.length) return <p className="empty-inline">이 단계에 명시적으로 연결된 도구 호출 근거가 없습니다.</p>;
  return <div className="table-wrap"><table className="trace-tools"><caption className="sr-only">관측된 도구 호출과 구간</caption><thead><tr><th scope="col">도구 · 호출 ID</th><th scope="col">관측 상태</th><th scope="col">시작 / 종료</th><th scope="col">관측 구간</th></tr></thead><tbody>{tools.map((tool) => <tr key={tool.key}>
    <td><strong>{tool.tool ?? "도구명 미확인"}</strong><code>{tool.callId}</code>{tool.invocationId && <small>invocation {tool.invocationId}</small>}<small>근거 seq {tool.sequences.join(", ")}</small></td>
    <td>{phaseNames[tool.phase]}</td><td><span>{clock(tool.startedAt)}</span><small>{clock(tool.completedAt)}</small></td>
    <td>{tool.observedIntervalMs === null ? "알 수 없음" : `${tool.observedIntervalMs.toLocaleString("ko-KR")} ms`}</td>
  </tr>)}</tbody></table></div>;
}

export function RunTrace({ run, events, hasMore }: { run: RunView; events: EventView[]; hasMore: boolean }) {
  const trace = projectTrace(run, events);
  return <section className="run-trace" aria-label="Run 단계와 도구 호출"><div className="section-heading"><div><span className="overline">RUN → OBSERVED STEP → TOOL</span><h2>실행 단계와 도구</h2></div><small>{trace.eventCount}개 이벤트 범위</small></div>
    <p className="graph-legend">출처: {run.sourceLabel} · Run {run.runId}. 완료 이벤트는 도구 결과의 검증·업무 수용과 별도입니다. 관측 구간은 같은 출처의 시작·종료 시각 차이입니다.</p>
    {(hasMore || run.incomplete) && <p className="inline-warning">아직 읽지 않았거나 누락된 이력이 있어 단계와 호출이 불완전할 수 있습니다.</p>}
    {trace.steps.length ? trace.steps.map((step) => <section className="trace-step" key={step.id}><h3>Invocation · {step.id}</h3><p>{phaseNames[step.phase]} · 상위 invocation {step.parentId ?? "알 수 없음"}</p><ToolCalls tools={step.tools} /></section>)
      : <p className="empty-inline">현재 정규 이벤트에는 호출 생명주기가 없습니다. 위 Flow의 별도 native lineage 근거와 구별합니다.</p>}
    {(trace.unassigned.length > 0 || !trace.steps.length) && <section className="trace-step"><h3>단계 연결 미확인 도구 호출</h3><p className="graph-legend">호출 생명주기와 연결되지 않은 정규 도구 이벤트입니다. invocation ID가 있어도 생명주기·원본 결과는 별도 확인합니다.</p><ToolCalls tools={trace.unassigned} /></section>}
    {trace.unidentifiedEvents > 0 && <p className="inline-warning">호출 ID가 없어 묶지 못한 도구 이벤트 {trace.unidentifiedEvents}개. 아래 원본 이벤트 목록에서 확인하세요.</p>}
  </section>;
}

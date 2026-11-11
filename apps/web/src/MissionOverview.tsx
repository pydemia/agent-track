import type { RelationView, RunView } from "../../../packages/contracts/index.ts";
import { missionOverview } from "../../../packages/projection/mission-overview.ts";

export function MissionOverview({ runs, relations, selected, onSelect, onMap }: { runs: RunView[]; relations: RelationView[]; selected: string;
  onSelect: (key: string) => void; onMap: (key: string) => void }) {
  const missions = missionOverview(runs, relations);
  const unbound = runs.filter((run) => !run.binding?.taskId).length;
  return <section className="mission-overview" aria-label="업무별 세션과 Agent 실행">
    <div className="section-heading"><div><h2>업무별 실행 조직</h2><p>같은 원본 업무에 연결된 여러 세션·출처의 Run을 함께 봅니다.</p></div><small>{missions.length}개 연결 업무</small></div>
    <p className="graph-legend">업무의 완료·수용 상태는 위 Projects 원본 목록에서 확인합니다. 목표 계층과 업무 간 의존성은 원본 계약 연결 대기입니다.</p>
    {missions.length ? <div className="mission-summary-list">{missions.map((mission) => <article key={mission.key} className="mission-summary">
      <div className="mission-summary-title"><div><small>{mission.project}</small><h3>{mission.title}</h3></div><button className="text-button" onClick={() => onMap(mission.runs.find((run) => run.key === selected)?.key ?? mission.runs[0]!.key)}>협업 Map 열기</button></div>
      <p>{mission.runs.length}개 고유 Run · {mission.sessions}개 세션 · 장치 표기 {mission.devices.length}종 · {mission.sources.join(" / ")}</p>
      <p className="mission-state">실행 중·대기 {mission.active} · 결정 필요 {mission.decisions} · 실패·중단 관측 {mission.failed} · 관측 확인 필요 {mission.uncertain}</p>
      <p className="graph-legend">{mission.childRelations || mission.peerRelations ? `명시된 하위 실행 관계 ${mission.childRelations}건 · peer ${mission.peerRelations}건` : "이 업무에 연결된 하위 실행·peer 관계는 아직 관측되지 않았습니다."}</p>
      <details open={mission.runs.some((run) => run.key === selected)}><summary>연결된 세션·Run 보기</summary><div className="mission-run-list">{mission.runs.map((run) => <button className="flow-list-choice" key={run.key} onClick={() => onSelect(run.key)} aria-pressed={run.key === selected}><strong>{run.title || run.runId}</strong><span>{run.sourceLabel} · {run.device} · Session {run.sessionId} · Run {run.runId}</span></button>)}</div></details>
    </article>)}</div> : <p className="empty-inline">현재 조건에 원본 업무와 연결된 실행이 없습니다. Projects 업무를 선택해 기존 Run과 명시적으로 연결하면 세션을 가로질러 묶입니다.</p>}
    <p className="graph-legend">업무 미연결 Run {unbound}개는 아래 실행 목록에서 확인할 수 있습니다.</p>
  </section>;
}

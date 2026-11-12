import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { RunView, RelationView, SourceView, EventView } from "../../../packages/contracts/index.ts";
import type { AssistantExecutionView } from "../../../packages/contracts/assistant-view.ts";
import type { GroupWorkspaceScope } from "../../../packages/projection/group-workspace-scope.ts";
import { groupTaskKey, isDetailedGroup, type GroupTaskRecord } from "../../../packages/projection/group-workspace-flow.ts";
import { missionFlow } from "../../../packages/projection/mission-flow.ts";
import { fetchGroupTaskMetadata, GroupWorkspaceReadError } from "./group-workspace-client.ts";
import { fetchGroupRunEvents, GroupRunEventsError } from "./group-run-events-client.ts";
import { groupStatusLabel } from "./FlowGrouping.tsx";
import { ActivityTrail } from "./ActivityTrail.tsx";
import { FileEvidencePanel } from "./FileEvidencePanel.tsx";
import { ArtifactEvidencePanel } from "./ArtifactEvidencePanel.tsx";
import { RunControls } from "./RunControls.tsx";
import { RunApprovals } from "./RunApprovals.tsx";
import { AssistantSelectionView } from "./AssistantWorkspace.tsx";
import "./group-workspace.css";

const LazyMissionFlow = lazy(() => import("./MissionFlow.tsx").then(module => ({ default: module.MissionFlow })));
const LazyGroupWorkspaceMap = lazy(() => import("./GroupWorkspaceMap.tsx").then(module => ({ default: module.GroupWorkspaceMap })));
type Mode = "track" | "trail" | "trace" | "map";
type Props = { actor: string; scope: GroupWorkspaceScope; runs: RunView[]; executions: AssistantExecutionView[];
  sources: SourceView[]; relations: RelationView[]; mode: Mode; onClose: () => void; onUnavailable: () => void; onUnauthorized: (reason: string) => void;
  onView: (mode: Mode) => void; onTaskMap: (sourceId: string, projectId: string, taskId: string) => void };
const assistantKey = (source: string, id: string) => JSON.stringify(["assistant", source, id]);

export function GroupWorkspace({ actor, scope, runs, executions, sources, relations, mode, onClose, onUnavailable, onUnauthorized, onView, onTaskMap }: Props) {
  const [tasks, setTasks] = useState<{ stamp: string; records: GroupTaskRecord[]; error: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [limit, setLimit] = useState(20);
  const [lane, setLane] = useState<string | null>(() => runs.length === 1 ? runs[0]!.key : executions.length === 1 ? assistantKey(executions[0]!.sourceId, executions[0]!.native.id) : null);
  const laneButtons = useRef(new Map<string, HTMLButtonElement>()), pendingFocus = useRef<string | null>(null);
  const stamp = JSON.stringify([actor, scope.taskRefs]);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      const cycle = new AbortController(), cancel = () => cycle.abort();
      controller.signal.addEventListener("abort", cancel, { once: true });
      const jobs: Promise<void>[] = [];
      try {
        const records: GroupTaskRecord[] = []; const queue = [...scope.taskRefs];
        const worker = async () => { for (;;) { const ref = queue.shift(); if (!ref || cycle.signal.aborted) return;
          const task = await fetchGroupTaskMetadata(ref, actor, cycle.signal); records.push({ ref, task }); } };
        jobs.push(...Array.from({ length: Math.min(4, queue.length) }, worker));
        await Promise.all(jobs);
        if (!controller.signal.aborted) {
          const byKey = new Map(records.map(record => [groupTaskKey(record.ref), record]));
          setTasks({ stamp, records: scope.taskRefs.map(ref => byKey.get(groupTaskKey(ref))!), error: false });
        }
      } catch (error) {
        cycle.abort(); await Promise.allSettled(jobs);
        if (controller.signal.aborted) return;
        setTasks({ stamp, records: [], error: true });
        if (error instanceof GroupWorkspaceReadError && error.kind === "unauthorized") onUnauthorized("묶음의 업무 조회 권한이 해제되어 데이터를 지웠습니다.");
        else if (error instanceof GroupWorkspaceReadError && error.kind === "unavailable") onUnavailable();
      } finally { controller.signal.removeEventListener("abort", cancel); if (!controller.signal.aborted) timer = setTimeout(() => void load(), 15000); }
    }
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [stamp, retry, onUnauthorized, onUnavailable]);
  const records = tasks?.stamp === stamp && !tasks.error ? tasks.records : null;
  const detailed = isDetailedGroup(scope.kind);
  const chooseRun = (key: string) => { if (runs.some(run => run.key === key)) { pendingFocus.current = key; setLane(key); } };
  const chooseAssistant = (source: string, id: string) => { if (executions.some(view => view.sourceId === source && view.native.id === id)) { const key = assistantKey(source, id); pendingFocus.current = key; setLane(key); } };
  useEffect(() => { if (pendingFocus.current === lane && lane) { const button = laneButtons.current.get(lane); button?.focus(); button?.scrollIntoView({ block: "nearest" }); pendingFocus.current = null; } }, [lane]);
  if (!records) return <section className="group-workspace" aria-label="묶음의 현재 업무 확인">
    <h2>{tasks?.error ? "묶음의 업무 원본을 확인하지 못했습니다" : "묶음의 현재 접근 범위를 확인하는 중…"}</h2>
    <p>이전 업무 이름과 이력은 표시하지 않습니다.</p>{tasks?.error && <button type="button" onClick={() => setRetry(value => value + 1)}>다시 확인</button>}
    <button type="button" onClick={onClose}>묶음 범위 해제</button></section>;
  const title = scope.basis === "view" ? scope.label : scope.kind === "task" && records.length === 1 ? records[0]!.task.title : "선택한 실행 묶음";
  return <section className="group-workspace" aria-label="네 보기의 공통 묶음 범위">
    <div className="section-heading"><div><small>{scope.basis === "view" ? "화면 묶음" : "원본·명시 연결 범위"}</small><h2>{title}</h2>
      <p>업무 {records.length}개 · 고유 Run {runs.length}개 · Assistant 실행 {executions.length}개</p></div><button type="button" className="button-secondary" onClick={onClose}>묶음 범위 해제</button></div>
    <p className="graph-legend">상단 Track·Trail·Trace·Map을 전환해도 같은 구성원을 유지합니다. 현재 접속의 선택이며 새로고침 시 저장되지 않습니다. 업무 수용과 실행 종료는 별도로 읽습니다.</p>
    {records.length > 0 && <section aria-label="묶음의 현재 원본 업무"><h3>현재 원본 업무</h3><div className="group-task-list">{records.slice(0, limit).map(({ ref, task }) => <div key={groupTaskKey(ref)}>
      <strong>{task.title}</strong><span>{groupStatusLabel("task", task.state)} · revision {task.revision}</span><small>{ref.sourceId} · Task {task.id}</small></div>)}</div>
      {records.length > limit && <button type="button" onClick={() => setLimit(value => value + 20)}>업무 더 보기</button>}</section>}
    {mode === "map" && !detailed && <Suspense fallback={<p role="status">묶음 연결 구조를 불러오는 중…</p>}><LazyGroupWorkspaceMap tasks={records} runs={runs} executions={executions} sources={sources} relations={relations}
      onRun={chooseRun} onAssistant={chooseAssistant} onUnavailable={onUnavailable} onUnauthorized={onUnauthorized} onTaskMap={onTaskMap} /></Suspense>}
    <section className="group-execution-lanes" aria-label="묶음의 실행별 흐름"><h3>{mode === "track" ? "참여 실행과 상태" : "실행별 흐름 비교"}</h3>
      <p className="graph-legend">각 실행의 sequence·시간·호출은 독립입니다. 실행을 펼쳐 읽으며 서로 다른 실행의 시각을 하나의 인과 순서로 합치지 않습니다.</p>
      {!runs.length && !executions.length && <p className="empty-inline">현재 묶음에서 확인된 실행이 없습니다. 실행 미관측은 업무 완료를 뜻하지 않습니다.</p>}
      {runs.slice(0, limit).map(run => <article className="group-execution-lane" key={run.key}><button type="button" className="group-lane-toggle" aria-expanded={lane === run.key}
        ref={element => { if (element) laneButtons.current.set(run.key, element); else laneButtons.current.delete(run.key); }}
        onClick={() => setLane(current => current === run.key ? null : run.key)}><strong>{run.title || run.runId}</strong><span>{groupStatusLabel("run", run.status)} · {run.sourceLabel} · {run.device}</span><small>Run {run.runId} · Session {run.sessionId}</small></button>
        {lane === run.key && mode === "track" && <div className="group-lane-detail"><p>{run.stale ? "마지막 관측 · 원본 상태 재확인 필요" : "현재 수집된 실행 상태"} · {groupStatusLabel("run", run.status)}</p>
          <button type="button" onClick={() => onView("trace")}>같은 묶음의 Trace에서 보기</button><RunControls run={run} onUnauthorized={onUnauthorized} /><RunApprovals run={run} onUnauthorized={onUnauthorized} /></div>}
        {lane === run.key && mode !== "track" && <RunEvidenceLane key={JSON.stringify([actor, run.key])} actor={actor} run={run} runs={runs} relations={relations} mode={mode}
          {...(detailed && !scope.runRefs.find(ref => ref.key === run.key)?.assistantLinks?.length ? { scopeNodeKeys: scope.nodeKeys } : {})}
          relatedRoleRun={detailed && !!scope.runRefs.find(ref => ref.key === run.key)?.assistantLinks?.length}
          onSelectRun={chooseRun} onUnavailable={onUnavailable} onUnauthorized={onUnauthorized} onView={onView} />}</article>)}
      {executions.slice(0, limit).map(view => { const key = assistantKey(view.sourceId, view.native.id); return <article className="group-execution-lane" key={key}>
        <button type="button" className="group-lane-toggle" aria-expanded={lane === key} ref={element => { if (element) laneButtons.current.set(key, element); else laneButtons.current.delete(key); }} onClick={() => setLane(current => current === key ? null : key)}><strong>Assistant · {view.currentTask?.task.title ?? view.native.id}</strong><span>{groupStatusLabel("assistant-execution", view.native.state)} · 역할 {view.native.roles.length}개</span><small>{view.sourceId} · Execution {view.native.id}</small></button>
        {lane === key && <AssistantSelectionView mode={mode} initial={view} sources={sources} runs={runs} onSelect={selection => { if (selection) chooseAssistant(selection.sourceId, selection.executionId); }}
          onSelectRun={chooseRun} onTaskMap={onTaskMap} taskMapLabel="업무 의존 Map으로 이동 · 묶음 범위 해제" onUnavailable={onUnavailable} onUnauthorized={onUnauthorized} {...(detailed ? { scopeNodeKeys: scope.nodeKeys } : {})} />}</article>; })}
      {runs.length > limit || executions.length > limit ? <button type="button" onClick={() => setLimit(value => value + 20)}>참여 실행 더 보기</button> : null}
    </section>
  </section>;
}

function RunEvidenceLane({ actor, run, runs, relations, mode, scopeNodeKeys, relatedRoleRun, onSelectRun, onUnavailable, onUnauthorized, onView }: {
  actor: string; run: RunView; runs: RunView[]; relations: RelationView[]; mode: Mode; scopeNodeKeys?: readonly string[];
  onSelectRun: (key: string) => void; onUnavailable: () => void; onUnauthorized: (reason: string) => void;
  onView: (mode: Mode) => void;
  relatedRoleRun: boolean;
}) {
  const [page, setPage] = useState<{ events: EventView[]; cursor: string; more: boolean }>({ events: [], cursor: "0", more: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [request, setRequest] = useState({ serial: 0, after: null as string | null });
  const highWater = useRef(run.highWater), pendingTail = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(false);
    void fetchGroupRunEvents(run, request.after, controller.signal).then(result => {
      if (!controller.signal.aborted) setPage(previous => ({ events: request.after === null ? result.events : [...previous.events, ...result.events].slice(0, 2000), cursor: result.nextCursor,
        more: result.hasMore || (request.after !== null && page.events.length + result.events.length > 2000) }));
    }).catch(reason => {
      if (controller.signal.aborted) return;
      setPage({ events: [], cursor: "0", more: false }); setError(true);
      if (reason instanceof GroupRunEventsError && reason.kind === "unauthorized") onUnauthorized("묶음의 실행 조회 권한이 해제되어 데이터를 지웠습니다.");
      else if (reason instanceof GroupRunEventsError && reason.kind === "unavailable") onUnavailable();
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [actor, run.key, request, onUnavailable, onUnauthorized]);
  useEffect(() => {
    if (highWater.current !== run.highWater) { highWater.current = run.highWater; pendingTail.current = true; }
    if (pendingTail.current && !busy && !page.more && !error) {
      pendingTail.current = false; setRequest(previous => ({ serial: previous.serial + 1, after: page.cursor }));
    }
  }, [run.highWater, busy, page.more, page.cursor, error]);
  const sequences = useMemo(() => {
    if (!scopeNodeKeys) return null;
    const keys = new Set(scopeNodeKeys), model = missionFlow(run, runs, relations, page.events, { mode: "execution", includeExecution: true, maxNodes: 2000 });
    return new Set(model.nodes.filter(node => keys.has(node.key)).flatMap(node => node.sequences));
  }, [run, runs, relations, page.events, scopeNodeKeys]);
  const selectedEvents = sequences ? page.events.filter(event => sequences.has(event.sequence)) : page.events;
  return <div className="group-lane-detail">
    {relatedRoleRun && <p className="graph-legend">선택한 역할에 명시적으로 연결된 Run의 전체 실행 근거입니다. 역할 묶음의 시각적 소속과 구분한 실행 문맥이며, 원본에서 역할별로 더 나눌 수는 없습니다.</p>}
    <p className="graph-legend">현재 원장 {page.events.length}개{scopeNodeKeys ? ` · 선택한 하위 항목과 연결된 근거 ${selectedEvents.length}개` : ""}{busy ? " · 조회 중…" : ""}{page.more ? " · 추가 근거 있음" : ""}</p>
    {error && <p role="alert">이 실행의 현재 근거를 확인하지 못해 이전 이력을 지웠습니다.<button type="button" onClick={() => setRequest(previous => ({ serial: previous.serial + 1, after: null }))}>다시 조회</button></p>}
    {mode === "trail" ? <><ActivityTrail run={run} events={selectedEvents} hasMore={page.more} onUnauthorized={onUnauthorized} onTrace={() => onView("trace")}
      {...(sequences ? { scopeSequences: sequences } : {})} />{!scopeNodeKeys && <><FileEvidencePanel run={run} onUnauthorized={onUnauthorized} /><ArtifactEvidencePanel actor={actor} run={run} onUnauthorized={onUnauthorized} /></>}
      {scopeNodeKeys && <p className="graph-legend">파일·산출물의 하위 호출별 귀속은 현재 계약에 없어 전체 Run의 결과로 채우지 않습니다.</p>}</>
      : <Suspense fallback={<p role="status">실행 흐름을 불러오는 중…</p>}><LazyMissionFlow actor={actor} run={run} runs={runs} relations={relations} events={page.events}
        mode={mode === "trace" ? "execution" : "mission"} hasMore={page.more} onSelectRun={onSelectRun} onUnauthorized={onUnauthorized} {...(scopeNodeKeys ? { scopeNodeKeys } : {})} /></Suspense>}
    {page.more && <button type="button" disabled={busy || page.events.length >= 2000} onClick={() => setRequest(previous => ({ serial: previous.serial + 1, after: page.cursor }))}>이 실행의 근거 더 읽기</button>}
    {page.more && page.events.length >= 2000 && <p>현재 실행의 2,000개 원장 근거 한도에 도달했습니다.</p>}
    <details className="flow-raw-evidence"><summary>선택 범위의 정규 이벤트 근거</summary><ol>{selectedEvents.map(event => <li key={event.key}>seq {event.sequence} · {event.type}</li>)}</ol></details>
  </div>;
}

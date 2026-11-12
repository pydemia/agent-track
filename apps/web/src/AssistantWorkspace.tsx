import { useEffect, useMemo, useState } from "react";
import { MarkerType, type NodeChange, type EdgeChange } from "@xyflow/react";
import type { SourceView, RunView } from "../../../packages/contracts/index.ts";
import type { AssistantExecutionView } from "../../../packages/contracts/assistant-view.ts";
import type { AssistantExecutionEvent } from "../../../packages/contracts/assistant.ts";
import { assistantFlow, authorizedAssistantLinks } from "../../../packages/projection/assistant-flow.ts";
import { FlowCanvas, type FlowNode, type FlowEdge } from "./ui/flow-canvas.tsx";
import { layoutGroupedFlow } from "./flow-group-layout.ts";
import { useFlowGrouping, FlowGroupControls, FlowGroupInspector, FlowGroupEdgeEvidence } from "./FlowGrouping.tsx";
import { AssistantWebError, fetchAssistantExecution, fetchAssistantEvents } from "./assistant-client.ts";
import { assistantMatches, type useAssistantExecutions } from "./useAssistantExecutions.ts";
import "@xyflow/react/dist/style.css";
import "./ui/flow-canvas.css";
import "./mission-flow.css";
import "./assistant-workspace.css";

export interface AssistantSelection { sourceId: string; executionId: string }
const states: Record<string, string> = { registering: "등록 중", queued: "대기", pending: "대기", preparing: "준비 중", running: "실행 중",
  publishing: "게시 처리 중", linking: "연결 처리 중", completed: "완료 관측", failed: "실패", cancelling: "취소 중", cancelled: "취소",
  reconciliation_required: "확인 필요", awaiting_connection: "연결 대기", awaiting_runtime: "Runtime 대기", interrupted: "중단",
  observed: "참조 관측", todo: "할 일", in_progress: "진행", in_review: "검토", done: "원본 완료", succeeded: "성공 종료",
  waiting_for_permission: "승인 대기", leasing: "할당 중", expired: "만료" };
const kinds: Record<string, string> = { task: "Projects 업무", "assistant-execution": "Assistant 실행", "assistant-role": "원본 역할",
  "assistant-runtime-task": "Runtime Task 참조", "assistant-thread": "Thread 참조", "assistant-turn": "Turn 참조", run: "Demian Run", session: "Session" };
const time = (value: string) => new Date(value).toLocaleString("ko-KR");
const selectedKey = (selection: AssistantSelection | null) => selection ? JSON.stringify([selection.sourceId, selection.executionId]) : "";

export function AssistantWorkspace({ mode, sources, runs = [], collection, selection, onSelect, filters, onTaskMap, onSelectRun, onUnauthorized }: {
  mode: "track" | "trail" | "trace" | "map"; sources: SourceView[];
  collection: ReturnType<typeof useAssistantExecutions>; selection: AssistantSelection | null;
  onSelect: (selection: AssistantSelection | null) => void;
  filters: { source: string; project: string; status: string; q: string };
  onTaskMap: (sourceId: string, projectId: string, taskId: string) => void;
  onUnauthorized: (reason: string) => void;
  runs?: RunView[];
  onSelectRun?: (key: string) => void;
}) {
  const configured = sources.filter(source => source.kind === "assistant" && source.state !== "unsupported" && (!filters.source || source.id === filters.source));
  const visible = collection.executions.filter(view => assistantMatches(view, filters));
  const chosen = visible.find(view => selectedKey(selection) === JSON.stringify([view.sourceId, view.native.id]));
  if (!configured.length) return null;
  return <section className="assistant-workspace" aria-label="Assistant 원본 업무 실행">
    <div className="section-heading"><div><h2>Assistant 업무 실행</h2><p>WorkExecution·역할·Runtime 참조를 원본 식별자로 연결합니다. Demian Run 수에 합산하지 않습니다.</p></div>
      <button className="text-button" onClick={collection.refresh}>원본 다시 조회</button></div>
    <p className="graph-legend">현재 조회 창 · 최대 출처별 {collection.maxPages * 50}개 · 15초마다 확인 · 실행 완료와 Projects 업무 수용은 별도입니다.</p>
    {configured.map(source => {
      const window = collection.windows.find(item => item.sourceId === source.id);
      const last = window?.pages.at(-1);
      return <div className="assistant-window-status" key={source.id} role="status"><strong>{source.label}</strong>
        <span>{window?.error || (window?.status === "loading" ? "원본 확인 중 · 표시된 값은 마지막 관측" : last ? `관측 ${time(last.observedAt)} · 원본 범위에 따라 제외 ${window!.pages.reduce((n, page) => n + page.omitted, 0)}개` : "현재 읽기 권한 확인 중")}</span>
        {last?.hasMore && window!.pages.length < collection.maxPages && <button className="text-button" disabled={window?.status === "loading"} onClick={() => collection.loadMore(source.id)}>다음 조회 창</button>}
        {last?.hasMore && window!.pages.length >= collection.maxPages && <span>표시 한도에 도달했습니다. 전체 이력이라는 뜻은 아닙니다.</span>}</div>;
    })}
    {visible.length ? <div className="table-wrap"><table><caption className="sr-only">현재 허용된 Assistant 실행</caption><thead><tr><th>업무 · 원본 실행</th><th>Assistant 상태</th><th>현재 업무 상태</th><th>역할</th><th>갱신</th></tr></thead>
      <tbody>{visible.map(view => <tr key={JSON.stringify([view.sourceId, view.native.id])} className={chosen === view ? "selected-row" : ""}>
        <td><button className="run-select" aria-pressed={chosen === view} onClick={() => onSelect({ sourceId: view.sourceId, executionId: view.native.id })}><strong>{view.currentTask?.task.title ?? `업무 미연결 · ${view.native.instructionId.slice(0, 8)}`}</strong><small>{view.sourceLabel} · WorkExecution {view.native.id}</small></button></td>
        <td>{states[view.native.state] ?? view.native.state}</td><td>{view.currentTask ? `${states[view.currentTask.task.state] ?? view.currentTask.task.state} · r${view.currentTask.task.revision}` : "원본 업무 연결 없음"}</td>
        <td>{view.native.roles.length}개{view.demianLinks && <small>Demian 실행 연결 {authorizedAssistantLinks(view, sources, runs).length}개</small>}</td><td>{time(view.native.updatedAt)}</td></tr>)}</tbody></table></div>
      : <p className="empty-inline" role="status">현재 허용된 조회 창과 필터에 표시할 Assistant 실행이 없습니다. 전체 이력에 실행이 없다는 뜻은 아닙니다.</p>}
    {chosen ? <AssistantSelectionView key={JSON.stringify([selectedKey(selection), chosen.demianLinks?.state,
      chosen.demianLinks?.links.map(link => [link.roleId, link.sourceId, link.runKey, link.sessionId, link.workspaceId, link.operationId])])} mode={mode} initial={chosen} sources={sources} runs={runs}
      onSelect={onSelect} onTaskMap={onTaskMap} {...(onSelectRun ? { onSelectRun } : {})} onUnauthorized={onUnauthorized} onUnavailable={() => { collection.invalidateSource(chosen.sourceId); onSelect(null); }} />
      : (mode === "map" && visible.length > 0 ? <AssistantFlowMap entries={visible} sources={sources} runs={runs} onSelect={onSelect} onTaskMap={onTaskMap} {...(onSelectRun ? { onSelectRun } : {})} />
        : <p className="graph-legend">실행을 선택하면 {mode === "trail" ? "원본 상태 이력" : mode === "trace" ? "역할·시간·상태 Trace" : "역할과 연결 구조"}를 볼 수 있습니다.</p>)}
  </section>;
}

function AssistantSelectionView({ mode, initial, sources, runs, onSelect, onTaskMap, onSelectRun, onUnauthorized, onUnavailable }: {
  mode: "track" | "trail" | "trace" | "map"; initial: AssistantExecutionView; sources: SourceView[];
  onSelect: (selection: AssistantSelection | null) => void; onTaskMap: (sourceId: string, projectId: string, taskId: string) => void;
  onUnauthorized: (reason: string) => void; onUnavailable: () => void;
  runs: RunView[]; onSelectRun?: (key: string) => void;
}) {
  const [detail, setDetail] = useState<AssistantExecutionView | null>(null);
  const [events, setEvents] = useState<AssistantExecutionEvent[]>([]);
  const [cursor, setCursor] = useState("0");
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [more, setMore] = useState(0);
  const showEvents = mode === "trail" || mode === "trace";
  const nativeLinks = detail ? authorizedAssistantLinks(detail, sources, runs) : [];
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setDetail(null); setEvents([]); setCursor("0"); setHasMore(false); setError(""); setMore(0);
    async function load() {
      try {
        if (showEvents) {
          const result = await fetchAssistantEvents(initial.sourceId, initial.native.id, "0", controller.signal);
          if (!controller.signal.aborted) { setDetail(result.execution); setEvents(result.page.events); setCursor(result.page.cursor); setHasMore(result.page.hasMore); }
        } else {
          const result = await fetchAssistantExecution(initial.sourceId, initial.native.id, controller.signal);
          if (!controller.signal.aborted) setDetail(result);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setDetail(null); setEvents([]); setError("현재 원본 실행을 확인하지 못했습니다.");
          if (error instanceof AssistantWebError && error.kind === "unauthorized") onUnauthorized("로그인이 만료되어 실행 상세를 지웠습니다.");
          else onUnavailable();
        }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load();
    return () => controller.abort();
  }, [initial.sourceId, initial.native.id, initial.native.revision, initial.currentTask?.task.revision, initial.currentTask?.project.accessRevision, showEvents, refresh]);
  useEffect(() => {
    if (!more || !hasMore) return;
    const controller = new AbortController(); setBusy(true);
    void fetchAssistantEvents(initial.sourceId, initial.native.id, cursor, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const next = [...events, ...result.page.events].slice(0, 500);
      setDetail(result.execution); setEvents(next); setCursor(next.at(-1)?.sequence ?? cursor);
      setHasMore(result.page.hasMore || next.length < events.length + result.page.events.length);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setDetail(null); setEvents([]);
      if (error instanceof AssistantWebError && error.kind === "unauthorized") onUnauthorized("로그인이 만료되어 상태 이력을 지웠습니다.");
      else onUnavailable();
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [more]);
  return <section className="assistant-selected" aria-label="선택한 Assistant 실행 상세">
    <div className="section-heading"><h3>원본 WorkExecution 상세</h3><button className="text-button" onClick={() => setRefresh(value => value + 1)}>상세 다시 조회</button></div>
    {busy && <p role="status" className="graph-legend">현재 원본 권한과 실행을 확인하고 있습니다.</p>}{error && <p role="alert" className="inline-error">{error}</p>}
    {detail && <><dl className="assistant-summary"><div><dt>Execution ID</dt><dd>{detail.native.id}</dd></div><div><dt>Assistant 실행 상태</dt><dd>{states[detail.native.state] ?? detail.native.state} · r{detail.native.revision}</dd></div>
      <div><dt>업무 연결 당시</dt><dd>{detail.native.task ? `${detail.native.task.state} · r${detail.native.task.revision} · ${time(detail.native.task.observedAt)}` : "연결 없음"}</dd></div>
      <div><dt>현재 Projects 업무</dt><dd>{detail.currentTask ? <>{states[detail.currentTask.task.state] ?? detail.currentTask.task.state} · r{detail.currentTask.task.revision} <button className="text-button" onClick={() => onTaskMap(detail.currentTask!.projectsSourceId, detail.currentTask!.project.id, detail.currentTask!.task.id)}>업무·실행 통합 Map</button></> : "원본 연결 없음"}</dd></div></dl>
      {detail.demianLinks && <section aria-label="Demian 원본 실행 연결"><h4>Demian 원본 실행</h4><p className="graph-legend">{nativeLinks.length ? detail.demianLinks.detail : "현재 접근 가능한 Demian 실행 연결을 확인하지 못했습니다. 미구성·원본 참조 없음·철회·단절은 전체 실행이 없다는 뜻이 아닙니다."}</p>
        {nativeLinks.map(link => <div key={link.roleId} className="assistant-window-status"><span>{detail.native.roles.find(role => role.id === link.roleId)?.label} → {states[link.status] ?? link.status} · Run {link.runId}</span>
          {onSelectRun && <button className="text-button" onClick={() => onSelectRun(link.runKey)}>Demian Trace의 호출·도구·산출물 보기</button>}</div>)}</section>}
      <div className="table-wrap"><table><caption>원본 역할별 시간 관측 · 외부 runtime 시각은 미검증이며 측정 시간으로 합산하지 않습니다.</caption><thead><tr><th>역할 · Agent</th><th>책임</th><th>상태</th><th>시도</th><th>관측 시간</th></tr></thead><tbody>{detail.native.roles.map(role => <tr key={role.id}><td>{role.label}<small>{role.teamLabel} · {role.agentLabel}</small></td><td>{role.responsibility}</td><td>{states[role.state] ?? role.state}</td><td>{role.attempts}</td><td>{role.observation.seconds === null ? "미확인" : `${role.observation.seconds}초`}{!role.observation.timingComplete && " · 부분 관측"}</td></tr>)}</tbody></table></div>
      {showEvents && <section className="assistant-events" aria-label="Assistant 원본 상태 이력"><h4>{mode === "trail" ? "상태 경과" : "실행 상태 Trace"}</h4><p className="graph-legend">원본 execution sequence · 현재 계약은 상태 metadata만 제공합니다. 도구 호출·산출물 내용은 이 이력에 포함되지 않습니다.</p>
        {events.length ? <ol>{events.map(event => <li key={event.sequence}><strong>#{event.sequence} · {states[event.state] ?? event.state}</strong><span>{time(event.occurredAt)} · 실행 r{event.revision}{event.errorCode ? ` · ${event.errorCode}` : ""}</span></li>)}</ol> : <p className="empty-inline">현재 조회 창에 원본 상태 이벤트가 없습니다.</p>}
        {hasMore && <button className="button-secondary" disabled={busy || events.length >= 500} onClick={() => setMore(value => value + 1)}>다음 상태 이력</button>}
        {hasMore && events.length >= 500 && <p className="graph-legend">현재 화면의 500개 상태 이력 한도에 도달했습니다.</p>}
        <p className="graph-legend">관측 cursor {cursor} · {events.length}개 · 전체 기록을 보장하지 않습니다.</p></section>}
      {mode !== "trail" && <AssistantFlowMap entries={[detail]} sources={sources} runs={runs} onSelect={onSelect} onTaskMap={onTaskMap} {...(onSelectRun ? { onSelectRun } : {})} />}
    </>}
  </section>;
}

export function AssistantFlowMap({ entries, sources, runs = [], onSelect, onTaskMap, onSelectRun }: { entries: AssistantExecutionView[]; sources: SourceView[];
  onSelect: (selection: AssistantSelection | null) => void; onTaskMap: (sourceId: string, projectId: string, taskId: string) => void;
  runs?: RunView[]; onSelectRun?: (key: string) => void }) {
  const model = useMemo(() => assistantFlow(entries, sources, { maxNodes: 500, runs }), [entries, sources, runs]);
  const [choice, setChoice] = useState<{ kind: "node" | "edge"; key: string } | null>(null);
  const [fit, setFit] = useState(0);
  const chooseNode = (key: string) => setChoice({ kind: "node", key });
  const chooseEdge = (key: string) => setChoice({ kind: "edge", key });
  const changeNodes = (changes: NodeChange<FlowNode>[]) => { const change = changes.find(item => item.type === "select" && item.selected); if (change?.type === "select") chooseNode(change.id); };
  const changeEdges = (changes: EdgeChange<FlowEdge>[]) => { const change = changes.find(item => item.type === "select" && item.selected); if (change?.type === "select") chooseEdge(change.id); };
  const grouping = useFlowGrouping(model, { scopeKey: JSON.stringify(entries.map(entry => [entry.sourceId, entry.native.id]).sort()), defaultBy: "project", chooseNode, chooseEdge, selection: choice, clearSelection: () => setChoice(null) });
  const node = grouping.inspectNodes.find(item => choice?.kind === "node" && item.key === choice.key);
  const edge = grouping.inspectEdges.find(item => choice?.kind === "edge" && item.key === choice.key);
  const group = choice?.kind === "node" ? grouping.groupByKey.get(choice.key) : undefined;
  const name = (key: string) => model.nodes.find(item => item.key === key)?.label ?? key;
  const graph = useMemo(() => {
    const nodes: FlowNode[] = grouping.projection.nodes.map(item => grouping.decorate(item, { id: item.key, type: "pyd-flow-node", position: { x: 0, y: 0 }, width: 240, height: 136,
      selected: item.key === node?.key, ariaLabel: `${kinds[item.kind] ?? item.kind} ${item.label}`,
      data: { title: item.label, kindLabel: kinds[item.kind] ?? item.kind, description: item.description,
        status: ["completed", "done", "succeeded"].includes(item.status) ? "complete" : ["running", "queued", "preparing", "publishing", "linking", "leasing", "waiting_for_permission"].includes(item.status) ? "running" : ["failed", "interrupted"].includes(item.status) ? "error" : "idle", statusLabel: states[item.status] ?? item.status } }));
    const edges: FlowEdge[] = grouping.projection.edges.map(item => ({ id: item.key, source: item.from, target: item.to, type: "pyd-flow-edge", label: item.label,
      selected: item.key === edge?.key, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--flow-edge)" } }));
    return layoutGroupedFlow(nodes, edges);
  }, [model, grouping.projection, node?.key, edge?.key]);
  const executionId = node?.kind === "assistant-execution" ? node.id : node?.details.find(item => item.label === "Execution ID")?.value;
  const projectId = node?.kind === "task" ? node.details.find(item => item.label === "Project ID")?.value : undefined;
  return <section className="mission-flow" aria-label="Assistant 업무와 역할 흐름">
    <div className="flow-semantics"><span>원본 업무 연결 → WorkExecution → 역할 → Runtime 참조</span><span>참조선은 실행 의존 관계가 아닙니다.</span><button className="text-button" onClick={() => { grouping.fitAll(); setFit(value => value + 1); }}>전체 흐름 맞춤</button></div>
    <p className="graph-legend">현재 조회 창의 {model.nodes.length} nodes · {model.edges.length} edges{model.hiddenNodes ? ` · 표시 한도로 ${model.hiddenNodes}개 생략` : ""}. Demian 연결선은 현재 원본 접근과 operation 영수증을 대조한 경우에 표시합니다. 일반 runtime 참조는 실제 Run으로 변환하지 않습니다.</p>
    <FlowGroupControls state={grouping} />
    <div className="mission-flow-workspace"><FlowCanvas key={`${fit}:${grouping.topology}`} label="Assistant 실행과 역할" nodes={graph.nodes} edges={graph.edges} showMiniMap readOnly
      height="clamp(500px, 65vh, 700px)" onNodeClick={chooseNode} onEdgeClick={chooseEdge} onNodesChange={changeNodes} onEdgesChange={changeEdges} onGroupToggle={grouping.toggle} onGroupEnter={grouping.enter}
      {...grouping.canvasProps} />
      <aside className="flow-inspector" aria-label="Assistant node 또는 edge 상세" aria-live="polite">{group ? <FlowGroupInspector group={group} state={grouping} nodes={model.nodes} edges={model.edges} />
        : node ? <><small>{kinds[node.kind] ?? node.kind}</small><h3>{node.label}</h3><p>{node.description}</p><dl>{node.details.map((item, index) => <div key={`${item.label}:${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          {executionId && <button className="button-secondary" onClick={() => onSelect({ sourceId: node.sourceId, executionId })}>이 실행의 원본 상세 보기</button>}
          {node.runKey && onSelectRun && <button className="button-secondary" onClick={() => onSelectRun(node.runKey!)}>Demian Trace의 호출·도구·산출물 보기</button>}
          {projectId && <button className="button-secondary" onClick={() => onTaskMap(node.sourceId, projectId, node.id)}>업무·실행 통합 Map</button>}</>
          : edge ? <><small>원본 관계 · {edge.kind}</small><h3>{edge.label}</h3><p>{name(edge.from)} → {name(edge.to)}</p><p style={{ whiteSpace: "pre-wrap" }}>{edge.detail}</p><FlowGroupEdgeEvidence edgeKey={edge.key} state={grouping} nodes={model.nodes} /></>
            : <><h3>Node·edge·group을 선택하세요</h3><p>역할과 원본 runtime 참조, 업무 연결 당시와 현재 revision을 구별합니다.</p></>}</aside></div>
    <details className="flow-accessible-list"><summary>Node·edge 목록으로 탐색</summary><div className="flow-list-columns"><section><h4>Nodes</h4>{model.nodes.map(item => <button key={item.key} className="flow-list-choice" onClick={() => grouping.revealNode(item.key)}><strong>{item.label}</strong><span>{kinds[item.kind] ?? item.kind} · {states[item.status] ?? item.status}</span></button>)}</section>
      <section><h4>Edges</h4>{model.edges.map(item => <button key={item.key} className="flow-list-choice" onClick={() => grouping.revealEdge(item.key)}><strong>{item.label}</strong><span>{name(item.from)} → {name(item.to)}</span></button>)}</section></div></details>
  </section>;
}

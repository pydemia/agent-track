import { useEffect, useMemo, useState } from "react";
import { MarkerType, type NodeChange, type EdgeChange } from "@xyflow/react";
import type { RunView, SourceView } from "../../../packages/contracts/index.ts";
import { dependencyGrants, projectDependenciesFlow } from "../../../packages/projection/project-dependencies-flow.ts";
import { pollTaskDependencies, type DependencySnapshot } from "./task-dependencies-client.ts";
import { FlowCanvas, type FlowNode, type FlowEdge } from "./ui/flow-canvas.tsx";
import { layoutFlowGraph } from "./ui/flow-layout.ts";
import "@xyflow/react/dist/style.css";
import "./ui/flow-canvas.css";
import "./mission-flow.css";

const kindLabels: Record<string, string> = { task: "업무", run: "Run", session: "Session" };
const stateLabels: Record<string, string> = { todo: "할 일", in_progress: "진행", in_review: "검토", done: "원본 완료", cancelled: "취소",
  queued: "대기", leasing: "할당 중", running: "실행 중", waiting_for_permission: "승인 대기", cancelling: "취소 중",
  succeeded: "성공 종료", failed: "실패 종료", expired: "만료", interrupted: "중단", observed: "관측됨", unknown: "미확인" };
function cardState(value: string): "idle" | "running" | "complete" | "error" {
  if (["queued", "leasing", "running", "in_progress", "waiting_for_permission"].includes(value)) return "running";
  if (["done", "succeeded"].includes(value)) return "complete";
  return value === "failed" ? "error" : "idle";
}

export interface TaskDependencyMapProps {
  sourceId: string;
  projectId: string;
  focusTaskId?: string;
  sources: SourceView[];
  runs: RunView[];
  onSelectRun: (key: string) => void;
  onUnauthorized: (reason: string) => void;
  onScopeUnavailable: (sourceId: string, projectId: string) => void;
}

// Keying the inner component also clears selection/search on grant changes,
// synchronously, before effects can begin the next scope's request.
export function TaskDependencyMap(props: TaskDependencyMapProps) {
  const grants = dependencyGrants(props.sources);
  const stamp = JSON.stringify([...grants].sort());
  if (!grants.has(JSON.stringify([props.sourceId, props.projectId]))) {
    return <p className="empty-inline" role="status">업무 의존성 조회 범위에 접근할 수 없습니다.</p>;
  }
  return <DependencyMapScope key={JSON.stringify([props.sourceId, props.projectId, stamp])} {...props} />;
}

function DependencyMapScope({ sourceId, projectId, focusTaskId, sources, runs,
  onSelectRun, onUnauthorized, onScopeUnavailable }: TaskDependencyMapProps) {
  const [snapshot, setSnapshot] = useState<DependencySnapshot>({ status: "loading", page: null });
  const [retry, setRetry] = useState(0);
  const [fit, setFit] = useState(0);
  const [filter, setFilter] = useState("");
  const [choice, setChoice] = useState<{ kind: "node" | "edge"; key: string } | null>(null);
  useEffect(() => pollTaskDependencies(sourceId, projectId, (next) => {
    setSnapshot(next);
    if (!next.page) { setChoice(null); setFilter(""); }
  }, onUnauthorized, undefined, () => onScopeUnavailable(sourceId, projectId)), [sourceId, projectId, retry, onUnauthorized, onScopeUnavailable]);
  const model = useMemo(() => snapshot.page
    ? projectDependenciesFlow(snapshot.page, runs, sources, focusTaskId)
    : { nodes: [], edges: [], hiddenNodes: 0, incomplete: false, cycles: new Set<string>(), focusPresent: false },
  [snapshot.page, runs, sources, focusTaskId]);
  const node = model.nodes.find((n) => choice?.kind === "node" && n.key === choice.key);
  const edge = model.edges.find((e) => choice?.kind === "edge" && e.key === choice.key);
  const chooseNode = (key: string) => setChoice({ kind: "node", key });
  const chooseEdge = (key: string) => setChoice({ kind: "edge", key });
  const name = (key: string) => model.nodes.find((n) => n.key === key)?.label ?? key;
  const graph = useMemo(() => {
    const nodes: FlowNode[] = model.nodes.map((n) => ({ id: n.key, type: "pyd-flow-node",
      position: { x: 0, y: 0 }, width: 240, height: 136, style: { width: 240, height: 136,
        ...(n.kind === "task" && n.id === focusTaskId ? { outline: "2px solid var(--lime)" } : {}) },
      selected: n.key === node?.key, ariaLabel: `${kindLabels[n.kind] ?? n.kind} ${n.label} ${stateLabels[n.status] ?? n.status}`,
      data: { title: n.label, kindLabel: n.kind === "task" ? "Projects 업무" : kindLabels[n.kind] ?? n.kind,
        kind: n.kind === "task" ? "trigger" : "action", status: cardState(n.status),
        statusLabel: stateLabels[n.status] ?? n.status, description: n.description } }));
    const edges: FlowEdge[] = model.edges.map((e) => ({ id: e.key,
      source: e.from, target: e.to, type: "pyd-flow-edge", label: e.label,
      selected: e.key === edge?.key, className: `mission-edge-${e.kind}`,
      ariaLabel: `${e.label} ${name(e.from)} → ${name(e.to)}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--flow-edge)" } }));
    return layoutFlowGraph({ nodes, edges });
  }, [model, focusTaskId, node?.key, edge?.key]);
  const topology = JSON.stringify([model.nodes.map((n) => n.key).sort(), model.edges.map((e) => e.key).sort()]);
  const selectNode = (changes: NodeChange<FlowNode>[]) => { const change = changes.find((item) => item.type === "select" && item.selected); if (change?.type === "select") chooseNode(change.id); };
  const selectEdge = (changes: EdgeChange<FlowEdge>[]) => { const change = changes.find((item) => item.type === "select" && item.selected); if (change?.type === "select") chooseEdge(change.id); };
  const retryRead = () => {
    setSnapshot({ status: "loading", page: null }); setChoice(null); setFilter("");
    setRetry((v) => v + 1);
  };
  const message = snapshot.status === "loading" ? "업무 의존성을 조회하고 있습니다."
    : snapshot.status === "unavailable" ? "업무 의존성 조회 범위에 접근할 수 없습니다."
    : snapshot.status === "unauthorized" ? "조회 권한이 해제되었습니다."
    : snapshot.status === "failure" ? "업무 의존성 조회 실패 · 연결과 조회 범위를 확인하세요."
    : !snapshot.page?.supported ? "이 출처는 업무 의존 관계를 제공하지 않습니다. 관계가 없다는 뜻은 아닙니다."
    : model.nodes.length === 0 ? model.incomplete ? "부분 조회 · 현재 허용 범위에 표시할 관계가 없습니다." : "현재 조회 범위에 기록된 의존 관계가 없습니다."
    : model.incomplete ? "부분 조회 · 전체 의존 관계를 보장하지 않습니다." : "현재 조회된 업무 의존 관계";
  const query = filter.toLowerCase();
  return <section className="mission-flow" aria-label="Projects 업무 의존성 Map">
    <div className="flow-semantics"><span>실선 · 선행 조건 → 의존 업무</span><span>점선 · 명시적 Task 연결 / Session 소속</span>
      <span>의존성은 실행 배정·Task 성공을 뜻하지 않습니다.</span>
      <button className="text-button" onClick={() => setFit((v) => v + 1)}>전체 흐름 맞춤</button>
      <button className="text-button" onClick={retryRead}>다시 조회</button></div>
    <p className={snapshot.status === "failure" ? "inline-error" : "graph-legend"} role="status">{message}</p>
    {snapshot.page && <p className="graph-legend">관측 {snapshot.page.observedAt ?? "지원되지 않음"} · {model.nodes.length} nodes · {model.edges.length} edges
      {snapshot.page.hasMore ? " · 원본에 추가 관계 있음 (최대 200건 조회)" : ""}
      {model.hiddenNodes > 0 ? ` · 160 node 표시 한도로 ${model.hiddenNodes}개 생략` : ""}</p>}
    {focusTaskId && snapshot.page?.supported && !model.focusPresent && <p className="inline-warning">선택한 업무의 의존 관계를 현재 조회 범위에서 확인하지 못했습니다.</p>}
    {model.cycles.size > 0 && <p className="inline-warning">의존 관계 순환 · 관련 node {model.cycles.size}개. 실행 순서로 해석하지 마세요.</p>}
    {model.nodes.length > 0 && <>
      <div className="mission-flow-workspace">
        <FlowCanvas key={`${fit}:${topology}`} label="Projects 업무 의존성" nodes={graph.nodes} edges={graph.edges}
          onNodeClick={chooseNode} onEdgeClick={chooseEdge} onNodesChange={selectNode} onEdgesChange={selectEdge} showMiniMap readOnly
          height="clamp(560px, 72vh, 740px)" className="mission-flow-canvas" />
        <aside className="flow-inspector" aria-label="선택한 업무 또는 관계 상세" aria-live="polite">
          {node ? <><small>{kindLabels[node.kind] ?? node.kind} · {stateLabels[node.status] ?? node.status}</small><h3>{node.label}</h3><p>{node.description}</p>
            <dl>{node.details.map((d) => <div key={d.label}><dt>{d.label}</dt><dd>{d.value}</dd></div>)}</dl>
            {node.runKey && <button className="button-secondary" onClick={() => onSelectRun(node.runKey!)}>Run 실행 근거 보기</button>}
            <h4>연결 관계</h4>{model.edges.filter((e) => e.from === node.key || e.to === node.key).map((e) =>
              <button key={e.key} className="flow-list-choice" onClick={() => chooseEdge(e.key)}><strong>{e.label}</strong><span>{name(e.from)} → {name(e.to)}</span></button>)}
          </> : edge ? <><small>관계 상세 · {edge.kind}</small><h3>{edge.label}</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{edge.detail}</p><dl>
              <div><dt>관계 식별키</dt><dd>{edge.key}</dd></div><div><dt>출처</dt><dd>{edge.sourceId}</dd></div>
              <div><dt>화면 출발</dt><dd><button className="text-button" onClick={() => chooseNode(edge.from)}>{name(edge.from)}</button></dd></div>
              <div><dt>화면 도착</dt><dd><button className="text-button" onClick={() => chooseNode(edge.to)}>{name(edge.to)}</button></dd></div>
            </dl></> : <><h3>업무 또는 관계를 선택하세요</h3><p>현재 원본 상태·revision, 관계 기록 당시 revision, 명시적으로 연결된 Run을 구분해 표시합니다. Run 종료는 Task 완료·수용 근거가 아닙니다.</p></>}
        </aside>
      </div>
      <details className="flow-accessible-list"><summary>Node·edge 목록으로 탐색</summary>
        <label>업무·관계·ID 검색<input value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        <div className="flow-list-columns"><section><h3>Nodes</h3>{model.nodes.filter((n) =>
          `${n.label} ${n.kind} ${n.id} ${n.sourceId}`.toLowerCase().includes(query)).map((n) =>
          <button key={n.key} className="flow-list-choice" aria-pressed={node?.key === n.key} onClick={() => chooseNode(n.key)}><strong>{n.label}</strong><span>{kindLabels[n.kind] ?? n.kind} · {stateLabels[n.status] ?? n.status} · {n.id}</span></button>)}</section>
          <section><h3>Edges</h3>{model.edges.filter((e) => `${e.label} ${e.detail} ${name(e.from)} ${name(e.to)}`.toLowerCase().includes(query)).map((e) =>
            <button key={e.key} className="flow-list-choice" aria-pressed={edge?.key === e.key} onClick={() => chooseEdge(e.key)}><strong>{e.label}</strong><span>{name(e.from)} → {name(e.to)}</span></button>)}</section></div>
      </details>
    </>}
  </section>;
}

import { useEffect, useMemo, useState } from "react";
import { MarkerType, type NodeChange, type EdgeChange } from "@xyflow/react";
import type { RunView, RelationView, SourceView } from "../../../packages/contracts/index.ts";
import type { AssistantExecutionView } from "../../../packages/contracts/assistant-view.ts";
import type { ProjectDependencyPage } from "../../../packages/contracts/project-dependencies.ts";
import { missionUnitKind } from "../../../packages/projection/mission-flow.ts";
import { groupWorkspaceFlow, type GroupTaskRecord } from "../../../packages/projection/group-workspace-flow.ts";
import { FlowCanvas, type FlowNode, type FlowEdge } from "./ui/flow-canvas.tsx";
import { layoutGroupedFlow } from "./flow-group-layout.ts";
import { useFlowGrouping, FlowGroupControls, FlowGroupInspector, FlowGroupEdgeEvidence, groupStatusLabel } from "./FlowGrouping.tsx";
import { fetchTaskDependencies, TaskDependenciesError } from "./task-dependencies-client.ts";
import "@xyflow/react/dist/style.css";
import "./ui/flow-canvas.css";

export function GroupWorkspaceMap({ tasks, runs, executions, sources, relations, onRun, onAssistant, onUnavailable, onUnauthorized, onTaskMap }: {
  tasks: GroupTaskRecord[]; runs: RunView[]; executions: AssistantExecutionView[]; sources: SourceView[]; relations: RelationView[];
  onRun: (key: string) => void; onAssistant: (source: string, id: string) => void; onUnavailable: () => void; onUnauthorized: (reason: string) => void;
  onTaskMap: (sourceId: string, projectId: string, taskId: string) => void;
}) {
  const [limit, setLimit] = useState(8), [retry, setRetry] = useState(0);
  const projects = [...new Set(tasks.map(record => JSON.stringify([record.ref.sourceId, record.ref.projectId])))];
  const stamp = JSON.stringify(projects.slice(0, limit));
  const [dependencies, setDependencies] = useState<{ stamp: string; pages: ProjectDependencyPage[]; error: boolean } | null>(null);
  const [choice, setChoice] = useState<{ kind: "node" | "edge"; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      const cycle = new AbortController(), cancel = () => cycle.abort();
      controller.signal.addEventListener("abort", cancel, { once: true });
      const pages: ProjectDependencyPage[] = [], queue: string[] = JSON.parse(stamp);
      const jobs: Promise<void>[] = [];
      try {
        const read = async () => { for (;;) {
          const key = queue.shift(); if (!key || cycle.signal.aborted) return;
          const [source, project] = JSON.parse(key) as [string, string];
          pages.push(await fetchTaskDependencies(source, project, cycle.signal));
        } };
        jobs.push(...Array.from({ length: Math.min(4, queue.length) }, read)); await Promise.all(jobs);
        if (!controller.signal.aborted) setDependencies({ stamp, pages, error: false });
      } catch (error) {
        cycle.abort(); await Promise.allSettled(jobs);
        if (controller.signal.aborted) return;
        setDependencies({ stamp, pages: [], error: true });
        if (error instanceof TaskDependenciesError && error.kind === "unauthorized") onUnauthorized("묶음의 의존 관계 접근 권한이 해제되었습니다.");
        else if (error instanceof TaskDependenciesError && error.kind === "unavailable") onUnavailable();
      } finally { controller.signal.removeEventListener("abort", cancel); if (!controller.signal.aborted) timer = setTimeout(() => void load(), 15000); }
    }
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [stamp, retry, onUnavailable, onUnauthorized]);
  const pages = useMemo(() => dependencies?.stamp === stamp ? dependencies.pages : [], [dependencies, stamp]);
  const model = useMemo(() => groupWorkspaceFlow(tasks, runs, relations, executions, sources, pages), [tasks, runs, relations, executions, sources, pages]);
  const chooseNode = (key: string) => setChoice({ kind: "node", key });
  const chooseEdge = (key: string) => setChoice({ kind: "edge", key });
  const grouping = useFlowGrouping(model, { scopeKey: stamp, defaultBy: tasks.length ? "project" : "session", chooseNode, chooseEdge, selection: choice, clearSelection: () => setChoice(null) });
  const node = grouping.inspectNodes.find(item => choice?.kind === "node" && choice.key === item.key);
  const edge = grouping.inspectEdges.find(item => choice?.kind === "edge" && choice.key === item.key);
  const group = grouping.projection.groups.find(item => choice?.kind === "node" && choice.key === item.key);
  const graph = useMemo(() => {
    const nodes: FlowNode[] = grouping.projection.nodes.map(item => grouping.decorate(item, {
      id: item.key, type: "pyd-flow-node", position: { x: 0, y: 0 }, width: 240, height: 136, style: { width: 240, height: 136 },
      selected: node?.key === item.key, ariaLabel: `${item.label} · ${groupStatusLabel(item.kind, item.status)}`,
      data: { title: item.label, description: item.description, kindLabel: missionUnitKind(item) === "invocation-reference" ? "호출 참조 · 생명주기 미관측" : item.kind, statusLabel: groupStatusLabel(item.kind, item.status),
        kind: item.kind === "task" ? "trigger" : "action", status: ["running", "in_progress", "queued", "waiting_for_permission"].includes(item.status) ? "running" : ["done", "succeeded", "completed"].includes(item.status) ? "complete" : item.status === "failed" ? "error" : "idle" },
    }));
    const edges: FlowEdge[] = grouping.projection.edges.map(item => ({ id: item.key, source: item.from, target: item.to, type: "pyd-flow-edge", label: item.label,
      selected: edge?.key === item.key, className: `mission-edge-${item.kind}`, ariaLabel: item.label, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--flow-edge)" } }));
    return layoutGroupedFlow(nodes, edges);
  }, [grouping.projection, node?.key, edge?.key]);
  const selectNode = (changes: NodeChange<FlowNode>[]) => { const selected = changes.find(item => item.type === "select" && item.selected); if (selected?.type === "select") chooseNode(selected.id); };
  const selectEdge = (changes: EdgeChange<FlowEdge>[]) => { const selected = changes.find(item => item.type === "select" && item.selected); if (selected?.type === "select") chooseEdge(selected.id); };
  return <section className="mission-flow" aria-label="선택한 묶음의 연결 구조">
    <h3>선택한 묶음의 연결 구조</h3><p className="graph-legend">업무 선행 관계·실행 소속·실제 실행 관계를 종류별로 읽습니다. 로그의 기록 순서로 의존선을 만들지 않습니다.</p>
    {dependencies?.stamp !== stamp ? <p role="status">현재 의존 관계를 확인하는 중…</p> : dependencies.error ? <p role="alert">의존 관계를 확인하지 못해 이전 관계선을 지웠습니다.<button type="button" onClick={() => setRetry(value => value + 1)}>다시 조회</button></p> : null}
    <p className="graph-legend">묶음 밖으로 이어지는 원본 업무 관계 {model.boundaryDependencies}건은 이 범위의 내부 의존선으로 합치지 않습니다. 원본 전체 업무 Map에서 별도로 확인할 수 있습니다.</p>
    {!!model.boundaries.length && <details><summary>묶음 경계를 넘는 원본 관계 · {model.boundaries.length}건</summary>{model.boundaries.map(({ edge, from, to }) => <div key={edge.key}>
      <strong>{from.label} → {to.label}</strong><p className="edge-evidence-detail">{edge.detail}</p>{[from, to].filter(node => node.taskRef && !tasks.some(record => record.ref.sourceId === node.taskRef!.sourceId && record.ref.projectId === node.taskRef!.projectId && record.ref.taskId === node.taskRef!.taskId)).map(node =>
        <button type="button" key={node.key} onClick={() => onTaskMap(node.taskRef!.sourceId, node.taskRef!.projectId, node.taskRef!.taskId)}>외부 업무 Map으로 이동 · 묶음 범위 해제</button>)}</div>)}</details>}
    {pages.some(page => page.hasMore || !page.supported) && <p className="inline-warning">일부 업무 의존 관계가 미지원이거나 부분 조회입니다.</p>}
    {projects.length > limit && <button type="button" onClick={() => setLimit(value => value + 8)}>추가 Project의 의존 관계 읽기 · {projects.length - limit}개 남음</button>}
    <FlowGroupControls state={grouping} />
    <div className="mission-flow-workspace"><FlowCanvas label="공통 묶음 Map" nodes={graph.nodes} edges={graph.edges} onNodeClick={chooseNode} onEdgeClick={chooseEdge}
      onNodesChange={selectNode} onEdgesChange={selectEdge} onGroupToggle={grouping.toggle} onGroupEnter={grouping.enter} {...grouping.canvasProps} showMiniMap readOnly
      height="clamp(560px, 72vh, 740px)" className="mission-flow-canvas" />
      <aside className="flow-inspector" aria-label="묶음 node 또는 edge 상세" aria-live="polite">{group ? <FlowGroupInspector group={group} state={grouping} nodes={model.nodes} edges={model.edges} />
        : node ? <><small>{missionUnitKind(node) === "invocation-reference" ? "호출 참조 · 생명주기 미관측" : node.kind} · {groupStatusLabel(node.kind, node.status)}</small><h3>{node.label}</h3><p>{node.description}</p><dl>{node.details.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          {node.runKey && <button type="button" onClick={() => onRun(node.runKey!)}>이 실행의 흐름 펼치기</button>}
          {node.assistantExecutionRef && <button type="button" onClick={() => onAssistant(node.assistantExecutionRef!.sourceId, node.assistantExecutionRef!.executionId)}>이 Assistant 실행 펼치기</button>}</>
          : edge ? <><h3>{edge.label}</h3><p>{edge.kind}</p><p className="edge-evidence-detail">{edge.detail}</p><FlowGroupEdgeEvidence edgeKey={edge.key} state={grouping} nodes={model.nodes} /></>
          : <p>묶음·node·edge를 선택하면 구성과 원본 근거를 확인할 수 있습니다.</p>}</aside></div>
  </section>;
}

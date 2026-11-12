import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkerType, type NodeChange, type EdgeChange } from "@xyflow/react";
import type { EventView, RelationView, RunView } from "../../../packages/contracts/index.ts";
import { missionFlow } from "../../../packages/projection/mission-flow.ts";
import { missionNodeOrder } from "../../../packages/projection/mission-order.ts";
import { withNativeLineage } from "../../../packages/projection/lineage-flow.ts";
import { withToolEvidence } from "../../../packages/projection/tool-flow.ts";
import { analyseGraph } from "../../../packages/projection/graph.ts";
import { useNativeLineage } from "./useNativeLineage.ts";
import { useToolEvidence } from "./useToolEvidence.ts";
import { OrchestrationSupport } from "./OrchestrationSupport.tsx";
import { withSessionRelations } from "../../../packages/projection/session-relations-flow.ts";
import { useSessionRelations } from "./useSessionRelations.ts";
import { SessionRelationsSupport } from "./SessionRelationsSupport.tsx";
import { withArtifactEvidence } from "../../../packages/projection/artifact-flow.ts";
import { useArtifactEvidence } from "./useArtifactEvidence.ts";
import { ArtifactSupport } from "./ArtifactSupport.tsx";
import { FlowCanvas, type FlowNode, type FlowEdge } from "./ui/flow-canvas.tsx";
import { layoutGroupedFlow } from "./flow-group-layout.ts";
import { useFlowGrouping, FlowGroupControls, FlowGroupInspector, FlowGroupEdgeEvidence } from "./FlowGrouping.tsx";
import "@xyflow/react/dist/style.css";
import "./ui/flow-canvas.css";
import "./mission-flow.css";

const kinds: Record<string, string> = { task: "업무", workspace: "Workspace", session: "Session", run: "Run", invocation: "Agent 호출",
  tool: "도구 호출", permission: "승인", artifact: "산출물", group: "협업 그룹", member: "협업 멤버", lifecycle: "실행 단계", event: "관측", reference: "원본 참조", unknown: "미확인 참조",
  "managed-parent-reference": "부모 호출 참조 · Run 미확인", "peer-connection": "peer 연결 참조", "peer-conversation": "처리 대화 참조", "peer-message": "처리 메시지 참조", "session-relation-receipt": "관계 영수증" };
const statuses: Record<string, string> = { bound: "명시 연결", observed: "관측됨", "observed-reference": "관계 참조", unobserved: "미조회 참조", queued: "대기", leasing: "할당 중", running: "실행 중", started: "실행 중", waiting_for_permission: "승인 대기",
  cancelling: "취소 중", succeeded: "성공 종료", completed: "완료 보고", complete: "완료 보고", failed: "실패 보고", cancelled: "취소 종료", expired: "만료",
  interrupted: "중단", unknown: "미확인", ambiguous: "근거 충돌", idle: "미확인", todo: "할 일", in_progress: "진행", in_review: "검토", done: "원본 완료" };
function cardStatus(value: string): "idle" | "running" | "complete" | "error" {
  if (["running", "started", "leasing", "queued", "waiting_for_permission", "in_progress"].includes(value)) return "running";
  if (["completed", "complete", "succeeded", "done"].includes(value)) return "complete";
  return ["failed", "error"].includes(value) ? "error" : "idle";
}
type Choice = { kind: "node" | "edge"; key: string } | null;

export function MissionFlow({ actor, run, runs, relations, events, mode = "mission", hasMore = false, onSelectRun, onUnauthorized }: {
  actor: string; run: RunView; runs: RunView[]; relations: RelationView[]; events: EventView[];
  mode?: "mission" | "execution"; hasMore?: boolean; onSelectRun: (key: string) => void; onUnauthorized: (reason: string) => void;
}) {
  const [choice, setChoice] = useState<Choice>(null);
  const [fitVersion, setFitVersion] = useState(0);
  const [filter, setFilter] = useState("");
  const lineage = useNativeLineage(run, onUnauthorized);
  const tools = useToolEvidence(run, onUnauthorized);
  const sessionRelations = useSessionRelations(actor, run, runs, onUnauthorized);
  const artifacts = useArtifactEvidence(actor, run, onUnauthorized);
  const model = useMemo(() => withArtifactEvidence(withSessionRelations(withNativeLineage(withToolEvidence(missionFlow(run, runs, relations, events, { mode, maxNodes: 160, hasMoreEvents: hasMore, includeExecution: true }), run, tools.page), run,
    lineage.observations, lineage.hasMore || lineage.capped), run, runs, sessionRelations.evidence), run, artifacts.evidence), [run, runs, relations, events, mode, hasMore, tools.page, lineage.observations, lineage.hasMore, lineage.capped, sessionRelations.evidence, artifacts.evidence]);
  const chooseNode = useCallback((key: string) => setChoice((old) => old?.kind === "node" && old.key === key ? old : { kind: "node", key }), []);
  const chooseEdge = useCallback((key: string) => setChoice((old) => old?.kind === "edge" && old.key === key ? old : { kind: "edge", key }), []);
  const grouping = useFlowGrouping(model, { scopeKey: `${actor}:${run.key}:${mode}`, defaultBy: mode === "execution" ? "run" : run.binding?.taskId ? "task" : "session",
    defaultDepth: mode === "execution" ? "detail" : "structure", chooseNode, chooseEdge, selection: choice, clearSelection: () => setChoice(null) });
  const selectedNode = grouping.inspectNodes.find((node) => choice?.kind === "node" && choice.key === node.key);
  const selectedEdge = grouping.inspectEdges.find((edge) => choice?.kind === "edge" && choice.key === edge.key);
  const selectedGroup = choice?.kind === "node" ? grouping.groupByKey.get(choice.key) : undefined;
  useEffect(() => {
    if (choice && !selectedNode && !selectedEdge && !selectedGroup) setChoice(null);
  }, [choice, selectedNode, selectedEdge, selectedGroup]);
  const dependencyCycles = useMemo(() => analyseGraph({ nodes: model.nodes,
    edges: model.edges.filter((edge) => edge.kind === "dependency").map((edge) => ({ ...edge, kind: "dependency" as const })) }).cyclic, [model]);
  // Refit when asynchronously loaded evidence changes topology, while preserving
  // pan/zoom across the recurring status-only snapshots and selection updates.
  const topology = JSON.stringify([model.nodes.map((node) => node.key).sort(),
    model.edges.map((edge) => [edge.key, edge.from, edge.to]).sort((a, b) => a[0]!.localeCompare(b[0]!))]);
  const graph = useMemo(() => {
    const nodes: FlowNode[] = grouping.projection.nodes.map((node) => grouping.decorate(node, { id: node.key, type: "pyd-flow-node", position: { x: 0, y: 0 },
      selected: selectedNode?.key === node.key, width: 240, height: 136, style: { width: 240, height: 136 },
      ariaLabel: `${kinds[node.kind] ?? node.kind} · ${node.label} · ${statuses[node.status] ?? node.status}`,
      data: { title: node.label, description: node.description, kindLabel: kinds[node.kind] ?? node.kind, statusLabel: statuses[node.status] ?? node.status,
        kind: node.kind === "permission" ? "condition" : node.kind === "artifact" ? "result" : node.kind === "task" ? "trigger" : "action", status: cardStatus(node.status) } }));
    const edges: FlowEdge[] = grouping.projection.edges.map((edge) => ({ id: edge.key, source: edge.from, target: edge.to, type: "pyd-flow-edge",
      label: edge.label, selected: selectedEdge?.key === edge.key, className: `mission-edge-${edge.kind}`,
      ariaLabel: `${edge.label} · ${edge.detail}`, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--flow-edge)" } }));
    // Hierarchy sets the columns; chronology connects siblings without pushing
    // every tool into another column or turning record order into dependency.
    const order = missionNodeOrder(model);
    return layoutGroupedFlow(nodes, edges, order);
  }, [model, grouping.projection, selectedNode?.key, selectedEdge?.key]);
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => { const selected = changes.find((change) => change.type === "select" && change.selected); if (selected?.type === "select") chooseNode(selected.id); }, [chooseNode]);
  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => { const selected = changes.find((change) => change.type === "select" && change.selected); if (selected?.type === "select") chooseEdge(selected.id); }, [chooseEdge]);
  const neighbours = selectedNode ? model.edges.filter((edge) => edge.from === selectedNode.key || edge.to === selectedNode.key) : [];
  const nodeName = (key: string) => grouping.inspectNodes.find((node) => node.key === key)?.label ?? "미조회 대상";

  return <section className="mission-flow" aria-label={mode === "execution" ? "Trace 실행 흐름" : "업무와 Agent 협업 흐름"}>
    <div className="flow-heading"><div><h2>{mode === "execution" ? "실행 안의 Agent·도구·승인 흐름" : "업무와 Agent 협업 흐름"}</h2><p>{mode === "execution" ? "호출 구조와 기록 순서를 따라가며 실행 근거를 확인합니다." : "업무 연결·세션·위임·협업을 관계의 종류별로 따라갑니다."}</p></div><button className="text-button" onClick={() => { grouping.fitAll(); setFitVersion((value) => value + 1); }}>전체 흐름 맞춤</button></div>
    <div className="flow-semantics" aria-label="연결선 의미"><span>실선 · 명시된 관계</span><span>점선 · 소속 또는 업무 연결</span><span>기록 순서 · 인과·의존 보장 아님</span><span>{model.nodes.length}개 node · {model.edges.length}개 edge</span></div>
    <OrchestrationSupport run={run} onUnauthorized={onUnauthorized} />
    <SessionRelationsSupport value={sessionRelations} />
    <ArtifactSupport value={artifacts} />
    {lineage.native && <p className="graph-legend">Native lineage {lineage.observations.length}개 · {lineage.detail}{lineage.hasMore && <button className="text-button" disabled={lineage.capped} onClick={lineage.more}>{lineage.capped ? "1,000개 조회 한도" : "Native 근거 더 불러오기"}</button>}</p>}
    {tools.native && <p className="graph-legend">{tools.page ? `도구 결과 ${tools.page.calls.length}건 · 실패 보고 ${tools.page.calls.filter((call) => call.outcome === "failed").length}건 · 원본 seq ${tools.page.throughSequence}/${tools.page.targetSequence}${tools.page.complete ? "까지 조회" : " · 부분 조회"}` : tools.detail}</p>}
    {!!tools.page?.unidentifiedEvents && <p className="inline-warning">호출 ID가 없어 구조에 연결하지 못한 원본 도구 이벤트 {tools.page.unidentifiedEvents}건이 있습니다.</p>}
    {(model.incomplete || model.hiddenNodes > 0) && <p className="inline-warning">현재 관측·조회 범위의 흐름입니다.{model.hiddenNodes > 0 ? ` 표시 범위 밖 node ${model.hiddenNodes}개.` : ""} 연결이 없거나 대기 중인 근거를 완료로 해석하지 않습니다.</p>}
    {dependencyCycles.size > 0 && <p className="inline-warning">명시된 의존 관계에 순환이 있습니다. 관련 node {dependencyCycles.size}개의 출발·도착과 원본 근거를 확인하세요.</p>}
    <FlowGroupControls state={grouping} />
    <div className="mission-flow-workspace">
      <FlowCanvas key={`${run.key}:${mode}:${fitVersion}:${topology}:${grouping.topology}`} label={mode === "execution" ? "Agent 실행 Trace" : "업무 실행 Map"} nodes={graph.nodes} edges={graph.edges}
        onNodeClick={chooseNode} onEdgeClick={chooseEdge} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onGroupToggle={grouping.toggle} onGroupEnter={grouping.enter} {...grouping.canvasProps}
        height="clamp(560px, 72vh, 740px)" className="mission-flow-canvas" readOnly />
      <aside className="flow-inspector" aria-label="선택한 node 또는 edge 상세" aria-live="polite">
        {selectedGroup ? <FlowGroupInspector group={selectedGroup} state={grouping} nodes={model.nodes} edges={model.edges} /> : selectedNode ? <><small>{kinds[selectedNode.kind] ?? selectedNode.kind} · {statuses[selectedNode.status] ?? selectedNode.status}</small><h3>{selectedNode.label}</h3><p>{selectedNode.description}</p>
          <dl>{selectedNode.details.map((detail, index) => <div key={`${detail.label}:${index}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
          {selectedNode.sequences.length > 0 && <p className="flow-evidence">근거 seq {selectedNode.sequences.join(", ")}</p>}
          {selectedNode.runKey && selectedNode.runKey !== run.key && <button className="button-secondary" onClick={() => onSelectRun(selectedNode.runKey!)}>이 Run의 실행 근거 보기</button>}
          <h4>연결 {neighbours.length}건</h4><div className="flow-neighbours">{neighbours.map((edge) => <button className="flow-list-choice" key={edge.key} onClick={() => grouping.revealEdge(edge.key)}><strong>{edge.label}</strong><span>{nodeName(edge.from)} → {nodeName(edge.to)}</span></button>)}</div>
        </> : selectedEdge ? <><small>관계 상세</small><h3>{selectedEdge.label}</h3><p style={{ whiteSpace: "pre-wrap" }}>{selectedEdge.detail}</p><dl><div><dt>출발</dt><dd><button className="text-button" onClick={() => chooseNode(selectedEdge.from)}>{nodeName(selectedEdge.from)}</button></dd></div><div><dt>도착</dt><dd><button className="text-button" onClick={() => chooseNode(selectedEdge.to)}>{nodeName(selectedEdge.to)}</button></dd></div><div><dt>관계 종류</dt><dd>{selectedEdge.kind}</dd></div><div><dt>출처</dt><dd>{selectedEdge.sourceId}</dd></div></dl><p className="flow-evidence">{selectedEdge.sequences.length ? `근거 seq ${selectedEdge.sequences.join(", ")}` : "원본 식별자와 명시된 소속·업무 연결 근거"}</p></>
          : <><small>흐름 탐색</small><h3>Node 또는 edge를 선택하세요</h3><p>실행 상태·담당 호출·연결 대상과 원본 근거를 여기에 표시합니다. 캔버스의 연결선과 아래 목록에서 같은 관계를 선택할 수 있습니다.</p><p>관계가 없는 node는 미연결·미관측 상태로 남깁니다.</p></>}
        {selectedEdge && <FlowGroupEdgeEvidence edgeKey={selectedEdge.key} state={grouping} nodes={model.nodes} />}
      </aside>
    </div>
    <details className="flow-accessible-list"><summary>Node·edge 목록으로 탐색 <small>{model.nodes.length + model.edges.length}개 항목</small></summary>
      <label>흐름 항목 검색 <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="업무·도구·관계 이름" /></label>
      <div className="flow-list-columns"><section><h3>Nodes</h3>{model.nodes.filter((node) => `${node.label} ${node.kind} ${node.id}`.toLowerCase().includes(filter.toLowerCase())).map((node) => <button key={node.key} className="flow-list-choice" aria-pressed={selectedNode?.key === node.key} onClick={() => grouping.revealNode(node.key)}><strong>{node.label}</strong><span>{kinds[node.kind] ?? node.kind} · {statuses[node.status] ?? node.status}</span></button>)}</section>
        <section><h3>Edges</h3>{model.edges.filter((edge) => `${edge.label} ${nodeName(edge.from)} ${nodeName(edge.to)}`.toLowerCase().includes(filter.toLowerCase())).map((edge) => <button key={edge.key} className="flow-list-choice" aria-pressed={selectedEdge?.key === edge.key} onClick={() => grouping.revealEdge(edge.key)}><strong>{edge.label}</strong><span>{nodeName(edge.from)} → {nodeName(edge.to)}</span></button>)}</section></div>
    </details>
  </section>;
}

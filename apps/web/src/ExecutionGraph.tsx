import { useId } from "react";
import type { RelationView, RunView } from "../../../packages/contracts/index.ts";
import { analyseGraph, executionGraph } from "../../../packages/projection/graph.ts";

const kindNames: Record<string, string> = { workspace: "Workspace / 저장소", session: "Session", run: "Run", invocation: "에이전트 호출", group: "협업 그룹", member: "협업 멤버", artifact: "산출물", task: "업무 참조", unknown: "관측 대상" };
const short = (value: string) => [...value].length > 27 ? [...value].slice(0, 25).join("") + "…" : value;

export function ExecutionGraph({ selected, runs, relations, onSelect }: { selected: RunView; runs: RunView[]; relations: RelationView[]; onSelect: (key: string) => void }) {
  const id = useId().replace(/:/g, "_");
  const graph = executionGraph(selected, runs, relations);
  const analysis = analyseGraph(graph);
  const visible = graph.nodes.slice(0, 40);
  const visibleLayers = [...new Set(visible.map((node) => analysis.layers.get(node.key)!))].sort((a, b) => a - b);
  const rowForLayer = new Map<number, number>();
  const positions = new Map(visible.map((node) => {
    const layer = visibleLayers.indexOf(analysis.layers.get(node.key)!);
    const row = rowForLayer.get(layer) ?? 0; rowForLayer.set(layer, row + 1);
    return [node.key, { x: 20 + layer * 250, y: 26 + row * 100 }];
  }));
  const width = Math.max(660, ...[...positions.values()].map((point) => point.x + 230));
  const height = Math.max(145, ...[...positions.values()].map((point) => point.y + 100));
  const observedRuns = graph.nodes.filter((node) => node.runKey).length;
  return <section className="execution-graph" aria-label="선택한 실행 지도">
    <div className="section-heading"><h2>선택한 실행 지도</h2><small>조회된 Run {observedRuns}개 · 전체 실행 집계와 별도</small></div>
    <p className="graph-legend">점선: 원본 소속 · 실선: 관측 관계 · 조회되지 않은 참조에는 원본 상태를 추정하지 않습니다.</p>
    {analysis.cyclic.size > 0 && <p className="inline-warning">관계 순환에 포함된 노드 {analysis.cyclic.size}개. 순환만으로 실행 오류를 판정하지 않습니다.</p>}
    {analysis.isolated.size > 0 && <p className="graph-legend">관계가 연결되지 않은 관측 노드 {analysis.isolated.size}개</p>}
    <div className="graph-scroll" role="region" aria-label="실행 지도 가로 스크롤" tabIndex={0}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>실제 소속 구조와 관측된 실행 관계</title>
        <desc id={`${id}-desc`}>소속 구조는 실행의 부모 자식 관계와 별도입니다. 호출·협업 멤버를 별도 Run으로 합산하지 않습니다. 아래 실행 목록과 관계 목록으로 같은 데이터를 읽을 수 있습니다.</desc>
        <defs><marker id={`${id}-arrow`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#8b9778" /></marker></defs>
        {graph.edges.map((edge) => {
          const from = positions.get(edge.from); const to = positions.get(edge.to);
          if (!from || !to) return null;
          const startX = from.x + 210; const endX = to.x;
          const middle = (startX + endX) / 2;
          return <g key={edge.key}><path className={`graph-edge ${edge.kind === "context" ? "context-edge" : "evidence-edge"}`} d={`M${startX},${from.y + 33} C${middle},${from.y + 33} ${middle},${to.y + 33} ${endX},${to.y + 33}`} markerEnd={`url(#${id}-arrow)`}><title>{edge.kind === "context" ? "원본 소속" : edge.kind}</title></path><text className="graph-edge-label" x={middle} y={(from.y + to.y) / 2 + 22} textAnchor="middle">{edge.kind === "context" ? "소속" : edge.kind}</text></g>;
        })}
        {visible.map((node) => {
          const point = positions.get(node.key)!;
          const reference = node.kind === "run" && !node.runKey;
          const label = `${kindNames[node.kind] ?? node.kind}${reference ? " · 미조회 참조" : ""}`;
          return <g key={node.key} transform={`translate(${point.x},${point.y})`} className={`graph-node ${node.runKey === selected.key ? "graph-selected" : ""} ${analysis.cyclic.has(node.key) ? "graph-cycle" : ""}`}
            {...(node.runKey ? { role: "button", tabIndex: 0, "aria-label": `Run 선택 · ${node.label}`, "aria-pressed": node.runKey === selected.key,
              onClick: () => onSelect(node.runKey!), onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.runKey!); } } } : {})}>
            <title>{label} · {node.id}</title><rect width="210" height="68" rx="4" /><text x="12" y="20" className="graph-kind">{label}</text><text x="12" y="41">{short(node.label)}</text><text x="12" y="57" className="graph-id">{short(node.id)}</text>
          </g>;
        })}
      </svg>
    </div>
    {visible.length < graph.nodes.length && <p className="graph-legend">지도는 처음40개/{graph.nodes.length}개 노드만 표시합니다. 전체 관측 관계는 아래 목록에서 확인하세요.</p>}
    <p className="graph-legend">출처: {selected.sourceLabel} · 마지막 관측 {new Date(selected.observedAt).toLocaleString("ko-KR")}</p>
  </section>;
}

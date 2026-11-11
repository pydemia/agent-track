import {
    Background, BaseEdge, Controls, EdgeLabelRenderer, Handle,
    MiniMap, Position, ReactFlow, ViewportPortal, getSmoothStepPath,
    type Connection, type Edge, type EdgeProps, type Node,
    type NodeProps, type OnEdgesChange, type OnNodesChange,
    type Viewport, useReactFlow,
} from "@xyflow/react";
import type { CSSProperties } from "react";
import { createContext, useContext, useRef, useState } from "react";
import { alignFlowNode, type FlowGuide } from "./flow-alignment.ts";

type FlowNodeData = {
    title: string;
    description?: string;
    kind?: "trigger" | "action" | "condition" | "result";
    status?: "idle" | "running" | "complete" | "error";
    kindLabel?: string;
    statusLabel?: string;
};

type FlowNode = Node<FlowNodeData, "pyd-flow-node" | "pyd-flow-group">;
type FlowPoint = { x: number; y: number };
type FlowEdgeData = { controlPoint?: FlowPoint };
type FlowEdge = Edge<FlowEdgeData, "pyd-flow-edge">;
type FlowEdgeEditPhase = "start" | "move" | "end";
type FlowEdgeEdit = (id: string, point: FlowPoint,
    phase: FlowEdgeEditPhase) => void;
const FlowEdgeEditContext = createContext<FlowEdgeEdit | undefined>(undefined);
const FlowEdgeSelectContext = createContext<((id: string) => void) | undefined>(undefined);

type FlowCanvasProps = {
    label: string;
    nodes: FlowNode[];
    edges: FlowEdge[];
    onNodesChange?: OnNodesChange<FlowNode>;
    onEdgesChange?: OnEdgesChange<FlowEdge>;
    onConnect?: (connection: Connection) => void;
    onNodeDragStart?: (id: string) => void;
    onNodeDragStop?: (id: string) => void;
    onNodeSnap?: (id: string, position: { x: number; y: number }) => void;
    onEdgeControlChange?: FlowEdgeEdit;
    onNodeClick?: (id: string, event: React.MouseEvent) => void;
    onEdgeClick?: (id: string) => void;
    onSelectionChange?: (selection: {
        nodes: FlowNode[]; edges: FlowEdge[];
    }) => void;
    className?: string;
    height?: number | string;
    showMiniMap?: boolean;
    fitView?: boolean;
    defaultViewport?: Viewport;
    readOnly?: boolean;
};

const kindLabels: Record<NonNullable<FlowNodeData["kind"]>, string> = {
    trigger: "Trigger", action: "Action", condition: "Condition",
    result: "Result",
};

const statusLabels: Record<NonNullable<FlowNodeData["status"]>, string> = {
    idle: "대기", running: "진행", complete: "완료", error: "오류",
};

function FlowNodeCard({ data, selected }: NodeProps<FlowNode>) {
    const kind = data.kind ?? "action";
    const status = data.status ?? "idle";
    return <div data-ui="flow-node" data-kind={kind} data-status={status}
        data-selected={selected ? "true" : undefined}
        className="min-w-44 max-w-56 rounded-md border border-border bg-surface text-foreground shadow-sm">
        <Handle type="target" position={Position.Left}
            aria-label={`${data.title} 입력 포트`} />
        <div data-slot="flow-node-heading" className="border-b border-border px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted">
                {data.kindLabel ?? kindLabels[kind]}
            </span>
            <strong className="block text-sm leading-5">{data.title}</strong>
        </div>
        <div data-slot="flow-node-body" className="flex items-start justify-between gap-2 px-3 py-2">
            <span className="max-w-36 text-xs leading-4 text-muted">
                {data.description ?? "설명 없음"}
            </span>
            <span data-slot="flow-status" className="shrink-0 text-[11px] font-medium">
                {data.statusLabel ?? statusLabels[status]}
            </span>
        </div>
        <Handle type="source" position={Position.Right}
            aria-label={`${data.title} 출력 포트`} />
    </div>;
}

function FlowGroupCard({ data, selected }: NodeProps<FlowNode>) {
    return <div data-ui="flow-group" data-selected={selected ? "true" : undefined}
        className="h-full w-full rounded-lg border-2 border-dashed border-border bg-surface-subtle/70">
        <strong className="block px-3 py-2 text-xs font-semibold text-muted">
            {data.title}
        </strong>
    </div>;
}

function FlowEdgePath({ id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, markerEnd, label, selected, data,
}: EdgeProps<FlowEdge>) {
    const edit = useContext(FlowEdgeEditContext);
    const select = useContext(FlowEdgeSelectContext);
    const instance = useReactFlow();
    const drag = useRef<{ clientX: number; clientY: number;
        point: FlowPoint } | null>(null);
    const [defaultPath, defaultX, defaultY] = getSmoothStepPath({
        sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
        borderRadius: 12,
    });
    const control = data?.controlPoint;
    const path = control ? `M ${sourceX} ${sourceY} Q ${control.x} ${control.y} ${targetX} ${targetY}` :
        defaultPath;
    const labelX = control ? (sourceX + 2 * control.x + targetX) / 4 : defaultX;
    const labelY = control ? (sourceY + 2 * control.y + targetY) / 4 : defaultY;
    return <>
        <BaseEdge id={id} path={path} {...(markerEnd ? { markerEnd } : {})}
            className={selected ? "pyd-flow-edge-selected" : ""} />
        {label && <EdgeLabelRenderer>
            <button type="button" data-ui="flow-edge-label" className="nodrag nopan"
                aria-label={`${String(label)} 관계 선택`}
                aria-pressed={Boolean(selected)}
                onClick={(event) => { event.stopPropagation(); select?.(id); }}
                style={{
                    position: "absolute",
                    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                    pointerEvents: "all",
                }}>
                {label}
            </button>
        </EdgeLabelRenderer>}
        {control && edit && <EdgeLabelRenderer>
            <button type="button" className="nodrag nopan pyd-flow-control-point"
                aria-label={`${String(label || id)} 연결 제어점`}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                style={{ position: "absolute", pointerEvents: "all",
                    transform: `translate(-50%, -50%) translate(${control.x}px, ${control.y}px)` }}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { clientX: event.clientX, clientY: event.clientY,
                        point: control };
                    edit(id, control, "start");
                }}
                onPointerMove={(event) => {
                    if (!drag.current) return;
                    const zoom = instance.getViewport().zoom;
                    edit(id, {
                        x: drag.current.point.x +
                            (event.clientX - drag.current.clientX) / zoom,
                        y: drag.current.point.y +
                            (event.clientY - drag.current.clientY) / zoom,
                    }, "move");
                }}
                onPointerUp={(event) => {
                    if (!drag.current) return;
                    event.stopPropagation();
                    drag.current = null;
                    edit(id, control, "end");
                }}
                onPointerCancel={() => {
                    if (!drag.current) return;
                    drag.current = null;
                    edit(id, control, "end");
                }}
                onKeyDown={(event) => {
                    const steps: Record<string, FlowPoint> = {
                        ArrowLeft: { x: -1, y: 0 },
                        ArrowRight: { x: 1, y: 0 },
                        ArrowUp: { x: 0, y: -1 },
                        ArrowDown: { x: 0, y: 1 },
                    };
                    const step = steps[event.key];
                    if (!step) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const amount = event.shiftKey ? 10 : 1;
                    edit(id, control, "start");
                    edit(id, { x: control.x + step.x * amount,
                        y: control.y + step.y * amount }, "move");
                    edit(id, control, "end");
                }} />
        </EdgeLabelRenderer>}
    </>;
}

const nodeTypes = { "pyd-flow-node": FlowNodeCard,
    "pyd-flow-group": FlowGroupCard };
const edgeTypes = { "pyd-flow-edge": FlowEdgePath };

function FlowCanvas({ label, nodes, edges, onNodesChange, onEdgesChange,
    onConnect, onNodeDragStart, onNodeDragStop, onNodeSnap,
    onEdgeControlChange,
    onNodeClick, onEdgeClick, onSelectionChange,
    className, height = 560, showMiniMap = true,
    fitView = true, defaultViewport, readOnly = true,
}: FlowCanvasProps) {
    const [guides, setGuides] = useState<FlowGuide[]>([]);
    const zoom = useRef(1);
    if (typeof label !== "string" || !label.trim()) {
        throw new Error("FlowCanvas requires a label.");
    }
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
        throw new TypeError("FlowCanvas nodes and edges must be arrays.");
    }
    const style: CSSProperties = { height };
    return <section data-ui="flow-canvas" aria-label={label}
        className={className} style={style}>
        <FlowEdgeEditContext.Provider value={onEdgeControlChange}>
        <FlowEdgeSelectContext.Provider value={onEdgeClick}>
        <ReactFlow<FlowNode, FlowEdge> nodes={nodes} edges={edges}
            nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            {...(onNodesChange ? { onNodesChange } : {})}
            {...(onEdgesChange ? { onEdgesChange } : {})}
            {...(onConnect && !readOnly ? { onConnect } : {})}
            onNodeDragStart={(_, node) => onNodeDragStart?.(node.id)}
            onNodeDrag={(_, node) => {
                if (node.parentId || nodes.filter((item) => item.selected).length > 1) {
                    setGuides([]);
                    return;
                }
                setGuides(alignFlowNode(node, nodes, zoom.current).guides);
            }}
            onNodeDragStop={(_, node) => {
                if (!node.parentId && nodes.filter((item) => item.selected).length <= 1) {
                    const snapped = alignFlowNode(node, nodes, zoom.current);
                    if (snapped.guides.length > 0) {
                        onNodeSnap?.(node.id, snapped.position);
                    }
                }
                setGuides([]);
                onNodeDragStop?.(node.id);
            }}
            onNodeClick={(event, node) => onNodeClick?.(node.id, event)}
            onEdgeClick={(_, edge) => onEdgeClick?.(edge.id)}
            {...(onSelectionChange ? { onSelectionChange } : {})}
            nodesDraggable={!readOnly && Boolean(onNodesChange)}
            nodesConnectable={!readOnly && Boolean(onConnect)}
            deleteKeyCode={null}
            edgesFocusable
            edgesReconnectable={false}
            fitView={fitView} {...(defaultViewport ? { defaultViewport } : {})}
            onInit={(instance) => { zoom.current = instance.getViewport().zoom; }}
            onMove={(_, viewport) => { zoom.current = viewport.zoom; }}
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.25} maxZoom={2}
            zoomOnScroll={false} preventScrolling={false}
            attributionPosition="bottom-left"
            aria-label={`${label} 작업 영역`}>
            <Background gap={20} size={1} color="var(--border)" />
            <ViewportPortal>
                {guides.map((guide) => <span
                    key={guide.axis}
                    data-ui="flow-alignment-guide" data-axis={guide.axis}
                    style={guide.axis === "x" ? { left: guide.value } :
                        { top: guide.value }} />)}
            </ViewportPortal>
            <Controls showInteractive={false} position="bottom-right" />
            {showMiniMap && <MiniMap pannable zoomable position="bottom-left"
                ariaLabel={`${label} 미니맵`} />}
        </ReactFlow>
        </FlowEdgeSelectContext.Provider>
        </FlowEdgeEditContext.Provider>
    </section>;
}

export { FlowCanvas, FlowEdgePath, FlowGroupCard, FlowNodeCard };
export type { FlowCanvasProps, FlowEdge, FlowEdgeData, FlowNode,
    FlowNodeData, FlowPoint };

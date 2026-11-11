import type { FlowNode, FlowEdge } from "./flow-canvas.tsx";
type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };
import { flowNodeSize } from "./flow-alignment.ts";

function translateFlowControls(graph: FlowGraph,
    nextNodes: FlowGraph["nodes"]): FlowGraph {
    const oldById = new Map(graph.nodes.map((node) => [node.id, node]));
    const newById = new Map(nextNodes.map((node) => [node.id, node]));
    function absolute(id: string, byId: Map<string, FlowGraph["nodes"][number]>) {
        let node = byId.get(id);
        let x = 0;
        let y = 0;
        const seen = new Set<string>();
        while (node && !seen.has(node.id)) {
            seen.add(node.id);
            x += node.position.x;
            y += node.position.y;
            node = node.parentId ? byId.get(node.parentId) : undefined;
        }
        return { x, y };
    }
    const edges = graph.edges.map((edge) => {
        const point = edge.data?.controlPoint;
        if (!point) return edge;
        const oldSource = absolute(edge.source, oldById);
        const newSource = absolute(edge.source, newById);
        const oldTarget = absolute(edge.target, oldById);
        const newTarget = absolute(edge.target, newById);
        const dx = (newSource.x - oldSource.x +
            newTarget.x - oldTarget.x) / 2;
        const dy = (newSource.y - oldSource.y +
            newTarget.y - oldTarget.y) / 2;
        if (dx === 0 && dy === 0) return edge;
        return { ...edge, data: { ...edge.data, controlPoint: {
            x: point.x + dx, y: point.y + dy,
        } } };
    });
    return { nodes: nextNodes, edges };
}

function layoutFlowGraph(graph: FlowGraph, order: readonly string[] = []): FlowGraph {
    const topNodes = graph.nodes.filter((node) => !node.parentId);
    if (topNodes.length === 0) return graph;
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    function topId(id: string) {
        let node = byId.get(id);
        const seen = new Set<string>();
        while (node?.parentId && !seen.has(node.id)) {
            seen.add(node.id);
            node = byId.get(node.parentId);
        }
        return node?.id;
    }
    const ranks = new Map(order.map((id, index) => [id, index]));
    const ids = topNodes.map((node) => node.id).sort((a, b) =>
        (ranks.get(a) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));
    const incoming = new Map(ids.map((id) => [id, new Set<string>()]));
    const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
    for (const edge of graph.edges) {
        const source = topId(edge.source);
        const target = topId(edge.target);
        if (!source || !target || source === target) continue;
        incoming.get(target)?.add(source);
        outgoing.get(source)?.add(target);
    }
    const remaining = new Set(ids);
    const layers = new Map<string, number>();
    while (remaining.size > 0) {
        const ready = ids.find((id) => remaining.has(id) &&
            [...(incoming.get(id) ?? [])].every((parent) =>
                !remaining.has(parent))) ?? ids.find((id) => remaining.has(id))!;
        const previous = [...(incoming.get(ready) ?? [])]
            .filter((id) => layers.has(id))
            .map((id) => layers.get(id)!);
        layers.set(ready, Math.max(layers.get(ready) ?? 0,
            previous.length ? Math.max(...previous) + 1 : 0));
        remaining.delete(ready);
        for (const next of outgoing.get(ready) ?? []) {
            incoming.get(next)?.delete(ready);
            if (!remaining.has(next)) continue;
            const level = (layers.get(ready) ?? 0) + 1;
            layers.set(next, Math.max(layers.get(next) ?? 0, level));
        }
    }
    const columns = new Map<number, string[]>();
    for (const id of ids) {
        const level = layers.get(id) ?? 0;
        columns.set(level, [...(columns.get(level) ?? []), id]);
    }
    const positions = new Map<string, { x: number; y: number }>();
    for (const [level, column] of columns) {
        let y = 70;
        for (const id of column) {
            const node = byId.get(id)!;
            positions.set(id, { x: 70 + level * 310, y });
            y += Math.max(150, flowNodeSize(node).height + 42);
        }
    }
    return translateFlowControls(graph,
        graph.nodes.map((node) => positions.has(node.id) ? {
            ...node, position: positions.get(node.id)!,
        } : node));
}

export { layoutFlowGraph, translateFlowControls };

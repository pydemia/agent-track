type AlignmentNode = {
    id: string;
    position: { x: number; y: number };
    parentId?: string;
    hidden?: boolean;
    width?: number;
    height?: number;
    measured?: { width?: number; height?: number };
};

const nodeWidth = 224;
const nodeHeight = 104;

function flowNodeSize(node: AlignmentNode) {
    return {
        width: node.measured?.width ?? node.width ?? nodeWidth,
        height: node.measured?.height ?? node.height ?? nodeHeight,
    };
}

type FlowGuide = { axis: "x" | "y"; value: number };
type FlowAlignment = { position: { x: number; y: number };
    guides: FlowGuide[] };

function alignFlowNode<Node extends AlignmentNode>(
    moving: Node, nodes: Node[], zoom = 1, tolerancePx = 7,
): FlowAlignment {
    const size = flowNodeSize(moving);
    const peers = nodes.filter((node) => node.id !== moving.id &&
        node.parentId === moving.parentId && !node.hidden);
    const tolerance = tolerancePx / Math.max(zoom, 0.25);
    const anchors = (start: number, length: number) =>
        [start, start + length / 2, start + length];
    function nearest(axis: "x" | "y") {
        const coordinate = moving.position[axis];
        const length = axis === "x" ? size.width : size.height;
        let best: { delta: number; value: number } | null = null;
        for (const peer of peers) {
            const otherLength = axis === "x" ? flowNodeSize(peer).width :
                flowNodeSize(peer).height;
            for (const selfAnchor of anchors(coordinate, length)) {
                for (const targetAnchor of anchors(peer.position[axis],
                    otherLength)) {
                    const delta = targetAnchor - selfAnchor;
                    if (Math.abs(delta) > tolerance ||
                        (best && Math.abs(delta) >= Math.abs(best.delta))) continue;
                    best = { delta, value: targetAnchor };
                }
            }
        }
        return best;
    }
    const x = nearest("x");
    const y = nearest("y");
    return {
        position: {
            x: moving.position.x + (x?.delta ?? 0),
            y: moving.position.y + (y?.delta ?? 0),
        },
        guides: [x && { axis: "x" as const, value: x.value },
            y && { axis: "y" as const, value: y.value }]
            .filter((guide): guide is FlowGuide => Boolean(guide)),
    };
}

export { alignFlowNode, flowNodeSize };
export type { AlignmentNode, FlowAlignment, FlowGuide };

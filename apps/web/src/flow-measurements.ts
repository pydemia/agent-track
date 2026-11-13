import type { NodeChange } from "@xyflow/react";
import type { FlowNode } from "./ui/flow-canvas.tsx";

export type FlowMeasurements = ReadonlyMap<string, { width: number; height: number }>;
export function captureFlowMeasurements(previous: FlowMeasurements, changes: NodeChange<FlowNode>[]): FlowMeasurements {
  let next: Map<string, { width: number; height: number }> | undefined;
  for (const change of changes) {
    if (change.type !== "dimensions" || !change.dimensions) continue;
    const { width, height } = change.dimensions;
    if (![width, height].every(value => Number.isFinite(value) && value > 0)) continue;
    const current = (next ?? previous).get(change.id);
    if (current?.width === width && current.height === height) continue;
    next ??= new Map(previous); next.set(change.id, { width, height });
  }
  return next ?? previous;
}

/** Controlled node refreshes retain port bounds only while measured geometry matches. */
export function measuredFlowNodes(nodes: FlowNode[], measured: FlowMeasurements): FlowNode[] {
  return nodes.map(node => {
    if (node.measured) return node;
    const size = measured.get(node.id);
    if (!size || node.width !== undefined && node.width !== size.width || node.height !== undefined && node.height !== size.height) return node;
    return { ...node, measured: { ...size } };
  });
}

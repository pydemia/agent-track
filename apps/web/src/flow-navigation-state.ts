import type { MissionEdge, MissionNode } from "../../../packages/projection/mission-flow.ts";
import type { FlowGroupSummary } from "../../../packages/projection/flow-groups.ts";

export type FlowNavigationSelection = { kind: "node" | "edge"; key: string };
export type FlowNavigationView = { x: number; y: number; zoom: number; width: number; height: number };
export interface FlowNavigationFrame {
  focus: string | null;
  targets: string[];
  overrides: Array<[string, boolean]>;
  selection: FlowNavigationSelection | null;
  view: FlowNavigationView | null;
}
export interface FlowNavigationHistory { scope: string; graph: string; frames: FlowNavigationFrame[] }

const membership = (keys: string[]): string[] => [...new Set(keys)].sort();
const ordered = (rows: unknown[][]): string[] => rows.map(row => JSON.stringify(row)).sort();

/** Structural identity only: no presentation, status, or sequence evidence. */
export function flowNavigationGraph(nodes: MissionNode[], edges: MissionEdge[], groups: FlowGroupSummary[]): string {
  return JSON.stringify([
    ordered(nodes.map(node => [node.key, node.kind, node.sourceId, node.id, node.runKey ?? null])),
    ordered(edges.map(edge => [edge.key, edge.from, edge.to, edge.kind, edge.sourceId])),
    ordered(groups.map(group => [group.key, group.kind, group.sourceId, group.basis, group.parentKey ?? null,
      membership(group.memberKeys), membership(group.leafKeys)])),
  ]);
}

export function validFlowNavigationView(value: FlowNavigationView): boolean {
  return value !== null && typeof value === "object" &&
    [value.x, value.y, value.zoom, value.width, value.height].every(Number.isFinite) &&
    value.zoom > 0 && value.zoom <= 64 && value.width > 0 && value.height > 0;
}

/** Reject malformed key/state fields; an invalid camera is normalized to null.
 * Explicit field copying excludes extra properties and caller-owned references.
 * Selection membership is validated by the capturing consumer, not this helper.
 */
function cloneFrame(frame: FlowNavigationFrame): FlowNavigationFrame | null {
  if (!frame || typeof frame !== "object" ||
    (frame.focus !== null && typeof frame.focus !== "string") ||
    !Array.isArray(frame.targets) || !frame.targets.every(key => typeof key === "string") ||
    !Array.isArray(frame.overrides) || !frame.overrides.every(entry => Array.isArray(entry) &&
      entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "boolean") ||
    (frame.selection !== null && (!frame.selection ||
      (frame.selection.kind !== "node" && frame.selection.kind !== "edge") || typeof frame.selection.key !== "string"))) return null;
  const view = validFlowNavigationView(frame.view!) ? {
    x: frame.view!.x, y: frame.view!.y, zoom: frame.view!.zoom, width: frame.view!.width, height: frame.view!.height,
  } : null;
  return {
    focus: frame.focus, targets: [...frame.targets], overrides: frame.overrides.map(([key, collapsed]) => [key, collapsed]),
    selection: frame.selection === null ? null : { kind: frame.selection.kind, key: frame.selection.key }, view,
  };
}

/** Scope/topology checks precede reading any old frame. No persistence is used. */
export function reconcileFlowHistory(history: FlowNavigationHistory, scope: string, graph: string): FlowNavigationHistory {
  if (history.scope !== scope || history.graph !== graph) return { scope, graph, frames: [] };
  const frames: FlowNavigationFrame[] = [];
  for (const frame of history.frames.slice(-32)) {
    const copy = cloneFrame(frame);
    if (copy) frames.push(copy);
  }
  return { scope, graph, frames };
}

export function pushFlowHistory(history: FlowNavigationHistory, scope: string, graph: string, frame: FlowNavigationFrame): FlowNavigationHistory {
  const current = reconcileFlowHistory(history, scope, graph);
  const copy = cloneFrame(frame);
  if (copy) current.frames = [...current.frames, copy].slice(-32);
  return current;
}

export function popFlowHistory(history: FlowNavigationHistory, scope: string, graph: string, target?: string | null): { history: FlowNavigationHistory; frame: FlowNavigationFrame | null } {
  const current = reconcileFlowHistory(history, scope, graph);
  for (let index = current.frames.length - 1; index >= 0; index--) {
    const frame = current.frames[index]!;
    if (target === undefined || frame.focus === target) {
      return { history: { scope, graph, frames: current.frames.slice(0, index) }, frame: cloneFrame(frame) };
    }
  }
  return { history: current, frame: null };
}

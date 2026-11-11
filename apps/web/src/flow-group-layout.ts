import type { FlowNode, FlowEdge } from "./ui/flow-canvas.tsx";
import { layoutFlowGraph } from "./ui/flow-layout.ts";

/** Pack children in parent-relative coordinates, then size and place their containers. */
export function layoutGroupedFlow(nodes: FlowNode[], edges: FlowEdge[], order: string[] = []): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const byId = new Map(nodes.map(node => [node.id, { ...node, position: { ...node.position } }]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    const parent = node.parentId ?? "";
    const members = children.get(parent) ?? []; members.push(node.id); children.set(parent, members);
  }
  const groupIds = nodes.filter(node => node.type === "pyd-flow-group" && node.data.group?.collapsed !== true).map(node => node.id);
  const depth = (id: string) => {
    let count = 0; let current = byId.get(id); const seen = new Set<string>();
    while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); count++; current = byId.get(current.parentId); }
    return count;
  };
  const pack = (parent: string) => {
    const ids = children.get(parent) ?? [];
    if (!ids.length) return;
    const members = new Set(ids);
    const representative = (id: string): string | undefined => {
      let current = byId.get(id); const seen = new Set<string>();
      while (current && !members.has(current.id) && current.parentId && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.parentId); }
      return current && members.has(current.id) ? current.id : undefined;
    };
    const localEdges = edges.filter(edge => !edge.className?.includes("record-order")).flatMap(edge => {
      const source = representative(edge.source); const target = representative(edge.target);
      return source && target && source !== target ? [{ ...edge, source, target }] : [];
    });
    const localNodes = ids.map(id => { const { parentId: _parent, extent: _extent, ...node } = byId.get(id)!; return node; });
    const layout = layoutFlowGraph({ nodes: localNodes, edges: localEdges }, order);
    for (const laidOut of layout.nodes) {
      const node = byId.get(laidOut.id)!;
      // Reserve a functional group header, keeping its buttons clear of child cards.
      byId.set(node.id, { ...node, position: { x: laidOut.position.x - 46, y: laidOut.position.y + (parent ? 84 : -46) } });
    }
    if (parent) {
      const node = byId.get(parent)!;
      const width = Math.max(320, ...ids.map(id => byId.get(id)!.position.x + Number(byId.get(id)!.width ?? 240) + 24));
      const height = Math.max(180, ...ids.map(id => byId.get(id)!.position.y + Number(byId.get(id)!.height ?? 136) + 24));
      byId.set(parent, { ...node, width, height, style: { ...node.style, width, height } });
    }
  };
  for (const id of groupIds.sort((a, b) => depth(b) - depth(a) || a.localeCompare(b))) pack(id);
  pack("");
  const output: FlowNode[] = []; const queue = [...(children.get("") ?? [])];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!; output.push(byId.get(id)!); queue.push(...(children.get(id) ?? []));
  }
  return { nodes: output, edges };
}

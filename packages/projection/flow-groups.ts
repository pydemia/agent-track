import type { MissionEdge, MissionNode } from "./mission-flow.ts";

export const flowGroupKey = (kind: string, key: string) => JSON.stringify(["flow-container", kind, key]);

export interface FlowGroupDefinition {
  key: string;
  label: string;
  kind: string;
  basis: "native" | "binding" | "view";
  sourceId: string;
  memberKeys: string[];
  parentKey?: string;
  description: string;
}

export interface FlowGroupSummary extends FlowGroupDefinition {
  leafKeys: string[];
  childGroupKeys: string[];
  counts: Record<string, number>;
  statusCounts: Record<string, number>;
  internalEdges: number;
  boundaryEdges: number;
  cyclicMembers: number;
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Count members of dependency SCCs in this induced graph, without recursive DFS. */
function cyclicMembers(leaves: Set<string>, forward: Map<string, string[]>, reverse: Map<string, string[]>): number {
  const visited = new Set<string>();
  const finished: string[] = [];
  for (const key of leaves) {
    if (visited.has(key)) continue;
    visited.add(key);
    const stack: Array<{ key: string; index: number }> = [{ key, index: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const links = forward.get(frame.key) ?? [];
      if (frame.index === links.length) { finished.push(frame.key); stack.pop(); continue; }
      const next = links[frame.index++]!;
      if (leaves.has(next) && !visited.has(next)) { visited.add(next); stack.push({ key: next, index: 0 }); }
    }
  }
  visited.clear();
  let count = 0;
  for (let index = finished.length - 1; index >= 0; index--) {
    const key = finished[index]!;
    if (visited.has(key)) continue;
    const stack = [key];
    visited.add(key);
    let size = 0;
    while (stack.length) {
      const current = stack.pop()!;
      size++;
      for (const next of reverse.get(current) ?? []) {
        if (leaves.has(next) && !visited.has(next)) { visited.add(next); stack.push(next); }
      }
    }
    if (size > 1 || forward.get(key)?.includes(key)) count += size;
  }
  return count;
}

/** Metadata-only visual projection. Membership never changes native authority or Task binding. */
export function projectFlowGroups(
  model: { nodes: MissionNode[]; edges: MissionEdge[]; incomplete?: boolean },
  definitions: FlowGroupDefinition[],
  collapsedKeys: ReadonlySet<string>,
): {
  nodes: MissionNode[];
  edges: MissionEdge[];
  groups: FlowGroupSummary[];
  parents: Map<string, string>;
  edgeEvidence: Map<string, MissionEdge[]>;
  invalidGroups: string[];
} {
  const native = new Map(model.nodes.map((node) => [node.key, node]));
  const byKey = new Map<string, FlowGroupDefinition>();
  const invalid = new Set<string>();
  const neighbors = new Map<string, Set<string>>();
  const owners = new Map<string, Set<string>>();
  for (const definition of definitions) {
    if (byKey.has(definition.key) || native.has(definition.key)) invalid.add(definition.key);
    byKey.set(definition.key, definition);
    for (const member of definition.memberKeys) {
      if (!native.has(member)) invalid.add(definition.key);
      const memberships = owners.get(member) ?? new Set<string>();
      memberships.add(definition.key); owners.set(member, memberships);
    }
    if (definition.parentKey !== undefined) {
      for (const [from, to] of [[definition.key, definition.parentKey], [definition.parentKey, definition.key]]) {
        const links = neighbors.get(from!) ?? new Set<string>();
        links.add(to!); neighbors.set(from!, links);
      }
    }
  }
  for (const memberships of owners.values()) if (memberships.size > 1) for (const key of memberships) invalid.add(key);
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const definition of byKey.values()) {
    if (definition.parentKey === undefined) roots.push(definition.key);
    else if (!byKey.has(definition.parentKey)) invalid.add(definition.key);
    else {
      const links = children.get(definition.parentKey) ?? [];
      links.push(definition.key); children.set(definition.parentKey, links);
    }
  }
  const ordered: string[] = [...roots].sort(compare);
  for (let index = 0; index < ordered.length; index++) ordered.push(...(children.get(ordered[index]!) ?? []).sort(compare));
  const reachable = new Set(ordered);
  for (const key of byKey.keys()) if (!reachable.has(key)) invalid.add(key);
  // An invalid subtree makes its ancestors incomplete; descendants also lose a
  // valid parent. Reject the affected hierarchy rather than silently reparenting.
  const rejected = [...invalid];
  for (let index = 0; index < rejected.length; index++) {
    for (const key of neighbors.get(rejected[index]!) ?? []) {
      if (byKey.has(key) && !invalid.has(key)) { invalid.add(key); rejected.push(key); }
    }
  }
  const validOrder = ordered.filter((key) => !invalid.has(key));
  const incident = new Map<string, number[]>();
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  model.edges.forEach((edge, index) => {
    if (!native.has(edge.from) || !native.has(edge.to)) return;
    for (const key of new Set([edge.from, edge.to])) {
      const links = incident.get(key) ?? []; links.push(index); incident.set(key, links);
    }
    if (edge.kind === "dependency") {
      const outgoing = forward.get(edge.from) ?? []; outgoing.push(edge.to); forward.set(edge.from, outgoing);
      const incoming = reverse.get(edge.to) ?? []; incoming.push(edge.from); reverse.set(edge.to, incoming);
    }
  });
  const summaries = new Map<string, FlowGroupSummary>();
  for (let index = validOrder.length - 1; index >= 0; index--) {
    const definition = byKey.get(validOrder[index]!)!;
    const childGroupKeys = [...(children.get(definition.key) ?? [])].sort(compare);
    const leaves = new Set(definition.memberKeys);
    for (const child of childGroupKeys) for (const leaf of summaries.get(child)!.leafKeys) leaves.add(leaf);
    const leafKeys = [...leaves].sort(compare);
    const counts: Record<string, number> = Object.create(null);
    const statusCounts: Record<string, number> = Object.create(null);
    const runs = new Set<string>();
    const edgeIndices = new Set<number>();
    for (const key of leafKeys) {
      const node = native.get(key)!;
      counts[node.kind] = (counts[node.kind] ?? 0) + 1;
      statusCounts[node.status] = (statusCounts[node.status] ?? 0) + 1;
      if (node.kind === "run" && node.runKey) runs.add(JSON.stringify([node.sourceId, node.runKey]));
      for (const edgeIndex of incident.get(key) ?? []) edgeIndices.add(edgeIndex);
    }
    counts.uniqueRun = runs.size;
    let internalEdges = 0;
    let boundaryEdges = 0;
    for (const edgeIndex of edgeIndices) {
      const edge = model.edges[edgeIndex]!;
      if (leaves.has(edge.from) && leaves.has(edge.to)) internalEdges++;
      else boundaryEdges++;
    }
    summaries.set(definition.key, {
      ...definition, memberKeys: [...new Set(definition.memberKeys)].sort(compare), leafKeys, childGroupKeys,
      counts, statusCounts, internalEdges, boundaryEdges, cyclicMembers: cyclicMembers(leaves, forward, reverse),
    });
  }
  const parents = new Map<string, string>();
  const representative = new Map<string, string>();
  const collapsedAncestor = new Map<string, string>();
  const nodes: MissionNode[] = [];
  for (const key of validOrder) {
    const group = summaries.get(key)!;
    const ancestor = group.parentKey === undefined ? undefined : collapsedAncestor.get(group.parentKey);
    const hiddenBy = ancestor ?? (collapsedKeys.has(key) ? key : undefined);
    if (hiddenBy !== undefined) collapsedAncestor.set(key, hiddenBy);
    if (ancestor === undefined) {
      if (group.parentKey !== undefined) parents.set(key, group.parentKey);
      nodes.push({
        key, id: key, kind: "container", label: group.label, status: "group-summary", sourceId: group.sourceId,
        description: `${group.description} · basis: ${group.basis}`, sequences: [],
        details: [
          { label: "count", value: String(group.leafKeys.length) },
          { label: "kind", value: JSON.stringify(group.counts) },
          { label: "status", value: JSON.stringify(group.statusCounts) },
          { label: "partial", value: String(Boolean(model.incomplete)) },
          { label: "source", value: group.sourceId },
          { label: "basis", value: group.basis },
          { label: "internalEdges", value: String(group.internalEdges) },
          { label: "boundaryEdges", value: String(group.boundaryEdges) },
          { label: "cyclicMembers", value: String(group.cyclicMembers) },
        ],
      });
    }
    for (const member of group.memberKeys) {
      representative.set(member, hiddenBy ?? member);
      if (hiddenBy === undefined) parents.set(member, key);
    }
  }
  for (const node of model.nodes) if ((representative.get(node.key) ?? node.key) === node.key) nodes.push(node);
  const buckets = new Map<string, { from: string; to: string; originals: MissionEdge[] }>();
  for (const edge of model.edges) {
    if (!native.has(edge.from) || !native.has(edge.to)) continue;
    const from = representative.get(edge.from) ?? edge.from;
    const to = representative.get(edge.to) ?? edge.to;
    if (from === to && (from !== edge.from || to !== edge.to)) continue;
    const key = JSON.stringify([edge.sourceId, from, to, edge.kind]);
    const bucket = buckets.get(key) ?? { from, to, originals: [] };
    bucket.originals.push(edge); buckets.set(key, bucket);
  }
  const edges: MissionEdge[] = [];
  const edgeEvidence = new Map<string, MissionEdge[]>();
  for (const [identity, { from, to, originals }] of [...buckets].sort(([a], [b]) => compare(a, b))) {
    originals.sort((a, b) => compare(a.key, b.key));
    if (originals.every((edge) => edge.from === from && edge.to === to)) {
      for (const edge of originals) { edges.push(edge); edgeEvidence.set(edge.key, [edge]); }
    } else {
      const first = originals[0]!;
      const key = JSON.stringify(["flow-group-edge", JSON.parse(identity)]);
      edges.push({ key, from, to, kind: first.kind, sourceId: first.sourceId, sequences: [],
        label: `${first.label} · ${originals.length}개 관계`,
        detail: "그룹 경계의 시각적 대표선입니다. 새로운 의존 관계가 아닙니다. 원본 관계와 각 sequence는 상세 근거에서 별도로 확인합니다.",
      });
      edgeEvidence.set(key, originals);
    }
  }
  return {
    nodes: nodes.sort((a, b) => compare(a.key, b.key)), edges: edges.sort((a, b) => compare(a.key, b.key)),
    groups: [...summaries.values()].sort((a, b) => compare(a.key, b.key)),
    parents: new Map([...parents].sort(([a], [b]) => compare(a, b))), edgeEvidence,
    invalidGroups: [...invalid].sort(compare),
  };
}

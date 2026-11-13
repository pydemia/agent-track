import type { FlowGroupSummary } from "./flow-groups.ts";
import { missionUnitKind, type MissionEdge, type MissionNode } from "./mission-flow.ts";

export interface FlowGroupContext {
  partial: boolean;
  memberCount: number;
  statusByKind: Array<{ kind: string; states: Array<{ state: string; count: number }> }>;
  concerns: Array<{ nodeKey: string; kind: "approval_wait" | "runtime_wait" | "failed" | "review" }>;
  dependencies: Array<{ edgeKey: string; fromKey: string; toKey: string; direction: "incoming" | "outgoing" | "internal" }>;
  artifacts: Array<{ nodeKey: string; relationship: "output" | "association" | "reference"; edgeKey?: string }>;
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const statusKinds = new Set(["task", "run", "assistant-execution", "assistant-role", "invocation", "tool", "group", "member"]);
const failureKinds = new Set(["run", "assistant-execution", "assistant-role", "invocation", "tool", "group", "member"]);

// Compare only the existing metadata shape, without interpreting detail text.
const nodeSignature = (node: MissionNode): string => JSON.stringify([
  node.kind, node.id, node.sourceId, node.status, node.runKey, node.callId, node.invocationId,
  node.label, node.description, node.details.map(item => [item.label, item.value]), node.sequences,
  node.coworkRef,
]);
const edgeSignature = (edge: MissionEdge): string => JSON.stringify([
  edge.from, edge.to, edge.kind, edge.sourceId, edge.label, edge.detail, edge.sequences,
]);

function unambiguous<T extends { key: string; sourceId: string }>(
  items: T[], signature: (item: T) => string,
): Map<string, T> {
  const current = new Map<string, T>();
  const signatures = new Map<string, string>();
  const rejected = new Set<string>();
  for (const item of items) {
    if (rejected.has(item.key)) continue;
    const value = signature(item);
    if (!item.key || !item.sourceId || (signatures.has(item.key) && signatures.get(item.key) !== value)) {
      current.delete(item.key);
      rejected.add(item.key);
    } else {
      current.set(item.key, item);
      signatures.set(item.key, value);
    }
  }
  return current;
}

/** Bounded current metadata only. Keys are opaque source-qualified projection keys. */
export function flowGroupContext(
  group: Pick<FlowGroupSummary, "leafKeys">,
  nodes: MissionNode[],
  edges: MissionEdge[],
  incomplete = false,
): FlowGroupContext {
  const current = unambiguous(nodes, nodeSignature);
  const requested = new Set(group.leafKeys);
  const members = [...current.values()].filter(node => requested.has(node.key))
    .sort((a, b) => compare(a.key, b.key));
  const memberKeys = new Set(members.map(node => node.key));
  const result: FlowGroupContext = {
    partial: incomplete || members.length !== requested.size,
    memberCount: members.length, statusByKind: [], concerns: [], dependencies: [], artifacts: [],
  };
  const counts = new Map<string, Map<string, number>>();
  const runs = new Map<string, MissionNode>();
  const conflictingRuns = new Set<string>();
  for (const node of current.values()) {
    if (node.kind !== "run" || !node.runKey) continue;
    const identity = JSON.stringify([node.sourceId, node.runKey]);
    const previous = runs.get(identity);
    if (previous && (previous.id !== node.id || previous.status !== node.status)) conflictingRuns.add(identity);
    else if (!previous) runs.set(identity, node);
  }
  const countedRuns = new Set<string>();
  for (const node of members) {
    if (node.kind === "run" && node.runKey) {
      const identity = JSON.stringify([node.sourceId, node.runKey]);
      if (conflictingRuns.has(identity)) { result.partial = true; continue; }
      if (countedRuns.has(identity)) continue;
      countedRuns.add(identity);
    }
    if (statusKinds.has(node.kind)) {
      const unitKind = missionUnitKind(node);
      const states = counts.get(unitKind) ?? new Map<string, number>();
      states.set(node.status, (states.get(node.status) ?? 0) + 1);
      counts.set(unitKind, states);
    }
    let concern: FlowGroupContext["concerns"][number]["kind"] | undefined;
    if (node.kind === "run" && node.status === "waiting_for_permission") concern = "approval_wait";
    else if (node.kind === "assistant-role" && ["awaiting_connection", "awaiting_runtime"].includes(node.status)) concern = "runtime_wait";
    else if (node.kind === "task" && node.status === "in_review") concern = "review";
    else if (failureKinds.has(node.kind) && node.status === "failed") concern = "failed";
    if (concern) result.concerns.push({ nodeKey: node.key, kind: concern });
  }
  result.statusByKind = [...counts].sort(([a], [b]) => compare(a, b)).map(([kind, states]) => ({
    kind, states: [...states].sort(([a], [b]) => compare(a, b)).map(([state, count]) => ({ state, count })),
  }));

  const artifactRelations = new Map<string, FlowGroupContext["artifacts"]>();
  const artifactProducers = new Map<string, Set<string>>();
  const currentEdges = unambiguous(edges, edgeSignature);
  for (const edge of [...currentEdges.values()].sort((a, b) => compare(a.key, b.key))) {
    const fromInside = memberKeys.has(edge.from);
    const toInside = memberKeys.has(edge.to);
    if (!fromInside && !toInside) continue;
    if (!["dependency", "cowork-dependency", "artifact-output", "artifact-association"].includes(edge.kind)) continue;
    const from = current.get(edge.from);
    const to = current.get(edge.to);
    // These native relations are source-local. Never resolve a bare ID in another source.
    if (!from || !to || edge.sourceId !== from.sourceId || edge.sourceId !== to.sourceId) {
      result.partial = true;
      continue;
    }
    if (edge.kind === "dependency" && from.kind === "task" && to.kind === "task" ||
        edge.kind === "cowork-dependency" && from.kind === "member" && to.kind === "member" && from.runKey && from.runKey === to.runKey &&
        from.coworkRef?.groupId && from.coworkRef.groupId === to.coworkRef?.groupId) {
      result.dependencies.push({ edgeKey: edge.key, fromKey: from.key, toKey: to.key,
        direction: fromInside ? toInside ? "internal" : "outgoing" : "incoming" });
    }
    if (edge.kind !== "dependency" && fromInside && toInside && from.kind === "run" && from.runKey && to.kind === "artifact") {
      if (conflictingRuns.has(JSON.stringify([from.sourceId, from.runKey])) || to.runKey && to.runKey !== from.runKey) {
        result.partial = true;
        continue;
      }
      const relations = artifactRelations.get(to.key) ?? [];
      relations.push({ nodeKey: to.key, relationship: edge.kind === "artifact-output" ? "output" : "association", edgeKey: edge.key });
      artifactRelations.set(to.key, relations);
      const producers = artifactProducers.get(to.key) ?? new Set<string>();
      producers.add(JSON.stringify([from.sourceId, from.runKey])); artifactProducers.set(to.key, producers);
    }
  }
  // A conflicting incident edge is omitted, but its missing evidence is not completeness.
  if (edges.some(edge => !currentEdges.has(edge.key) &&
    (memberKeys.has(edge.from) || memberKeys.has(edge.to)))) result.partial = true;
  for (const node of members) {
    if (node.kind !== "artifact") continue;
    const links = artifactRelations.get(node.key) ?? [];
    const ambiguousProducer = (artifactProducers.get(node.key)?.size ?? 0) > 1;
    if (ambiguousProducer) result.partial = true;
    // Count the artifact once. Keep one explicit output proof, otherwise one
    // association; conflicting Run provenance remains a reference only.
    const proof = !ambiguousProducer && (links.find(link => link.relationship === "output") ?? links[0]);
    result.artifacts.push(proof || { nodeKey: node.key, relationship: "reference" });
  }
  return result;
}

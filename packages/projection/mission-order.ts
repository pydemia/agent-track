import type { MissionFlow, MissionNode } from "./mission-flow.ts";

/** Keep Session→Run lanes aligned; chronology still orders calls within a Run. */
export function missionNodeOrder(flow: Pick<MissionFlow, "nodes" | "edges">): string[] {
  const byKey = new Map(flow.nodes.map((node) => [node.key, node]));
  const sessions = new Map<string, string[]>();
  for (const edge of flow.edges) {
    if (edge.kind !== "ownership" || byKey.get(edge.from)?.kind !== "session" || byKey.get(edge.to)?.kind !== "run") continue;
    const parents = sessions.get(edge.to) ?? []; parents.push(edge.from); sessions.set(edge.to, parents);
  }
  const lane = (node: MissionNode) => node.kind === "session" ? node.key : node.kind === "run" ? sessions.get(node.key)?.sort()[0] ?? node.key : "";
  return [...flow.nodes].sort((a, b) => a.kind.localeCompare(b.kind) || lane(a).localeCompare(lane(b)) ||
    (a.sequences[0] ?? "0").length - (b.sequences[0] ?? "0").length ||
    (a.sequences[0] ?? "0").localeCompare(b.sequences[0] ?? "0") || a.key.localeCompare(b.key)).map((node) => node.key);
}

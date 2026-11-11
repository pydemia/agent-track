import type { RelationView, RunView } from "../contracts/index.ts";

export interface MissionSummary {
  key: string;
  title: string;
  project: string;
  runs: RunView[];
  sessions: number;
  devices: string[];
  sources: string[];
  active: number;
  decisions: number;
  failed: number;
  uncertain: number;
  childRelations: number;
  peerRelations: number;
}

/** Current explicit bindings group work across sessions; titles never imply identity. */
export function missionOverview(runs: RunView[], relations: RelationView[]): MissionSummary[] {
  const groups = new Map<string, RunView[]>();
  for (const run of new Map(runs.map((value) => [value.key, value])).values()) {
    if (!run.binding?.taskId) continue;
    const key = JSON.stringify([run.binding.projectSourceId, run.binding.projectId, run.binding.taskId]);
    const group = groups.get(key) ?? []; group.push(run); groups.set(key, group);
  }
  return [...groups].map(([key, values]) => {
    const ordered = values.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.key.localeCompare(b.key));
    const current = ordered[0]!.binding!; const keys = new Set(ordered.map((run) => run.key));
    const links = new Map(relations.filter((relation) => keys.has(relation.runKey)).map((relation) =>
      [JSON.stringify([ordered.find((run) => run.key === relation.runKey)!.sourceId, relation.kind, relation.from, relation.to]), relation]));
    return { key, title: current.taskTitle ?? current.taskId!, project: current.projectTitle, runs: ordered,
      sessions: new Set(ordered.map((run) => JSON.stringify([run.sourceId, run.sessionId]))).size,
      devices: [...new Set(ordered.map((run) => run.device))].sort(), sources: [...new Set(ordered.map((run) => run.sourceLabel))].sort(),
      active: ordered.filter((run) => ["queued", "leasing", "running", "waiting_for_permission", "cancelling"].includes(run.status)).length,
      decisions: ordered.filter((run) => run.status === "waiting_for_permission").length,
      failed: ordered.filter((run) => ["failed", "expired", "interrupted"].includes(run.status)).length,
      uncertain: ordered.filter((run) => run.stale || run.incomplete || run.sourceState !== "connected" || run.status === "unknown").length,
      childRelations: [...links.values()].filter((link) => link.kind === "managed-child").length,
      peerRelations: [...links.values()].filter((link) => link.kind === "peer").length };
  }).sort((a, b) => b.decisions - a.decisions || b.active - a.active || b.uncertain - a.uncertain || a.title.localeCompare(b.title));
}

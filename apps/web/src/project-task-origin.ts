import type { SourceView } from "../../../packages/contracts/index.ts";

export interface ProjectTaskRef { sourceId: string; projectId: string; taskId: string }
export type ProjectTaskOrigin = { state: "ready"; href: string } | { state: "unavailable" | "unsupported" };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** A link selects the original entity; the destination still authenticates it. */
export function projectTaskOrigin(sources: readonly SourceView[], task: ProjectTaskRef): ProjectTaskOrigin {
  const matches = sources.filter(source => source.id === task.sourceId);
  if (matches.length !== 1 || !uuid.test(task.projectId) || !uuid.test(task.taskId)) return { state: "unavailable" };
  const source = matches[0]!;
  if (source.kind !== "projects" || source.state !== "connected" || !source.authorizedProjectIds?.includes(task.projectId)) return { state: "unavailable" };
  if (!source.uiBaseUrl || source.uiBaseUrl.length > 2000 || source.uiBaseUrl.trim() !== source.uiBaseUrl) return { state: "unsupported" };
  try {
    const url = new URL(source.uiBaseUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return { state: "unsupported" };
    url.search = new URLSearchParams({ project: task.projectId, view: "tasks", item: task.taskId, kind: "task" }).toString();
    return { state: "ready", href: url.href };
  } catch { return { state: "unsupported" }; }
}

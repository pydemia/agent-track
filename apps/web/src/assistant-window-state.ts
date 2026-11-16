import type { SourceView } from "../../../packages/contracts/index.ts";
import type { AssistantExecutionView } from "../../../packages/contracts/assistant-view.ts";

/** Native Run snapshots are projected separately; they cannot revoke the whole Assistant window. */
export function assistantWindowScope(user: string | null, sources: SourceView[]): string {
  return JSON.stringify([user,
    sources.filter(source => source.kind === "assistant" && source.state !== "unsupported")
      .map(source => [source.id, source.state]).sort(),
    sources.filter(source => source.kind === "projects").map(source => [source.id, source.state,
      [...(source.authorizedProjectIds ?? [])].sort()]).sort(),
  ]);
}

export const assistantDetailScope = (view: AssistantExecutionView) => JSON.stringify([
  view.sourceId, view.native.id, view.native.revision,
  view.currentTask?.projectsSourceId, view.currentTask?.project.id,
  view.currentTask?.task.id, view.currentTask?.task.revision, view.currentTask?.project.accessRevision,
]);

/** Keep navigation mounted, but never let a retained detail override the latest list authority. */
export function currentAssistantDetail(detail: AssistantExecutionView | null, current: AssistantExecutionView): AssistantExecutionView | null {
  if (!detail || assistantDetailScope(detail) !== assistantDetailScope(current)) return null;
  const { demianLinks: previousLinks, ...metadata } = detail;
  const latestLinks = current.demianLinks;
  if (!previousLinks || !latestLinks) return metadata;
  if (previousLinks.state !== "connected" || latestLinks.state !== "connected") {
    const denied = previousLinks.state !== "connected" ? previousLinks : latestLinks;
    return { ...metadata, demianLinks: { ...denied, links: [] } };
  }
  const allowed = new Set(latestLinks.links.map(linkIdentity));
  const links = previousLinks.links.filter(link => allowed.has(linkIdentity(link)));
  return { ...metadata, demianLinks: { ...previousLinks, links,
    omitted: Math.max(previousLinks.omitted, previousLinks.links.length - links.length) } };
}

const linkIdentity = (link: NonNullable<AssistantExecutionView["demianLinks"]>["links"][number]) =>
  JSON.stringify([link.roleId, link.sourceId, link.runKey, link.runId, link.sessionId, link.workspaceId, link.operationId]);

export const assistantLinkScope = (view: AssistantExecutionView) => JSON.stringify([
  view.demianLinks?.state, view.demianLinks?.links.map(linkIdentity).sort(),
]);

import { ProjectsSourceError, type ProjectsClient } from "../../packages/adapters/projects/index.ts";
import type { ProjectDependencyPage } from "../../packages/contracts/project-dependencies.ts";
import type { SourceView } from "../../packages/contracts/index.ts";
import type { Config } from "./config.ts";
import { sourceIdentity } from "./source-identity.ts";

export interface DependencyAuthority {
  refreshProjectGrants(user: string): Promise<void>;
  views(user: string): SourceView[];
  projects: { client(sourceId: string, user: string): Pick<ProjectsClient, "dependencies"> };
}

/** A link's owner and both endpoint Projects must survive the final native ACL refresh. */
export async function projectDependencies(config: () => Config, sources: DependencyAuthority, user: string, sourceId: string, projectId: string): Promise<ProjectDependencyPage> {
  const initial = config().sources.find((source) => source.id === sourceId && source.kind === "projects");
  if (!initial) throw new ProjectsSourceError(404);
  const identity = sourceIdentity(initial);
  const grants = () => {
    const current = config();
    const source = current.sources.find((candidate) => candidate.id === sourceId && candidate.kind === "projects");
    const actorAllowed = current.auth.mode === "proxy" ? current.auth.users.includes(user) : current.auth.user === user;
    if (!actorAllowed || !source || !source.users.includes(user) || source.projectsUser !== user || sourceIdentity(source) !== identity) throw new ProjectsSourceError(404);
    const view = sources.views(user).find((candidate) => candidate.id === sourceId && candidate.kind === "projects" && candidate.state === "connected");
    const allowed = new Set(view?.authorizedProjectIds ?? []);
    if (!allowed.has(projectId)) throw new ProjectsSourceError(404);
    return allowed;
  };
  await sources.refreshProjectGrants(user);
  grants();
  const page = await sources.projects.client(sourceId, user).dependencies(projectId);
  await sources.refreshProjectGrants(user);
  const allowed = grants();
  if (page.sourceId !== sourceId || page.projectId !== projectId || page.dependencies.some((edge) =>
    ![edge.projectId, edge.fromTask.projectId, edge.toTask.projectId].every((id) => allowed.has(id)))) throw new ProjectsSourceError(404);
  return page;
}

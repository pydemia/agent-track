import { z } from "zod";
import { ProjectsSourceError } from "../../packages/adapters/projects/index.ts";
import type { ProjectTaskMetadata } from "../../packages/contracts/index.ts";
import type { Sources } from "./runner.ts";

type TaskMetadataSources = Pick<Sources, "refreshProjectGrants" | "views" | "projects">;

const sourceIdPattern = /^[a-z0-9_-]{1,80}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const taskMetadataSchema = z.object({
  id: z.string().regex(uuidPattern),
  projectId: z.string().regex(uuidPattern),
  title: z.string().min(1).max(300),
  revision: z.string().regex(/^[1-9][0-9]{0,18}$/).refine((value) => BigInt(value) <= 9223372036854775807n),
  state: z.string().min(1).max(100),
  requiresTest: z.boolean(),
}).strict();

/** Read one task's bounded metadata under the current native project grant. */
export async function projectTaskMetadata(
  sources: TaskMetadataSources,
  user: string,
  sourceId: string,
  projectId: string,
  taskId: string,
): Promise<{ actor: string; sourceId: string; projectId: string; task: ProjectTaskMetadata }> {
  if (!sourceIdPattern.test(sourceId) || !uuidPattern.test(projectId) || !uuidPattern.test(taskId)) {
    throw new ProjectsSourceError(400);
  }

  const authorize = () => {
    const view = sources.views(user).find((candidate) =>
      candidate.id === sourceId && candidate.kind === "projects" && candidate.state === "connected");
    if (!view?.authorizedProjectIds?.includes(projectId)) throw new ProjectsSourceError(404);
  };

  await sources.refreshProjectGrants(user);
  authorize();

  let task: ProjectTaskMetadata;
  try {
    task = await sources.projects.client(sourceId, user)
      .task(taskId, projectId);
  } finally {
    await sources.refreshProjectGrants(user);
  }

  authorize();
  const parsed = taskMetadataSchema.safeParse(task);
  if (!parsed.success || parsed.data.id !== taskId || parsed.data.projectId !== projectId) {
    throw new ProjectsSourceError(404);
  }

  return { actor: user, sourceId, projectId, task: parsed.data };
}

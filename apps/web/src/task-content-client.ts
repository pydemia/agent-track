import { z } from "zod";
import type { ProjectTaskRef } from "./project-task-origin.ts";
import { fetchPrivateJson, PrivateReadError } from "./private-json.ts";

const reviewSchema = z.strictObject({
  task: z.strictObject({ id: z.uuid(), projectId: z.uuid(), title: z.string().min(1).max(500),
    revision: z.string().regex(/^[1-9][0-9]{0,18}$/), state: z.string().min(1).max(100), requiresTest: z.boolean() }),
  body: z.string().max(5000).refine(value => new TextEncoder().encode(value).length <= 8192),
  acceptanceCriteria: z.array(z.string().max(500)).max(20), complete: z.boolean(),
  reviewSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).refine(value => value.complete || value.body === "" && value.acceptanceCriteria.length === 0);
export type TaskContent = z.infer<typeof reviewSchema>;

/** Explicit, read-only fetch. The existing review route rechecks the native Project grant. */
export async function fetchTaskContent(ref: ProjectTaskRef, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<TaskContent> {
  if (!/^[a-z0-9_-]{1,80}$/.test(ref.sourceId) || !z.uuid().safeParse(ref.projectId).success || !z.uuid().safeParse(ref.taskId).success)
    throw new PrivateReadError("failure");
  const url = `/api/projects/${ref.sourceId}/${ref.projectId}/tasks/${ref.taskId}/review`;
  return fetchPrivateJson(url, signal, fetcher, value => {
    const content = reviewSchema.parse(value);
    if (content.task.id !== ref.taskId || content.task.projectId !== ref.projectId) throw new PrivateReadError("failure");
    return content;
  });
}

import { z } from "zod";
import type { ProjectTaskMetadata } from "../../../packages/contracts/index.ts";

const sourceIdSchema = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const taskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string().min(1).max(300),
  revision: z.string().regex(/^[1-9][0-9]{0,18}$/)
    .refine((value) => BigInt(value) <= 9223372036854775807n),
  state: z.string().min(1).max(100),
  requiresTest: z.boolean(),
}).strict();
const responseSchema = z.object({
  actor: z.string().min(1),
  sourceId: sourceIdSchema,
  projectId: z.uuid(),
  task: taskSchema,
}).strict();

export class GroupWorkspaceReadError extends Error {
  constructor(public readonly kind: "unauthorized" | "unavailable" | "failure", message: string) {
    super(message);
    this.name = "GroupWorkspaceReadError";
  }
}

/** Read and validate one authorized task's metadata within a hard request bound. */
export async function fetchGroupTaskMetadata(
  ref: { sourceId: string; projectId: string; taskId: string },
  actor: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ProjectTaskMetadata> {
  if (!sourceIdSchema.safeParse(ref.sourceId).success || !z.uuid().safeParse(ref.projectId).success ||
    !z.uuid().safeParse(ref.taskId).success || !actor.trim()) {
    throw new GroupWorkspaceReadError("unavailable", "업무 조회 범위가 올바르지 않습니다.");
  }

  const controller = new AbortController();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  const cleanup = () => {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {});
  };
  let rejectBoundary: (error: Error) => void = () => {};
  const boundary = new Promise<never>((_, reject) => { rejectBoundary = reject; });
  const abort = () => { cleanup(); rejectBoundary(new Error("Group workspace request aborted")); };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    cleanup(); rejectBoundary(new Error("Group workspace request deadline exceeded"));
  }, 4_000);

  const work = async () => {
    if (signal.aborted) throw new Error("Group workspace request aborted");
    response = await fetcher(`/api/projects/${encodeURIComponent(ref.sourceId)}/${encodeURIComponent(ref.projectId)}/tasks/${encodeURIComponent(ref.taskId)}`,
      { method: "GET", signal: controller.signal, redirect: "error", credentials: "same-origin", cache: "no-store" });
    if (finished || signal.aborted || controller.signal.aborted) {
      cleanup(); throw new Error("Late group workspace response");
    }
    if (response.status === 401 || response.status === 403)
      throw new GroupWorkspaceReadError("unauthorized", "업무 조회 권한이 해제되었습니다.");
    if (response.status === 404)
      throw new GroupWorkspaceReadError("unavailable", "업무 조회 범위에 접근할 수 없습니다.");
    if (!response.ok) throw new GroupWorkspaceReadError("failure", "업무 metadata를 조회하지 못했습니다.");

    const limit = 65_536;
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error("Task metadata body too large");
    if (!response.body) throw new Error("Missing task metadata body");
    const activeReader = response.body.getReader(); reader = activeReader;
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const result = await activeReader.read();
        if (finished || controller.signal.aborted) throw new Error("Late task metadata body");
        if (result.done) break;
        size += result.value.byteLength;
        if (size > limit) throw new Error("Task metadata body too large");
        chunks.push(result.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const parsed = responseSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (parsed.actor !== actor || parsed.sourceId !== ref.sourceId || parsed.projectId !== ref.projectId ||
        parsed.task.id !== ref.taskId || parsed.task.projectId !== ref.projectId) {
        throw new Error("Task metadata scope mismatch");
      }
      return parsed.task;
    } finally {
      if (controller.signal.aborted || size > limit) void activeReader.cancel().catch(() => {});
      activeReader.releaseLock();
      reader = undefined;
    }
  };

  try {
    return await Promise.race([work(), boundary]);
  } catch (error) {
    if (error instanceof GroupWorkspaceReadError) throw error;
    const boundaryMessage = error instanceof Error && ["Group workspace request aborted", "Group workspace request deadline exceeded"].includes(error.message)
      ? error.message : "업무 metadata를 조회하지 못했습니다.";
    throw new GroupWorkspaceReadError("failure", boundaryMessage);
  } finally {
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    cleanup();
  }
}

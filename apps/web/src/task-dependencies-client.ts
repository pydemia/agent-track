import { z } from "zod";
import { sequenceSchema, timestampSchema } from "../../../packages/contracts/index.ts";
import type { ProjectDependencyPage } from "../../../packages/contracts/project-dependencies.ts";

const revision = sequenceSchema.refine((v) => v !== "0");
const task = z.object({ id: z.uuid(), projectId: z.uuid(), title: z.string().min(1).max(300),
  revision, state: z.string().min(1).max(100), requiresTest: z.boolean() }).strict();
const pageSchema = z.object({ sourceId: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  projectId: z.uuid(), supported: z.boolean(), observedAt: timestampSchema.nullable(),
  dependencies: z.array(z.object({ id: z.uuid(), projectId: z.uuid(),
    relation: z.literal("depends_on"), fromTask: task, toTask: task,
    fromRevision: revision, toRevision: revision }).strict()).max(200), hasMore: z.boolean(),
}).strict().refine((p) => p.supported ? p.observedAt !== null :
  p.observedAt === null && p.dependencies.length === 0 && !p.hasMore);

export class TaskDependenciesError extends Error {
  constructor(public readonly kind: "unauthorized" | "unavailable" | "failure", message: string) {
    super(message);
  }
}

export function validateDependencyPage(value: unknown, sourceId: string, projectId: string): ProjectDependencyPage {
  const page = pageSchema.parse(value);
  if (page.sourceId !== sourceId || page.projectId !== projectId) throw new Error("Dependency scope mismatch");
  // Conflicting snapshots must not silently select one current Task revision.
  const tasks = new Map<string, string>();
  const relations = new Map<string, string>();
  for (const e of page.dependencies) {
    if (![e.projectId, e.fromTask.projectId, e.toTask.projectId].includes(projectId))
      throw new Error("Unrelated dependency project");
    for (const t of [e.fromTask, e.toTask]) {
      const snapshot = JSON.stringify(t);
      if (tasks.has(t.id) && tasks.get(t.id) !== snapshot) throw new Error("Conflicting Task metadata");
      tasks.set(t.id, snapshot);
    }
    const snapshot = JSON.stringify(e);
    if (relations.has(e.id) && relations.get(e.id) !== snapshot) throw new Error("Conflicting relation ID");
    relations.set(e.id, snapshot);
  }
  return page;
}

/** One deadline includes fetch, streamed body and validation, even for custom fetch. */
export async function fetchTaskDependencies(sourceId: string, projectId: string,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProjectDependencyPage> {
  if (!/^[a-z0-9_-]{1,80}$/.test(sourceId) || !z.uuid().safeParse(projectId).success) throw new TaskDependenciesError("unavailable", "업무 의존성 조회 범위가 올바르지 않습니다.");
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
  const abort = () => { cleanup(); rejectBoundary(new Error("Dependency request aborted")); };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    cleanup(); rejectBoundary(new Error("Dependency request deadline exceeded"));
  }, 4_000);
  const work = async () => {
    if (signal.aborted) throw new Error("Dependency request aborted");
    response = await fetcher(`/api/projects/${encodeURIComponent(sourceId)}/${encodeURIComponent(projectId)}/task-dependencies`,
      { method: "GET", signal: controller.signal, redirect: "error", credentials: "same-origin" });
    if (finished || signal.aborted || controller.signal.aborted) {
      cleanup(); throw new Error("Late dependency response");
    }
    if (response.status === 401 || response.status === 403)
      throw new TaskDependenciesError("unauthorized", "업무 의존성 조회 권한이 해제되었습니다.");
    if (response.status === 404) throw new TaskDependenciesError("unavailable", "업무 의존성 조회 범위에 접근할 수 없습니다.");
    if (!response.ok) throw new TaskDependenciesError("failure", "업무 의존성을 조회하지 못했습니다.");
    const limit = 1_048_576;
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error("Dependency body too large");
    if (!response.body) throw new Error("Missing dependency body");
    const activeReader = response.body.getReader(); reader = activeReader;
    let size = 0; const chunks: Uint8Array[] = [];
    try {
    while (true) {
      const result = await activeReader.read();
      if (finished || controller.signal.aborted) throw new Error("Late dependency body");
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new Error("Dependency body too large");
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return validateDependencyPage(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), sourceId, projectId);
    } finally { if (controller.signal.aborted || size > limit) void activeReader.cancel().catch(() => {}); activeReader.releaseLock(); reader = undefined; }
  };
  try { return await Promise.race([work(), boundary]); }
  finally {
    finished = true; clearTimeout(timer); signal.removeEventListener("abort", abort); cleanup();
  }
}

export type DependencySnapshot = { page: ProjectDependencyPage | null;
  status: "loading" | "ready" | "unavailable" | "failure" | "unauthorized" };

/** Serial polling: the next timer starts only after the previous read settles. */
export function pollTaskDependencies(sourceId: string, projectId: string,
  receive: (snapshot: DependencySnapshot) => void, onUnauthorized: (reason: string) => void,
  fetcher: typeof fetch = fetch, onScopeUnavailable?: () => void): () => void {
  const controller = new AbortController(); let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function load() {
    let unauthorized = false, unavailable = false;
    try {
      const page = await fetchTaskDependencies(sourceId, projectId, controller.signal, fetcher);
      if (!disposed) receive({ status: "ready", page });
    } catch (error) {
      if (disposed) return;
      const status = error instanceof TaskDependenciesError ? error.kind : "failure";
      receive({ status, page: null });
      unauthorized = status === "unauthorized";
      unavailable = status === "unavailable";
      if (unauthorized) onUnauthorized("업무 의존성 조회 권한이 해제되어 그래프를 지웠습니다.");
      if (unavailable) onScopeUnavailable?.();
    } finally {
      if (!disposed && !unauthorized && !unavailable) timer = setTimeout(() => void load(), 15_000);
    }
  }
  receive({ status: "loading", page: null }); void load();
  return () => { disposed = true; controller.abort(); clearTimeout(timer); };
}

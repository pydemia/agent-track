import { z } from "zod";
import { sequenceSchema, timestampSchema } from "../../../packages/contracts/index.ts";
import { assistantExecutionMetadataSchema, assistantExecutionPageSchema,
  assistantExecutionEventsPageSchema } from "../../../packages/contracts/assistant.ts";
import type { AssistantExecutionView, AssistantExecutionListView,
  AssistantExecutionEventsView } from "../../../packages/contracts/assistant-view.ts";

const sourceSchema = z.string().regex(/^[a-z0-9_-]{1,80}$(?![\s\S])/);
const labelSchema = z.string().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$(?![\s\S])/);
const revision = sequenceSchema.refine(value => value !== "0" && !/[\r\n]/.test(value));
const cursorSchema = z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$(?![\s\S])/).nullable();
const afterSchema = z.string().regex(/^(0|[1-9][0-9]{0,15})$(?![\s\S])/)
  .refine(value => Number(value) <= Number.MAX_SAFE_INTEGER);
const nativeRevision = afterSchema.refine(value => value !== "0");
const executionSchema = z.strictObject({
  sourceId: sourceSchema, sourceLabel: labelSchema, device: labelSchema,
  native: assistantExecutionMetadataSchema.refine(value =>
    [value.revision, value.instructionRevision, ...(value.task ? [value.task.revision] : []),
      ...value.roles.map(role => role.membershipRevision)]
      .every(item => nativeRevision.safeParse(item).success)),
  currentTask: z.strictObject({
    projectsSourceId: sourceSchema,
    projectKey: z.string().regex(/^project:[A-Za-z0-9_-]{43}$(?![\s\S])/),
    project: z.strictObject({ id: z.uuid(), title: z.string().min(1).max(300),
      revision, accessRevision: revision, archived: z.boolean() }),
    task: z.strictObject({ id: z.uuid(), projectId: z.uuid(),
      title: z.string().min(1).max(300), revision,
      state: z.string().min(1).max(100), requiresTest: z.boolean() }),
    observedAt: timestampSchema,
  }).nullable(),
}).refine(({ native, currentTask }) => native.task === null ? currentTask === null :
  currentTask !== null && currentTask.task.id === native.task.taskId &&
  currentTask.project.id === native.task.projectId &&
  currentTask.task.projectId === native.task.projectId);
const listSchema = z.strictObject({
  version: z.literal(1), sourceId: sourceSchema, observedAt: timestampSchema,
  executions: z.array(executionSchema).max(50), cursor: cursorSchema,
  hasMore: z.boolean(), omitted: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  complete: z.literal(false),
}).refine(page => page.hasMore === (page.cursor !== null) &&
  new Set(page.executions.map(item => item.native.id)).size === page.executions.length &&
  page.executions.every(item => item.sourceId === page.sourceId));
const eventsSchema = z.strictObject({ execution: executionSchema,
  page: assistantExecutionEventsPageSchema.refine(page =>
    afterSchema.safeParse(page.cursor).success && page.events.every(event =>
      nativeRevision.safeParse(event.sequence).success && nativeRevision.safeParse(event.revision).success)) });

type ErrorKind = "unauthorized" | "unavailable" | "failure";
const messages = {
  unauthorized: "Assistant authentication is required.",
  unavailable: "Assistant scope is unavailable.",
  failure: "Assistant data could not be loaded.",
} as const;
export class AssistantWebError extends Error {
  constructor(public readonly kind: ErrorKind) {
    super(messages[kind]);
    this.name = "AssistantWebError";
  }
}

const deadlineMs = 12_000;
const bodyLimit = 2 * 1024 * 1024;

/** The boundary also settles custom transports that ignore AbortSignal. */
async function request<T>(url: string, signal: AbortSignal,
  fetcher: typeof fetch, validate: (value: unknown) => T): Promise<T> {
  const controller = new AbortController();
  const deadline = performance.now() + deadlineMs;
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  const cancel = () => {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {});
  };
  let rejectBoundary!: (error: AssistantWebError) => void;
  const boundary = new Promise<never>((_, reject) => { rejectBoundary = reject; });
  const abort = () => { cancel(); rejectBoundary(new AssistantWebError("failure")); };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, deadlineMs);
  const check = () => {
    if (finished || signal.aborted || controller.signal.aborted || performance.now() >= deadline)
      throw new AssistantWebError("failure");
  };
  const work = async () => {
    check();
    response = await fetcher(url, { method: "GET", credentials: "same-origin",
      redirect: "error", signal: controller.signal });
    // A late response owns a new body even after the outer finally ran.
    try { check(); } catch (error) { cancel(); throw error; }
    if (response.status === 401) throw new AssistantWebError("unauthorized");
    if (response.status === 403 || response.status === 404)
      throw new AssistantWebError("unavailable");
    if (!response.ok) throw new AssistantWebError("failure");
    const contentType = response.headers.get("content-type");
    if (!contentType || !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(contentType))
      throw new AssistantWebError("failure");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^[0-9]{1,10}$(?![\s\S])/.test(length) || Number(length) > bodyLimit))
      throw new AssistantWebError("failure");
    if (!response.body) throw new AssistantWebError("failure");
    const activeReader = response.body.getReader();
    reader = activeReader;
    // One fixed buffer bounds allocation even with millions of tiny chunks.
    const bytes = new Uint8Array(bodyLimit);
    let size = 0;
    try {
      while (true) {
        const result = await activeReader.read();
        check();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > bodyLimit) throw new AssistantWebError("failure");
        bytes.set(result.value, size - result.value.byteLength);
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true })
        .decode(bytes.subarray(0, size)));
      check();
      const validated = validate(value);
      check();
      return validated;
    } finally {
      void activeReader.cancel().catch(() => {});
      activeReader.releaseLock();
      reader = undefined;
    }
  };
  try { return await Promise.race([work(), boundary]); }
  catch (error) {
    // Never expose transport errors, response content or schema diagnostics.
    throw new AssistantWebError(error instanceof AssistantWebError ? error.kind : "failure");
  } finally {
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    cancel();
  }
}

function route(sourceId: string, id?: string): string {
  if (!sourceSchema.safeParse(sourceId).success ||
    (id !== undefined && !z.uuid().safeParse(id).success))
    throw new AssistantWebError("failure");
  return `/api/assistant/${encodeURIComponent(sourceId)}/executions` +
    (id === undefined ? "" : `/${encodeURIComponent(id)}`);
}

export async function fetchAssistantExecutions(sourceId: string, cursor: string | null,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<AssistantExecutionListView> {
  const path = route(sourceId);
  if (!cursorSchema.safeParse(cursor).success) throw new AssistantWebError("failure");
  return request(path + (cursor === null ? "" : `?${new URLSearchParams({ cursor })}`),
    signal, fetcher, value => {
      const page = listSchema.parse(value);
      if (page.sourceId !== sourceId) throw new AssistantWebError("failure");
      const { sourceId: _sourceId, ...nativePage } = page;
      assistantExecutionPageSchema.parse({ ...nativePage,
        executions: page.executions.map(item => item.native) });
      return page;
    });
}

export async function fetchAssistantExecution(sourceId: string, id: string,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<AssistantExecutionView> {
  if (!z.uuid().safeParse(id).success) throw new AssistantWebError("failure");
  return request(route(sourceId, id), signal, fetcher, value => {
    const execution = executionSchema.parse(value);
    if (execution.sourceId !== sourceId || execution.native.id !== id)
      throw new AssistantWebError("failure");
    return execution;
  });
}

export async function fetchAssistantEvents(sourceId: string, id: string, after: string,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<AssistantExecutionEventsView> {
  if (!z.uuid().safeParse(id).success) throw new AssistantWebError("failure");
  const path = route(sourceId, id);
  if (!afterSchema.safeParse(after).success) throw new AssistantWebError("failure");
  return request(`${path}/events?${new URLSearchParams({ after })}`, signal, fetcher, value => {
    const result = eventsSchema.parse(value);
    if (result.execution.sourceId !== sourceId || result.execution.native.id !== id ||
      result.page.executionId !== id ||
      result.page.events.some(event => BigInt(event.sequence) <= BigInt(after)) ||
      (result.page.events.length === 0 && result.page.cursor !== after))
      throw new AssistantWebError("failure");
    return result;
  });
}

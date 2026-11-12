import { PrivateReadError as AssistantWebError, fetchPrivateJson as request } from "./private-json.ts";
export { PrivateReadError as AssistantWebError } from "./private-json.ts";
import { z } from "zod";
import { sequenceSchema, timestampSchema, statusSchema } from "../../../packages/contracts/index.ts";
import { assistantExecutionMetadataSchema,
  assistantExecutionEventsPageSchema, assistantExecutionMetadataV2Schema,
  assistantExecutionEventsPageV2Schema } from "../../../packages/contracts/assistant.ts";
import type { AssistantExecutionView, AssistantExecutionListView,
  AssistantExecutionEventsView } from "../../../packages/contracts/assistant-view.ts";

const sourceSchema = z.string().regex(/^[a-z0-9_-]{1,80}$(?![\s\S])/);
const labelSchema = z.string().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$(?![\s\S])/);
const revision = sequenceSchema.refine(value => value !== "0" && !/[\r\n]/.test(value));
const cursorSchema = z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$(?![\s\S])/).nullable();
const afterSchema = z.string().regex(/^(0|[1-9][0-9]{0,15})$(?![\s\S])/)
  .refine(value => Number(value) <= Number.MAX_SAFE_INTEGER);
const nativeRevision = afterSchema.refine(value => value !== "0");
const browserNativeSchema = z.union([assistantExecutionMetadataSchema,
  assistantExecutionMetadataV2Schema.refine(value => value.roles.every(role => role.runtime.demian === null &&
    (role.observation.basis !== "external_run_wall_timestamps_unverified" || role.runtime.threadId === null && role.runtime.turnId === null)))]);
const linkSchema = z.strictObject({ roleId: z.uuid(), sourceId: sourceSchema,
  runKey: z.string().min(1).max(2048), runId: z.guid(), sessionId: z.guid(), workspaceId: z.guid(),
  operationId: z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/), status: statusSchema,
  observedAt: timestampSchema }).refine(value => value.runKey ===
    btoa(JSON.stringify([value.sourceId, value.runId])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
const linksSchema = z.strictObject({ state: z.enum(["connected", "unconfigured", "not_observed", "forbidden", "disconnected"]),
  links: z.array(linkSchema).max(100), omitted: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), complete: z.literal(false),
  detail: z.string().max(1000).regex(/^[^\u0000-\u001f\u007f]*$/) }).refine(value =>
    (value.links.length > 0) === (value.state === "connected") && new Set(value.links.map(link => link.roleId)).size === value.links.length);
const executionSchema = z.strictObject({
  sourceId: sourceSchema, sourceLabel: labelSchema, device: labelSchema,
  native: browserNativeSchema.refine(value =>
    [value.revision, value.instructionRevision, ...(value.task ? [value.task.revision] : []),
      ...value.roles.map(role => role.membershipRevision)]
      .every(item => nativeRevision.safeParse(item).success)),
  demianLinks: linksSchema.optional(),
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
  currentTask.task.projectId === native.task.projectId).refine(value => !value.demianLinks ||
    value.native.roles.every(role => "demian" in role.runtime) &&
      value.demianLinks.links.every(link => value.currentTask !== null && link.sourceId !== value.sourceId &&
        value.native.roles.some(role => role.id === link.roleId))).transform(({ demianLinks, ...value }): AssistantExecutionView =>
          ({ ...value, ...(demianLinks ? { demianLinks } : {}) }));
const listSchema = z.strictObject({
  version: z.literal(1), sourceId: sourceSchema, observedAt: timestampSchema,
  executions: z.array(executionSchema).max(50), cursor: cursorSchema,
  hasMore: z.boolean(), omitted: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  complete: z.literal(false),
}).refine(page => page.hasMore === (page.cursor !== null) &&
  new Set(page.executions.map(item => item.native.id)).size === page.executions.length &&
  page.executions.every(item => item.sourceId === page.sourceId));
const eventsSchema = z.strictObject({ execution: executionSchema,
  page: z.union([assistantExecutionEventsPageSchema, assistantExecutionEventsPageV2Schema]).refine(page =>
    afterSchema.safeParse(page.cursor).success && page.events.every(event =>
      nativeRevision.safeParse(event.sequence).success && nativeRevision.safeParse(event.revision).success)) });


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
      // The BFF envelope stays v1 while its native metadata can be v1 or v2.
      // Each native closed variant was validated above; never downgrade a v2 row.
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

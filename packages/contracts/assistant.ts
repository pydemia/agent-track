import { z } from "zod";

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const nativeIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const safePositiveSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const safeNonnegativeSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestampSchema = z.iso.datetime({ offset: true });
const decimalSchema = z.string().regex(/^[1-9][0-9]{0,15}$/).refine(
  (value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
);
const nonnegativeDecimalSchema = z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(
  (value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
  "Assistant safe-integer cursor required",
);
const boundedNullableErrorSchema = nativeIdSchema.nullable();
const cursorSchema = z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$/).nullable();

const executionStateSchema = z.enum([
  "registering", "queued", "running", "publishing", "linking",
  "completed", "failed", "cancelling", "cancelled",
  "reconciliation_required",
]);
const roleStateSchema = z.enum([
  "pending", "queued", "awaiting_connection", "awaiting_runtime",
  "preparing", "running", "completed", "failed", "cancelled",
  "interrupted",
]);
const responsibilitySchema = z.enum(["accountable", "contributor", "reviewer"]);
const taskStateSchema = z.enum(["todo", "in_progress", "in_review", "done", "cancelled"]);

const roleInputSchema = z.object({
  id: z.uuid(),
  assignmentId: nativeIdSchema,
  workPackageId: nativeIdSchema,
  membershipId: nativeIdSchema,
  membershipRevision: safePositiveSchema,
  teamId: nativeIdSchema,
  teamName: z.string(),
  personaName: z.string(),
  role: z.string(),
  responsibility: responsibilitySchema,
  state: roleStateSchema,
  runtimeTaskId: z.string().nullable(),
  threadId: z.string().nullable(),
  turnId: z.string().nullable(),
  attempts: safeNonnegativeSchema,
  observation: z.object({
    basis: z.literal("server_dispatch_to_terminal_including_sdk_preparation"),
    queuedAt: timestampSchema.nullable(),
    startedAt: timestampSchema.nullable(),
    endedAt: timestampSchema.nullable(),
    executionSeconds: safeNonnegativeSchema.nullable(),
    timingComplete: z.boolean(),
  }),
});

const taskReferenceInputSchema = z.object({
  sourceService: z.literal("projects"),
  sourceId: nativeIdSchema,
  projectId: nativeIdSchema,
  revision: safePositiveSchema,
  state: taskStateSchema,
  url: z.url().max(2000),
  asOf: timestampSchema,
}).refine((task) => {
  const url = new URL("https://projects.pydemia.ai/");
  url.searchParams.set("project", task.projectId);
  url.searchParams.set("view", "tasks");
  url.searchParams.set("item", task.sourceId);
  return task.url === url.href;
}, { path: ["url"], message: "Projects Task URL must match its identity" });

const executionInputSchema = z.object({
  id: z.uuid(),
  instructionId: z.uuid(),
  instructionRevision: safePositiveSchema,
  revision: safePositiveSchema,
  state: executionStateSchema,
  errorCode: boundedNullableErrorSchema,
  taskRef: taskReferenceInputSchema.nullable(),
  roles: z.array(roleInputSchema).min(1).max(100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const plainLabel = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 240);
const labelSchema = z.string().max(240).regex(/^[^\u0000-\u001f\u007f]*$/);

const runtimeReferenceSchema = opaqueIdSchema.nullable();

export const assistantExecutionMetadataSchema = z.strictObject({
    id: z.uuid(),
    instructionId: z.uuid(),
    instructionRevision: decimalSchema,
    revision: decimalSchema,
    state: executionStateSchema,
    errorCode: boundedNullableErrorSchema,
    task: z.strictObject({
      projectId: opaqueIdSchema,
      taskId: opaqueIdSchema,
      revision: decimalSchema,
      state: taskStateSchema,
      observedAt: timestampSchema,
    }).nullable(),
    roles: z.array(z.strictObject({
      id: z.uuid(),
      assignmentId: opaqueIdSchema,
      workPackageId: opaqueIdSchema,
      teamId: opaqueIdSchema,
      membershipId: opaqueIdSchema,
      membershipRevision: decimalSchema,
      label: labelSchema,
      teamLabel: labelSchema,
      agentLabel: labelSchema,
      responsibility: responsibilitySchema,
      state: roleStateSchema,
      attempts: safeNonnegativeSchema,
      runtime: z.strictObject({
        taskId: runtimeReferenceSchema,
        threadId: runtimeReferenceSchema,
        turnId: runtimeReferenceSchema,
      }),
      observation: z.strictObject({
        queuedAt: timestampSchema.nullable(),
        startedAt: timestampSchema.nullable(),
        endedAt: timestampSchema.nullable(),
        seconds: safeNonnegativeSchema.nullable(),
        timingComplete: z.boolean(),
        basis: z.literal("server_dispatch_to_terminal_including_sdk_preparation"),
      }),
    })).min(1).max(100),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
}).refine(value => new Set(value.roles.map(role => role.id)).size === value.roles.length,
  { path: ["roles"], message: "Role IDs must be unique within the execution" });
export type AssistantExecutionMetadata = z.infer<typeof assistantExecutionMetadataSchema>;

export const assistantExecutionPageSchema = z.strictObject({
  version: z.literal(1),
  observedAt: timestampSchema,
  executions: z.array(assistantExecutionMetadataSchema).max(50),
  cursor: cursorSchema,
  hasMore: z.boolean(),
  omitted: safeNonnegativeSchema,
  complete: z.literal(false),
}).refine(page => page.hasMore === (page.cursor !== null), { path: ["cursor"], message: "Continuation must match hasMore" });
export type AssistantExecutionPage = z.infer<typeof assistantExecutionPageSchema>;

const eventInputSchema = z.object({
  executionId: z.uuid(),
  sequence: safePositiveSchema,
  revision: safePositiveSchema,
  state: executionStateSchema,
  errorCode: boundedNullableErrorSchema,
  occurredAt: timestampSchema,
});

export const assistantExecutionEventSchema = z.strictObject({
  executionId: z.uuid(),
  sequence: decimalSchema,
  revision: decimalSchema,
  state: executionStateSchema,
  errorCode: boundedNullableErrorSchema,
  occurredAt: timestampSchema,
});
export type AssistantExecutionEvent = z.infer<typeof assistantExecutionEventSchema>;

export const assistantExecutionEventsPageSchema = z.strictObject({
  version: z.literal(1),
  observedAt: timestampSchema,
  executionId: z.uuid(),
  events: z.array(assistantExecutionEventSchema).max(100),
  cursor: nonnegativeDecimalSchema,
  hasMore: z.boolean(),
  complete: z.literal(false),
}).refine(
  (page) => page.events.every((event) => event.executionId === page.executionId),
  { path: ["events"], message: "Event execution must match page scope" },
).refine(page => page.events.every((event, index) => index === 0 || BigInt(event.sequence) > BigInt(page.events[index - 1]!.sequence)) &&
    (!page.events.length || page.cursor === page.events.at(-1)!.sequence) && (!page.hasMore || page.events.length > 0),
  { path: ["cursor"], message: "Event continuation must follow its ordered page" });
export type AssistantExecutionEventsPage = z.infer<typeof assistantExecutionEventsPageSchema>;

export const assistantCapabilitiesSchema = z.strictObject({
  version: z.literal(1),
  service: z.literal("assistant"),
  audience: z.literal("agent-track"),
  ownerId: z.string().regex(/^sso-sub:[a-f0-9]{64}$/),
  principalId: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  revision: decimalSchema,
  executionsRead: z.literal(true),
  eventsRead: z.literal(true),
  controls: z.literal(false),
  listLimit: z.literal(50),
  eventLimit: z.literal(100),
  demianReferencesSupported: z.literal(false),
});
export type AssistantCapabilities = z.infer<typeof assistantCapabilitiesSchema>;

export function projectAssistantExecution(raw: unknown): AssistantExecutionMetadata {
  const value = executionInputSchema.parse(raw);
  const task = value.taskRef;
  return assistantExecutionMetadataSchema.parse({
      id: value.id,
      instructionId: value.instructionId,
      instructionRevision: String(value.instructionRevision),
      revision: String(value.revision),
      state: value.state,
      errorCode: value.errorCode,
      task: task === null ? null : {
        projectId: task.projectId,
        taskId: task.sourceId,
        revision: String(task.revision),
        state: task.state,
        observedAt: task.asOf,
      },
      roles: value.roles.map((role) => ({
        id: role.id,
        assignmentId: role.assignmentId,
        workPackageId: role.workPackageId,
        teamId: role.teamId,
        membershipId: role.membershipId,
        membershipRevision: String(role.membershipRevision),
        label: plainLabel(role.role),
        teamLabel: plainLabel(role.teamName),
        agentLabel: plainLabel(role.personaName),
        responsibility: role.responsibility,
        state: role.state,
        attempts: role.attempts,
        runtime: {
          taskId: role.runtimeTaskId,
          threadId: role.threadId,
          turnId: role.turnId,
        },
        observation: {
          queuedAt: role.observation.queuedAt,
          startedAt: role.observation.startedAt,
          endedAt: role.observation.endedAt,
          seconds: role.observation.executionSeconds,
          timingComplete: role.observation.timingComplete,
          basis: role.observation.basis,
        },
      })),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
  });
}

export function projectAssistantEvent(raw: unknown): AssistantExecutionEvent {
  const value = eventInputSchema.parse(raw);
  return assistantExecutionEventSchema.parse({
    executionId: value.executionId,
    sequence: String(value.sequence),
    revision: String(value.revision),
    state: value.state,
    errorCode: value.errorCode,
    occurredAt: value.occurredAt,
  });
}

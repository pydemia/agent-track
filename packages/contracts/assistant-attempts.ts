import { z } from "zod";
import { assistantDemianReferenceSchema } from "./assistant.ts";

const states = z.enum(["pending", "queued", "awaiting_connection", "awaiting_runtime", "preparing", "running",
  "completed", "failed", "cancelled", "interrupted"]);
export const assistantRoleAttemptSchema = z.object({
  id: z.uuid(), ordinal: z.number().int().min(1).max(33), current: z.boolean(), state: states,
  runtimeTaskId: z.string().min(1).max(512).nullable(),
  demian: assistantDemianReferenceSchema.nullable(),
  command: z.object({ id: z.uuid(), kind: z.enum(["retry", "resume"]), predecessorAttemptId: z.uuid(),
    provenance: z.literal("coordinator-intent") }).strict().nullable(),
}).strict().superRefine((value, context) => {
  if ((value.command && (value.command.id !== value.id || value.command.predecessorAttemptId === value.id)) ||
      (value.demian && (value.demian.operationId !== value.id || value.runtimeTaskId === null))) {
    context.addIssue({ code: "custom", message: "Attempt identity differs from its observed producer/intent" });
  }
});
export const assistantRoleAttemptsPageSchema = z.object({
  version: z.literal(1), executionId: z.uuid(), roleId: z.uuid(),
  coverage: z.literal("coordinator-history"), observedAt: z.iso.datetime({ offset: true }),
  attempts: z.array(assistantRoleAttemptSchema).max(33), total: z.number().int().min(0).max(33),
}).strict().superRefine((value, context) => {
  const ids = new Set(value.attempts.map(attempt => attempt.id));
  if (value.total !== value.attempts.length || ids.size !== value.total ||
      value.attempts.some((attempt, index) => attempt.ordinal !== index + 1 || attempt.current !== (index === value.total - 1) ||
        (attempt.command && !value.attempts.slice(0, index).some(old => old.id === attempt.command!.predecessorAttemptId)))) {
    context.addIssue({ code: "custom", message: "Attempt history is incomplete or ambiguous" });
  }
});
export type AssistantRoleAttempt = z.infer<typeof assistantRoleAttemptSchema>;
export type AssistantRoleAttemptsPage = z.infer<typeof assistantRoleAttemptsPageSchema>;

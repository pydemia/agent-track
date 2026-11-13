import { z } from "zod";
import { idSchema, sequenceSchema, timestampSchema } from "./index.ts";
import { nativeCommandKindSchema, nativeCommandTerminalSchema } from "./native-run-commands.ts";

export const successorReviewInputSchema = z.object({
  id: z.uuid().transform(value => value.toLowerCase()), runKey: idSchema, kind: nativeCommandKindSchema,
  expiresAt: timestampSchema.transform(value => new Date(value).toISOString()),
  input: z.string().min(1).max(1_000_000).optional(),
}).strict().refine(value => (value.kind === "continue") === (value.input !== undefined), "Continue requires new input; retry/resume preserve it");
export type SuccessorReviewInput = z.infer<typeof successorReviewInputSchema>;
export const successorStateSchema = z.enum(["prepared", "dispatching", "accepted", "rejected", "expired", "unknown"]);
export const successorDetailSchema = z.enum(["review_ready", "review_discarded", "deadline_passed", "review_changed",
  "authority_changed", "native_rejected", "outcome_unknown", "not_found", "accepted", "observation_pending"]);
export const successorReceiptSchema = z.object({
  id: z.uuid(), runKey: idSchema, sourceId: z.string().regex(/^[a-z0-9_-]{1,80}$/), runId: z.uuid(), sessionId: z.uuid(),
  kind: nativeCommandKindSchema, sourceStatus: nativeCommandTerminalSchema, expectedCursor: sequenceSchema,
  state: successorStateSchema, detail: successorDetailSchema,
  expiresAt: timestampSchema, createdAt: timestampSchema, updatedAt: timestampSchema,
  newRunId: z.uuid().nullable(), relation: z.enum(["retry_of", "continues"]).nullable(),
  observationState: z.enum(["pending", "observed"]).nullable(),
}).strict().refine(value => value.state === "accepted"
  ? value.newRunId !== null && value.newRunId !== value.runId && value.relation === (value.kind === "retry" ? "retry_of" : "continues") && value.observationState !== null
  : value.newRunId === null && value.relation === null && value.observationState === null, "Admission and observation states differ");
export type SuccessorReceipt = z.infer<typeof successorReceiptSchema>;
export const successorReceiptPageSchema = z.object({ receipts: z.array(successorReceiptSchema).max(100), hasMore: z.boolean() }).strict()
  .refine(value => new Set(value.receipts.map(receipt => receipt.id)).size === value.receipts.length, "Duplicate command identity");
export type SuccessorReceiptPage = z.infer<typeof successorReceiptPageSchema>;
export const successorAvailabilitySchema = z.object({
  state: z.enum(["available", "unsupported", "unavailable"]), runKey: idSchema,
  availableKinds: z.array(nativeCommandKindSchema).max(2),
  detail: z.enum(["ready", "not_enabled", "protected_owner_required", "native_contract_unavailable", "native_unavailable", "no_terminal_action"]),
}).strict().refine(value => (value.state === "available" || value.availableKinds.length === 0) &&
  new Set(value.availableKinds).size === value.availableKinds.length);
export type SuccessorAvailability = z.infer<typeof successorAvailabilitySchema>;
export const successorPanelSchema = successorReceiptPageSchema.safeExtend({ availability: successorAvailabilitySchema });
export type SuccessorPanel = z.infer<typeof successorPanelSchema>;

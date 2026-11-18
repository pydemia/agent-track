import { z } from "zod";
import { assistantCommandInputSchema, assistantCommandReceiptSchema } from "./assistant-commands.ts";

export const assistantReceiptCapabilitiesSchema = z.strictObject({
  version: z.literal(2), audience: z.literal("agent-track-command"),
  ownerId: z.string().regex(/^sso-sub:[a-f0-9]{64}$/), principalId: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  trackUser: z.email(), grantRevision: z.int().positive().safe(),
  commands: z.tuple([z.literal("reconcile-expired")]), receiptRead: z.literal(true),
  reconcileExpiredReceipts: z.literal(true),
});
export const assistantNotAcceptedReceiptSchema = z.strictObject({
  version: z.literal(2), outcome: z.literal("not_accepted"), reason: z.literal("expired_without_saved_intent"),
  operationId: z.uuid(), executionId: z.uuid(), roleId: z.uuid(), request: assistantCommandInputSchema,
  resolvedAt: z.iso.datetime({ offset: true }),
}).refine(value => value.operationId === value.request.operationId &&
  Date.parse(value.resolvedAt) >= Date.parse(value.request.expiresAt));
export const assistantReceiptOutcomeSchema = z.union([
  z.strictObject({ version: z.literal(2), outcome: z.literal("accepted"), command: assistantCommandReceiptSchema.shape.command }),
  assistantNotAcceptedReceiptSchema,
]);
export type AssistantNotAcceptedReceipt = z.infer<typeof assistantNotAcceptedReceiptSchema>;
export type AssistantReceiptOutcome = z.infer<typeof assistantReceiptOutcomeSchema>;

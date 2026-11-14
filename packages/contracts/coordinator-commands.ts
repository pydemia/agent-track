import { z } from "zod";
import { idSchema, timestampSchema } from "./index.ts";
import { assistantCommandKindSchema, assistantCommandReceiptSchema } from "./assistant-commands.ts";

const lowerUuid = z.uuid().refine(value => value === value.toLowerCase());
const canonicalTime = timestampSchema.refine(value =>
  Number.isFinite(Date.parse(value)) && value === new Date(value).toISOString());
export const coordinatorReviewInputSchema = z.strictObject({
  id: lowerUuid, runKey: idSchema, kind: assistantCommandKindSchema,
  expiresAt: timestampSchema.transform(value => new Date(value).toISOString()),
});
export type CoordinatorReviewInput = z.infer<typeof coordinatorReviewInputSchema>;
export const coordinatorStateSchema = z.enum([
  "prepared", "dispatching", "unknown", "intent_saved", "rejected", "discarded", "expired",
]);
export const coordinatorDetailSchema = z.enum([
  "review_ready", "outcome_unknown", "intent_saved", "review_changed",
  "authority_changed", "review_discarded", "deadline_passed",
]);
export const coordinatorReceiptSchema = z.strictObject({
  id: lowerUuid, runKey: idSchema, kind: assistantCommandKindSchema,
  expiresAt: canonicalTime, state: coordinatorStateSchema, detail: coordinatorDetailSchema,
  coordinatorReceipt: assistantCommandReceiptSchema.nullable(),
  createdAt: canonicalTime, updatedAt: canonicalTime,
}).refine(value => {
  const details = {
    prepared: ["review_ready"], dispatching: ["outcome_unknown"], unknown: ["outcome_unknown"],
    intent_saved: ["intent_saved"], rejected: ["review_changed", "authority_changed"],
    discarded: ["review_discarded"], expired: ["deadline_passed"],
  };
  return details[value.state].includes(value.detail) &&
    (value.state === "intent_saved"
      ? value.coordinatorReceipt !== null && value.coordinatorReceipt.command.operationId === value.id &&
        value.coordinatorReceipt.command.kind === value.kind &&
        value.coordinatorReceipt.command.attempt >= 2 && value.coordinatorReceipt.command.attempt <= 33
      : value.coordinatorReceipt === null);
}, "Coordinator intent state and evidence must agree");
export type CoordinatorReceipt = z.infer<typeof coordinatorReceiptSchema>;
export const coordinatorReceiptPageSchema = z.strictObject({
  receipts: z.array(coordinatorReceiptSchema).max(100), hasMore: z.boolean(),
}).refine(value => new Set(value.receipts.map(receipt => receipt.id)).size === value.receipts.length);
export type CoordinatorReceiptPage = z.infer<typeof coordinatorReceiptPageSchema>;

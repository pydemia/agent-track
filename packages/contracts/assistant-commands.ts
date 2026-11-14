import { z } from "zod";

export const assistantCommandKindSchema = z.enum(["retry", "resume"]);
export const assistantCommandInputSchema = z.strictObject({
  operationId: z.uuid(), kind: assistantCommandKindSchema,
  expectedRevision: z.int().positive().safe(), expiresAt: z.iso.datetime({ offset: true }),
});
export const assistantCommandCapabilitiesSchema = z.strictObject({
  version: z.literal(1), audience: z.literal("agent-track-command"),
  ownerId: z.string().regex(/^sso-sub:[a-f0-9]{64}$/),
  principalId: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  trackUser: z.email().refine(value => value === value.toLowerCase()),
  grantRevision: z.int().positive().safe(),
  commands: z.tuple([z.literal("retry"), z.literal("resume")]), receiptRead: z.literal(true),
});
/** A saved coordinator intent is neither Native acceptance nor execution success. */
export const assistantCommandReceiptSchema = z.strictObject({
  version: z.literal(1), command: z.strictObject({
    operationId: z.uuid(), executionId: z.uuid(), roleId: z.uuid(), kind: assistantCommandKindSchema,
    attempt: z.int().positive().safe(), intentState: z.literal("saved"),
    createdAt: z.iso.datetime({ offset: true }),
  }),
});
export type AssistantCommandInput = z.infer<typeof assistantCommandInputSchema>;
export type AssistantCommandKind = z.infer<typeof assistantCommandKindSchema>;
export type AssistantCommandCapabilities = z.infer<typeof assistantCommandCapabilitiesSchema>;
export type AssistantCommandReceipt = z.infer<typeof assistantCommandReceiptSchema>;

import { z } from "zod";

export const contentTextSchema = z.strictObject({ text: z.string().max(32_000), truncated: z.boolean() });
export type ContentText = z.infer<typeof contentTextSchema>;
export function contentText(text: string): ContentText {
  const end = text.length > 32_000 && /[\uD800-\uDBFF]/.test(text[31_999]!) ? 31_999 : 32_000;
  return { text: text.slice(0, end), truncated: text.length > end };
}
export const workContentSchema = z.strictObject({
  title: z.string().min(1).max(500), purpose: contentTextSchema.nullable(),
  acceptanceCriteria: z.array(z.string().max(2000)).max(100),
  steps: z.array(z.strictObject({ id: z.string().min(1).max(512), title: z.string().min(1).max(500),
    status: z.string().min(1).max(100), detail: contentTextSchema.nullable() })).max(100),
  messages: z.array(z.strictObject({ id: z.string().min(1).max(512), role: z.enum(["user", "assistant", "tool"]),
    text: contentTextSchema, occurredAt: z.iso.datetime({ offset: true }).nullable(),
    tool: z.string().max(200).nullable(), callId: z.string().max(512).nullable() })).max(80),
  result: contentTextSchema.nullable(),
  failure: z.strictObject({ code: z.string().min(1).max(200), message: contentTextSchema.nullable(),
    basis: z.enum(["native", "coordinator", "local-log"]) }).nullable(),
  coverage: z.enum(["request-response", "native-message-journal", "local-session-turn"]),
  incomplete: z.boolean(), observedAt: z.iso.datetime({ offset: true }),
}).refine(value => value.messages.reduce((n, message) => n + message.text.text.length, 0) <= 128_000);
export type WorkContent = z.infer<typeof workContentSchema>;

export const assistantAttemptContentSchema = z.strictObject({
  version: z.literal(1), executionId: z.uuid(), roleId: z.uuid(), attemptId: z.uuid(),
  ordinal: z.number().int().min(1).max(33), current: z.boolean(), state: z.string().min(1).max(100),
  run: z.strictObject({ id: z.guid(), sessionId: z.guid(), workspaceId: z.guid() }).nullable(),
  content: workContentSchema,
});
export type AssistantAttemptContent = z.infer<typeof assistantAttemptContentSchema>;

export const runContentViewSchema = z.strictObject({
  version: z.literal(1), runKey: z.string().min(1).max(2048), sourceId: z.string().min(1).max(512), runId: z.string().min(1).max(512),
  sessionId: z.string().min(1).max(512), state: z.enum(["connected", "unsupported", "forbidden", "disconnected"]),
  attempt: z.strictObject({ sourceId: z.string().min(1).max(512), executionId: z.uuid(), roleId: z.uuid(),
    attemptId: z.uuid(), ordinal: z.number().int().min(1).max(33), current: z.boolean() }).nullable(),
  content: workContentSchema.nullable(), detail: z.string().max(2000),
}).refine(value => (value.state === "connected") === (value.content !== null));
export type RunContentView = z.infer<typeof runContentViewSchema>;

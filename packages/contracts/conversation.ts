import { z } from "zod";

const validInt64 = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
const int64 = z.string().refine(validInt64);
const positive = int64.refine(value => value !== "0");
export const conversationCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/);
export const conversationEntrySchema = z.strictObject({
  id: z.string().min(1).max(128), messageId: positive, sequence: positive,
  part: z.number().int().min(0).max(100_000), offset: z.number().int().min(0).max(8_388_608),
  end: z.number().int().min(0).max(8_388_608), total: z.number().int().min(0).max(8_388_608),
  occurredAt: z.iso.datetime({ offset: true }),
  kind: z.enum(["message", "tool-call", "tool-result"]), role: z.enum(["user", "assistant", "tool"]),
  text: z.string().max(16_000), tool: z.string().min(1).max(200).nullable(),
  callId: z.string().min(1).max(512).nullable(), isError: z.boolean().nullable(),
  contentSource: z.enum(["original", "preview", "unavailable", "unknown"]),
  observation: z.strictObject({ invocationId: z.string().min(1).max(512), parentInvocationId: z.string().min(1).max(512).nullable(),
    agentSessionId: z.string().min(1).max(512), agent: z.string().min(1).max(120) }).nullable(),
}).refine(entry => entry.id === `${entry.messageId}:${entry.part}:${entry.offset}` && entry.end === entry.offset + entry.text.length && entry.end <= entry.total &&
  (entry.kind === "message" ? entry.role !== "tool" && entry.tool === null && entry.callId === null && entry.isError === null
    : entry.tool !== null && entry.callId !== null && (entry.kind === "tool-call" ? entry.role === "assistant" && entry.isError === null : entry.role === "tool")));
export type ConversationEntry = z.infer<typeof conversationEntrySchema>;

export const conversationPageSchema = z.strictObject({
  version: z.literal(1), object: z.literal("demian.run_conversation_page"),
  run: z.strictObject({ id: z.guid(), sessionId: z.guid(), workspaceId: z.guid() }),
  after: conversationCursorSchema, limit: z.number().int().min(1).max(50), through: int64,
  next: conversationCursorSchema.nullable(), entries: z.array(conversationEntrySchema).max(50),
  recording: z.enum(["legacy", "messages-v2"]), incomplete: z.boolean(), terminal: z.boolean(),
}).refine(page => page.entries.length <= page.limit && page.entries.reduce((sum, entry) => sum + entry.text.length, 0) <= 96_000 &&
  new Set(page.entries.map(entry => entry.id)).size === page.entries.length &&
  page.entries.every((entry, index) => {
    if (!validInt64(entry.messageId) || !validInt64(page.through) || !validInt64(entry.sequence) || BigInt(entry.messageId) > BigInt(page.through)) return false;
    const previous = page.entries[index - 1];
    if (!previous) return true;
    if (!validInt64(previous.messageId) || !validInt64(previous.sequence)) return false;
    if (entry.messageId === previous.messageId) return entry.sequence === previous.sequence &&
      (entry.part === previous.part ? entry.offset === previous.end : entry.part > previous.part && entry.offset === 0 && previous.end === previous.total);
    return BigInt(entry.messageId) > BigInt(previous.messageId) && BigInt(entry.sequence) > BigInt(previous.sequence) && entry.offset === 0 && previous.end === previous.total;
  }));
export type ConversationPage = z.infer<typeof conversationPageSchema>;

export const nativeConversationPageSchema = z.strictObject({
  ...conversationPageSchema.shape,
  authority: z.strictObject({ organizationId: z.guid(), servicePrincipalId: z.guid(), bindingSha256: z.string().regex(/^[a-f0-9]{64}$/),
    contextSha256: z.string().regex(/^[a-f0-9]{64}$/), requestSha256: z.string().regex(/^[a-f0-9]{64}$/), correlationId: z.string().min(1).max(256) }).nullable(),
}).refine(value => { const { authority: _, ...page } = value; return conversationPageSchema.safeParse(page).success; });

export const attemptConversationPageSchema = z.strictObject({
  version: z.literal(1), executionId: z.uuid(), roleId: z.uuid(), attemptId: z.uuid(),
  ordinal: z.number().int().min(1).max(33), current: z.boolean(), page: conversationPageSchema,
});
export type AttemptConversationPage = z.infer<typeof attemptConversationPageSchema>;

export const runConversationViewSchema = z.strictObject({
  version: z.literal(1), runKey: z.string().min(1).max(2048), sourceId: z.string().min(1).max(512),
  runId: z.string().min(1).max(512), sessionId: z.string().min(1).max(512),
  state: z.enum(["connected", "unsupported", "disconnected", "forbidden"]), page: conversationPageSchema.nullable(),
  attempt: z.strictObject({ sourceId: z.string().min(1).max(512), executionId: z.uuid(), roleId: z.uuid(),
    attemptId: z.uuid(), ordinal: z.number().int().min(1).max(33), current: z.boolean() }).nullable(), detail: z.string().max(2000),
}).refine(value => (value.state === "connected") === (value.page !== null) &&
  (!value.page || value.page.run.id === value.runId && value.page.run.sessionId === value.sessionId));
export type RunConversationView = z.infer<typeof runConversationViewSchema>;

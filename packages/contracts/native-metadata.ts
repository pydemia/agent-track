import { z } from "zod";

/** Portable transport contract. No input, output, tool arguments or artifact bytes. */
export const nativeMetadataSequenceSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine(value => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n);
const uuid = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const identifier = z.string().min(1).max(512).regex(/^[^\x00-\x1f\x7f-\x9f]+$/u);
const token = z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/);
const memberId = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const flow = z.strictObject({ version: z.literal(1), members: z.array(z.strictObject({
  memberId, dependsOn: z.array(memberId).max(64),
})).min(2).max(64) }).superRefine((value, context) => {
  const ids = new Set(value.members.map(member => member.memberId));
  if (ids.size !== value.members.length || value.members.some(member => member.dependsOn.some(id => !ids.has(id))))
    context.addIssue({ code: "custom", message: "Unique in-plan members required" });
});
const runStatus = z.enum(["queued", "running", "waiting_for_permission", "cancelling", "succeeded", "failed", "cancelled", "expired"]);

export const nativeMetadataEventDataSchema = z.strictObject({
  invocationId: identifier.optional(), invocation_id: identifier.optional(),
  parentInvocationId: identifier.optional(), parent_invocation_id: identifier.optional(),
  agentSessionId: identifier.optional(), agent_session_id: identifier.optional(),
  groupId: identifier.optional(), group_id: identifier.optional(),
  memberId: identifier.optional(), member_id: identifier.optional(),
  callId: identifier.optional(), call_id: identifier.optional(),
  permission_id: identifier.optional(), sessionId: identifier.optional(),
  tool: token.optional(), name: token.optional(), status: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/).optional(),
  ok: z.boolean().optional(), provider: token.optional(),
  model: z.string().regex(/^[a-zA-Z0-9_.:/-]{1,200}$/).optional(),
  durationMs: z.number().finite().nonnegative().optional(),
  expires_at: timestamp.optional(),
  change: z.strictObject({ path: z.string().min(1).max(2048).regex(/^[^\x00-\x1f\x7f-\x9f]+$/u) }).optional(),
  // A version-only stub keeps unsupported/invalid flow evidence observable.
  flow: z.union([flow, z.strictObject({ version: z.number().int().safe().nullable() })]).optional(),
});
export const nativeMetadataEventSchema = z.strictObject({
  api_version: z.literal("2026-09-01"), run_id: uuid,
  sequence_text: nativeMetadataSequenceSchema.refine(value => value !== "0"),
  type: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/),
  created_at: timestamp, data: nativeMetadataEventDataSchema,
});
export const nativeMetadataPageSchema = z.strictObject({
  version: z.literal(1), object: z.literal("demian.work_runtime.metadata_page"),
  api_version: z.literal("2026-09-01"),
  run: z.strictObject({
    id: uuid, organization_id: uuid, workspace_id: uuid, session_id: uuid,
    acting_user_id: uuid, service_principal_id: uuid,
    status: runStatus, created_at: timestamp, started_at: timestamp.nullable(), completed_at: timestamp.nullable(),
    correlation_id: identifier.max(200), binding_sha256: digest, context_sha256: digest, request_sha256: digest,
  }),
  events: z.strictObject({
    after: nativeMetadataSequenceSchema, through_sequence: nativeMetadataSequenceSchema,
    next_after: nativeMetadataSequenceSchema, limit: z.number().int().min(1).max(250),
    has_more: z.boolean(), data: z.array(nativeMetadataEventSchema).max(250),
  }),
}).superRefine((page, context) => {
  const events = page.events;
  if ([events.after, events.through_sequence, events.next_after, ...events.data.map(event => event.sequence_text)]
    .some(value => !nativeMetadataSequenceSchema.safeParse(value).success)) return;
  let previous = BigInt(events.after);
  if (previous > BigInt(events.through_sequence) || events.data.length > events.limit)
    context.addIssue({ code: "custom", message: "Invalid metadata window" });
  for (const event of events.data) {
    const sequence = BigInt(event.sequence_text);
    if (event.run_id !== page.run.id || sequence <= previous || sequence > BigInt(events.through_sequence))
      context.addIssue({ code: "custom", message: "Invalid metadata scope or order" });
    previous = sequence;
  }
  if (String(previous) !== events.next_after || events.has_more && (!events.data.length || previous >= BigInt(events.through_sequence)))
    context.addIssue({ code: "custom", message: "Invalid metadata continuation" });
  if (!events.has_more && events.next_after !== events.through_sequence)
    context.addIssue({ code: "custom", message: "Metadata page does not reach its declared boundary" });
});
export type NativeMetadataPage = z.infer<typeof nativeMetadataPageSchema>;

export const assistantNativeMetadataPageSchema = z.strictObject({
  version: z.literal(1), executionId: uuid, roleId: uuid,
  observedAt: timestamp, page: nativeMetadataPageSchema,
});
export type AssistantNativeMetadataPage = z.infer<typeof assistantNativeMetadataPageSchema>;

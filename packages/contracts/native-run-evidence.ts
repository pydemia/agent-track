import { z } from "zod";
import { nativeMetadataPageSchema, nativeMetadataSequenceSchema } from "./native-metadata.ts";

const uuid = z.guid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const identifier = z.string().min(1).max(512).regex(/^[^\x00-\x1f\x7f-\x9f]+$/u);
const source = z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$/);
const count = z.number().int().nonnegative().safe();
const usage = z.strictObject({
  inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(),
  cachedInputTokens: count.optional(), reasoningOutputTokens: count.optional(),
}).refine(value => Object.keys(value).length > 0);
export const nativeUsageObservationSchema = z.strictObject({
  scope: z.enum(["invocation", "latest-model-request", "native-session", "unknown"]),
  coverage: z.enum(["complete", "partial", "unknown"]), source,
  invocationId: identifier.optional(), usage,
  costUsd: z.number().nonnegative().finite().optional(),
}).refine(value => value.coverage !== "complete" || value.scope === "invocation");
export const nativeEvidenceLineageSchema = z.strictObject({
  attempt: z.number().int().positive().safe(), executor: z.literal("codex-app-server"),
  provider: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/),
  phase: z.enum(["turn_started", "message_completed", "tool_started", "tool_completed"]),
  // Source-scoped hashes, never raw SDK thread/turn/item identifiers.
  nativeThreadKey: digest, nativeTurnKey: digest, nativeItemKey: digest.nullable(),
  invocationId: identifier.nullable(),
}).refine(value => (value.phase === "turn_started") === (value.nativeItemKey === null));
export const nativeEvidenceRecordSchema = z.strictObject({
  runId: uuid, sequence: nativeMetadataSequenceSchema.refine(value => value !== "0"),
  type: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/), occurredAt: timestamp,
  selectedModel: z.string().regex(/^[A-Za-z0-9_.:/-]{1,200}$/).nullable(),
  usageObservations: z.array(nativeUsageObservationSchema).max(16),
  lineage: nativeEvidenceLineageSchema.nullable(),
  issues: z.array(z.enum(["model-unavailable", "usage-unavailable", "lineage-unavailable"])).max(3),
}).superRefine((value, context) => {
  if (value.selectedModel !== null && value.type !== "run.prepared.selected" ||
      value.usageObservations.length > 0 && value.type !== "response.usage" ||
      value.lineage !== null && value.type !== "external.lineage.observed" ||
      value.issues.some(issue => value.type !== ({ "model-unavailable": "run.prepared.selected", "usage-unavailable": "response.usage", "lineage-unavailable": "external.lineage.observed" }[issue])) ||
      new Set(value.issues).size !== value.issues.length)
    context.addIssue({ code: "custom", message: "Evidence fields must match their producer event" });
});
export const nativeEvidenceArtifactSchema = z.strictObject({
  id: uuid, sourceRunId: uuid, sha256: digest,
  filename: z.string().min(1).max(256).regex(/^[^/\\\x00-\x1f\x7f]+$/).refine(value => ![".", ".."].includes(value)),
  mediaType: z.string().min(1).max(255).regex(/^[^\x00-\x1f\x7f]+$/),
  sizeBytes: count.max(8 * 1024 * 1024), createdAt: timestamp,
  bytesVerified: z.literal(true),
});
/** Independently read evidence; never replaces previously journaled EventData. */
const nativeEvidencePageBaseSchema = z.strictObject({
  version: z.literal(1), object: z.literal("demian.work_runtime.evidence_page"),
  api_version: z.literal("2026-09-01"), observedAt: timestamp,
  run: nativeMetadataPageSchema.shape.run,
  events: z.strictObject({
    after: nativeMetadataSequenceSchema, through_sequence: nativeMetadataSequenceSchema,
    next_after: nativeMetadataSequenceSchema, limit: z.number().int().min(1).max(250),
    has_more: z.boolean(), data: z.array(nativeEvidenceRecordSchema).max(250),
  }),
  timings: z.array(z.strictObject({
    kind: z.enum(["queue", "wall"]),
    source: z.enum(["runs.created_at-to-started_at", "runs.started_at-to-completed_at"]),
    startedAt: timestamp, endedAt: timestamp.nullable(),
  }).refine(value => value.source === (value.kind === "queue" ? "runs.created_at-to-started_at" : "runs.started_at-to-completed_at") &&
    (value.endedAt === null || Date.parse(value.endedAt) >= Date.parse(value.startedAt)))).max(2),
  artifactState: z.enum(["available", "not-ready"]),
  artifacts: z.array(nativeEvidenceArtifactSchema).max(8),
});
const publicEvidenceRunSchema = nativeMetadataPageSchema.shape.run.pick({
  id: true, workspace_id: true, session_id: true, status: true,
  created_at: true, started_at: true, completed_at: true,
});
type EvidenceWindowScope = Omit<z.infer<typeof nativeEvidencePageBaseSchema>, "run"> & {
  run: z.infer<typeof publicEvidenceRunSchema>;
};
function checkEvidenceScope(page: EvidenceWindowScope, context: z.RefinementCtx): void {
  const window = page.events;
  if ([window.after, window.through_sequence, window.next_after, ...window.data.map(record => record.sequence)]
    .some(value => !nativeMetadataSequenceSchema.safeParse(value).success)) return;
  let previous = BigInt(window.after);
  if (previous > BigInt(window.through_sequence) || window.data.length > window.limit)
    context.addIssue({ code: "custom", message: "Invalid evidence window" });
  for (const record of window.data) {
    const sequence = BigInt(record.sequence);
    if (record.runId !== page.run.id || sequence <= previous || sequence > BigInt(window.through_sequence))
      context.addIssue({ code: "custom", message: "Evidence scope/order mismatch" });
    previous = sequence;
  }
  if (window.next_after !== String(previous) || window.has_more && (!window.data.length || previous >= BigInt(window.through_sequence)) ||
      !window.has_more && window.next_after !== window.through_sequence)
    context.addIssue({ code: "custom", message: "Invalid evidence continuation" });
  if (page.artifacts.some(artifact => artifact.sourceRunId !== page.run.id) ||
      new Set(page.artifacts.map(artifact => artifact.id)).size !== page.artifacts.length ||
      page.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0) > 16 * 1024 * 1024 ||
      (page.artifactState === "not-ready" && page.artifacts.length > 0) ||
      page.artifactState !== (page.run.status === "succeeded" ? "available" : "not-ready") ||
      new Set(page.timings.map(timing => timing.kind)).size !== page.timings.length)
    context.addIssue({ code: "custom", message: "Evidence artifact/timing scope mismatch" });
  for (const timing of page.timings) {
    const expectedStart = timing.kind === "queue" ? page.run.created_at : page.run.started_at;
    const expectedEnd = timing.kind === "queue" ? page.run.started_at : page.run.completed_at;
    if (expectedStart === null || timing.startedAt !== expectedStart || timing.endedAt !== expectedEnd)
      context.addIssue({ code: "custom", message: "Timing must match the locked Run timestamps" });
  }
}
export const nativeRunEvidencePageSchema = nativeEvidencePageBaseSchema.superRefine(checkEvidenceScope);
/** Browser-safe evidence: no principal, organization, signature/context or operation hashes. */
export const publicNativeRunEvidencePageSchema = nativeEvidencePageBaseSchema.extend({
  run: publicEvidenceRunSchema,
}).superRefine(checkEvidenceScope);
export type NativeRunEvidencePage = z.infer<typeof nativeRunEvidencePageSchema>;
export type PublicNativeRunEvidencePage = z.infer<typeof publicNativeRunEvidencePageSchema>;
export type NativeEvidenceRecord = z.infer<typeof nativeEvidenceRecordSchema>;
export const assistantNativeRunEvidencePageSchema = z.strictObject({
  version: z.literal(1), executionId: uuid, roleId: uuid, observedAt: timestamp,
  page: nativeRunEvidencePageSchema,
});
export type AssistantNativeRunEvidencePage = z.infer<typeof assistantNativeRunEvidencePageSchema>;
export const nativeRunEvidenceViewSchema = z.strictObject({
  state: z.enum(["connected", "disconnected", "forbidden", "unsupported"]),
  runKey: z.string().min(1).max(2048), sourceId: z.string().min(1).max(512),
  executionRef: z.strictObject({ sourceId: z.string().min(1).max(512), executionId: uuid, roleId: uuid }).nullable(),
  page: publicNativeRunEvidencePageSchema.nullable(), observedAt: timestamp,
  detail: z.string().max(2000),
}).refine(value => (value.state === "connected") === (value.page !== null && value.executionRef !== null) &&
  (value.state === "connected" || value.page === null && value.executionRef === null));
export type NativeRunEvidenceView = z.infer<typeof nativeRunEvidenceViewSchema>;
export function publicNativeRunEvidence(page: NativeRunEvidencePage): PublicNativeRunEvidencePage {
  const value = nativeRunEvidencePageSchema.parse(page), run = value.run;
  return publicNativeRunEvidencePageSchema.parse({ ...value, run: {
    id: run.id, workspace_id: run.workspace_id, session_id: run.session_id, status: run.status,
    created_at: run.created_at, started_at: run.started_at, completed_at: run.completed_at,
  } });
}

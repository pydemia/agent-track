import { z } from "zod";
import { coworkPlanSchema } from "./cowork.ts";

export const idSchema = z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/);
export const sequenceSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((value) => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n, "int64 cursor required");
export const timestampSchema = z.iso.datetime({ offset: true });
export const statusSchema = z.enum([
  "queued", "leasing", "running", "waiting_for_permission", "cancelling",
  "succeeded", "failed", "cancelled", "expired", "interrupted", "unknown",
]);
export type RunStatus = z.infer<typeof statusSchema>;
export const terminalStatuses = new Set<RunStatus>(["succeeded", "failed", "cancelled", "expired"]);
export const relationKinds = ["invocation", "cowork", "managed-child", "peer", "dependency", "artifact"] as const;
export type RelationKind = typeof relationKinds[number];

/** Read-side coordinator identity; never an executor receipt or event payload. */
export const assistantRunAttemptSchema = z.object({
  assistantSourceId: idSchema, executionId: z.uuid(), roleId: z.uuid(), attemptId: z.uuid(),
  ordinal: z.number().int().min(1).max(33),
  command: z.object({ id: z.uuid(), kind: z.enum(["retry", "resume"]), predecessorAttemptId: z.uuid(),
    provenance: z.literal("coordinator-intent") }).strict().nullable(),
}).strict().refine(value => !value.command || value.command.id === value.attemptId &&
  value.command.predecessorAttemptId !== value.attemptId, "Attempt and intent identities differ");
export type AssistantRunAttempt = z.infer<typeof assistantRunAttemptSchema>;

export const runSchema = z.object({
  sourceId: idSchema,
  runId: idSchema,
  sessionId: idSchema,
  workspaceId: idSchema.nullable(),
  title: z.string().max(240),
  status: statusSchema,
  createdAt: timestampSchema,
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  observedAt: timestampSchema,
  assistantAttempt: assistantRunAttemptSchema.optional(),
}).strict();
export type RunObservation = z.infer<typeof runSchema>;

// Deliberately closed metadata schema: no prompts, messages, arguments or output.
export const eventDataSchema = z.object({
  status: statusSchema.optional(),
  invocationId: idSchema.optional(),
  parentInvocationId: idSchema.optional(),
  agentSessionId: idSchema.optional(),
  groupId: idSchema.optional(),
  memberId: idSchema.optional(),
  coworkPlan: coworkPlanSchema.optional(),
  coworkPlanIssue: z.enum(["invalid", "unsupported"]).optional(),
  childRunId: idSchema.optional(),
  peerSessionId: idSchema.optional(),
  callId: idSchema.optional(),
  tool: z.string().max(120).optional(),
  path: z.string().max(2048).optional(),
  artifactId: idSchema.optional(),
  permissionId: idSchema.optional(),
  expiresAt: timestampSchema.optional(),
  durationMs: z.number().nonnegative().finite().optional(),
  redacted: z.boolean(),
}).strict();
export type EventData = z.infer<typeof eventDataSchema>;
export const eventSchema = z.object({
  sourceId: idSchema,
  runId: idSchema,
  sequence: sequenceSchema.refine((value) => value !== "0"),
  type: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/),
  occurredAt: timestampSchema,
  data: eventDataSchema,
}).strict();
export type ObservationEvent = z.infer<typeof eventSchema>;

export const bindingSchema = z.object({
  sourceId: idSchema,
  runId: idSchema,
  projectSourceId: idSchema,
  projectId: idSchema,
  taskId: idSchema.nullable(),
  taskRevision: idSchema.nullable(),
  projectTitle: z.string().min(1).max(240),
  taskTitle: z.string().max(300).nullable(),
  provenance: z.enum(["source", "operator"]),
}).strict();
export type RunBinding = z.infer<typeof bindingSchema>;

export const bindingRequestSchema = z.object({
  id: z.uuid(),
  runKey: idSchema,
  expectedVersion: sequenceSchema,
  projectSourceId: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  projectId: z.uuid(),
  taskId: z.uuid(),
  taskRevision: sequenceSchema.refine((value) => value !== "0"),
}).strict();
export type BindingRequest = z.infer<typeof bindingRequestSchema>;
export interface BindingRecord { version: string; binding: RunBinding; actor: string; recordedAt: string }
export interface BindingReceipt { id: string; runKey: string; version: string; binding: RunBinding; recordedAt: string }
export interface BindingView {
  version: string;
  current: RunBinding | null;
  history: BindingRecord[];
  incomplete: boolean;
}

export const permissionDecisionSchema = z.enum(["allow_once", "allow_session", "deny"]);
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export const permissionViewSchema = z.object({
  id: z.uuid(), runId: z.uuid(), callId: idSchema, tool: z.string().min(1).max(200),
  status: z.enum(["pending", "resolved", "expired"]), decision: permissionDecisionSchema.nullable(),
  createdAt: timestampSchema, resolvedAt: timestampSchema.nullable(), expiresAt: timestampSchema,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type PermissionView = z.infer<typeof permissionViewSchema>;
export interface PermissionReview { request: PermissionView; reviewText: string; reviewComplete: boolean }
export const approvalRequestSchema = z.object({
  id: z.uuid(), runKey: idSchema, permissionId: z.uuid(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/), decision: permissionDecisionSchema,
  expiresAt: timestampSchema,
}).strict();
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalReceiptState = "requested" | "dispatching" | "succeeded" | "failed" | "expired" | "unknown";
export interface ApprovalReceipt {
  id: string; runKey: string; permissionId: string; decision: PermissionDecision;
  state: ApprovalReceiptState; createdAt: string; updatedAt: string; detail: string;
}

export interface SourceView {
  id: string;
  kind: "demian" | "codex" | "claude" | "projects" | "assistant" | "desktop";
  label: string;
  device: string;
  state: "connected" | "disconnected" | "forbidden" | "unsupported";
  lastObservedAt: string | null;
  detail: string;
  capabilities: string[];
  authorizedProjectIds?: string[];
  /** Optional per-Run grant; absence preserves existing source authorization. */
  authorizedRunIds?: string[];
}
export interface ProjectMetadata {
  id: string;
  title: string;
  revision: string;
  accessRevision: string;
  archived: boolean;
}
export interface ProjectTaskMetadata {
  id: string;
  projectId: string;
  title: string;
  revision: string;
  state: string;
  requiresTest: boolean;
}
export interface ProjectTaskPage { tasks: ProjectTaskMetadata[]; total: number; nextCursor: string | null; snapshot: string }
export interface RunView extends RunObservation {
  key: string;
  cursor: string;
  highWater: string;
  incomplete: boolean;
  stale: boolean;
  binding: RunBinding | null;
  sourceLabel: string;
  device: string;
  sourceState: SourceView["state"];
  sourceUrl: string | null;
  workspaceKey: string | null;
  projectKey: string | null;
  capabilities: string[];
}
export interface RelationView {
  key: string;
  runKey: string;
  kind: RelationKind;
  from: string;
  to: string;
  evidenceSequence: string;
  observedAt: string;
}
export interface EventView extends ObservationEvent { key: string; receivedAt: string }
export interface ArtifactMetadata {
  id: string;
  runId: string;
  sessionId: string;
  kind: "attachment" | "result";
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  representation: "original" | "extracted_text" | "summary" | "reference";
  createdAt: string;
}
export interface ArtifactMetadataPage { artifacts: ArtifactMetadata[]; scanned: number; limit: number; complete: false }
export interface ArtifactEvidence extends ArtifactMetadataPage {
  state: SourceView["state"];
  runKey: string;
  observedAt: string;
  detail: string;
}
export interface FileChangeItem {
  key: string;
  path: string;
  operation: "add" | "update" | "delete" | "unknown";
  state: "reported" | "pending" | "failed" | "ambiguous";
  mechanism: "native-fileChange" | "workspace-diff";
  callId: string | null;
  requestedSequence: string | null;
  completedSequence: string | null;
  observedAt: string;
  detail: string;
}
export interface FileChangePage {
  changes: FileChangeItem[];
  scanned: number;
  limit: number;
  targetSequence: string;
  throughSequence: string;
  omittedChanges: number;
  complete: boolean;
}
export interface FileChangeEvidence extends FileChangePage {
  state: SourceView["state"];
  runKey: string;
  observedAt: string;
  detail: string;
}
export interface Snapshot {
  viewEpoch: string;
  viewVersion: string;
  revision: string;
  generatedAt: string;
  user: string;
  runs: RunView[];
  sources: SourceView[];
  relations: RelationView[];
}
export function externalKey(...parts: string[]): string {
  // Length-preserving JSON tuple avoids ambiguous concatenation across sources.
  return Buffer.from(JSON.stringify(parts)).toString("base64url");
}
export function compareSequence(a: string, b: string): number {
  return a.length - b.length || a.localeCompare(b);
}

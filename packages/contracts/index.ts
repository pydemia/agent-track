import { z } from "zod";

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
  taskTitle: z.string().max(240).nullable(),
  provenance: z.enum(["source", "operator"]),
}).strict();
export type RunBinding = z.infer<typeof bindingSchema>;

export interface SourceView {
  id: string;
  kind: "demian" | "codex" | "claude" | "projects" | "assistant" | "desktop";
  label: string;
  device: string;
  state: "connected" | "disconnected" | "forbidden" | "unsupported";
  lastObservedAt: string | null;
  detail: string;
  capabilities: string[];
}
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
export interface Snapshot {
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

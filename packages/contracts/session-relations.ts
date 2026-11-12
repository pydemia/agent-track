import { z } from "zod";
import { idSchema, statusSchema, timestampSchema } from "./index.ts";

// The producer accepts UUID shapes, including legacy versions, and normalizes case.
export const relationUuidSchema = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i)
  .transform(value => value.toLowerCase());
export const sessionRelationKindSchema = z.enum(["managed-children", "peer-processing"]);
export type SessionRelationKind = z.infer<typeof sessionRelationKindSchema>;
const common = { sessionId: relationUuidSchema, runId: relationUuidSchema, operationId: relationUuidSchema, status: statusSchema };
export const sessionRelationSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("managed-child"), parentInvocationId: idSchema, childInvocationId: idSchema }).strict(),
  z.object({ ...common, kind: z.literal("peer-processing"), connectionId: idSchema, conversationId: idSchema, messageId: idSchema }).strict(),
]);
export type SessionRelation = z.infer<typeof sessionRelationSchema>;
export interface NativeSessionRelationPage {
  kind: SessionRelationKind;
  sessionId: string;
  relations: SessionRelation[];
  nextCursor: string | null;
  hasMore: boolean;
  availability: "available" | "unsupported" | "unconfigured";
  coverage: "managed-child-receipts" | "peer-processing-receipts";
}
export const sessionRelationsEvidenceSchema = z.object({
  runKey: idSchema, sourceId: idSchema, sessionId: idSchema, kind: sessionRelationKindSchema,
  state: z.enum(["connected", "unsupported", "unconfigured", "forbidden", "disconnected"]),
  relations: z.array(sessionRelationSchema).max(250),
  // Encrypted BFF continuation; a hidden native Run UUID must never be a browser cursor.
  nextCursor: z.string().min(40).max(1024).regex(/^[A-Za-z0-9_-]+$/).nullable(),
  hasMore: z.boolean(), omitted: z.number().int().nonnegative().safe(),
  coverage: z.enum(["managed-child-receipts", "peer-processing-receipts"]),
  observedAt: timestampSchema, detail: z.string().max(2000),
}).strict().superRefine((value, context) => {
  const expected = value.kind === "managed-children" ? "managed-child" : "peer-processing";
  if (value.coverage !== (value.kind === "managed-children" ? "managed-child-receipts" : "peer-processing-receipts") ||
      value.relations.some(row => row.kind !== expected || row.sessionId !== value.sessionId) ||
      new Set(value.relations.map(row => row.runId)).size !== value.relations.length ||
      new Set(value.relations.map(row => row.operationId)).size !== value.relations.length ||
      (value.state === "connected" && !relationUuidSchema.safeParse(value.sessionId).success) ||
      value.hasMore !== (value.nextCursor !== null) ||
      (value.state !== "connected" && (value.relations.length > 0 || value.hasMore || value.omitted > 0))) {
    context.addIssue({ code: "custom", message: "Session relation scope mismatch" });
  }
});
export type SessionRelationsEvidence = z.infer<typeof sessionRelationsEvidenceSchema>;

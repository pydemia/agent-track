import { z } from "zod";
import { idSchema, statusSchema } from "../../contracts/index.ts";
import { readBoundedNativeJson } from "./json.ts";
import { relationUuidSchema, sessionRelationKindSchema, sessionRelationSchema,
  type NativeSessionRelationPage, type SessionRelationKind } from "../../contracts/session-relations.ts";

const uuid = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const common = { session_id: uuid, run_id: uuid, operation_id: uuid, status: statusSchema };
const rowSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, object: z.literal("demian.managed_child_relation"), kind: z.literal("managed_child"),
    parent_invocation_id: idSchema, child_invocation_id: idSchema }).strict(),
  z.object({ ...common, object: z.literal("demian.peer_processing_relation"), kind: z.literal("peer_processing"),
    connection_id: idSchema, conversation_id: idSchema, message_id: idSchema }).strict(),
]);
const pageSchema = z.object({
  object: z.literal("list"), session_id: uuid, data: z.array(rowSchema).max(250),
  next_cursor: uuid.nullable(), has_more: z.boolean(),
  availability: z.enum(["available", "unsupported", "unconfigured"]),
  coverage: z.enum(["managed-child-receipts", "peer-processing-receipts"]),
}).strict();

export function parseNativeSessionRelationsPage(
  raw: unknown,
  expected: { kind: SessionRelationKind; sessionId: string; after: string | null; limit: number },
): NativeSessionRelationPage {
  try {
    const request = z.object({ kind: sessionRelationKindSchema, sessionId: relationUuidSchema,
      after: relationUuidSchema.nullable(), limit: z.number().int().min(1).max(250) }).strict().parse(expected);
    const page = pageSchema.parse(raw);
    const managed = request.kind === "managed-children";
    if (page.session_id !== request.sessionId || page.data.length > request.limit ||
        page.coverage !== (managed ? "managed-child-receipts" : "peer-processing-receipts") ||
        (page.availability !== "available" && (page.data.length > 0 || page.has_more || page.next_cursor !== null))) {
      throw new Error();
    }
    let previous = request.after;
    const operations = new Set<string>();
    const relations = page.data.map(row => {
      if (row.session_id !== request.sessionId || row.kind !== (managed ? "managed_child" : "peer_processing") ||
          (previous !== null && row.run_id <= previous) || operations.has(row.operation_id)) throw new Error();
      previous = row.run_id;
      operations.add(row.operation_id);
      const base = { sessionId: row.session_id, runId: row.run_id, operationId: row.operation_id, status: row.status };
      return sessionRelationSchema.parse(row.kind === "managed_child"
        ? { ...base, kind: "managed-child", parentInvocationId: row.parent_invocation_id, childInvocationId: row.child_invocation_id }
        : { ...base, kind: "peer-processing", connectionId: row.connection_id, conversationId: row.conversation_id, messageId: row.message_id });
    });
    if (page.has_more ? (relations.length === 0 || page.next_cursor !== previous) : page.next_cursor !== null) throw new Error();
    return { kind: request.kind, sessionId: request.sessionId, relations, nextCursor: page.next_cursor,
      hasMore: page.has_more, availability: page.availability, coverage: page.coverage };
  } catch {
    // Never expose schema diagnostics, unknown keys, or producer values.
    throw new Error("Invalid native session relations page");
  }
}

export async function readBoundedSessionRelationsJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  try { return await readBoundedNativeJson(response, signal); }
  catch { throw new Error("Invalid native session relations response"); }
}

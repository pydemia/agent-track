import { createHash } from "node:crypto";
import { z } from "zod";
import { idSchema, permissionDecisionSchema, permissionViewSchema, timestampSchema, type PermissionReview } from "../../contracts/index.ts";

const nativePermission = z.object({
  id: z.uuid(), object: z.literal("demian.permission_request"), run_id: z.uuid(),
  call_id: idSchema, tool: z.string().min(1).max(200), input: z.unknown().refine((value) => value !== undefined),
  actor: z.string().max(2000).nullable(), reason: z.string().max(8000).nullable(),
  status: z.enum(["pending", "resolved", "expired"]), decision: permissionDecisionSchema.nullable(),
  created_at: timestampSchema, resolved_at: timestampSchema.nullable(), expires_at: timestampSchema,
});

function canonical(value: unknown, depth = 0): unknown {
  if (depth > 30) throw new Error("Permission review nesting limit exceeded");
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, item]) => [key, canonical(item, depth + 1)]));
  return value;
}

// Raw arguments exist only for an explicit, current-authorized review response.
// Event metadata and durable receipts never carry this text.
export function permissionReview(raw: unknown, runId: string): PermissionReview {
  const value = nativePermission.parse(raw);
  if (value.run_id !== runId) throw new Error("Permission Run identity mismatch");
  if (value.status === "resolved" && (!value.decision || !value.resolved_at)) throw new Error("Permission resolution metadata is incomplete");
  const reviewed = JSON.stringify(canonical({ input: value.input, actor: value.actor, reason: value.reason }), null, 2);
  const reviewComplete = Buffer.byteLength(reviewed) <= 65_536;
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical({
    id: value.id, runId: value.run_id, callId: value.call_id, tool: value.tool,
    input: value.input, actor: value.actor, reason: value.reason,
    createdAt: value.created_at, expiresAt: value.expires_at,
  }))).digest("hex");
  return { request: permissionViewSchema.parse({ id: value.id, runId: value.run_id, callId: value.call_id, tool: value.tool,
    status: value.status, decision: value.decision, createdAt: value.created_at, resolvedAt: value.resolved_at,
    expiresAt: value.expires_at, fingerprint }), reviewComplete,
    reviewText: reviewComplete ? reviewed : "요청 내용이 검토 크기 제한을 넘었습니다. 원본에서 확인해 주세요." };
}

export async function permissionJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Permission response unavailable");
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new Error("Permission response exceeds limit");
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function permissionList(raw: unknown, runId: string): PermissionReview[] {
  const page = z.object({ object: z.literal("list"), data: z.array(z.unknown()).max(2000) }).parse(raw);
  const result = page.data.map((item) => permissionReview(item, runId));
  if (new Set(result.map((item) => item.request.id)).size !== result.length) throw new Error("Duplicate permission identity");
  return result;
}

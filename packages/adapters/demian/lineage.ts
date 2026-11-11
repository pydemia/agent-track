import { z } from "zod";
import { sequenceSchema } from "../../contracts/index.ts";

const maxInt64 = 9223372036854775807n;
const phases = ["turn_started", "tool_started", "tool_completed", "message_completed"] as const;
const nativeText = z.string().min(1).max(512).refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

const recordSchema = z.object({
  sequence: sequenceSchema.refine((value) => value !== "0"),
  attempt: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  executor: nativeText,
  provider: nativeText,
  phase: z.enum(phases),
  native_thread_id: nativeText,
  native_turn_id: nativeText,
  native_item_id: nativeText.nullable(),
  invocation_id: nativeText.nullable(),
}).strip();

const pageSchema = z.object({
  run_id: z.uuid(),
  session_id: z.uuid(),
  observations: z.array(z.unknown()).max(250),
  next_cursor: sequenceSchema,
  has_more: z.boolean(),
}).strip();

export interface NativeLineageObservation {
  sequence: string;
  invocationId: string | null;
  nativeItemId: string | null;
  nativeThreadId: string;
  nativeTurnId: string;
  phase: typeof phases[number];
  attempt: number;
  executor: string;
  provider: string;
  observedAt: string;
  parentInvocationId?: string;
}

export interface NativeLineagePage {
  sessionId: string;
  observations: NativeLineageObservation[];
  nextCursor: string;
  hasMore: boolean;
}

export function canonicalLineageCursor(value: string): string {
  if (!/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > maxInt64) {
    throw new Error("Invalid native lineage cursor");
  }
  return value;
}

export function parseNativeLineagePage(
  raw: unknown,
  runId: string,
  after: string,
  limit: number,
  observedAt = new Date().toISOString(),
): NativeLineagePage {
  z.uuid().parse(runId);
  canonicalLineageCursor(after);
  if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new Error("Invalid native lineage limit");
  const page = pageSchema.parse(raw);
  if (page.run_id !== runId) throw new Error("Source lineage Run identity mismatch");
  if (page.observations.length > limit) throw new Error("Source lineage page exceeds requested limit");

  let previous = BigInt(after);
  const observations = page.observations.map((value) => {
    const row = recordSchema.parse(value);
    const sequence = BigInt(row.sequence);
    if (sequence <= previous) throw new Error("Source lineage sequence is not strictly increasing");
    previous = sequence;
    return {
      sequence: row.sequence,
      invocationId: row.invocation_id,
      nativeItemId: row.native_item_id,
      nativeThreadId: row.native_thread_id,
      nativeTurnId: row.native_turn_id,
      phase: row.phase,
      attempt: row.attempt,
      executor: row.executor,
      provider: row.provider,
      observedAt,
    };
  });
  const expectedCursor = observations.at(-1)?.sequence ?? after;
  if (page.next_cursor !== expectedCursor || (page.has_more && observations.length === 0)) {
    throw new Error("Source lineage page cursor mismatch");
  }
  return { sessionId: page.session_id, observations, nextCursor: page.next_cursor, hasMore: page.has_more };
}

export async function readBoundedLineageJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    await response.body?.cancel();
    throw new Error("Expected native lineage JSON");
  }
  if (!response.body) throw new Error("Missing native lineage response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new Error("Native lineage response exceeds 1 MiB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

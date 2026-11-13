import { createHash } from "node:crypto";
import { sequenceSchema, timestampSchema } from "../../contracts/index.ts";
import { modelRequestSchema, type ModelRequestObservation } from "../../contracts/model-requests.ts";

type Candidate = {
  sequence: string; occurredAt: string; contextKey: string; invocationId: string | null;
  provider: string; model: string; start: boolean; duration: number | null;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f-\x9f]/u.test(value);
const compare = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
const isModel = (type: unknown) => type === "model.request" || type === "model.request.completed";

function candidate(row: Record<string, unknown>, runId: string): Candidate | null {
  const data = object(row.data);
  if (!data || !identifier(data.sessionId) || typeof data.provider !== "string" ||
      !/^[a-zA-Z0-9_.:-]{1,120}$/u.test(data.provider) || typeof data.model !== "string" ||
      !/^[a-zA-Z0-9_.:/-]{1,200}$/u.test(data.model)) return null;
  const camel = data.invocationId, snake = data.invocation_id;
  if (camel !== undefined && !identifier(camel) || snake !== undefined && !identifier(snake) ||
      camel !== undefined && snake !== undefined && camel !== snake) return null;
  const invocationId = typeof camel === "string" ? camel : typeof snake === "string" ? snake : null;
  const contextKey = createHash("sha256").update(JSON.stringify([runId, data.sessionId, invocationId, data.provider, data.model])).digest("hex");
  return { sequence: row.sequence_text as string, occurredAt: row.created_at as string,
    contextKey, invocationId, provider: data.provider, model: data.model, start: row.type === "model.request",
    duration: typeof data.durationMs === "number" && Number.isFinite(data.durationMs) && data.durationMs >= 0 ? data.durationMs : null };
}

/** Reads allowlisted lifecycle metadata; no native session ID or request/response body leaves here. */
export function projectModelRequests(values: readonly unknown[], runId: string, sseIds: readonly string[]): {
  modelRequests: ModelRequestObservation[]; unidentifiedModelEvents: number;
} {
  if (values.length !== sseIds.length) throw new Error("Model evidence frame mismatch");
  const rows = new Map<string, { signatures: Set<string>; model: boolean; value: Candidate | null }>();
  for (let index = 0; index < values.length; index++) {
    const row = object(values[index]);
    if (!row || row.api_version !== "2026-09-01" || row.run_id !== runId || row.sequence_text !== sseIds[index] ||
        !sequenceSchema.safeParse(row.sequence_text).success || row.sequence_text === "0" ||
        !timestampSchema.safeParse(row.created_at).success || typeof row.type !== "string") {
      throw new Error("Invalid native model evidence scope");
    }
    const seq = row.sequence_text as string, model = isModel(row.type), parsed = model ? candidate(row, runId) : null;
    const signature = JSON.stringify([row.type, row.created_at, parsed]);
    const previous = rows.get(seq) ?? { signatures: new Set<string>(), model: false, value: null };
    previous.signatures.add(signature); previous.model ||= model;
    if (parsed) previous.value = parsed;
    rows.set(seq, previous);
  }
  const sequences = [...rows.keys()].sort(compare);
  const gaps = sequences.slice(1).flatMap((right, index) => {
    const left = sequences[index]!;
    return BigInt(right) - BigInt(left) > 1n ? [{ left, right }] : [];
  });
  const valuesByContext = new Map<string, Candidate[]>();
  const uncertainSequences: string[] = [];
  let unidentifiedModelEvents = 0;
  for (const seq of sequences) {
    const row = rows.get(seq)!;
    if (!row.model) continue;
    if (row.signatures.size !== 1 || !row.value) { unidentifiedModelEvents++; uncertainSequences.push(seq); continue; }
    const list = valuesByContext.get(row.value.contextKey) ?? [];
    list.push(row.value); valuesByContext.set(row.value.contextKey, list);
  }
  const output: ModelRequestObservation[] = [];
  const mark = (value: Candidate) => ({ sequence: value.sequence, occurredAt: value.occurredAt });
  const base = (value: Candidate) => ({ id: value.sequence, contextKey: value.contextKey,
    invocationId: value.invocationId, provider: value.provider, model: value.model });
  for (const context of valuesByContext.values()) {
    let starts: Candidate[] = [], ends: Candidate[] = [], open = 0;
    const finish = () => {
      // No particular end belongs to a start in this block. Keep each actual
      // start's evidence, rather than attributing every end to every request.
      for (const start of starts) output.push({ ...base(start), phase: "ambiguous", started: mark(start), ended: null, sequences: [start.sequence] });
      starts = []; ends = []; open = 0;
    };
    for (const event of context) {
      if (event.start) { starts.push(event); open++; continue; }
      if (!open) {
        output.push({ ...base(event), phase: "end-only", started: null, ended: mark(event),
          ...(event.duration === null ? {} : { reportedDurationMs: event.duration }), sequences: [event.sequence] });
        continue;
      }
      ends.push(event); open--;
      if (open) continue;
      const start = starts[0]!;
      const gap = gaps.some(value => compare(value.left, start.sequence) >= 0 && compare(value.right, event.sequence) <= 0) ||
        uncertainSequences.some(seq => compare(seq, start.sequence) > 0 && compare(seq, event.sequence) < 0);
      if (starts.length !== 1 || ends.length !== 1 || gap) { finish(); continue; }
      output.push({ ...base(start), phase: "ended", started: mark(start), ended: mark(event),
        ...(event.duration === null ? {} : { reportedDurationMs: event.duration }), sequences: [start.sequence, event.sequence] });
      starts = []; ends = [];
    }
    if (starts.length > 1 || ends.length) finish();
    else if (starts[0]) output.push({ ...base(starts[0]), phase: "started", started: mark(starts[0]), ended: null, sequences: [starts[0].sequence] });
  }
  return { modelRequests: output.sort((a, b) => compare(a.id, b.id)).map(value => modelRequestSchema.parse(value)), unidentifiedModelEvents };
}

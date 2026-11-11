import { timestampSchema } from "../../contracts/index.ts";

export type ToolEvidenceOutcome = "succeeded" | "failed" | "unknown" | "ambiguous";
export type ToolEvidenceEventType = "tool.requested" | "tool.started" | "tool.completed" | "tool.failed";

export interface ToolEvidenceMark {
  type: ToolEvidenceEventType;
  sequence: string;
  occurredAt: string;
  ok?: boolean;
}

export interface ToolEvidenceCall {
  invocationId: string | null;
  callId: string;
  tool: string | null;
  requested: ToolEvidenceMark[];
  started: ToolEvidenceMark[];
  ended: ToolEvidenceMark[];
  outcome: ToolEvidenceOutcome;
}

export interface ToolEvidencePage {
  calls: ToolEvidenceCall[];
  scanned: number;
  limit: 2000;
  targetSequence: string;
  throughSequence: string;
  targetReached: boolean;
  gaps: boolean;
  truncated: boolean;
  omittedCalls: number;
  unidentifiedEvents: number;
  complete: boolean;
}

type NativeToolEvent = {
  api_version: "2026-09-01";
  run_id: string;
  sequence_text: string;
  type: ToolEvidenceEventType;
  created_at: string;
  data: Record<string, unknown>;
};

type MutableCall = Omit<ToolEvidenceCall, "outcome"> & { ambiguous: boolean };

const MAX_INT64 = 9223372036854775807n;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const TOOL_NAME = /^[a-zA-Z0-9_.:-]{1,120}$/u;
const EVENT_TYPES = new Set<ToolEvidenceEventType>([
  "tool.requested", "tool.started", "tool.completed", "tool.failed",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !CONTROL.test(value);
}

function sequence(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/u.test(value)) return false;
  try { return BigInt(value) <= MAX_INT64; } catch { return false; }
}

function alias(data: Record<string, unknown>, camel: string, snake: string): { value: string | null; candidates: string[]; ambiguous: boolean } {
  const first = data[camel];
  const second = data[snake];
  const firstValid = first === undefined || safeIdentifier(first);
  const secondValid = second === undefined || safeIdentifier(second);
  if (!firstValid || !secondValid) return { value: null, candidates: [], ambiguous: true };
  if (typeof first === "string" && typeof second === "string" && first !== second) {
    return { value: null, candidates: [first, second], ambiguous: true };
  }
  const value = typeof first === "string" ? first : typeof second === "string" ? second : null;
  return { value, candidates: value === null ? [] : [value], ambiguous: false };
}

function nativeToolEvent(value: unknown, runId: string, sseId: string): NativeToolEvent | null {
  const event = record(value);
  if (!event || typeof event.type !== "string" || !EVENT_TYPES.has(event.type as ToolEvidenceEventType)) return null;
  const data = record(event.data);
  if (event.api_version !== "2026-09-01" || event.run_id !== runId || !sequence(event.sequence_text) ||
      event.sequence_text !== sseId || !timestampSchema.safeParse(event.created_at).success || !data) {
    throw new Error("Invalid native tool evidence event");
  }
  return {
    api_version: "2026-09-01", run_id: runId, sequence_text: event.sequence_text,
    type: event.type as ToolEvidenceEventType, created_at: event.created_at as string, data,
  };
}

function tupleKey(invocationId: string | null, callId: string): string {
  return JSON.stringify([invocationId, callId]);
}

function compareSequence(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function outcome(call: MutableCall): ToolEvidenceOutcome {
  if (call.ambiguous) return "ambiguous";
  const terminal = call.ended;
  if (terminal.length > 1) return "ambiguous";
  if (terminal.length === 0) return "unknown";
  const end = terminal[0]!;
  if (end.type === "tool.failed" || end.ok === false) return "failed";
  if (end.type === "tool.completed" && end.ok === true) return "succeeded";
  return "unknown";
}

/** Projects bounded native SSE rows into an allowlisted, metadata-only page. */
export function projectToolEvidence(
  values: readonly unknown[],
  runId: string,
  sseIds: readonly string[],
): { calls: ToolEvidenceCall[]; unidentifiedEvents: number } {
  const grouped = new Map<string, MutableCall>();
  const sequenceOwners = new Map<string, { keys: Set<string>; count: number }>();
  let unidentifiedEvents = 0;

  values.forEach((value, index) => {
    const event = nativeToolEvent(value, runId, sseIds[index] ?? "");
    if (!event) return;
    const call = alias(event.data, "callId", "call_id");
    const invocation = alias(event.data, "invocationId", "invocation_id");
    const callIds = call.candidates;
    if (callIds.length === 0) { unidentifiedEvents++; return; }
    const knownTool = event.data.tool ?? event.data.name;
    const tool = typeof knownTool === "string" && TOOL_NAME.test(knownTool) ? knownTool : null;
    const mark: ToolEvidenceMark = {
      type: event.type, sequence: event.sequence_text, occurredAt: event.created_at,
      ...(event.type === "tool.completed" && typeof event.data.ok === "boolean" ? { ok: event.data.ok } : {}),
    };
    for (const callId of callIds) {
      const key = tupleKey(invocation.value, callId);
      const row = grouped.get(key) ?? {
        invocationId: invocation.value, callId, tool,
        requested: [], started: [], ended: [], ambiguous: false,
      };
      if ((row.tool !== null && tool !== null && row.tool !== tool) || (row.tool === null && tool !== null && row.requested.length + row.started.length + row.ended.length > 0)) {
        row.ambiguous = true;
      }
      if (row.tool === null) row.tool = tool;
      row.ambiguous ||= call.ambiguous || invocation.ambiguous;
      const owners = sequenceOwners.get(event.sequence_text) ?? { keys: new Set<string>(), count: 0 };
      owners.keys.add(key);
      owners.count++;
      sequenceOwners.set(event.sequence_text, owners);
      if (event.type === "tool.requested") row.requested.push(mark);
      else if (event.type === "tool.started") row.started.push(mark);
      else row.ended.push(mark);
      grouped.set(key, row);
    }
  });

  for (const row of grouped.values()) {
    if (row.requested.length > 1 || row.started.length > 1 || row.ended.length > 1) row.ambiguous = true;
  }
  for (const owners of sequenceOwners.values()) {
    if (owners.count < 2) continue;
    for (const key of owners.keys) {
      const row = grouped.get(key);
      if (row) row.ambiguous = true;
    }
  }
  const calls = [...grouped.values()].map((call) => ({
    invocationId: call.invocationId, callId: call.callId, tool: call.tool,
    requested: call.requested, started: call.started, ended: call.ended,
    outcome: outcome(call),
  }));
  calls.sort((a, b) => compareSequence(
    [...a.requested, ...a.started, ...a.ended].map((mark) => mark.sequence).sort(compareSequence)[0] ?? "0",
    [...b.requested, ...b.started, ...b.ended].map((mark) => mark.sequence).sort(compareSequence)[0] ?? "0",
  ));
  return { calls, unidentifiedEvents };
}

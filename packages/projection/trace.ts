import { terminalStatuses, type EventView, type RunStatus } from "../contracts/index.ts";

export type TracePhase = "started" | "completed" | "failed" | "cancelled" | "unfinished" | "unknown" | "ambiguous";

export interface ToolTrace {
  key: string;
  callId: string;
  invocationId: string | null;
  tool: string | null;
  startedAt: string | null;
  completedAt: string | null;
  observedIntervalMs: number | null;
  phase: TracePhase;
  sequences: string[];
}

export interface InvocationTrace {
  id: string;
  parentId: string | null;
  phase: TracePhase;
  startedAt: string | null;
  completedAt: string | null;
  tools: ToolTrace[];
}

export interface TraceProjection {
  steps: InvocationTrace[];
  unassigned: ToolTrace[];
  unidentifiedEvents: number;
  eventCount: number;
}

type Lifecycle = "started" | "completed" | "failed" | "cancelled" | "other";
type Evidence = { event: EventView; lifecycle: Lifecycle; conflict?: boolean };

function compareSequence(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function eventIdentity(event: EventView): string {
  return JSON.stringify([event.sourceId, event.runId, event.sequence, event.type, event.occurredAt, event.data]);
}

function lifecycle(type: string, prefix: "agent.invocation." | "tool."): Lifecycle {
  if (!type.startsWith(prefix)) return "other";
  const suffix = type.slice(prefix.length);
  if (prefix === "agent.invocation." && suffix === "cancelled") return "cancelled";
  return suffix === "started" || suffix === "completed" || suffix === "failed" ? suffix : "other";
}

function interval(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const startClock = startedAt.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1];
  const endClock = completedAt.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1];
  if (!startClock || startClock !== endClock) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function oneTimestamp(evidence: Evidence[], kind: "started" | "completed" | "failed" | "cancelled"): { value: string | null; ambiguous: boolean } {
  const matching = evidence.filter((item) => item.lifecycle === kind);
  if (matching.some((item) => item.conflict)) return { value: null, ambiguous: true };
  if (matching.length > 1) return { value: null, ambiguous: true };
  return { value: matching[0]?.event.occurredAt ?? null, ambiguous: false };
}

function phaseFor(evidence: Evidence[], startedAt: string | null, completedAt: string | null, ambiguous: boolean, runEnded = false): TracePhase {
  if (ambiguous || evidence.some((item) => item.conflict)) return "ambiguous";
  const ends = evidence.filter((item) => item.lifecycle === "completed" || item.lifecycle === "failed" || item.lifecycle === "cancelled");
  if (ends.length > 1) return "ambiguous";
  if (ends[0]?.lifecycle === "completed") return "completed";
  if (ends[0]?.lifecycle === "failed") return "failed";
  if (ends[0]?.lifecycle === "cancelled") return "cancelled";
  if (startedAt) return runEnded ? "unfinished" : "started";
  if (completedAt) return "completed";
  return "unknown";
}

/** Projects only normalized, metadata-only events belonging to the requested source/run. */
export function projectTrace(
  run: { sourceId: string; runId: string; status?: RunStatus },
  events: EventView[],
): TraceProjection {
  const runEnded = run.status !== undefined && terminalStatuses.has(run.status);
  const scoped = events.filter((event) => event.sourceId === run.sourceId && event.runId === run.runId);
  const bySequence = new Map<string, EventView[]>();
  for (const event of scoped) {
    const rows = bySequence.get(event.sequence) ?? [];
    rows.push(event);
    bySequence.set(event.sequence, rows);
  }

  const unique: EventView[] = [];
  const conflicts: EventView[] = [];
  for (const rows of bySequence.values()) {
    const distinct = new Map(rows.map((event) => [eventIdentity(event), event]));
    if (distinct.size === 1) unique.push(distinct.values().next().value as EventView);
    else conflicts.push(...distinct.values());
  }
  unique.sort((a, b) => compareSequence(a.sequence, b.sequence));

  const invocations = new Map<string, Evidence[]>();
  const tools = new Map<string, Evidence[]>();
  let unidentifiedEvents = 0;
  const addInvocation = (event: EventView, isConflict = false): void => {
    if (!event.type.startsWith("agent.invocation.")) return;
    const id = event.data.invocationId;
    if (!id) return;
    const list = invocations.get(id) ?? [];
    list.push({ event, lifecycle: lifecycle(event.type, "agent.invocation."), ...(isConflict ? { conflict: true } : {}) });
    invocations.set(id, list);
  };
  const addTool = (event: EventView, isConflict = false): void => {
    if (!event.type.startsWith("tool.")) return;
    const callId = event.data.callId;
    if (!callId) { unidentifiedEvents++; return; }
    const key = JSON.stringify([event.data.invocationId ?? null, callId]);
    const list = tools.get(key) ?? [];
    list.push({ event, lifecycle: lifecycle(event.type, "tool."), ...(isConflict ? { conflict: true } : {}) });
    tools.set(key, list);
  };
  for (const event of unique) {
    addInvocation(event);
    addTool(event);
  }
  for (const event of conflicts) {
    addInvocation(event, true);
    addTool(event, true);
  }

  const steps: InvocationTrace[] = [...invocations.entries()].map(([id, evidence]) => {
    const starts = oneTimestamp(evidence, "started");
    const completions = oneTimestamp(evidence, "completed");
    const failures = oneTimestamp(evidence, "failed");
    const cancellations = oneTimestamp(evidence, "cancelled");
    const endCount = evidence.filter((item) => item.lifecycle === "completed" || item.lifecycle === "failed" || item.lifecycle === "cancelled").length;
    const endConflict = completions.ambiguous || failures.ambiguous || cancellations.ambiguous || endCount > 1;
    const end = endCount === 1 ? (completions.value ?? failures.value ?? cancellations.value) : null;
    const startedAt = starts.ambiguous ? null : starts.value;
    const completedAt = endConflict ? null : end;
    const parents = new Set(evidence.filter((item) => !item.conflict).flatMap((item) => item.event.data.parentInvocationId ? [item.event.data.parentInvocationId] : []));
    const parentId = parents.size === 1 ? [...parents][0]! : null;
    return {
      id, parentId,
      phase: phaseFor(evidence, startedAt, completedAt, starts.ambiguous || endConflict || parents.size > 1, runEnded),
      startedAt, completedAt,
      tools: [],
    };
  });
  const stepById = new Map(steps.map((step) => [step.id, step]));

  const projectedTools: ToolTrace[] = [...tools.entries()].map(([key, evidence]) => {
    const first = evidence[0]!.event;
    const invocationId = first.data.invocationId ?? null;
    const callId = first.data.callId!;
    const names = new Set(evidence.filter((item) => !item.conflict).map((item) => item.event.data.tool).filter((name): name is string => name !== undefined));
    const starts = oneTimestamp(evidence, "started");
    const completions = oneTimestamp(evidence, "completed");
    const failures = oneTimestamp(evidence, "failed");
    const endCount = evidence.filter((item) => item.lifecycle === "completed" || item.lifecycle === "failed").length;
    const endConflict = completions.ambiguous || failures.ambiguous || endCount > 1;
    const startedAt = starts.ambiguous ? null : starts.value;
    const completedAt = endCount === 1 && !endConflict ? (completions.value ?? failures.value) : null;
    const ambiguous = starts.ambiguous || endConflict || names.size > 1 || evidence.some((item) => item.conflict);
    const phase = ambiguous ? "ambiguous" : phaseFor(evidence, startedAt, completedAt, false, runEnded);
    return {
      key, callId, invocationId, tool: names.size === 1 ? [...names][0]! : null,
      startedAt, completedAt,
      observedIntervalMs: ambiguous ? null : interval(startedAt, completedAt),
      phase,
      sequences: [...new Set(evidence.map((item) => item.event.sequence))].sort(compareSequence),
    };
  });

  const unassigned: ToolTrace[] = [];
  for (const tool of projectedTools) {
    const owner = tool.invocationId ? stepById.get(tool.invocationId) : undefined;
    if (owner) owner.tools.push(tool);
    else unassigned.push(tool);
  }
  for (const step of steps) step.tools.sort((a, b) => compareSequence(a.sequences[0] ?? "0", b.sequences[0] ?? "0"));
  steps.sort((a, b) => {
    const aSeq = invocations.get(a.id)?.[0]?.event.sequence ?? "0";
    const bSeq = invocations.get(b.id)?.[0]?.event.sequence ?? "0";
    return compareSequence(aSeq, bSeq) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  unassigned.sort((a, b) => compareSequence(a.sequences[0] ?? "0", b.sequences[0] ?? "0"));

  return { steps, unassigned, unidentifiedEvents, eventCount: bySequence.size };
}

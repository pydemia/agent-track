import { createHash } from "node:crypto";
import { timestampSchema, type FileChangeItem } from "../contracts/index.ts";

type Operation = FileChangeItem["operation"];
type State = FileChangeItem["state"];
type Mechanism = FileChangeItem["mechanism"];

interface SignalBase {
  sequence: string;
  observedAt: string;
  /** SHA-256 of the complete source event, including private fields. Never expose the event. */
  evidenceDigest: string;
}

export type FileSignal =
  | (SignalBase & {
      kind: "proposal";
      callId: string | null;
      invocationId: string | null;
      identityAmbiguous: boolean;
      changes: Array<{ path: string; operation: Operation }>;
    })
  | (SignalBase & {
      kind: "completion";
      callId: string | null;
      invocationId: string | null;
      identityAmbiguous: boolean;
      ok: boolean | null;
    })
  | (SignalBase & {
      kind: "workspace-diff";
      path: string;
      operation: Operation;
    });

const MAX_INT64 = 9223372036854775807n;
const ID_LIMIT = 512;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const URI_SCHEME = /^[a-z][a-z\d+.-]*:/iu;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= ID_LIMIT && !CONTROL.test(value);
}

function safePath(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2048 || CONTROL.test(value)) return false;
  // A drive-letter path is a Windows path, not a URI scheme.
  return !(/^[a-z]:[\\/]/iu.test(value) ? false : URI_SCHEME.test(value));
}

function validSequence(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/u.test(value)) return false;
  try { return BigInt(value) <= MAX_INT64; } catch { return false; }
}

function validTime(value: unknown): value is string {
  return timestampSchema.safeParse(value).success;
}

function invalid(): never {
  throw new Error("Invalid native file-change metadata");
}

function evidenceDigest(raw: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return invalid();
  }
  if (serialized === undefined) return invalid();
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

function invocationIdentity(data: Record<string, unknown>): { value: string | null; ambiguous: boolean } {
  const camel = data.invocationId;
  const snake = data.invocation_id;
  if (camel !== undefined && !safeId(camel)) return invalid();
  if (snake !== undefined && !safeId(snake)) return invalid();
  if (typeof camel === "string" && typeof snake === "string" && camel !== snake) {
    return { value: null, ambiguous: true };
  }
  return { value: typeof camel === "string" ? camel : typeof snake === "string" ? snake : null, ambiguous: false };
}

/** Converts one native journal event into closed, display-safe file metadata. */
export function fileChangeSignal(raw: unknown, expectedRunId: string): FileSignal | null {
  const event = record(raw);
  if (!event) return null;
  const data = record(event.data);
  const type = event.type;
  if (typeof type !== "string") return null;

  const namedTool = data?.executor === "codex-app-server" && data.name === "fileChange";
  const isProposal = type === "tool.requested" && namedTool;
  const isCompletion = type === "tool.completed" && namedTool;
  const isWorkspaceDiff = type === "workspace.diff.updated";
  if (!isProposal && !isCompletion && !isWorkspaceDiff) return null;

  if (event.api_version !== "2026-09-01" || !safeId(expectedRunId) || !safeId(event.run_id)) return invalid();
  if (event.run_id !== expectedRunId) return null;
  if (!validSequence(event.sequence_text) || !validTime(event.created_at)) return invalid();
  const sequence = event.sequence_text;
  const observedAt = event.created_at;
  const digest = evidenceDigest(raw);

  if (isWorkspaceDiff) {
    const change = record(data?.change);
    if (!change || !safePath(change.path)) return invalid();
    const rawOperation = change.operation ?? record(change.kind)?.type;
    const operation: Operation = rawOperation === "add" || rawOperation === "update" || rawOperation === "delete"
      ? rawOperation
      : "unknown";
    return { kind: "workspace-diff", sequence, observedAt, evidenceDigest: digest, path: change.path, operation };
  }

  if (!data) return invalid();
  const callId = safeId(data.callId) ? data.callId : null;
  if (data.callId !== undefined && callId === null) return invalid();
  const invocation = invocationIdentity(data);

  if (isProposal) {
    const input = record(data.input);
    const rawChanges = input?.changes;
    if (!Array.isArray(rawChanges) || rawChanges.length > 100) return invalid();
    const changes = rawChanges.map((rawChange) => {
      const change = record(rawChange);
      const kind = record(change?.kind);
      if (!change || !safePath(change.path) || !kind) return invalid();
      const operation: Operation = kind.type === "add" || kind.type === "update" || kind.type === "delete"
        ? kind.type
        : "unknown";
      return { path: change.path, operation };
    });
    return {
      kind: "proposal", sequence, observedAt, evidenceDigest: digest,
      callId, invocationId: invocation.value, identityAmbiguous: invocation.ambiguous, changes,
    };
  }

  const ok = data.ok === true || data.ok === false ? data.ok : null;
  return {
    kind: "completion", sequence, observedAt, evidenceDigest: digest,
    callId, invocationId: invocation.value, identityAmbiguous: invocation.ambiguous, ok,
  };
}

function compareSequence(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function tupleKey(callId: string, invocationId: string | null): string {
  return JSON.stringify([callId, invocationId]);
}

function detail(state: State): string {
  switch (state) {
    case "reported": return "네이티브 파일 변경이 완료로 보고됨";
    case "pending": return "파일 변경 요청의 완료 이벤트를 기다리는 중";
    case "failed": return "파일 변경 요청이 실패로 보고됨";
    case "ambiguous": return "파일 변경 근거가 중복되거나 서로 일치하지 않음";
  }
}

/** Pairs bounded native signals without retaining source arguments, previews, or diff text. */
export function projectFileChanges(signals: readonly FileSignal[]): FileChangeItem[] {
  const bySequence = new Map<string, FileSignal[]>();
  for (const signal of signals) {
    const bucket = bySequence.get(signal.sequence) ?? [];
    bucket.push(signal);
    bySequence.set(signal.sequence, bucket);
  }

  const conflicts = new Set<string>();
  const unique: FileSignal[] = [];
  for (const [sequence, bucket] of bySequence) {
    const digests = new Set(bucket.map((signal) => signal.evidenceDigest));
    if (digests.size > 1) {
      conflicts.add(sequence);
      unique.push(...bucket);
    } else unique.push(bucket[0]!);
  }
  unique.sort((a, b) => compareSequence(a.sequence, b.sequence));

  const starts = new Map<string, Extract<FileSignal, { kind: "proposal" }>[]>();
  const ends = new Map<string, Extract<FileSignal, { kind: "completion" }>[]>();
  for (const signal of unique) {
    if (signal.kind === "proposal" && signal.callId !== null) {
      const key = tupleKey(signal.callId, signal.invocationId);
      const bucket = starts.get(key) ?? [];
      bucket.push(signal);
      starts.set(key, bucket);
    } else if (signal.kind === "completion" && signal.callId !== null) {
      const key = tupleKey(signal.callId, signal.invocationId);
      const bucket = ends.get(key) ?? [];
      bucket.push(signal);
      ends.set(key, bucket);
    }
  }

  const output: FileChangeItem[] = [];
  const append = (args: {
    path: string; operation: Operation; state: State; mechanism: Mechanism;
    callId: string | null; requestedSequence: string | null; completedSequence: string | null; observedAt: string;
  }) => {
    output.push({
      key: createHash("sha256").update(JSON.stringify([args.mechanism, args.callId, args.requestedSequence, args.completedSequence, args.path, args.operation])).digest("hex"),
      ...args,
      detail: detail(args.state),
    });
  };

  for (const signal of unique) {
    if (signal.kind === "workspace-diff") {
      append({ path: signal.path, operation: signal.operation, state: conflicts.has(signal.sequence) ? "ambiguous" : "reported",
        mechanism: "workspace-diff", callId: null, requestedSequence: null, completedSequence: signal.sequence,
        observedAt: signal.observedAt });
      continue;
    }
    if (signal.kind !== "proposal") continue;
    const key = signal.callId === null ? null : tupleKey(signal.callId, signal.invocationId);
    const matchingStarts = key === null ? [] : starts.get(key)!;
    const matchingEnds = key === null ? [] : ends.get(key) ?? [];
    const earlierEnds = matchingEnds.filter((end) => compareSequence(end.sequence, signal.sequence) < 0);
    const laterEnds = matchingEnds.filter((end) => compareSequence(end.sequence, signal.sequence) > 0);
    const duplicateStart = matchingStarts.length !== 1;
    const duplicateEnd = matchingEnds.length > 1;
    const collision = conflicts.has(signal.sequence) || matchingEnds.some((end) => conflicts.has(end.sequence));
    let state: State = "pending";
    let completedSequence: string | null = null;
    let observedAt = signal.observedAt;
    if (signal.identityAmbiguous || signal.callId === null || duplicateStart || duplicateEnd || collision || earlierEnds.length > 0) {
      state = "ambiguous";
    } else if (laterEnds.length === 1) {
      const end = laterEnds[0]!;
      if (end.identityAmbiguous || end.ok === null) state = "ambiguous";
      else {
        state = end.ok ? "reported" : "failed";
        completedSequence = end.sequence;
        observedAt = end.observedAt;
      }
    }
    for (const change of signal.changes) {
      append({ path: change.path, operation: change.operation, state, mechanism: "native-fileChange",
        callId: signal.callId, requestedSequence: signal.sequence, completedSequence, observedAt });
    }
  }

  const rowsByKey = new Map<string, FileChangeItem>();
  for (const row of output) rowsByKey.set(row.key, row);
  return [...rowsByKey.values()];
}

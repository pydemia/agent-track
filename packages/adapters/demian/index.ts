import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  eventSchema, idSchema, runSchema, sequenceSchema, statusSchema,
  permissionDecisionSchema,
  type ArtifactMetadataPage, type EventData, type ObservationEvent, type RunObservation, type PermissionDecision, type PermissionReview,
  type FileChangePage,
} from "../../contracts/index.ts";
import { permissionJson, permissionList, permissionReview } from "./permissions.ts";
import { fileChangeSignal, projectFileChanges, type FileSignal } from "../../projection/file-changes.ts";
import { canonicalLineageCursor, parseNativeLineagePage, readBoundedLineageJson, type NativeLineagePage } from "./lineage.ts";
import { projectToolEvidence, type ToolEvidencePage } from "./tool-evidence.ts";
import { parseNativeSessionRelationsPage, readBoundedSessionRelationsJson } from "./session-relations.ts";
import { relationUuidSchema, type SessionRelationKind, type NativeSessionRelationPage } from "../../contracts/session-relations.ts";
import { readBoundedNativeJson } from "./json.ts";

export type { NativeLineageObservation, NativeLineagePage } from "./lineage.ts";
export type { ToolEvidenceCall, ToolEvidenceEventType, ToolEvidenceMark, ToolEvidenceOutcome, ToolEvidencePage } from "./tool-evidence.ts";

const artifactManifestSchema = z.object({
  version: z.literal(1),
  object: z.literal("demian.artifact"),
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  organization_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  workspace_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  session_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  owner_user_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  run_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).nullable(),
  kind: z.enum(["attachment", "result"]),
  filename: z.string().min(1).max(256).refine((value) =>
    value.trim().length > 0 && !/[\/\\\x00-\x1f\x7f]/.test(value) && ![".", ".."].includes(value)),
  media_type: z.string().max(255).regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/),
  size_bytes: z.number().int().min(0).max(8 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  representation: z.enum(["original", "extracted_text", "summary", "reference"]),
  source_artifact_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).nullable(),
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  revoked_at: z.iso.datetime({ offset: true }).nullable(),
});

const artifactPageSchema = z.object({
  object: z.literal("list"),
  data: z.array(artifactManifestSchema).max(100),
  limit: z.literal(100),
});

const nativeEventSchema = z.object({
  api_version: z.literal("2026-09-01"),
  run_id: idSchema,
  sequence_text: sequenceSchema.refine((value) => value !== "0"),
  type: z.string(),
  created_at: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export function normalizeEvent(sourceId: string, raw: unknown): ObservationEvent {
  const event = nativeEventSchema.parse(raw);
  const data: EventData = { redacted: true };
  const rawData = event.data;
  const aliases = {
    invocationId: ["invocationId", "invocation_id"],
    parentInvocationId: ["parentInvocationId", "parent_invocation_id"],
    agentSessionId: ["agentSessionId", "agent_session_id"],
    groupId: ["groupId", "group_id"], memberId: ["memberId", "member_id"],
    callId: ["callId", "call_id"], permissionId: ["permission_id"],
  } as const;
  // Do not promote identically named fields from arbitrary tool outputs into edges.
  if (event.type.startsWith("agent.invocation.") || event.type.startsWith("cowork.") ||
      event.type.startsWith("tool.") || event.type.startsWith("permission.") || event.type === "workspace.diff.updated") {
    for (const [target, keys] of Object.entries(aliases)) {
      const value = keys.map((key) => rawData[key]).find((value) => typeof value === "string");
      if (typeof value === "string" && idSchema.safeParse(value).success) {
        (data as Record<string, unknown>)[target] = value;
      }
    }
  }
  const status = statusSchema.safeParse(rawData.status);
  if ((event.type.startsWith("run.") || event.type.startsWith("response.")) && status.success) data.status = status.data;
  if (event.type.startsWith("tool.") || event.type.startsWith("permission.")) {
    const name = rawData.tool ?? rawData.name;
    if (typeof name === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(name)) data.tool = name;
  }
  if (event.type === "permission.requested" && typeof rawData.expires_at === "string" &&
      z.iso.datetime({ offset: true }).safeParse(rawData.expires_at).success) data.expiresAt = rawData.expires_at;
  if (event.type === "workspace.diff.updated" && rawData.change && typeof rawData.change === "object") {
    const path = (rawData.change as Record<string, unknown>).path;
    if (typeof path === "string" && path.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(path)) data.path = path;
  }
  // Diff content, tool input/output and provider/native identity never enter Track.
  // Native lineage and peer/managed-child require their separately authorized APIs.
  return eventSchema.parse({ sourceId, runId: event.run_id, sequence: event.sequence_text,
    type: event.type, occurredAt: event.created_at, data });
}

export interface DemianOptions {
  sourceId: string;
  baseUrl: string;
  tokenFile?: string;
  credentialFormat?: "plain" | "demian-service";
  organizationId?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export class SourceError extends Error {
  constructor(readonly status: number) { super(`Source request failed (${status})`); }
}

export class DemianClient {
  constructor(readonly options: DemianOptions) {}

  private async request(path: string, signal?: AbortSignal, body?: object): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (this.options.tokenFile) {
      const text = (await readFile(this.options.tokenFile, "utf8")).replace(/^\uFEFF/, "").trim();
      const token = this.options.credentialFormat === "demian-service"
        ? z.object({ apiToken: z.string().min(1) }).parse(JSON.parse(text)).apiToken : text;
      if (!token || /\s/.test(token)) throw new Error("Invalid source credential file");
      headers.Authorization = `Bearer ${token}`;
    }
    if (this.options.organizationId) headers["X-Demian-Organization-Id"] = this.options.organizationId;
    const response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
      headers, redirect: "error", signal: signal ?? this.options.signal ?? AbortSignal.timeout(15_000),
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) { await response.body?.cancel(); throw new SourceError(response.status); }
    return response;
  }

  async verifySessionAccess(sessionId: string): Promise<void> {
    idSchema.parse(sessionId);
    const response = await this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
    const session = z.object({ id: idSchema, workspace_id: idSchema }).parse(await response.json());
    if (session.id !== sessionId) throw new Error("Source Session identity mismatch");
  }

  async sessionRelations(sessionId: string, kind: SessionRelationKind, after: string | null = null, limit = 250): Promise<NativeSessionRelationPage> {
    const session = relationUuidSchema.parse(sessionId);
    if (!["managed-children", "peer-processing"].includes(kind) || !Number.isInteger(limit) || limit < 1 || limit > 250) throw new Error("Invalid session relation query");
    const cursor = after === null ? null : relationUuidSchema.parse(after);
    const query = new URLSearchParams({ limit: String(limit), ...(cursor ? { after: cursor } : {}) });
    const signal = this.options.signal ?? AbortSignal.timeout(10_000);
    const response = await this.request(`/api/v1/sessions/${session}/relations/${kind}?${query}`, signal);
    const raw = await readBoundedSessionRelationsJson(response, signal);
    return parseNativeSessionRelationsPage(raw, { kind, sessionId: session, after: cursor, limit });
  }

  async observe(runId: string): Promise<RunObservation> {
    const signal = this.options.signal ?? AbortSignal.timeout(15_000);
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}`, signal);
    const raw = z.object({
      id: idSchema, session_id: idSchema, status: statusSchema,
      created_at: z.string(), started_at: z.string().nullable(), completed_at: z.string().nullable(),
    }).parse(await readBoundedNativeJson(response, signal));
    if (raw.id !== runId) throw new Error("Source Run identity mismatch");
    const sessionResponse = await this.request(`/api/v1/sessions/${encodeURIComponent(raw.session_id)}`, signal);
    const session = z.object({ id: idSchema, workspace_id: idSchema, title: z.string() }).parse(await readBoundedNativeJson(sessionResponse, signal));
    if (session.id !== raw.session_id) throw new Error("Source Session identity mismatch");
    return runSchema.parse({ sourceId: this.options.sourceId, runId: raw.id, sessionId: raw.session_id,
      workspaceId: session.workspace_id, title: session.title.slice(0, 240), status: raw.status,
      createdAt: raw.created_at, startedAt: raw.started_at, completedAt: raw.completed_at,
      observedAt: new Date().toISOString() });
  }

  async cancel(runId: string): Promise<{ runId: string; status: RunObservation["status"] }> {
    const raw = z.object({ id: idSchema, status: statusSchema }).parse(await (
      await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, undefined, {})
    ).json());
    if (raw.id !== runId) throw new Error("Source cancel identity mismatch");
    return { runId: raw.id, status: raw.status };
  }

  async permissions(runId: string): Promise<PermissionReview[]> {
    z.uuid().parse(runId);
    return permissionList(await permissionJson(await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/permissions`)), runId);
  }

  async fileChanges(runId: string, targetSequence: string): Promise<FileChangePage> {
    z.uuid().parse(runId); sequenceSchema.parse(targetSequence);
    const limit = 2000;
    const empty = { changes: [], scanned: 0, limit, targetSequence, throughSequence: "0", omittedChanges: 0, complete: false };
    if (targetSequence === "0") return empty;
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/events?after=0`, AbortSignal.timeout(10_000));
    if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
      await response.body?.cancel(); throw new Error("Expected file evidence SSE");
    }
    const stop = new Error("File evidence window reached");
    const resourceLimit = new Error("File evidence limit reached");
    const signals: FileSignal[] = []; const seen = new Set<string>();
    let scanned = 0; let through = 0n; let contiguous = 0n; let bytes = 0;
    const target = BigInt(targetSequence);
    const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > 8_388_608) throw resourceLimit;
      controller.enqueue(chunk);
    } }));
    try {
      await parseSse(bounded, (id, raw) => {
        const event = nativeEventSchema.parse(raw);
        if (event.run_id !== runId || event.sequence_text !== id) throw new Error("File evidence scope mismatch");
        const sequence = BigInt(event.sequence_text);
        if (sequence > target) throw stop;
        scanned++; seen.add(id);
        if (sequence > through) through = sequence;
        while (seen.has(String(contiguous + 1n))) contiguous++;
        const signal = fileChangeSignal(event, runId);
        if (signal) signals.push(signal);
        if (contiguous >= target) throw stop;
        if (scanned >= limit) throw resourceLimit;
      });
    } catch (error) {
      if (error !== stop && error !== resourceLimit) throw error;
    }
    const projected = projectFileChanges(signals);
    const omittedChanges = Math.max(0, projected.length - 500);
    return { changes: projected.slice(0, 500), scanned, limit, targetSequence,
      throughSequence: String(through), omittedChanges, complete: contiguous >= target && omittedChanges === 0 };
  }

  async toolEvidence(runId: string, targetSequence: string): Promise<ToolEvidencePage> {
    z.uuid().parse(runId); sequenceSchema.parse(targetSequence);
    const limit = 2000 as const;
    const empty: ToolEvidencePage = {
      calls: [], scanned: 0, limit, targetSequence, throughSequence: "0",
      targetReached: targetSequence === "0", gaps: false, truncated: false,
      omittedCalls: 0, unidentifiedEvents: 0, complete: targetSequence === "0",
    };
    if (targetSequence === "0") return empty;
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/events?after=0`, AbortSignal.timeout(10_000));
    if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
      await response.body?.cancel(); throw new Error("Expected tool evidence SSE");
    }
    const stop = new Error("Tool evidence target reached");
    const resourceLimit = new Error("Tool evidence limit reached");
    const events: unknown[] = []; const ids: string[] = []; const seen = new Set<string>();
    let scanned = 0; let through = 0n; let contiguous = 0n; let bytes = 0; let truncated = false;
    const target = BigInt(targetSequence);
    const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > 8_388_608) throw resourceLimit;
      controller.enqueue(chunk);
    } }));
    try {
      await parseSse(bounded, (id, raw) => {
        const event = nativeEventSchema.parse(raw);
        if (event.run_id !== runId || event.sequence_text !== id) throw new Error("Tool evidence scope mismatch");
        const sequence = BigInt(event.sequence_text);
        if (sequence > target) throw stop;
        scanned++; events.push(raw); ids.push(id); seen.add(id);
        if (sequence > through) through = sequence;
        while (seen.has(String(contiguous + 1n))) contiguous++;
        if (contiguous >= target) throw stop;
        if (scanned >= limit) throw resourceLimit;
      });
    } catch (error) {
      if (error === resourceLimit || (error instanceof Error && error.message === "Source SSE frame too large")) truncated = true;
      else if (error !== stop) throw error;
    }
    const projected = projectToolEvidence(events, runId, ids);
    const omittedCalls = Math.max(0, projected.calls.length - 500);
    const targetReached = contiguous >= target;
    const complete = targetReached && !truncated && omittedCalls === 0 && projected.unidentifiedEvents === 0;
    const calls = projected.calls.slice(0, 500).map((call) =>
      !complete && call.outcome === "succeeded" ? { ...call, outcome: "unknown" as const } : call);
    return {
      calls, scanned, limit, targetSequence, throughSequence: String(through), targetReached,
      gaps: through > contiguous, truncated, omittedCalls,
      unidentifiedEvents: projected.unidentifiedEvents,
      complete,
    };
  }

  async lineage(runId: string, after = "0", limit = 250): Promise<NativeLineagePage> {
    z.uuid().parse(runId);
    canonicalLineageCursor(after);
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new Error("Invalid native lineage limit");
    const query = new URLSearchParams({ after, limit: String(limit) });
    const response = await this.request(
      `/api/v1/runs/${encodeURIComponent(runId)}/lineage?${query.toString()}`,
      AbortSignal.timeout(10_000),
    );
    const raw = await readBoundedLineageJson(response);
    return parseNativeLineagePage(raw, runId, after, limit);
  }

  async decidePermission(runId: string, permissionId: string, decision: PermissionDecision): Promise<PermissionReview> {
    z.uuid().parse(runId); z.uuid().parse(permissionId); permissionDecisionSchema.parse(decision);
    const value = permissionReview(await permissionJson(await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/permissions/${encodeURIComponent(permissionId)}/decision`,
      undefined, { decision })), runId);
    if (value.request.id !== permissionId) throw new Error("Permission acknowledgement identity mismatch");
    return value;
  }

  async artifacts(runId: string, sessionId: string): Promise<ArtifactMetadataPage> {
    artifactManifestSchema.shape.run_id.unwrap().parse(runId);
    artifactManifestSchema.shape.session_id.parse(sessionId);
    const signal = this.options.signal ?? AbortSignal.timeout(10_000);
    const response = await this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/artifacts`, signal);
    const page = artifactPageSchema.parse(await readBoundedNativeJson(response, signal));
    if (new Set(page.data.map(row => row.id.toLowerCase())).size !== page.data.length) throw new Error("Duplicate native artifact identity");
    const artifacts = page.data.flatMap((raw) => {
      if (raw.session_id !== sessionId) throw new Error("Source artifact session identity mismatch");
      if (raw.revoked_at !== null || raw.run_id !== runId) return [];
      return [{ id: raw.id, runId: raw.run_id, sessionId: raw.session_id, kind: raw.kind, filename: raw.filename,
        mediaType: raw.media_type, sizeBytes: raw.size_bytes, sha256: raw.sha256,
        representation: raw.representation, createdAt: raw.created_at }];
    });
    return { artifacts, scanned: page.data.length, limit: 100, complete: false };
  }

  async discoverRuns(options: { history?: boolean; maxPages?: number; cursor?: (sessionId: string) => string } = {}): Promise<{ runIds: string[]; cursors: Map<string, string>; sessions: number; incompleteSessions: number }> {
    const workspaces = z.object({ data: z.array(z.object({ id: idSchema })) })
      .parse(await (await this.request("/api/v1/workspaces")).json());
    const runs = new Set<string>();
    const cursors = new Map<string, string>();
    let sessionCount = 0;
    let incompleteSessions = 0;
    for (const workspace of workspaces.data) {
      const sessions = z.object({ data: z.array(z.object({ id: idSchema, active_run_id: idSchema.nullish() })) })
        .parse(await (await this.request(`/api/v1/sessions?workspace_id=${encodeURIComponent(workspace.id)}`)).json());
      for (const session of sessions.data) {
        sessionCount++;
        // Collection resources may omit active_run_id; an authorized detail read is required.
        const detail = z.object({ active_run_id: idSchema.nullish() })
          .parse(await (await this.request(`/api/v1/sessions/${encodeURIComponent(session.id)}`)).json());
        if (detail.active_run_id) runs.add(detail.active_run_id);
        if (options.history) {
          let after = sequenceSchema.parse(options.cursor?.(session.id) ?? "0");
          let partial = false;
          for (let page = 0; page < (options.maxPages ?? 4); page++) {
            // Only entries are retained; message bodies in the native response are discarded.
            const history = z.object({
              entries: z.array(z.object({ run_id: idSchema.nullable(), sequence: sequenceSchema })),
              next_cursor: sequenceSchema.nullable(), has_more: z.boolean(), incomplete_history: z.boolean(),
            }).parse(await (await this.request(`/api/v1/sessions/${encodeURIComponent(session.id)}/messages?limit=500&after=${after}`)).json());
            for (const entry of history.entries) if (entry.run_id) runs.add(entry.run_id);
            const last = history.entries.at(-1)?.sequence;
            if (last && BigInt(last) > BigInt(after)) { after = last; cursors.set(session.id, after); }
            partial ||= history.incomplete_history;
            if (!history.has_more) break;
            if (!history.next_cursor || BigInt(history.next_cursor) < BigInt(after) || history.entries.length === 0) throw new Error("Invalid native message discovery cursor");
            after = history.next_cursor;
            if (page === (options.maxPages ?? 4) - 1) partial = true;
          }
          if (partial) incompleteSessions++;
        }
      }
    }
    return { runIds: [...runs], cursors, sessions: sessionCount, incompleteSessions };
  }

  async stream(runId: string, after: string, consume: (event: ObservationEvent) => void, signal: AbortSignal, opened?: () => void): Promise<void> {
    sequenceSchema.parse(after);
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/events?after=${after}`, signal);
    if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
      await response.body?.cancel(); throw new Error("Expected source SSE");
    }
    if (!response.body) throw new Error("Missing source SSE body");
    opened?.();
    await parseSse(response.body, (id, value) => {
      const event = normalizeEvent(this.options.sourceId, value);
      if (event.runId !== runId || id !== event.sequence) throw new Error("SSE identity/cursor mismatch");
      consume(event);
    });
  }
}

export async function parseSse(body: ReadableStream<Uint8Array>, consume: (id: string, value: unknown) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let id = "";
  let lines: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 2_097_152) throw new Error("Source SSE frame too large");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line === "") {
          if (lines.length) consume(id, JSON.parse(lines.join("\n")));
          lines = []; id = "";
        } else if (line.startsWith("id:")) id = line.slice(3).trimStart();
        else if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
        if (lines.reduce((total, text) => total + text.length, 0) > 1_048_576) throw new Error("Source SSE event too large");
      }
    }
    // Unterminated frames are deliberately replayed after the durable cursor.
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

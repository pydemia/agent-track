import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  eventSchema, idSchema, runSchema, sequenceSchema, statusSchema,
  type EventData, type ObservationEvent, type RunObservation,
} from "../../contracts/index.ts";

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
  organizationId?: string;
  fetch?: typeof fetch;
}

export class SourceError extends Error {
  constructor(readonly status: number) { super(`Source request failed (${status})`); }
}

export class DemianClient {
  constructor(readonly options: DemianOptions) {}

  private async request(path: string, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.tokenFile) {
      const token = (await readFile(this.options.tokenFile, "utf8")).trim();
      if (!token || /\s/.test(token)) throw new Error("Invalid source credential file");
      headers.Authorization = `Bearer ${token}`;
    }
    if (this.options.organizationId) headers["X-Demian-Organization-Id"] = this.options.organizationId;
    const response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
      headers, redirect: "error", signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new SourceError(response.status); }
    return response;
  }

  async observe(runId: string): Promise<RunObservation> {
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}`);
    const raw = z.object({
      id: idSchema, session_id: idSchema, status: statusSchema,
      created_at: z.string(), started_at: z.string().nullable(), completed_at: z.string().nullable(),
    }).parse(await response.json());
    if (raw.id !== runId) throw new Error("Source Run identity mismatch");
    const sessionResponse = await this.request(`/api/v1/sessions/${encodeURIComponent(raw.session_id)}`);
    const session = z.object({ id: idSchema, workspace_id: idSchema, title: z.string() }).parse(await sessionResponse.json());
    if (session.id !== raw.session_id) throw new Error("Source Session identity mismatch");
    return runSchema.parse({ sourceId: this.options.sourceId, runId: raw.id, sessionId: raw.session_id,
      workspaceId: session.workspace_id, title: session.title.slice(0, 240), status: raw.status,
      createdAt: raw.created_at, startedAt: raw.started_at, completedAt: raw.completed_at,
      observedAt: new Date().toISOString() });
  }

  async discoverActiveRuns(): Promise<string[]> {
    const workspaces = z.object({ data: z.array(z.object({ id: idSchema })) })
      .parse(await (await this.request("/api/v1/workspaces")).json());
    const runs = new Set<string>();
    for (const workspace of workspaces.data) {
      const sessions = z.object({ data: z.array(z.object({ id: idSchema, active_run_id: idSchema.nullish() })) })
        .parse(await (await this.request(`/api/v1/sessions?workspace_id=${encodeURIComponent(workspace.id)}`)).json());
      for (const session of sessions.data) {
        // Collection resources may omit active_run_id; an authorized detail read is required.
        const detail = z.object({ active_run_id: idSchema.nullish() })
          .parse(await (await this.request(`/api/v1/sessions/${encodeURIComponent(session.id)}`)).json());
        if (detail.active_run_id) runs.add(detail.active_run_id);
      }
    }
    return [...runs];
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

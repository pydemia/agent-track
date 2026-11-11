import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { statusSchema, type RunStatus } from "../../contracts/index.ts";
import { SourceError, type DemianOptions } from "./index.ts";

const uuidSchema = z.string().uuid();
const timestampSchema = z.iso.datetime({ offset: true });
const MAX_TEXT_BYTES = 8192;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export interface NativeAssignmentSession {
  sessionId: string;
  workspaceId: string;
  title: string;
  agent: string;
  provider: string;
  model: string | null;
  mode: "single-agent" | "multi-agent";
  permissionPolicy: "deny" | "ask" | "auto" | "full";
  activeRunId: string | null;
  archived: boolean;
}

export interface NativeRunAcceptance {
  runId: string;
  sessionId: string;
  status: RunStatus;
  inputSha256: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export class DemianAssignmentRejected extends Error {
  constructor(readonly status: number) {
    super(`Demian assignment rejected (${status})`);
    this.name = "DemianAssignmentRejected";
  }
}

export class DemianAssignmentExpired extends Error {
  constructor() { super("Demian assignment deadline passed"); this.name = "DemianAssignmentExpired"; }
}

export class DemianAssignmentAccessChanged extends Error {
  constructor() { super("Demian assignment access changed"); this.name = "DemianAssignmentAccessChanged"; }
}

export function prepareRunInput(text: string): { inputSha256: string; body: string } {
  if (typeof text !== "string" || text.length === 0) throw new TypeError("Assignment text must be nonempty");
  const input = [{ type: "input_text", text }];
  const serializedInput = JSON.stringify(input);
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) throw new TypeError("Assignment text exceeds 8192 UTF-8 bytes");
  return {
    inputSha256: createHash("sha256").update(serializedInput, "utf8").digest("hex"),
    body: JSON.stringify({ input }),
  };
}

const sourceSessionSchema = z.object({
  id: uuidSchema,
  object: z.literal("demian.session"),
  workspace_id: uuidSchema,
  title: z.string(),
  agent: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  mode: z.enum(["single-agent", "multi-agent"]),
  permission_policy: z.enum(["deny", "ask", "auto", "full"]),
  active_run_id: uuidSchema.nullable().optional(),
  archived_at: timestampSchema.nullable().optional(),
}).passthrough();

const nativeRunSchema = z.object({
  id: uuidSchema,
  object: z.literal("demian.run"),
  session_id: uuidSchema,
  status: statusSchema,
  input: z.array(z.object({ type: z.literal("input_text"), text: z.string() }).strict()).length(1),
  created_at: timestampSchema,
  started_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
}).passthrough();

function acceptance(raw: unknown, expectedSessionId: string, expectedInputSha256: string): NativeRunAcceptance {
  const parsed = nativeRunSchema.safeParse(raw);
  if (!parsed.success || parsed.data.session_id !== expectedSessionId) throw new SourceError(502);
  const run = parsed.data;
  const inputSha256 = createHash("sha256").update(JSON.stringify(run.input), "utf8").digest("hex");
  if (inputSha256 !== expectedInputSha256) throw new SourceError(502);
  return {
    runId: run.id,
    sessionId: run.session_id,
    status: run.status,
    inputSha256,
    createdAt: run.created_at,
    startedAt: run.started_at,
    completedAt: run.completed_at,
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel();
    throw new SourceError(502);
  }
  if (!response.body) throw new SourceError(502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new SourceError(502);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof SourceError) throw error;
    throw new SourceError(502);
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new SourceError(502);
  }
}

export class DemianRunWriter {
  constructor(private readonly options: DemianOptions) {}

  private async request(path: string, method: "GET" | "POST", body?: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.options.tokenFile) {
      let token: string;
      try {
        const credentialText = (await readFile(this.options.tokenFile, "utf8")).replace(/^\uFEFF/, "").trim();
        token = this.options.credentialFormat === "demian-service"
          ? z.object({ apiToken: z.string().min(1) }).parse(JSON.parse(credentialText)).apiToken
          : credentialText;
      } catch {
        throw new SourceError(401);
      }
      if (!token || /\s/.test(token)) throw new SourceError(401);
      headers.Authorization = `Bearer ${token}`;
    }
    if (this.options.organizationId) headers["X-Demian-Organization-Id"] = this.options.organizationId;
    try {
      const response = await (this.options.fetch ?? fetch)(
        `${this.options.baseUrl.replace(/\/$/, "")}${path}`,
        {
          method,
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ...(body !== undefined ? { body } : {}),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        if (method === "POST" && response.status >= 400 && response.status < 500) {
          throw new DemianAssignmentRejected(response.status);
        }
        throw new SourceError(response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof SourceError || error instanceof DemianAssignmentRejected) throw error;
      throw new SourceError(502);
    }
  }

  async session(sessionId: string): Promise<NativeAssignmentSession> {
    uuidSchema.parse(sessionId);
    const response = await this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, "GET");
    const raw = await boundedJson(response);
    const parsed = sourceSessionSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== sessionId) throw new SourceError(502);
    const value = parsed.data;
    return {
      sessionId: value.id,
      workspaceId: value.workspace_id,
      title: value.title,
      agent: value.agent,
      provider: value.provider,
      model: value.model,
      mode: value.mode,
      permissionPolicy: value.permission_policy,
      activeRunId: value.active_run_id ?? null,
      archived: value.archived_at != null,
    };
  }

  async start(
    sessionId: string,
    requestIdUUID: string,
    text: string,
    options: { expiresAt: string; refreshAuthorization: () => Promise<void>; isAuthorized: () => boolean },
  ): Promise<NativeRunAcceptance> {
    uuidSchema.parse(sessionId);
    uuidSchema.parse(requestIdUUID);
    const prepared = prepareRunInput(text);
    const deadline = timestampSchema.safeParse(options.expiresAt);
    if (!deadline.success) throw new TypeError("Invalid assignment deadline");
    let currentSession: NativeAssignmentSession;
    try { currentSession = await this.session(sessionId); }
    catch { throw new DemianAssignmentAccessChanged(); }
    if (currentSession.archived || currentSession.activeRunId !== null) throw new DemianAssignmentRejected(409);

    // Read the live credential before refreshing grants and performing the final synchronous gate.
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (this.options.tokenFile) {
      let token: string;
      try {
        const credentialText = (await readFile(this.options.tokenFile, "utf8")).replace(/^\uFEFF/, "").trim();
        token = this.options.credentialFormat === "demian-service"
          ? z.object({ apiToken: z.string().min(1) }).parse(JSON.parse(credentialText)).apiToken
          : credentialText;
      } catch { throw new DemianAssignmentAccessChanged(); }
      if (!token || /\s/.test(token)) throw new DemianAssignmentAccessChanged();
      headers.Authorization = `Bearer ${token}`;
    }
    if (this.options.organizationId) headers["X-Demian-Organization-Id"] = this.options.organizationId;
    try { await options.refreshAuthorization(); }
    catch { throw new DemianAssignmentAccessChanged(); }
    if (!options.isAuthorized()) throw new DemianAssignmentAccessChanged();
    if (Date.now() >= Date.parse(deadline.data)) throw new DemianAssignmentExpired();

    const path = `/api/v1/sessions/${encodeURIComponent(sessionId)}/runs`;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": requestIdUUID },
        body: prepared.body,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { throw new SourceError(502); }
    if (response.status !== 200 && response.status !== 202) {
      await response.body?.cancel();
      if (response.status >= 400 && response.status < 500) throw new DemianAssignmentRejected(response.status);
      throw new SourceError(response.status);
    }
    return acceptance(await boundedJson(response), sessionId, prepared.inputSha256);
  }

  async lookup(sessionId: string, requestId: string, expectedInputSha256: string): Promise<NativeRunAcceptance | null> {
    uuidSchema.parse(sessionId);
    uuidSchema.parse(requestId);
    if (!/^[a-f0-9]{64}$/.test(expectedInputSha256)) throw new TypeError("Invalid expected input hash");
    const response = await this.request(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(requestId)}`,
      "GET",
    );
    const schema = z.object({
      object: z.literal("demian.run_request_status"),
      request_id: uuidSchema,
      status: z.enum(["found", "not_found"]),
      run: z.unknown().nullable(),
    }).strict();
    const parsed = schema.safeParse(await boundedJson(response));
    if (!parsed.success || parsed.data.request_id !== requestId) throw new SourceError(502);
    if (parsed.data.status === "not_found") {
      if (parsed.data.run !== null) throw new SourceError(502);
      return null;
    }
    if (parsed.data.run === null) throw new SourceError(502);
    return acceptance(parsed.data.run, sessionId, expectedInputSha256);
  }
}

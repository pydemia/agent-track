import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { openSync, fstatSync, readSync, closeSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import {
  assistantCapabilitiesSchema, assistantExecutionPageSchema, assistantExecutionEventsPageSchema,
  projectAssistantExecution, projectAssistantEvent,
} from "../contracts/assistant.ts";

export const ASSISTANT_READ_PREFIX = "/api/integrations/track/v1";
const readerId = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const ownerId = z.string().regex(/^sso-sub:[a-f0-9]{64}$/);
const ordinal = z.string().regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine(value => BigInt(value) <= 9223372036854775807n);
const eventCursor = z.string().regex(/^(0|[1-9][0-9]{0,15})$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
const timestamp = z.iso.datetime({ offset: true });
export const assistantReaderConfigSchema = z.strictObject({
  version: z.literal(1), enabled: z.boolean(), audience: z.literal("agent-track"),
  principalId: readerId, ownerId, revision: z.number().int().positive().safe(),
  notBefore: timestamp, expiresAt: timestamp, secretFile: z.string().refine(isAbsolute),
}).refine(value => Date.parse(value.expiresAt) > Date.parse(value.notBefore));
export type AssistantReaderConfig = z.infer<typeof assistantReaderConfigSchema>;

export class AssistantReadError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export interface AssistantReadRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
}
export interface AssistantReadPort {
  /** Native SQL must filter owner before ordering/limiting. Ordinals are decimal row IDs. */
  scan(owner: string, window: { after: string | null; through: string | null }, limit: number):
    { rows: Array<{ id: string; ordinal: string }>; through: string; hasMore: boolean } |
    Promise<{ rows: Array<{ id: string; ordinal: string }>; through: string; hasMore: boolean }>;
  /** Native frozen input, membership, runtime-context and result-proof checks precede return. */
  execution(owner: string, id: string): unknown | Promise<unknown>;
  /** Native current execution authorization is also required here; no result-body endpoint. */
  events(owner: string, id: string, after: string):
    { events: unknown[]; hasMore: boolean } | Promise<{ events: unknown[]; hasMore: boolean }>;
}
interface Reader {
  config: AssistantReaderConfig;
  secret: string;
  stamp: string;
}
type Route = { kind: "capabilities" } | { kind: "list"; cursor: string | null } |
  { kind: "execution"; id: string } | { kind: "events"; id: string; after: string };
const scanSchema = z.strictObject({
  rows: z.array(z.strictObject({ id: z.uuid(), ordinal })).max(50),
  through: ordinal, hasMore: z.boolean(),
});
const cursorSchema = z.strictObject({
  version: z.literal(1), purpose: z.literal("assistant-execution-page"),
  through: ordinal, after: ordinal, expiresAt: z.number().int().positive().safe(),
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const denied = () => new AssistantReadError(401, "track_reader_denied");
const invalidCursor = () => new AssistantReadError(400, "track_cursor_invalid");
const unavailable = () => new AssistantReadError(503, "track_read_unavailable");

function boundedFile(path: string, limit: number): string {
  const handle = openSync(path, "r");
  try {
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.size > limit) throw denied();
    const buffer = Buffer.alloc(limit + 1);
    let used = 0;
    while (used <= limit) {
      const bytesRead = readSync(handle, buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
      if (used > limit) throw denied();
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, used));
  } finally { closeSync(handle); }
}

function route(request: AssistantReadRequest): Route {
  if (request.method !== "GET") throw new AssistantReadError(405, "track_read_only");
  if (request.url.length > 4096 || !request.url.startsWith(ASSISTANT_READ_PREFIX + "/")) {
    throw new AssistantReadError(404, "track_read_missing");
  }
  const url = new URL(request.url, "http://native.invalid");
  if (!url.pathname.startsWith(ASSISTANT_READ_PREFIX + "/")) throw new AssistantReadError(404, "track_read_missing");
  const parts = url.pathname.slice(ASSISTANT_READ_PREFIX.length);
  const query = Object.fromEntries(url.searchParams);
  if ([...url.searchParams.keys()].some((key, index, keys) => keys.indexOf(key) !== index)) throw invalidCursor();
  if (parts === "/capabilities" && !url.search) return { kind: "capabilities" };
  if (parts === "/executions") {
    const parsed = z.strictObject({ cursor: z.string().min(1).max(2048).optional() }).safeParse(query);
    if (!parsed.success) throw invalidCursor();
    return { kind: "list", cursor: parsed.data.cursor ?? null };
  }
  const match = /^\/executions\/([0-9a-f-]{36})(\/events)?$/.exec(parts);
  if (!match || !z.uuid().safeParse(match[1]).success) throw new AssistantReadError(404, "track_read_missing");
  if (!match[2] && !url.search) return { kind: "execution", id: match[1]! };
  if (match[2]) {
    const parsed = z.strictObject({ after: eventCursor.optional() }).safeParse(query);
    if (!parsed.success) throw invalidCursor();
    return { kind: "events", id: match[1]!, after: parsed.data.after ?? "0" };
  }
  throw new AssistantReadError(400, "track_query_invalid");
}

/** Optional native producer. Never uses browser cookies, an Entra proxy key or outbound integration credentials. */
export class AssistantReadService {
  constructor(private options: {
    configFile: string;
    configuredOwner: () => string | null;
    port: AssistantReadPort;
    now?: () => number;
  }) {
    if (!isAbsolute(options.configFile)) throw new Error("Absolute reader configuration required");
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private authorize(request: AssistantReadRequest): Reader {
    try {
      const document = boundedFile(this.options.configFile, 16_384);
      const config = assistantReaderConfigSchema.parse(JSON.parse(document));
      if (!config.enabled || request.headers["x-agent-track-principal"] !== config.principalId) throw denied();
      const header = request.headers.authorization;
      if (typeof header !== "string" || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(header)) throw denied();
      const secret = boundedFile(config.secretFile, 4096).trim();
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret) ||
          !timingSafeEqual(Buffer.from(hash(header.slice(7)), "hex"), Buffer.from(hash(secret), "hex"))) throw denied();
      // Bounded synchronous reads keep the final grant check in this turn.
      if (boundedFile(this.options.configFile, 16_384) !== document) throw denied();
      const currentOwner = this.options.configuredOwner();
      const now = this.now();
      if (config.ownerId !== currentOwner || now < Date.parse(config.notBefore) || now >= Date.parse(config.expiresAt)) throw denied();
      return { config, secret, stamp: hash(JSON.stringify(config) + "\n" + hash(secret)) };
    } catch { throw denied(); }
  }
  private confirm(request: AssistantReadRequest, reader: Reader): void {
    const current = this.authorize(request);
    if (current.stamp !== reader.stamp) throw denied();
  }
  private mac(reader: Reader, encoded: string) {
    return createHmac("sha256", reader.secret).update(JSON.stringify([
      "assistant-execution-page-v1", reader.config.principalId, reader.config.ownerId,
      reader.config.revision, reader.stamp, encoded,
    ])).digest("base64url");
  }
  private decode(reader: Reader, cursor: string | null): { after: string | null; through: string | null } {
    if (cursor === null) return { after: null, through: null };
    try {
      const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(cursor);
      if (!match || !timingSafeEqual(Buffer.from(match[2]!), Buffer.from(this.mac(reader, match[1]!)))) throw invalidCursor();
      const decoded = cursorSchema.parse(JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")));
      if (decoded.expiresAt <= this.now() || decoded.expiresAt > Date.parse(reader.config.expiresAt) ||
          decoded.after === "0" || BigInt(decoded.after) > BigInt(decoded.through)) throw invalidCursor();
      return { after: decoded.after, through: decoded.through };
    } catch { throw invalidCursor(); }
  }
  private encode(reader: Reader, after: string, through: string): string {
    const encoded = Buffer.from(JSON.stringify({ version: 1, purpose: "assistant-execution-page", after, through,
      expiresAt: Math.min(this.now() + 900_000, Date.parse(reader.config.expiresAt)) })).toString("base64url");
    return encoded + "." + this.mac(reader, encoded);
  }
  private async execution(reader: Reader, id: string) {
    const value = await this.options.port.execution(reader.config.ownerId, id);
    if (value === null) return null;
    const metadata = projectAssistantExecution(value);
    if (metadata.id !== id) throw unavailable();
    return metadata;
  }
  private async list(reader: Reader, cursor: string | null) {
    const window = this.decode(reader, cursor);
    const page = scanSchema.parse(await this.options.port.scan(reader.config.ownerId, window, 50));
    if (window.through !== null && page.through !== window.through) throw unavailable();
    let previous = window.after === null ? BigInt(page.through) + 1n : BigInt(window.after);
    let processed: string | null = null;
    let bytes = 0; let omitted = 0; let budgetReached = false;
    const executions: Array<ReturnType<typeof projectAssistantExecution>> = [];
    const seen = new Set<string>();
    for (const row of page.rows) {
      const position = BigInt(row.ordinal);
      if (position === 0n || position >= previous || position > BigInt(page.through) || seen.has(row.id)) throw unavailable();
      const value = await this.execution(reader, row.id);
      if (value) {
        const size = Buffer.byteLength(JSON.stringify(value));
        if (bytes + size > 786_432) { if (processed === null) throw unavailable(); budgetReached = true; break; }
        bytes += size; executions.push(value);
      } else omitted++;
      previous = position; processed = row.ordinal; seen.add(row.id);
    }
    const hasMore = budgetReached || page.hasMore;
    if (hasMore && processed === null) throw unavailable();
    return assistantExecutionPageSchema.parse({ version: 1, observedAt: new Date(this.now()).toISOString(), executions,
      cursor: hasMore ? this.encode(reader, processed!, page.through) : null, hasMore, omitted, complete: false });
  }
  private async events(reader: Reader, id: string, after: string) {
    const execution = await this.execution(reader, id);
    if (!execution) throw new AssistantReadError(404, "track_execution_missing");
    if (BigInt(after) > BigInt(execution.revision)) throw new AssistantReadError(409, "track_event_cursor_invalid");
    const page = await this.options.port.events(reader.config.ownerId, id, after);
    if (!Array.isArray(page.events) || page.events.length > 100 || typeof page.hasMore !== "boolean") throw unavailable();
    const events = page.events.map(projectAssistantEvent);
    const current = await this.execution(reader, id);
    if (!current) throw new AssistantReadError(404, "track_execution_missing");
    let cursor = after;
    for (const event of events) {
      if (event.executionId !== id || BigInt(event.sequence) <= BigInt(cursor) || BigInt(event.sequence) > BigInt(current.revision)) throw unavailable();
      cursor = event.sequence;
    }
    if (page.hasMore && cursor === after) throw unavailable();
    return assistantExecutionEventsPageSchema.parse({ version: 1, executionId: id,
      observedAt: new Date(this.now()).toISOString(), events, cursor, hasMore: page.hasMore, complete: false });
  }
  async handle(request: AssistantReadRequest): Promise<unknown> {
    const target = route(request);
    const reader = this.authorize(request);
    try {
      let value: unknown;
      if (target.kind === "capabilities") value = assistantCapabilitiesSchema.parse({ version: 1, service: "assistant", audience: "agent-track",
        ownerId: reader.config.ownerId, principalId: reader.config.principalId, revision: String(reader.config.revision),
        executionsRead: true, eventsRead: true, controls: false, listLimit: 50, eventLimit: 100, demianReferencesSupported: false });
      else if (target.kind === "list") value = await this.list(reader, target.cursor);
      else if (target.kind === "execution") {
        value = await this.execution(reader, target.id);
        if (!value) throw new AssistantReadError(404, "track_execution_missing");
      } else value = await this.events(reader, target.id, target.after);
      this.confirm(request, reader);
      return value;
    } catch (error) {
      if (error instanceof AssistantReadError) throw error;
      throw unavailable();
    }
  }
}

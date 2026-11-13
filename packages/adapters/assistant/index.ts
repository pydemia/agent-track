import { createHash } from "node:crypto";
import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { assistantNativeMetadataPageSchema, nativeMetadataSequenceSchema, type AssistantNativeMetadataPage } from "../../contracts/native-metadata.ts";
import { assistantNativeRunEvidencePageSchema, type AssistantNativeRunEvidencePage } from "../../contracts/native-run-evidence.ts";
import {
  assistantCapabilitiesSchema, assistantExecutionMetadataSchema,
  assistantExecutionPageSchema, assistantExecutionEventsPageSchema,
  assistantCapabilitiesV2Schema, assistantExecutionMetadataV2Schema,
  assistantExecutionPageV2Schema, assistantExecutionEventsPageV2Schema,
  type AssistantObservedCapabilities, type AssistantObservedExecution,
  type AssistantObservedPage, type AssistantObservedEventsPage,
} from "../../contracts/assistant.ts";


const bodyLimit = 1_048_576;
const timeoutMs = 10_000;
const identity = z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/);
const credentialSchema = z.strictObject({
  version: z.literal(1), audience: z.literal("agent-track"), sourceId: identity, user: identity,
  ownerId: z.string().regex(/^sso-sub:[a-f0-9]{64}$/),
  principalId: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  revision: z.number().int().positive().safe(),
  notBefore: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
  nativeOrigin: z.string(), secretFile: z.string().refine(isAbsolute),
});
const listCursor = z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$/).nullable();
const eventCursor = z.string().regex(/^(0|[1-9][0-9]{0,15})$/)
  .refine(value => /^(0|[1-9][0-9]{0,15})$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));

export class AssistantSourceError extends Error {
  constructor(readonly status: number) { super("assistant_source_unavailable"); }
}

export interface AssistantClientOptions {
  protocol?: 1 | 2;
  sourceId: string;
  baseUrl: string;
  credentialFile: string;
  user: string;
  ownerId: string;
  principalId: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Credential {
  config: z.infer<typeof credentialSchema>;
  secret: string;
  fingerprint: string;
}

function canonicalOrigin(value: string): string {
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "[::1]" ||
      /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
    if (value !== url.origin || url.username || url.password ||
        !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) throw new Error();
    return url.origin;
  } catch { throw new AssistantSourceError(400); }
}

function boundedFile(path: string, limit: number): string {
  // A misconfigured FIFO must fail fstat without blocking the API event loop.
  const handle = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.size > limit) throw new AssistantSourceError(401);
    // Read one extra byte: a file growing after fstat cannot bypass the limit.
    const buffer = Buffer.alloc(limit + 1);
    let used = 0;
    while (used <= limit) {
      const count = readSync(handle, buffer, used, buffer.length - used, null);
      if (!count) break;
      used += count;
      if (used > limit) throw new AssistantSourceError(401);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, used));
  } finally { closeSync(handle); }
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function cancel(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => {});
}

/** Dedicated native metadata reader; never uses browser sessions or integration proxy keys. */
export class AssistantClient {
  private readonly options: Readonly<AssistantClientOptions>;
  private readonly origin: string;
  private readonly protocol: 1 | 2;
  private readonly prefix: string;

  constructor(options: AssistantClientOptions) {
    this.options = Object.freeze({ ...options });
    this.protocol = options.protocol ?? 1;
    if (this.protocol !== 1 && this.protocol !== 2) throw new AssistantSourceError(400);
    this.prefix = `/api/integrations/track/v${this.protocol}`;
    this.origin = canonicalOrigin(options.baseUrl);
    if (!isAbsolute(options.credentialFile)) throw new AssistantSourceError(400);
  }

  private credential(): Credential {
    try {
      const raw = boundedFile(this.options.credentialFile, 16_384);
      const config = credentialSchema.parse(JSON.parse(raw));
      if (config.sourceId !== this.options.sourceId || config.user !== this.options.user ||
          config.ownerId !== this.options.ownerId || config.principalId !== this.options.principalId ||
          canonicalOrigin(config.nativeOrigin) !== this.origin) throw new Error();
      const key = boundedFile(config.secretFile, 4096);
      const secret = key.trim();
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret) ||
          boundedFile(this.options.credentialFile, 16_384) !== raw) throw new Error();
      const now = (this.options.now ?? Date.now)();
      if (!Number.isFinite(now) || now < Date.parse(config.notBefore) ||
          now >= Date.parse(config.expiresAt) || Date.parse(config.notBefore) >= Date.parse(config.expiresAt)) throw new Error();
      return { config, secret, fingerprint: hash(raw + "\n" + hash(key)) };
    } catch { throw new AssistantSourceError(401); }
  }

  private confirm(credential: Credential): void {
    if (this.credential().fingerprint !== credential.fingerprint) throw new AssistantSourceError(401);
  }

  private async request<T>(path: string, schema: z.ZodType<T>, credential: Credential): Promise<T> {
    this.confirm(credential);
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        reject(new AssistantSourceError(503));
      }, timeoutMs);
    });
    try {
      const pending = (this.options.fetch ?? fetch)(this.origin + this.prefix + path, {
        method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal,
        headers: { Authorization: `Bearer ${credential.secret}`,
          "X-Agent-Track-Principal": credential.config.principalId, Accept: "application/json" },
      });
      // Also discard late responses from an injected transport that ignores abort.
      void pending.then(response => { if (expired) cancel(response.body); }, () => {});
      const response = await Promise.race([pending, deadline]);
      try { this.confirm(credential); } catch (error) { cancel(response.body); throw error; }
      if (response.status !== 200 || response.redirected ||
          (response.url && response.url !== this.origin + this.prefix + path)) {
        cancel(response.body);
        const status = [400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 502;
        throw new AssistantSourceError(status);
      }
      if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || !response.body) {
        cancel(response.body);
        throw new AssistantSourceError(502);
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await Promise.race([reader.read(), deadline]);
        if (expired) throw new AssistantSourceError(503);
        this.confirm(credential);
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > bodyLimit) throw new AssistantSourceError(502);
        chunks.push(chunk.value);
      }
      let parsed: z.ZodSafeParseResult<T>;
      try {
        const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
        parsed = schema.safeParse(raw);
      } catch { throw new AssistantSourceError(502); }
      if (!parsed.success) throw new AssistantSourceError(502);
      this.confirm(credential);
      return parsed.data;
    } catch (error) {
      if (expired) throw new AssistantSourceError(503);
      if (error instanceof AssistantSourceError && [400, 401, 403, 404, 409, 429, 502, 503].includes(error.status)) {
        throw new AssistantSourceError(error.status);
      }
      throw new AssistantSourceError(503);
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  }

  private async handshake(credential: Credential): Promise<AssistantObservedCapabilities> {
    const value = await this.request<AssistantObservedCapabilities>("/capabilities", this.protocol === 2 ? assistantCapabilitiesV2Schema : assistantCapabilitiesSchema, credential);
    if (value.ownerId !== credential.config.ownerId || value.principalId !== credential.config.principalId ||
        value.revision !== String(credential.config.revision)) throw new AssistantSourceError(401);
    return value;
  }

  async capabilities(): Promise<AssistantObservedCapabilities> {
    const credential = this.credential();
    const value = await this.handshake(credential);
    this.confirm(credential);
    return value;
  }

  private async data<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const credential = this.credential();
    await this.handshake(credential);
    const value = await this.request(path, schema, credential);
    await this.handshake(credential);
    this.confirm(credential);
    return value;
  }

  async executions(cursor: string | null = null): Promise<AssistantObservedPage> {
    if (!listCursor.safeParse(cursor).success) throw new AssistantSourceError(400);
    const query = cursor === null ? "" : "?" + new URLSearchParams({ cursor });
    return this.data<AssistantObservedPage>("/executions" + query, this.protocol === 2 ? assistantExecutionPageV2Schema : assistantExecutionPageSchema);
  }

  async execution(id: string): Promise<AssistantObservedExecution> {
    if (!z.uuid().safeParse(id).success) throw new AssistantSourceError(400);
    const schema: z.ZodType<AssistantObservedExecution> = this.protocol === 2
      ? assistantExecutionMetadataV2Schema : assistantExecutionMetadataSchema;
    return this.data(`/executions/${id}`, schema.refine(value => value.id === id));
  }

  async events(id: string, after = "0"): Promise<AssistantObservedEventsPage> {
    if (!z.uuid().safeParse(id).success || !eventCursor.safeParse(after).success) throw new AssistantSourceError(400);
    const schema: z.ZodType<AssistantObservedEventsPage> = this.protocol === 2
      ? assistantExecutionEventsPageV2Schema : assistantExecutionEventsPageSchema;
    return this.data(`/executions/${id}/events?after=${after}`, schema.refine(page =>
      page.executionId === id && (page.events.length === 0 ? page.cursor === after :
        page.events.every(event => BigInt(event.sequence) > BigInt(after)))));
  }

  async nativeMetadata(executionId: string, roleId: string, after = "0", limit = 100): Promise<AssistantNativeMetadataPage> {
    if (this.protocol !== 2 || !z.uuid().safeParse(executionId).success || !z.uuid().safeParse(roleId).success ||
        !nativeMetadataSequenceSchema.safeParse(after).success || !Number.isInteger(limit) || limit < 1 || limit > 250)
      throw new AssistantSourceError(400);
    return this.data(`/executions/${executionId}/roles/${roleId}/native?after=${after}&limit=${limit}`,
      assistantNativeMetadataPageSchema.refine(value => value.executionId === executionId && value.roleId === roleId &&
        value.page.events.after === after && value.page.events.limit === limit));
  }
  async nativeEvidence(executionId: string, roleId: string, after = "0", limit = 100): Promise<AssistantNativeRunEvidencePage> {
    if (this.protocol !== 2 || !z.uuid().safeParse(executionId).success || !z.uuid().safeParse(roleId).success ||
        !nativeMetadataSequenceSchema.safeParse(after).success || !Number.isInteger(limit) || limit < 1 || limit > 250)
      throw new AssistantSourceError(400);
    return this.data(`/executions/${executionId}/roles/${roleId}/native-evidence?after=${after}&limit=${limit}`,
      assistantNativeRunEvidencePageSchema.refine(value => value.executionId === executionId && value.roleId === roleId &&
        value.page.events.after === after && value.page.events.limit === limit));
  }
}

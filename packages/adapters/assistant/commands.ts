import { createHash } from "node:crypto";
import { constants, openSync, fstatSync, readSync, closeSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { assistantCommandCapabilitiesSchema, assistantCommandInputSchema, assistantCommandReceiptSchema,
  assistantCommandKindSchema, type AssistantCommandInput, type AssistantCommandKind } from "../../contracts/assistant-commands.ts";
const bodyLimit = 16_384;
const timeoutMs = 10_000;
const credentialSchema = z.strictObject({
  version: z.literal(1), audience: z.literal("agent-track-command"),
  sourceId: z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/),
  user: z.email().refine(value => value === value.toLowerCase()),
  ownerId: z.string().regex(/^sso-sub:[a-f0-9]{64}$/),
  principalId: z.string().regex(/^[a-z0-9_-]{1,80}$/), revision: z.int().positive().safe(),
  notBefore: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
  nativeOrigin: z.string(), secretFile: z.string().refine(isAbsolute),
});
/** withheld proves zero POSTs in this call; ambiguous requires exact-operation recovery. */
export class AssistantCommandError extends Error {
  constructor(readonly status: number, readonly disposition: "withheld" | "ambiguous" = "withheld") {
    super("assistant_command_unavailable");
  }
}
export interface AssistantCommandClientOptions {
  sourceId: string; baseUrl: string; credentialFile: string; user: string; ownerId: string;
  principalId: string; readerCredentialFile: string; proxySecretFile?: string;
  fetch?: typeof fetch; now?: () => number;
}
interface Credential { config: z.infer<typeof credentialSchema>; secret: string; fingerprint: string }
function canonicalOrigin(value: string): string {
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "[::1]" ||
      /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
    if (value !== url.origin || url.username || url.password ||
        !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) throw new Error();
    return url.origin;
  } catch { throw new AssistantCommandError(400); }
}

function boundedFile(path: string, limit: number): string {
  // A misconfigured FIFO must fail fstat without blocking the API event loop.
  const handle = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.size > limit) throw new AssistantCommandError(401);
    // Read one extra byte: a file growing after fstat cannot bypass the limit.
    const buffer = Buffer.alloc(limit + 1);
    let used = 0;
    while (used <= limit) {
      const count = readSync(handle, buffer, used, buffer.length - used, null);
      if (!count) break;
      used += count;
      if (used > limit) throw new AssistantCommandError(401);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, used));
  } finally { closeSync(handle); }
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function cancel(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => {});
}

/** Explicit construction only: no reader fallback and no automatic POST retries. */
export class AssistantCommandClient {
  private readonly options: Readonly<AssistantCommandClientOptions>;
  private readonly origin: string;
  private readonly prefix = "/api/integrations/track-command/v1";
  constructor(options: AssistantCommandClientOptions) {
    this.options = Object.freeze({ ...options });
    this.origin = canonicalOrigin(options.baseUrl);
    if (![options.credentialFile, options.readerCredentialFile, ...(options.proxySecretFile === undefined ? [] : [options.proxySecretFile])]
      .every(path => typeof path === "string" && isAbsolute(path))) throw new AssistantCommandError(400);
    this.credential();
  }
  private credential(): Credential {
    try {
      const raw = boundedFile(this.options.credentialFile, 16_384);
      const config = credentialSchema.parse(JSON.parse(raw));
      if (config.sourceId !== this.options.sourceId || config.user !== this.options.user ||
        config.ownerId !== this.options.ownerId || config.principalId !== this.options.principalId ||
        canonicalOrigin(config.nativeOrigin) !== this.origin) throw new Error();
      const key = boundedFile(config.secretFile, 4096), secret = key.trim();
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret)) throw new Error();
      const readerRaw = boundedFile(this.options.readerCredentialFile, 16_384);
      const reader = z.object({ secretFile: z.string().refine(isAbsolute) }).parse(JSON.parse(readerRaw));
      const paths = [reader.secretFile, ...(this.options.proxySecretFile ? [this.options.proxySecretFile] : [])];
      const keys = paths.map(path => {
        const a = statSync(config.secretFile), b = statSync(path);
        if (resolve(path) === resolve(config.secretFile) || realpathSync(path) === realpathSync(config.secretFile) ||
          (a.ino === b.ino && a.dev === b.dev)) throw new Error();
        const value = boundedFile(path, 4096);
        if (!value.trim() || value.trim() === secret) throw new Error();
        return value;
      });
      if (boundedFile(this.options.credentialFile, 16_384) !== raw || boundedFile(config.secretFile, 4096) !== key ||
        boundedFile(this.options.readerCredentialFile, 16_384) !== readerRaw ||
        paths.some((path, index) => boundedFile(path, 4096) !== keys[index])) throw new Error();
      const now = (this.options.now ?? Date.now)();
      if (!Number.isFinite(now) || now < Date.parse(config.notBefore) || now >= Date.parse(config.expiresAt) ||
        Date.parse(config.notBefore) >= Date.parse(config.expiresAt)) throw new Error();
      return { config, secret, fingerprint: hash(JSON.stringify([raw, key, readerRaw, ...keys])) };
    } catch { throw new AssistantCommandError(401); }
  }
  private confirm(credential: Credential): void {
    if (this.credential().fingerprint !== credential.fingerprint) throw new AssistantCommandError(401);
  }
  private async request<T>(path: string, schema: z.ZodType<T>, credential: Credential, body?: string, beforeDispatch?: () => void): Promise<T> {
    let dispatched = false;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        reject(new AssistantCommandError(503));
      }, timeoutMs);
    });
    try {
      this.confirm(credential);
      const init: RequestInit = {
        method: body === undefined ? "GET" : "POST", redirect: "manual", credentials: "omit", signal: controller.signal,
        headers: { Authorization: `Bearer ${credential.secret}`, "X-Agent-Track-User": credential.config.user,
          Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body }),
      };
      const transport = this.options.fetch ?? fetch;
      if (body !== undefined && beforeDispatch) {
        const result: unknown = beforeDispatch();
        if (result !== undefined) throw new AssistantCommandError(400);
      }
      dispatched = body !== undefined;
      const pending = transport(this.origin + this.prefix + path, init);
      // Also discard late responses from an injected transport that ignores abort.
      void pending.then(response => { if (expired) cancel(response.body); }, () => {});
      const response = await Promise.race([pending, deadline]);
      try { this.confirm(credential); } catch (error) { cancel(response.body); throw error; }
      if (response.status !== (body === undefined ? 200 : 202) || response.redirected ||
          (response.url && response.url !== this.origin + this.prefix + path)) {
        cancel(response.body);
        const status = [400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 502;
        throw new AssistantCommandError(status);
      }
      if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || !response.body) {
        cancel(response.body);
        throw new AssistantCommandError(502);
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await Promise.race([reader.read(), deadline]);
        if (expired) throw new AssistantCommandError(503);
        this.confirm(credential);
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > bodyLimit) throw new AssistantCommandError(502);
        chunks.push(chunk.value);
      }
      let parsed: z.ZodSafeParseResult<T>;
      try {
        const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
        parsed = schema.safeParse(raw);
      } catch { throw new AssistantCommandError(502); }
      if (!parsed.success) throw new AssistantCommandError(502);
      this.confirm(credential);
      return parsed.data;
    } catch (error) {
      const disposition = dispatched ? "ambiguous" : "withheld";
      if (expired) throw new AssistantCommandError(503, disposition);
      if (error instanceof AssistantCommandError && [400, 401, 403, 404, 409, 429, 502, 503].includes(error.status)) {
        throw new AssistantCommandError(error.status, disposition);
      }
      throw new AssistantCommandError(503, disposition);
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  }

  private async handshake(credential: Credential) {
    const value = await this.request("/capabilities", assistantCommandCapabilitiesSchema, credential);
    if (value.ownerId !== credential.config.ownerId || value.principalId !== credential.config.principalId ||
      value.trackUser !== credential.config.user || value.grantRevision !== credential.config.revision)
      throw new AssistantCommandError(401);
    return value;
  }
  async capabilities() { return this.handshake(this.credential()); }
  private path(executionId: string, roleId: string) {
    if (![executionId, roleId].every(id => z.uuid().safeParse(id).success && id === id.toLowerCase()))
      throw new AssistantCommandError(400);
    return `/executions/${executionId}/roles/${roleId}/commands`;
  }
  private receiptSchema(executionId: string, roleId: string, operationId: string, kind: AssistantCommandKind) {
    return assistantCommandReceiptSchema.refine(value => value.command.executionId === executionId &&
      value.command.roleId === roleId && value.command.operationId === operationId && value.command.kind === kind);
  }
  async command(executionId: string, roleId: string, input: AssistantCommandInput, beforeDispatch?: () => void) {
    const path = this.path(executionId, roleId);
    const parsed = assistantCommandInputSchema.safeParse(input);
    if (!parsed.success || parsed.data.operationId !== parsed.data.operationId.toLowerCase()) throw new AssistantCommandError(400);
    const credential = this.credential();
    await this.handshake(credential);
    const body = JSON.stringify(parsed.data);
    if (Buffer.byteLength(body) > bodyLimit) throw new AssistantCommandError(400);
    return this.request(path, this.receiptSchema(executionId, roleId, parsed.data.operationId, parsed.data.kind),
      credential, body, beforeDispatch);
  }
  /** Recovery uses the current grant, never the original command deadline. */
  async receipt(executionId: string, roleId: string, operationId: string, kind: AssistantCommandKind) {
    const path = this.path(executionId, roleId);
    if (!z.uuid().safeParse(operationId).success || operationId !== operationId.toLowerCase() ||
      !assistantCommandKindSchema.safeParse(kind).success) throw new AssistantCommandError(400);
    const credential = this.credential();
    await this.handshake(credential);
    return this.request(`${path}/${operationId}`, this.receiptSchema(executionId, roleId, operationId, kind), credential);
  }
}

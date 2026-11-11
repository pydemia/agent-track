import { readFile } from "node:fs/promises";
import { contextPath, contextSummarySchema, type ContextResult, type ContextTarget } from "./contracts.ts";

const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 2_000;

function sameTarget(left: ContextTarget, right: ContextTarget): boolean {
  if (left.kind !== right.kind || left.sourceId !== right.sourceId) return false;
  switch (left.kind) {
    case "project": return right.kind === "project" && left.projectId === right.projectId;
    case "task": return right.kind === "task" && left.projectId === right.projectId && left.taskId === right.taskId;
    case "session": return right.kind === "session" && left.sessionId === right.sessionId;
    case "run": return right.kind === "run" && left.runId === right.runId;
  }
}

export type ContextSummaryClientOptions = {
  baseUrl: string;
  readerId: string;
  tokenFile: string;
  publicOrigin: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

function rootOrigin(value: string, loopbackOnly: boolean): string {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || (loopbackOnly && !loopback) || value !== url.origin && value !== `${url.origin}/`) {
    throw new TypeError("Invalid context service origin");
  }
  return url.origin;
}

async function readBoundedJson(response: Response, setReader: (reader: ReadableStreamDefaultReader<Uint8Array> | null) => void): Promise<unknown> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("Invalid response type");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    throw new Error("Response too large");
  }
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  setReader(reader);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error("Response too large");
      }
      chunks.push(value);
    }
  } finally {
    setReader(null);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export class ContextSummaryClient {
  private readonly baseUrl: string;
  private readonly publicOrigin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ContextSummaryClientOptions) {
    this.baseUrl = rootOrigin(options.baseUrl, true);
    this.publicOrigin = rootOrigin(options.publicOrigin, false);
    if (!/^[a-z0-9_-]{1,80}$/.test(options.readerId)) throw new TypeError("Invalid context reader id");
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > DEFAULT_TIMEOUT_MS) {
      throw new TypeError("Invalid context request timeout");
    }
  }

  async read(target: ContextTarget): Promise<ContextResult> {
    const controller = new AbortController();
    let activeResponse: Response | null = null;
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cancelBody = () => {
      if (activeReader) void activeReader.cancel().catch(() => undefined);
      else if (activeResponse?.body && !activeResponse.bodyUsed) void activeResponse.body.cancel().catch(() => undefined);
    };
    const operation = async (): Promise<ContextResult> => {
      try {
        const token = (await readFile(this.options.tokenFile, { encoding: "utf8", signal: controller.signal })).trim();
        if (controller.signal.aborted || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) return { state: "unavailable", summary: null };
        const response = await this.fetchImpl(new URL(contextPath(target), this.baseUrl), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Track-Context-Reader": this.options.readerId,
            Accept: "application/json",
          },
          redirect: "error",
          signal: controller.signal,
        });
        activeResponse = response;
        if (controller.signal.aborted) { cancelBody(); return { state: "unavailable", summary: null }; }
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          cancelBody();
          return { state: "forbidden", summary: null };
        }
        if (!response.ok || response.redirected || response.type === "opaqueredirect" || response.type === "opaque") {
          cancelBody();
          return { state: "unavailable", summary: null };
        }
        const parsed = contextSummarySchema.safeParse(await readBoundedJson(response, (reader) => { activeReader = reader; }));
        if (controller.signal.aborted || !parsed.success || !sameTarget(parsed.data.context, target)) {
          return { state: "unavailable", summary: null };
        }
        const urls = [parsed.data.trackUrl, ...parsed.data.runs.map((run) => run.url)].filter((value): value is string => value !== null);
        if (urls.some((value) => new URL(value).origin !== this.publicOrigin)) return { state: "unavailable", summary: null };
        if (controller.signal.aborted) return { state: "unavailable", summary: null };
        return { state: "connected", summary: parsed.data };
      } catch {
        cancelBody();
        return { state: "unavailable", summary: null };
      }
    };
    const deadline = new Promise<ContextResult>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        cancelBody();
        resolve({ state: "unavailable", summary: null });
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([operation(), deadline]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}

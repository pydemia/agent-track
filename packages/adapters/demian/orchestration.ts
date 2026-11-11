import { readFile } from "node:fs/promises";
import { z } from "zod";
import { SourceError, type DemianOptions } from "./index.ts";

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_PROVIDER_CONNECTIONS = 100;
const REPORT_MAX_AGE_MS = 90_000;

const INTERNAL_PROVIDER_TYPES = new Set([
  "openai-compatible",
  "anthropic",
  "gemini",
  "codex",
  "ollama",
  "claudecode-api-legacy",
]);

const EXTERNAL_PROVIDER_TYPES = new Set([
  "claudecode",
  "antigravity-cli",
  "antigravity-acp",
  "gemini-cli",
  "codex-app-server",
]);

export type OrchestrationSupport = {
  provider: string;
  providerType: string | null;
  providerConfigured: boolean | null;
  toolOrchestration: "external" | "demian" | "unknown";
  reported: {
    goals: boolean | null;
    cowork: boolean | null;
    managedChild: boolean | null;
  };
  workers: number | null;
  checkedAt: string | null;
};

type ProviderConnection = {
  provider: string;
  providerType: string | null;
  configured: boolean | null;
  workers: number | null;
  checkedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseCheckedAt(value: unknown): { value: string; time: number } | null {
  if (typeof value !== "string" || !z.iso.datetime().safeParse(value).success) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? { value, time } : null;
}

function isFresh(time: number, now: number): boolean {
  return time <= now && now - time <= REPORT_MAX_AGE_MS;
}

function blankSupport(provider: string): OrchestrationSupport {
  return {
    provider,
    providerType: null,
    providerConfigured: null,
    toolOrchestration: "unknown",
    reported: { goals: null, cowork: null, managedChild: null },
    workers: null,
    checkedAt: null,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    await response.body?.cancel();
    throw new Error("Expected Demian orchestration JSON");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("Demian orchestration response exceeds 1 MiB");
  }
  if (!response.body) throw new Error("Missing Demian orchestration response body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      let item: ReadableStreamReadResult<Uint8Array>;
      try {
        item = await reader.read();
      } catch {
        throw new Error("Unable to read Demian orchestration response");
      }
      const { value, done } = item;
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error("Demian orchestration response exceeds 1 MiB");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Invalid Demian orchestration JSON");
  }
}

export class DemianOrchestrationReader {
  constructor(readonly options: DemianOptions) {}

  private async request(path: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.tokenFile) {
      let credential: string;
      try {
        const text = (await readFile(this.options.tokenFile, "utf8")).replace(/^\uFEFF/, "").trim();
        credential = this.options.credentialFormat === "demian-service"
          ? z.object({ apiToken: z.string().min(1) }).parse(JSON.parse(text)).apiToken
          : text;
      } catch {
        throw new Error("Invalid source credential file");
      }
      if (!credential || /\s/.test(credential)) throw new Error("Invalid source credential file");
      headers.Authorization = `Bearer ${credential}`;
    }
    if (this.options.organizationId) {
      headers["X-Demian-Organization-Id"] = this.options.organizationId;
    }

    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        `${this.options.baseUrl.replace(/\/$/, "")}${path}`,
        { headers, redirect: "error", signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      throw new Error("Demian orchestration request failed");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SourceError(response.status);
    }
    return response;
  }

  private async readProviderConnections(provider: string): Promise<ProviderConnection | null> {
    const raw = await readBoundedJson(await this.request("/api/v1/provider-connections"));
    if (!isRecord(raw) || raw.object !== "list" || !Array.isArray(raw.data) ||
        raw.data.length > MAX_PROVIDER_CONNECTIONS) {
      throw new Error("Invalid Demian provider connections response");
    }

    const matches = raw.data.filter((row) => isRecord(row) && row.provider === provider);
    if (matches.length > 1) throw new Error("Ambiguous Demian provider identity");
    const match = matches[0];
    if (!isRecord(match)) return null;

    const checkedAt = parseCheckedAt(match.checked_at);
    if (!checkedAt || !isFresh(checkedAt.time, Date.now())) return null;
    return {
      provider,
      providerType: typeof match.provider_type === "string" &&
          /^[A-Za-z0-9_.:-]{1,100}$/.test(match.provider_type) ? match.provider_type : null,
      configured: nullableBoolean(match.configured),
      workers: typeof match.worker_count === "number" && Number.isSafeInteger(match.worker_count) &&
          match.worker_count >= 0 ? match.worker_count : null,
      checkedAt: checkedAt.value,
    };
  }

  async read(provider: string): Promise<OrchestrationSupport> {
    if (typeof provider !== "string" || !/^[A-Za-z0-9_.:-]{1,120}$/.test(provider)) {
      throw new Error("Invalid provider name");
    }
    const result = blankSupport(provider);

    const capability = await readBoundedJson(
      await this.request("/api/v1/runtime/capabilities"),
    );
    if (!isRecord(capability) || capability.object !== "demian.runtime_capabilities") {
      throw new Error("Invalid Demian runtime capabilities response");
    }
    const checkedAt = parseCheckedAt(capability.checked_at);
    if (checkedAt) result.checkedAt = checkedAt.value;
    if (checkedAt && isFresh(checkedAt.time, Date.now()) && isRecord(capability.features)) {
      result.reported = {
        goals: nullableBoolean(capability.features.goals),
        cowork: nullableBoolean(capability.features.cowork),
        managedChild: nullableBoolean(capability.features.managed_child_v1),
      };
    }

    const connection = await this.readProviderConnections(provider);
    if (!connection) return result;
    result.providerType = connection.providerType;
    result.providerConfigured = connection.configured;
    result.workers = connection.workers;

    if (connection.providerType && EXTERNAL_PROVIDER_TYPES.has(connection.providerType)) {
      result.toolOrchestration = "external";
    } else if (connection.providerType && INTERNAL_PROVIDER_TYPES.has(connection.providerType)) {
      result.toolOrchestration = "demian";
    }
    return result;
  }
}

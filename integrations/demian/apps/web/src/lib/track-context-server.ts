import { createHash } from "node:crypto"
import { open } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { z } from "zod"
import { ContextSummaryClient } from "../track-shared/context/client"
import type { ContextResult } from "../track-shared/context/contracts"

const uuid = z.string().refine(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))
const origin = z.string().refine(value => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && value === url.origin } catch { return false }
})
const loopback = origin.refine(value => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname))
const configSchema = z.object({
  version: z.literal(1), sourceId: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  nativeActorId: uuid, nativeOrganizationId: uuid, nativeAuthMode: z.literal("trusted"), nativeRole: z.literal("owner"),
  sessions: z.array(z.object({ sessionId: uuid, workspaceId: uuid }).strict()).min(1).max(100),
  readerId: z.string().regex(/^[a-z0-9_-]{1,80}$/), tokenFile: z.string().refine(isAbsolute),
  trackBaseUrl: loopback, publicOrigin: origin, webOrigins: z.array(origin).min(1).max(8),
}).strict().refine(value => new Set(value.sessions.map(row => row.sessionId)).size === value.sessions.length)
type Config = z.infer<typeof configSchema>
type Loaded = { config: Config; fingerprint: string }
type Result = ContextResult | { state: "disabled"; summary: null }
type Environment = Readonly<Record<string, string | undefined>>
type Options = { env?: Environment; nativeFetch?: typeof fetch; trackFetch?: typeof fetch }
class NativeDenied extends Error { constructor(readonly status: number) { super("Native access unavailable") } }

async function configuration(env: Environment): Promise<Loaded | null> {
  const filename = env.DEMIAN_TRACK_CONTEXT_FILE
  if (!filename) return null
  if (!isAbsolute(filename)) throw new Error("Invalid private configuration")
  const file = await open(filename, "r")
  try {
    const bytes = Buffer.alloc(16385); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead > 16384) throw new Error("Configuration limit")
    const data = bytes.subarray(0, bytesRead)
    return { config: configSchema.parse(JSON.parse(data.toString("utf8"))), fingerprint: createHash("sha256").update(data).digest("hex") }
  } finally { await file.close() }
}

function response(result: Result, status = 200): Response {
  return Response.json(result, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, X-Demian-Organization-Id, X-Track-Expected-Actor" } })
}

async function nativeJson(url: string, token: string, organizationId: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  let activeResponse: Response | undefined
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    controller.abort()
    if (activeReader) void activeReader.cancel().catch(() => undefined)
    else if (activeResponse?.body && !activeResponse.bodyUsed) void activeResponse.body.cancel().catch(() => undefined)
  }
  const operation = async () => {
    const fetched = await fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, "X-Demian-Organization-Id": organizationId, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: controller.signal })
    activeResponse = fetched
    if (controller.signal.aborted) { cancel(); throw new Error("Native deadline") }
    if ([401, 403, 404].includes(fetched.status)) { cancel(); throw new NativeDenied(fetched.status) }
    if (!fetched.ok || fetched.redirected || !/^application\/json(?:\s*;|\s*$)/i.test(fetched.headers.get("Content-Type") ?? "") || !fetched.body) throw new Error("Native response unavailable")
    const reader = fetched.body.getReader(); activeReader = reader
    let length = 0; const chunks: Uint8Array[] = []
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 65536) { cancel(); throw new Error("Native metadata limit") }
        chunks.push(value)
      }
    } finally { activeReader = undefined; reader.releaseLock() }
    if (controller.signal.aborted) throw new Error("Native deadline")
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid native metadata")
    return parsed as Record<string, unknown>
  }
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { cancel(); reject(new Error("Native deadline")) }, 500) })
  try { return await Promise.race([operation(), deadline]) } finally { if (timer) clearTimeout(timer); cancel() }
}

async function authorized(config: Config, sessionId: string, token: string, nativeOrigin: string, fetchImpl: typeof fetch): Promise<string> {
  const [me, session] = await Promise.all([
    nativeJson(`${nativeOrigin}/api/v1/me`, token, config.nativeOrganizationId, fetchImpl),
    nativeJson(`${nativeOrigin}/api/v1/sessions/${sessionId}`, token, config.nativeOrganizationId, fetchImpl),
  ])
  if (me.id !== config.nativeActorId || me.organization_id !== config.nativeOrganizationId || me.auth_mode !== config.nativeAuthMode || me.role !== config.nativeRole) throw new NativeDenied(403)
  if (session.id !== sessionId || !uuid.safeParse(session.workspace_id).success) throw new NativeDenied(404)
  return String(session.workspace_id)
}

/** Only the existing trusted-owner native web deployment may opt in. */
export async function readTrackContext(request: Request, sessionId: string, cookieToken: string | undefined, options: Options = {}): Promise<Response> {
  const env = options.env ?? process.env
  try {
    if (!uuid.safeParse(sessionId).success || request.method !== "GET") return response({ state: "forbidden", summary: null }, 404)
    const loaded = await configuration(env)
    if (!loaded) return response({ state: "disabled", summary: null })
    const { config } = loaded
    // Other auth modes require their own per-user delegation contract; never
    // lend this deployment's native/Track credentials to an OIDC cookie fallback.
    if (env.DEMIAN_AUTH_MODE !== "trusted") return response({ state: "unavailable", summary: null })
    const publicUrl = origin.parse(env.DEMIAN_WEB_PUBLIC_URL)
    if (!config.webOrigins.includes(publicUrl) || request.headers.get("host") !== new URL(publicUrl).host ||
        request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.has("origin") && request.headers.get("origin") !== publicUrl) ||
        request.headers.get("x-track-expected-actor") !== config.nativeActorId || request.headers.get("x-demian-organization-id") !== config.nativeOrganizationId) {
      return response({ state: "forbidden", summary: null }, 403)
    }
    const nativeOrigin = loopback.parse((env.DEMIAN_API_INTERNAL_URL ?? "http://127.0.0.1:8080").replace(/\/$/, ""))
    const token = cookieToken ?? env.DEMIAN_API_TOKEN
    if (!token || token.length > 8192) return response({ state: "forbidden", summary: null }, 401)
    const nativeFetch = options.nativeFetch ?? fetch
    const workspace = await authorized(config, sessionId, token, nativeOrigin, nativeFetch)
    const pin = config.sessions.find(row => row.sessionId === sessionId)
    if (!pin) return response({ state: "disabled", summary: null })
    if (pin.workspaceId !== workspace) return response({ state: "forbidden", summary: null }, 404)
    const client = new ContextSummaryClient({ baseUrl: config.trackBaseUrl, readerId: config.readerId, tokenFile: config.tokenFile, publicOrigin: config.publicOrigin, fetch: options.trackFetch })
    const summary = await client.read({ kind: "session", sourceId: config.sourceId, sessionId })
    const confirmedWorkspace = await authorized(config, sessionId, token, nativeOrigin, nativeFetch)
    if (confirmedWorkspace !== workspace) return response({ state: "forbidden", summary: null }, 404)
    const confirmed = await configuration(env)
    if (!confirmed || confirmed.fingerprint !== loaded.fingerprint) return response({ state: "unavailable", summary: null })
    return response(summary)
  } catch (error) {
    if (error instanceof NativeDenied) return response({ state: "forbidden", summary: null }, error.status)
    return response({ state: "unavailable", summary: null })
  }
}

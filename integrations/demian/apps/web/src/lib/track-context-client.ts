import { z } from "zod"
import { contextSummarySchema, type ContextResult } from "../track-shared/context/contracts.ts"

const responseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("connected"), summary: contextSummarySchema }).strict(),
  z.object({ state: z.literal("disabled"), summary: z.null() }).strict(),
  z.object({ state: z.literal("forbidden"), summary: z.null() }).strict(),
  z.object({ state: z.literal("unavailable"), summary: z.null() }).strict(),
])

export type TrackContextScope = {
  actorId: string
  organizationId: string
  workspaceId: string
  sessionId: string
  authMode: string
  role: string
}
export type TrackContextView = { kind: "connected"; result: ContextResult } | { kind: "hidden" } | { kind: "error" }
export type TrackContextFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const MAX_RESPONSE_BYTES = 512 * 1024
const REQUEST_DEADLINE_MS = 4_000
const POLL_INTERVAL_MS = 15_000

export function scopeKey(scope: TrackContextScope): string {
  return JSON.stringify([scope.actorId, scope.organizationId, scope.workspaceId, scope.sessionId, scope.authMode, scope.role])
}

export async function fetchTrackContext(scope: TrackContextScope, fetcher: TrackContextFetch, outerSignal: AbortSignal): Promise<TrackContextView> {
  const controller = new AbortController()
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let interrupted = false
  let rejectInterruption!: (reason: unknown) => void
  const interruption = new Promise<never>((_resolve, reject) => { rejectInterruption = reject })
  const discardBody = () => {
    if (reader) void reader.cancel().catch(() => {})
    else if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {})
  }
  const interrupt = (reason: unknown) => {
    if (interrupted) return
    interrupted = true
    controller.abort()
    discardBody()
    rejectInterruption(reason)
  }
  const onOuterAbort = () => interrupt(new DOMException("Request cancelled", "AbortError"))
  if (outerSignal.aborted) onOuterAbort()
  else outerSignal.addEventListener("abort", onOuterAbort, { once: true })
  const deadline = setTimeout(() => interrupt(new Error("Track context request timed out")), REQUEST_DEADLINE_MS)
  const isActive = () => !interrupted && !outerSignal.aborted
  const work = (async (): Promise<TrackContextView> => {
    if (!isActive()) throw new DOMException("Request cancelled", "AbortError")
    response = await fetcher(`/track-context/sessions/${encodeURIComponent(scope.sessionId)}`, {
      method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: { "X-Demian-Organization-Id": scope.organizationId, "X-Track-Expected-Actor": scope.actorId },
    })
    if (!isActive()) { discardBody(); throw new DOMException("Request cancelled", "AbortError") }
    if (response.status === 401 || response.status === 403 || response.status === 404) { discardBody(); return { kind: "hidden" } }
    if (!response.ok) { discardBody(); throw new Error("Track context unavailable") }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    if (contentType !== "application/json") { discardBody(); throw new Error("Invalid Track context content type") }
    const declared = Number(response.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) { discardBody(); throw new Error("Track context response too large") }
    if (!response.body) throw new Error("Track context response missing")
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (!isActive()) throw new DOMException("Request cancelled", "AbortError")
        if (done) break
        size += value.byteLength
        if (size > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => {}); throw new Error("Track context response too large") }
        chunks.push(value)
      }
    } finally {
      if (!isActive()) void reader.cancel().catch(() => {})
      try { reader.releaseLock() } catch { /* A pending read is released when cancellation settles. */ }
    }
    if (!isActive()) throw new DOMException("Request cancelled", "AbortError")
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const parsed = responseSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (!parsed.success) throw new Error("Invalid Track context response")
    if (!isActive()) throw new DOMException("Request cancelled", "AbortError")
    if (parsed.data.state === "unavailable") return { kind: "error" }
    if (parsed.data.state === "disabled" || parsed.data.state === "forbidden") return { kind: "hidden" }
    const summary = parsed.data.summary
    if (summary.context.kind !== "session" || summary.context.sourceId !== "demian-local" || summary.context.sessionId !== scope.sessionId ||
      summary.runs.some((run) => run.sourceId !== "demian-local" || run.sessionId !== scope.sessionId)) throw new Error("Track context scope mismatch")
    if (!isActive()) throw new DOMException("Request cancelled", "AbortError")
    return { kind: "connected", result: { state: "connected", summary } }
  })()
  try {
    const view = await Promise.race([work, interruption])
    if (!isActive()) throw new DOMException("Request cancelled", "AbortError")
    return view
  } catch (error) {
    if (outerSignal.aborted) return { kind: "hidden" }
    throw error
  } finally {
    clearTimeout(deadline)
    outerSignal.removeEventListener("abort", onOuterAbort)
  }
}

export function startTrackContextPolling(
  scope: TrackContextScope,
  onView: (view: TrackContextView) => void,
  fetcher: TrackContextFetch = fetch,
): () => void {
  const controller = new AbortController()
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const poll = async () => {
    try {
      const view = await fetchTrackContext(scope, fetcher, controller.signal)
      if (!disposed) onView(view)
    } catch {
      if (!disposed && !controller.signal.aborted) onView({ kind: "error" })
    }
    if (!disposed) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
  }
  void poll()
  return () => { disposed = true; controller.abort(); if (timer) clearTimeout(timer) }
}

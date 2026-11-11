import assert from "node:assert/strict"
import { mock, test } from "node:test"
import { fetchTrackContext, scopeKey, startTrackContextPolling, type TrackContextScope } from "../src/lib/track-context-client.ts"

const scope: TrackContextScope = {
  actorId: "actor-a", organizationId: "org-a", workspaceId: "workspace-a",
  sessionId: "11111111-1111-4111-8111-111111111111", authMode: "local", role: "owner",
}
const summary = {
  version: 1,
  context: { kind: "session", sourceId: "demian-local", sessionId: scope.sessionId },
  observedAt: "2026-11-12T00:00:00Z", task: null, runs: [],
  counts: { runs: 0, sessions: 0, byStatus: { queued: 0, leasing: 0, running: 0, waiting_for_permission: 0, cancelling: 0, succeeded: 0, failed: 0, cancelled: 0, expired: 0, interrupted: 0, unknown: 0 } },
  coverage: { kind: "observed-window", limit: 50, capped: false, unavailable: false }, trackUrl: null,
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

test("sends same-origin scoped request and accepts only matching native session summary", async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined
  const view = await fetchTrackContext(scope, async (input, init) => { request = { input, init }; return response({ state: "connected", summary }) }, new AbortController().signal)
  assert.equal(view.kind, "connected")
  assert.equal(request?.input, `/track-context/sessions/${scope.sessionId}`)
  assert.equal(request?.init?.credentials, "same-origin")
  assert.equal(new Headers(request?.init?.headers).get("X-Demian-Organization-Id"), scope.organizationId)
  assert.equal(new Headers(request?.init?.headers).get("X-Track-Expected-Actor"), scope.actorId)
})

test("hides disabled and forbidden states, while unavailable remains retryable", async () => {
  for (const status of ["disabled", "forbidden"]) {
    assert.deepEqual(await fetchTrackContext(scope, async () => response({ state: status, summary: null }), new AbortController().signal), { kind: "hidden" })
  }
  assert.deepEqual(await fetchTrackContext(scope, async () => response({ state: "unavailable", summary: null }), new AbortController().signal), { kind: "error" })
  for (const code of [401, 403, 404]) assert.deepEqual(await fetchTrackContext(scope, async () => response({}, code), new AbortController().signal), { kind: "hidden" })
})

test("rejects malformed DTOs, cross-session rows, and oversized bodies", async () => {
  await assert.rejects(fetchTrackContext(scope, async () => new Response("{}", { headers: { "content-type": "text/plain" } }), new AbortController().signal), /content type/)
  await assert.rejects(fetchTrackContext(scope, async () => response({ state: "connected", summary: { ...summary, extra: true } }), new AbortController().signal))
  const other = { ...summary, runs: [{ sourceId: "demian-local", runId: "22222222-2222-4222-8222-222222222222", sessionId: "33333333-3333-4333-8333-333333333333", status: "running", binding: null, observedAt: summary.observedAt, cursor: "1", highWater: "1", stale: false, incomplete: false, url: "https://track.example/?view=session" }], counts: { runs: 1, sessions: 1, byStatus: { ...summary.counts.byStatus, running: 1 } } }
  await assert.rejects(fetchTrackContext(scope, async () => response({ state: "connected", summary: other }), new AbortController().signal), /Invalid Track context response/)
  const oversized = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)); controller.close() } }), { headers: { "content-type": "application/json" } })
  await assert.rejects(fetchTrackContext(scope, async () => oversized, new AbortController().signal), /too large/)
})

test("does not publish late responses after disposal and distinguishes changed account scope", async () => {
  let resolveFetch!: (value: Response) => void
  const pending = new Promise<Response>((resolve) => { resolveFetch = resolve })
  const published: unknown[] = []
  const dispose = startTrackContextPolling(scope, (view) => published.push(view), async () => pending)
  dispose()
  resolveFetch(response({ state: "connected", summary }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(published, [])
  assert.notEqual(scopeKey(scope), scopeKey({ ...scope, actorId: "actor-b" }))
  assert.notEqual(scopeKey(scope), scopeKey({ ...scope, organizationId: "org-b" }))
})

test("a hung fetch is bounded by the four second deadline and a late response body is cancelled", async () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  try {
    let resolveFetch!: (value: Response) => void
    let observedSignal: AbortSignal | undefined
    let cancelled = false
    const pending = fetchTrackContext(scope, (_input, init) => {
      observedSignal = init?.signal as AbortSignal
      return new Promise<Response>((resolve) => { resolveFetch = resolve })
    }, new AbortController().signal)
    const rejected = assert.rejects(pending, /timed out/)
    mock.timers.tick(4_000)
    await rejected
    assert.equal(observedSignal?.aborted, true)
    resolveFetch(new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { "content-type": "application/json" } }))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(cancelled, true)
  } finally { mock.timers.reset() }
})

test("an oversized streamed body is cancelled while its reader is still owned", async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)) },
    cancel() { cancelled = true },
  })
  await assert.rejects(fetchTrackContext(scope, async () => new Response(body, { headers: { "content-type": "application/json" } }), new AbortController().signal), /too large/)
  assert.equal(cancelled, true)
  assert.equal(body.locked, false)
})

test("a hung response body is cancelled and its reader lock released at the four second deadline", async () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  try {
    let observedSignal: AbortSignal | undefined
    let cancelled = false
    let body!: ReadableStream<Uint8Array>
    const pending = fetchTrackContext(scope, (_input, init) => {
      observedSignal = init?.signal as AbortSignal
      body = new ReadableStream({ cancel() { cancelled = true } })
      return Promise.resolve(new Response(body, { headers: { "content-type": "application/json" } }))
    }, new AbortController().signal)
    const rejected = assert.rejects(pending, /timed out/)
    await Promise.resolve()
    mock.timers.tick(4_000)
    await rejected
    assert.equal(observedSignal?.aborted, true)
    assert.equal(cancelled, true)
    assert.equal(body.locked, false)
  } finally { mock.timers.reset() }
})

test("polling schedules the next request only after the prior response completes", async () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  try {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let starts = 0
    let active = 0
    let maxActive = 0
    const fetcher = async () => {
      starts++
      active++
      maxActive = Math.max(maxActive, active)
      try {
        if (starts === 1) await firstGate
        return response({ state: "connected", summary })
      } finally { active-- }
    }
    const dispose = startTrackContextPolling(scope, () => {}, fetcher)
    await Promise.resolve()
    assert.equal(starts, 1)
    mock.timers.tick(2_000)
    releaseFirst()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(starts, 1)
    mock.timers.tick(14_999)
    assert.equal(starts, 1)
    mock.timers.tick(1)
    assert.equal(starts, 2)
    assert.equal(maxActive, 1)
    dispose()
  } finally { mock.timers.reset() }
})

test("disposal aborts a request and never publishes its late completion", async () => {
  let resolveFetch!: (value: Response) => void
  let observedSignal: AbortSignal | undefined
  let cancelled = false
  const pending = new Promise<Response>((resolve) => { resolveFetch = resolve })
  const published: unknown[] = []
  const dispose = startTrackContextPolling(scope, (view) => published.push(view), (_input, init) => {
    observedSignal = init?.signal as AbortSignal
    return pending
  })
  dispose()
  assert.equal(observedSignal?.aborted, true)
  resolveFetch(new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { "content-type": "application/json" } }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(cancelled, true)
  assert.deepEqual(published, [])
})

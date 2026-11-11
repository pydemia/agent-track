import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { readTrackContext } from "../src/lib/track-context-server"

const actor = "00000000-0000-0000-0000-000000000010"
const organization = "00000000-0000-0000-0000-000000000001"
const session = "00000000-0000-4000-8000-000000000020"
const workspace = "00000000-0000-4000-8000-000000000030"
const other = "00000000-0000-4000-8000-000000000099"
const at = "2026-11-12T00:00:00.000Z"
const byStatus = { queued: 0, leasing: 0, running: 0, waiting_for_permission: 0, cancelling: 0, succeeded: 0, failed: 0, cancelled: 0, expired: 0, interrupted: 0, unknown: 0 }
const summary = { version: 1, context: { kind: "session", sourceId: "demian-local", sessionId: session }, observedAt: at, task: null, runs: [], counts: { runs: 0, sessions: 0, byStatus }, coverage: { kind: "observed-window", limit: 50, capped: false, unavailable: false }, trackUrl: null }

function request(headers: Record<string, string> = {}) {
  return new Request(`http://127.0.0.1:3000/track-context/sessions/${session}`, { headers: { host: "127.0.0.1:3000", "X-Track-Expected-Actor": actor, "X-Demian-Organization-Id": organization, ...headers } })
}

async function fixture() {
  const dir = resolve(await mkdtemp(join(tmpdir(), "demian-track-context-")))
  assert.ok(dir.startsWith(resolve(tmpdir()) + sep))
  const configFile = join(dir, "context.json"), tokenFile = join(dir, "reader.key")
  await writeFile(tokenFile, "a".repeat(48))
  const config = { version: 1, sourceId: "demian-local", nativeActorId: actor, nativeOrganizationId: organization, nativeAuthMode: "trusted", nativeRole: "owner", sessions: [{ sessionId: session, workspaceId: workspace }], readerId: "demian-context-qa", tokenFile, trackBaseUrl: "http://127.0.0.1:14345", publicOrigin: "https://track.example", webOrigins: ["http://127.0.0.1:3000"] }
  await writeFile(configFile, JSON.stringify(config))
  const env = { DEMIAN_TRACK_CONTEXT_FILE: configFile, DEMIAN_AUTH_MODE: "trusted", DEMIAN_API_TOKEN: "synthetic-native-token", DEMIAN_API_INTERNAL_URL: "http://127.0.0.1:8080", DEMIAN_WEB_PUBLIC_URL: "http://127.0.0.1:3000" }
  let me: Record<string, unknown> = { id: actor, organization_id: organization, auth_mode: "trusted", role: "owner" }
  let nativeSession: Record<string, unknown> = { id: session, workspace_id: workspace }
  let deny = 0
  const nativeCalls: Array<{ path: string; token: string | null }> = []
  let trackCalls = 0
  let afterTrack: () => void | Promise<void> = () => undefined
  const nativeFetch: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname; const headers = new Headers(init?.headers)
    assert.equal(init?.method, "GET"); assert.equal(headers.get("x-demian-organization-id"), organization)
    nativeCalls.push({ path, token: headers.get("authorization") })
    if (deny) return Response.json({ private: "NATIVE_PRIVATE_SENTINEL" }, { status: deny })
    return Response.json(path.endsWith("/me") ? me : nativeSession)
  }
  const trackFetch: typeof fetch = async (input, init) => {
    trackCalls++
    assert.equal(String(input), `http://127.0.0.1:14345/api/integrations/context/v1/sessions/demian-local/${session}`)
    const headers = new Headers(init?.headers)
    assert.equal(headers.get("authorization"), "Bearer " + "a".repeat(48))
    assert.equal(headers.get("x-track-context-reader"), "demian-context-qa")
    assert.equal(headers.get("x-track-expected-actor"), null)
    await afterTrack()
    return Response.json(summary)
  }
  return { config, env, configFile, nativeFetch, trackFetch, nativeCalls, calls: () => trackCalls,
    me: (value: Record<string, unknown>) => { me = value }, session: (value: Record<string, unknown>) => { nativeSession = value }, deny: (status: number) => { deny = status }, after: (callback: () => void | Promise<void>) => { afterTrack = callback },
    cleanup: async () => { assert.ok(dir.startsWith(resolve(tmpdir()) + sep) && dir.split(sep).at(-1)?.startsWith("demian-track-context-")); await rm(dir, { recursive: true, force: true }) } }
}

test("optional default and malformed private configuration return no native or Track data", async () => {
  assert.deepEqual(await (await readTrackContext(request(), session, undefined, { env: {} })).json(), { state: "disabled", summary: null })
  const f = await fixture()
  try {
    await writeFile(f.configFile, "PRIVATE_CONFIG_SENTINEL")
    const result = await readTrackContext(request(), session, undefined, f)
    assert.deepEqual(await result.json(), { state: "unavailable", summary: null }); assert.equal(f.nativeCalls.length, 0); assert.equal(f.calls(), 0)
  } finally { await f.cleanup() }
})

test("native owner, organization, auth mode, role and exact Session workspace fence the machine reader", async () => {
  const f = await fixture()
  try {
    for (const patch of [{ id: other }, { organization_id: other }, { auth_mode: "keycloak" }, { role: "viewer" }]) {
      f.me({ id: actor, organization_id: organization, auth_mode: "trusted", role: "owner", ...patch })
      const result = await readTrackContext(request(), session, undefined, f)
      assert.equal(result.status, 403); assert.deepEqual(await result.json(), { state: "forbidden", summary: null })
    }
    f.me({ id: actor, organization_id: organization, auth_mode: "trusted", role: "owner" }); f.session({ id: session, workspace_id: other })
    assert.equal((await readTrackContext(request(), session, undefined, f)).status, 404)
    f.session({ id: other, workspace_id: workspace }); assert.equal((await readTrackContext(request(), session, undefined, f)).status, 404)
    assert.equal(f.calls(), 0)
  } finally { await f.cleanup() }
})

test("forged host/origin and browser scope never select a reader or trigger native reads", async () => {
  const f = await fixture()
  try {
    for (const headers of [{ host: "untrusted.example" }, { origin: "https://untrusted.example" }, { "sec-fetch-site": "cross-site" }, { "x-track-expected-actor": other }, { "x-demian-organization-id": other }] as Array<Record<string, string>>) {
      assert.equal((await readTrackContext(request(headers), session, undefined, f)).status, 403)
    }
    assert.equal(f.calls(), 0); assert.equal(f.nativeCalls.length, 0)
    assert.equal((await readTrackContext(request(), "../../me", undefined, f)).status, 404)
    assert.deepEqual(await (await readTrackContext(request(), session, undefined, { ...f, env: { ...f.env, DEMIAN_AUTH_MODE: "keycloak" } })).json(), { state: "unavailable", summary: null })
    assert.equal(f.nativeCalls.length, 0)
  } finally { await f.cleanup() }
})

test("connected summary reauthorizes native identity and Session before and after the optional read", async () => {
  const f = await fixture()
  try {
    const result = await readTrackContext(request({ "x-track-proxy-key": "ignored-client-value" }), session, undefined, f)
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { state: "connected", summary })
    assert.equal(result.headers.get("cache-control"), "private, no-store"); assert.equal(f.calls(), 1)
    assert.equal(f.nativeCalls.length, 4); assert.ok(f.nativeCalls.every(row => row.token === "Bearer synthetic-native-token"))
  } finally { await f.cleanup() }
})

test("a supplied native cookie is authoritative and is never replaced with the deployment credential", async () => {
  const f = await fixture()
  try {
    f.deny(401)
    const result = await readTrackContext(request(), session, "invalid-current-cookie", f)
    assert.equal(result.status, 401); assert.deepEqual(await result.json(), { state: "forbidden", summary: null }); assert.equal(f.calls(), 0)
    assert.ok(f.nativeCalls.every(row => row.token === "Bearer invalid-current-cookie"))
  } finally { await f.cleanup() }
})

test("revocation, scope changes and private config rotation discard a completed Track response", async () => {
  for (const change of ["actor", "workspace", "revoked", "config"] as const) {
    const f = await fixture()
    try {
      f.after(async () => {
        if (change === "actor") f.me({ id: other, organization_id: organization, auth_mode: "trusted", role: "owner" })
        if (change === "workspace") f.session({ id: session, workspace_id: other })
        if (change === "revoked") f.deny(404)
        if (change === "config") await writeFile(f.configFile, JSON.stringify({ ...f.config, sessions: [] }))
      })
      const result = await readTrackContext(request(), session, undefined, f)
      assert.notEqual((await result.json() as { state: string }).state, "connected"); assert.equal(f.calls(), 1)
    } finally { await f.cleanup() }
  }
})

test("Track outage/forbidden, invalid source replies and native deadlines remain summary-free", async () => {
  const f = await fixture()
  try {
    for (const trackFetch of [async () => { throw new Error("PRIVATE_TRANSPORT_SENTINEL") }, async () => Response.json({}, { status: 403 }), async () => Response.json({ ...summary, context: { ...summary.context, sessionId: other } })] as typeof fetch[]) {
      const result = await readTrackContext(request(), session, undefined, { ...f, trackFetch }); const body = await result.json() as { state: string; summary: unknown }
      assert.notEqual(body.state, "connected"); assert.equal(body.summary, null)
    }
    const started = Date.now()
    const hung: typeof fetch = () => new Promise(() => undefined)
    const result = await readTrackContext(request(), session, undefined, { ...f, nativeFetch: hung })
    assert.deepEqual(await result.json(), { state: "unavailable", summary: null }); assert.ok(Date.now() - started < 1500)
  } finally { await f.cleanup() }
})

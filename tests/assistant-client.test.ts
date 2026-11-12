import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { AssistantClient, AssistantSourceError } from "../packages/adapters/assistant/index.ts";
import { AssistantReadService, AssistantReadError } from "../packages/assistant-read/service.ts";

const origin = "http://127.0.0.1:12345";
const instant = "2026-11-12T00:00:00.000Z";
const owner = "sso-sub:" + "a".repeat(64);
const id = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const caps = { version: 1, service: "assistant", audience: "agent-track", ownerId: owner,
  principalId: "track-reader", revision: "1", executionsRead: true, eventsRead: true,
  controls: false, listLimit: 50, eventLimit: 100, demianReferencesSupported: false };
const page = { version: 1, observedAt: instant, executions: [], cursor: null, hasMore: false, omitted: 0, complete: false };
const events = { version: 1, observedAt: instant, executionId: id(), events: [], cursor: "0", hasMore: false, complete: false };
const event = (sequence: string, executionId = id()) => ({ executionId, sequence, revision: "3", state: "completed",
  errorCode: null, occurredAt: instant });
const json = (value: unknown) => Response.json(value);
const failure = (status: number) => (error: unknown) => {
  assert.ok(error instanceof AssistantSourceError);
  assert.equal(error.status, status);
  assert.equal(error.message, "assistant_source_unavailable");
  assert.equal(error.cause, undefined);
  assert.deepEqual(Object.keys(error), ["status"]);
  return true;
};

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "track-assistant-client-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("track-assistant-client-"));
    rmSync(root, { recursive: true, force: true });
  });
  const secretFile = join(root, "client.key");
  const credentialFile = join(root, "client.json");
  const secret = randomBytes(32).toString("base64url");
  const config = { version: 1, audience: "agent-track", sourceId: "assistant-native", user: "local-user",
    ownerId: owner, principalId: "track-reader", revision: 1, notBefore: "2026-11-11T00:00:00Z",
    expiresAt: "2026-12-12T00:00:00Z", nativeOrigin: origin, secretFile };
  const edit = (patch: Record<string, unknown>) => writeFileSync(credentialFile, JSON.stringify({ ...config, ...patch }));
  edit({}); writeFileSync(secretFile, secret);
  let clock = Date.parse(instant);
  const calls: string[] = [];
  let respond: (url: URL, init: RequestInit) => Response | Promise<Response> = url =>
    json(url.pathname.endsWith("/capabilities") ? caps : url.pathname.endsWith("/events") ? events : page);
  const transport: typeof fetch = async (input, init) => {
    assert.equal(typeof input, "string");
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    assert.equal(url.origin, origin);
    assert.equal(init?.method, "GET"); assert.equal(init.redirect, "manual"); assert.equal(init.credentials, "omit");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${secret}`);
    assert.equal(headers.get("x-agent-track-principal"), config.principalId);
    assert.equal(headers.get("cookie"), null);
    return respond(url, init);
  };
  const options = { sourceId: config.sourceId, baseUrl: origin, credentialFile, user: config.user,
    ownerId: owner, principalId: config.principalId, fetch: transport, now: () => clock };
  return { root, config, secret, secretFile, credentialFile, options, edit, calls,
    client: new AssistantClient(options), respond: (fn: typeof respond) => { respond = fn; },
    advance: (value: number) => { clock += value; } };
}

test("canonical producer service supplies exact metadata through fixed authenticated GETs", async t => {
  const f = fixture(t);
  const configFile = join(f.root, "producer.json");
  writeFileSync(configFile, JSON.stringify({ version: 1, enabled: true, audience: "agent-track", ownerId: owner,
    principalId: f.config.principalId, revision: 1, notBefore: f.config.notBefore,
    expiresAt: f.config.expiresAt, secretFile: f.secretFile }));
  const service = new AssistantReadService({ configFile, configuredOwner: () => owner, now: () => Date.parse(instant), port: {
    scan: () => ({ rows: [{ id: id(), ordinal: "1" }], through: "1", hasMore: false }),
    execution: () => ({ id: id(), instructionId: id(2), instructionRevision: 1, revision: 3, state: "completed",
      errorCode: null, taskRef: null, createdAt: instant, updatedAt: instant, body: "PRIVATE_BODY",
      roles: [{ id: id(3), assignmentId: "a", workPackageId: "w", membershipId: "m", membershipRevision: 1,
        teamId: "t", teamName: "Team", personaName: "Agent", role: "Writer", responsibility: "contributor",
        state: "completed", runtimeTaskId: null, threadId: null, turnId: null, attempts: 1,
        observation: { basis: "server_dispatch_to_terminal_including_sdk_preparation", queuedAt: null,
          startedAt: null, endedAt: null, executionSeconds: null, timingComplete: false } }] }),
    events: () => ({ events: [{ ...event("1"), sequence: 1, revision: 1 }], hasMore: false }),
  } });
  f.respond(async (url, init) => {
    try { return json(await service.handle({ method: init.method!, url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init.headers)) })); }
    catch (error) { return new Response("PRIVATE_ERROR", { status: error instanceof AssistantReadError ? error.status : 500 }); }
  });
  assert.deepEqual(await f.client.capabilities(), caps);
  const execution = await f.client.execution(id());
  assert.equal(execution.id, id()); assert.equal(JSON.stringify(execution).includes("PRIVATE_BODY"), false);
  assert.deepEqual((await f.client.executions()).executions, [execution]);
  assert.deepEqual((await f.client.events(id())).events, [event("1")].map(value => ({ ...value, revision: "1" })));
  assert.equal(f.calls.length, 10);
  assert.deepEqual(f.calls.slice(1, 4), ["/api/integrations/track/v1/capabilities",
    `/api/integrations/track/v1/executions/${id()}`, "/api/integrations/track/v1/capabilities"]);
  f.respond(url => json(url.pathname.endsWith("/capabilities") ? caps : execution));
  await assert.rejects(f.client.execution(id(2)), failure(502));
  f.respond(url => json(url.pathname.endsWith("/capabilities") ? caps : {
    ...execution, roles: execution.roles.map(role => ({ ...role, body: "PRIVATE" })),
  }));
  await assert.rejects(f.client.execution(id()), failure(502));
});

for (const baseUrl of ["http://example.com", "https://example.com/", "https://USER:SECRET@example.com",
  "https://example.com/path", "https://example.com?x=1", "https://example.com#x", "https://EXAMPLE.com",
  "https://example.com:443", "http://127.1", "file:///tmp", "garbage"]) {
  test(`reject noncanonical or unsafe origin ${baseUrl}`, t => {
    const f = fixture(t); assert.throws(() => new AssistantClient({ ...f.options, baseUrl }), failure(400));
    assert.equal(f.calls.length, 0);
  });
}
test("canonical HTTPS and loopback origins are accepted", t => {
  const f = fixture(t);
  for (const baseUrl of ["https://example.com", "http://localhost:1234", "http://[::1]:1234", "http://127.0.0.2"]) {
    assert.doesNotThrow(() => new AssistantClient({ ...f.options, baseUrl }));
  }
});

for (const patch of [{ user: "other" }, { ownerId: "sso-sub:" + "b".repeat(64) }, { sourceId: "other" },
  { principalId: "other" }, { nativeOrigin: "https://other.example" }, { audience: "projects" }, { version: 2 },
  { revision: 0 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { enabled: false }, { extra: "PRIVATE" },
  { expiresAt: instant }, { notBefore: "2027-01-01T00:00:00Z" }, { secretFile: "relative.key" }]) {
  test(`reject invalid dedicated credential ${JSON.stringify(patch)}`, async t => {
    const f = fixture(t); f.edit(patch); await assert.rejects(f.client.executions(), failure(401));
    assert.equal(f.calls.length, 0);
  });
}
test("missing, malformed, oversized configuration and key files fail closed", async t => {
  const f = fixture(t);
  for (const raw of ["{PRIVATE", " ".repeat(16_385), JSON.stringify(f.config) + " ".repeat(16_384)]) {
    writeFileSync(f.credentialFile, raw); await assert.rejects(f.client.capabilities(), failure(401));
  }
  f.edit({});
  for (const key of ["short", "x".repeat(129), "x".repeat(4097), "!".repeat(43)]) {
    writeFileSync(f.secretFile, key); await assert.rejects(f.client.capabilities(), failure(401));
  }
  rmSync(f.secretFile); await assert.rejects(f.client.capabilities(), failure(401));
  rmSync(f.credentialFile); await assert.rejects(f.client.capabilities(), failure(401));
  assert.equal(f.calls.length, 0);
});

for (const phase of [1, 3]) for (const patch of [{ ownerId: "sso-sub:" + "b".repeat(64) },
  { principalId: "other" }, { revision: "2" }, { controls: true }, { demianReferencesSupported: true }]) {
  test(`capabilities mismatch at request ${phase}: ${JSON.stringify(patch)}`, async t => {
    const f = fixture(t);
    f.respond(url => json(url.pathname.endsWith("/capabilities") ?
      { ...caps, ...(f.calls.length === phase ? patch : {}) } : page));
    await assert.rejects(f.client.executions(), failure("controls" in patch || "demianReferencesSupported" in patch ? 502 : 401));
    assert.equal(f.calls.length, phase);
  });
}

for (const phase of [1, 2, 3]) for (const mutation of ["config", "key", "revoke", "expire", "whitespace"]) {
  test(`credential ${mutation} during asynchronous request ${phase}`, async t => {
    const f = fixture(t);
    f.respond(async url => {
      await Promise.resolve();
      if (f.calls.length === phase) {
        if (mutation === "config") f.edit({ revision: 2 });
        if (mutation === "key") writeFileSync(f.secretFile, "z".repeat(43));
        if (mutation === "revoke") rmSync(f.credentialFile);
        if (mutation === "expire") f.advance(40 * 86400_000);
        if (mutation === "whitespace") writeFileSync(f.credentialFile, JSON.stringify(f.config) + " ");
      }
      return json(url.pathname.endsWith("/capabilities") ? caps : page);
    });
    await assert.rejects(f.client.executions(), failure(401)); assert.equal(f.calls.length, phase);
  });
}
test("credential revocation during streamed body is caught", async t => {
  const f = fixture(t);
  f.respond(() => new Response(new ReadableStream({ pull(controller) {
    rmSync(f.credentialFile); controller.enqueue(new TextEncoder().encode(JSON.stringify(caps))); controller.close();
  } }), { headers: { "content-type": "application/json" } }));
  await assert.rejects(f.client.capabilities(), failure(401));
});

for (const code of [301, 302, 303, 307, 308, 500, 400, 401, 403, 404, 409, 429, 503]) {
  test(`status ${code} cancels private body and never forwards redirect credentials`, async t => {
    const f = fixture(t); let cancelled = false;
    f.respond(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      status: code, headers: { location: "https://other.example/PRIVATE", "content-type": "application/json" },
    }));
    await assert.rejects(f.client.capabilities(), failure(code >= 300 && code < 400 || code === 500 ? 502 : code));
    assert.equal(cancelled, true); assert.equal(f.calls.length, 1);
  });
}
for (const [label, response] of [
  ["wrong content type", () => new Response(JSON.stringify(caps), { headers: { "content-type": "text/plain" } })],
  ["malformed JSON", () => new Response("PRIVATE_SECRET", { headers: { "content-type": "application/json" } })],
  ["extra metadata", () => json({ ...caps, body: "PRIVATE_BODY" })],
  ["invalid schema", () => json({ ...caps, revision: "01" })],
  ["overflow", () => new Response(" ".repeat(1_048_577), { headers: { "content-type": "application/json" } })],
  ["invalid utf8", () => new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } })],
] as const) {
  test(`reject ${label} without response detail`, async t => {
    const f = fixture(t); f.respond(response); await assert.rejects(f.client.capabilities(), failure(502));
  });
}
test("fetch and stream abort errors are redacted to static 503", async t => {
  const f = fixture(t);
  for (const error of [new Error("PRIVATE_URL_HEADER_SECRET"), new DOMException("PRIVATE", "AbortError")]) {
    f.respond(() => { throw error; }); await assert.rejects(f.client.capabilities(), failure(503));
  }
  f.respond(() => new Response(new ReadableStream({ start(controller) { controller.error(new Error("PRIVATE")); } }),
    { headers: { "content-type": "application/json" } }));
  await assert.rejects(f.client.capabilities(), failure(503));
});
test("timeout bounds transport ignoring AbortSignal", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t); let signal: AbortSignal | undefined;
  f.respond((_url, init) => { signal = init.signal ?? undefined; return new Promise(() => {}); });
  const result = assert.rejects(f.client.capabilities(), failure(503));
  t.mock.timers.tick(10_000); await result; assert.equal(signal?.aborted, true);
});
test("timeout bounds stalled body and cancels it", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t); let cancelled = false; let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  f.respond(() => new Response(new ReadableStream({ pull() { reading(); }, cancel() { cancelled = true; } }),
    { headers: { "content-type": "application/json" } }));
  const result = assert.rejects(f.client.capabilities(), failure(503));
  await started; await Promise.resolve(); t.mock.timers.tick(10_000); await result;
  assert.equal(cancelled, true);
});

test("opaque list cursors are bounded and encoded without interpretation", async t => {
  const f = fixture(t);
  for (const cursor of ["signed+/=&?%#", "x".repeat(2048), "9223372036854775807"]) {
    await f.client.executions(cursor);
    assert.equal(new URL(f.calls.at(-2)!, origin).searchParams.get("cursor"), cursor);
  }
  const count = f.calls.length;
  for (const cursor of ["", "x".repeat(2049), "a\nb", "a\u007fb"]) await assert.rejects(f.client.executions(cursor), failure(400));
  assert.equal(f.calls.length, count);
});
test("IDs and event after require UUID and canonical safe integer", async t => {
  const f = fixture(t);
  for (const value of ["../secret", "bad", id() + "?x=1"]) {
    await assert.rejects(f.client.execution(value), failure(400)); await assert.rejects(f.client.events(value), failure(400));
  }
  for (const after of ["", "01", "-1", "1.0", "1e2", " 1", "9007199254740992", "9223372036854775807", "0&x=1"]) {
    await assert.rejects(f.client.events(id(), after), failure(400));
  }
  assert.equal(f.calls.length, 0);
  f.respond(url => json(url.pathname.endsWith("/capabilities") ? caps : { ...events, cursor: url.searchParams.get("after") }));
  for (const after of ["0", "9007199254740991"]) assert.equal((await f.client.events(id(), after)).cursor, after);
});
for (const patch of [{ executionId: id(2) }, { cursor: "2" }, { events: [event("1")], cursor: "1" },
  { events: [event("3", id(2))], cursor: "3" }, { events: [event("3"), event("2")], cursor: "2" },
  { events: [event("3"), event("3")], cursor: "3" }, { events: [event("3")], cursor: "4" },
  { hasMore: true }, { body: "PRIVATE" }]) {
  test(`reject event scope or continuation violation ${JSON.stringify(patch)}`, async t => {
    const f = fixture(t);
    f.respond(url => json(url.pathname.endsWith("/capabilities") ? caps : { ...events, cursor: "1", ...patch }));
    await assert.rejects(f.client.events(id(), "1"), failure(502));
  });
}
test("valid monotonic event continuation remains exact", async t => {
  const f = fixture(t); const value = { ...events, events: [event("2"), event("3")], cursor: "3", hasMore: true };
  f.respond(url => json(url.pathname.endsWith("/capabilities") ? caps : value));
  assert.deepEqual(await f.client.events(id(), "1"), value);
});
test("list continuation and extra metadata use authoritative strict schema", async t => {
  const f = fixture(t);
  for (const patch of [{ cursor: "x", hasMore: false }, { cursor: null, hasMore: true },
    { cursor: "x".repeat(2049), hasMore: true }, { cursor: "x\ny", hasMore: true }, { body: "PRIVATE" }]) {
    f.respond(url => json(url.pathname.endsWith("/capabilities") ? caps : { ...page, ...patch }));
    await assert.rejects(f.client.executions(), failure(502));
  }
});

for (const target of ["config", "key", "config-after-key"]) {
  test(`bounded file reads reject stat/read race: ${target}`, async t => {
    const f = fixture(t);
    const original = fs.fstatSync;
    let changed = false;
    const mock = t.mock.method(fs, "fstatSync", (...args: Parameters<typeof fs.fstatSync>) => {
      const stat = original(...args);
      if (!changed && stat.size === (target === "config" ? Buffer.byteLength(JSON.stringify(f.config)) : 43)) {
        changed = true;
        if (target === "config") writeFileSync(f.credentialFile, " ".repeat(16_385));
        if (target === "key") writeFileSync(f.secretFile, "x".repeat(4097));
        if (target === "config-after-key") f.edit({ revision: 2 });
      }
      return stat;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(f.client.capabilities(), failure(401));
      assert.equal(changed, true); assert.equal(f.calls.length, 0);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

test("raw key changes invalidate the credential fingerprint even with identical trimmed secret", async t => {
  const f = fixture(t);
  f.respond(async () => { await Promise.resolve(); writeFileSync(f.secretFile, f.secret + "\n"); return json(caps); });
  await assert.rejects(f.client.capabilities(), failure(401));
});
test("stream byte limit counts all chunks and accepts exactly one MiB", async t => {
  const f = fixture(t);
  const raw = JSON.stringify(caps);
  f.respond(() => new Response(raw + " ".repeat(1_048_576 - Buffer.byteLength(raw)),
    { headers: { "content-type": "Application/JSON; charset=utf-8" } }));
  assert.deepEqual(await f.client.capabilities(), caps);
  let cancelled = false;
  f.respond(() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(600_000)); controller.enqueue(new Uint8Array(600_000));
  }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
  await assert.rejects(f.client.capabilities(), failure(502)); assert.equal(cancelled, true);
});
test("each invocation reauthorizes remote capabilities", async t => {
  const f = fixture(t); assert.deepEqual(await f.client.executions(), page);
  f.respond(() => new Response("PRIVATE_REVOKED", { status: 403 }));
  await assert.rejects(f.client.executions(), failure(403)); assert.equal(f.calls.length, 4);
});
test("strict identity binding survives caller option mutation", async t => {
  const f = fixture(t); f.options.baseUrl = "https://other.example"; f.options.principalId = "other";
  assert.deepEqual(await f.client.capabilities(), caps);
});

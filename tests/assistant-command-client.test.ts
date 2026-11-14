import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createServer } from "node:http";
import { listenHttp } from "./helpers/http-listen.ts";
import { AssistantCommandClient, AssistantCommandError } from "../packages/adapters/assistant/commands.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const instant = Date.parse("2026-11-14T00:00:00Z");
const owner = "sso-sub:" + "a".repeat(64);
const input = { operationId: id(3), kind: "retry" as const, expectedRevision: 1, expiresAt: "2026-11-14T00:01:00Z" };
const caps = { version: 1, audience: "agent-track-command", ownerId: owner, principalId: "writer", trackUser: "me@example.com", grantRevision: 1, commands: ["retry", "resume"], receiptRead: true };
const receipt = { version: 1, command: { operationId: id(3), executionId: id(1), roleId: id(2), kind: "retry", attempt: 1, intentState: "saved", createdAt: "2026-11-14T00:00:00Z" } };
function failure(disposition: "withheld" | "ambiguous") { return (error: unknown) => {
  assert.ok(error instanceof AssistantCommandError); assert.equal(error.disposition, disposition);
  assert.equal(error.message, "assistant_command_unavailable"); return true;
}; }
function fixture(t: test.TestContext, baseUrl = "http://127.0.0.1:12345") {
  const root = mkdtempSync(join(tmpdir(), "track-command-test-"));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const secretFile = join(root, "writer.key"), readerKey = join(root, "reader.key"), proxy = join(root, "proxy.key");
  const credentialFile = join(root, "writer.json"), readerCredentialFile = join(root, "reader.json");
  writeFileSync(secretFile, "w".repeat(43)); writeFileSync(readerKey, "r".repeat(43)); writeFileSync(proxy, "p".repeat(43));
  writeFileSync(readerCredentialFile, JSON.stringify({ secretFile: readerKey, audience: "agent-track" }));
  const config = { version: 1, audience: "agent-track-command", sourceId: "persona", user: caps.trackUser, ownerId: owner, principalId: "writer", revision: 1,
    notBefore: "2026-11-13T00:00:00Z", expiresAt: "2026-11-15T00:00:00Z", nativeOrigin: baseUrl, secretFile };
  const edit = (patch: Record<string, unknown>) => writeFileSync(credentialFile, JSON.stringify({ ...config, ...patch })); edit({});
  let clock = instant;
  const calls: { url: string; init: RequestInit }[] = [];
  let respond = async (url: string, init: RequestInit): Promise<Response> => Response.json(url.endsWith("capabilities") ? caps : receipt, { status: init.method === "POST" ? 202 : 200 });
  const transport: typeof fetch = async (url, init) => { calls.push({ url: String(url), init: init! }); return respond(String(url), init!); };
  const options = { sourceId: "persona", baseUrl, credentialFile, readerCredentialFile, user: caps.trackUser, ownerId: owner, principalId: "writer", proxySecretFile: proxy, fetch: transport, now: () => clock };
  return { options, edit, calls, secretFile, readerKey, proxy, readerCredentialFile, setClock: (n: number) => { clock = n; }, respond: (fn: typeof respond) => { respond = fn; } };
}
test("actual HTTP machine headers, exact POST and deadline-independent receipt recovery", async t => {
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    requests.push(req.method!);
    assert.equal(req.headers.authorization, "Bearer " + "w".repeat(43));
    assert.equal(req.headers["x-agent-track-user"], caps.trackUser);
    for (const key of ["cookie", "origin", "x-agent-track-principal", "x-forwarded-user"]) assert.equal(req.headers[key], undefined);
    let body = ""; for await (const chunk of req) body += chunk;
    if (req.method === "POST") assert.deepEqual(JSON.parse(body), input);
    res.writeHead(req.method === "POST" ? 202 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url!.endsWith("capabilities") ? caps : receipt));
  });
  const origin = await listenHttp(server);
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const f = fixture(t, origin);
  const client = new AssistantCommandClient({ ...f.options, fetch });
  let callback = 0;
  assert.deepEqual(await client.command(id(1), id(2), input, () => { callback++; }), receipt);
  assert.equal(callback, 1); f.setClock(instant + 120_000);
  assert.deepEqual(await client.receipt(id(1), id(2), id(3), "retry"), receipt);
  assert.equal(requests.filter(m => m === "POST").length, 1);
});
test("explicit configuration, audience, revision, identity and separation fail closed", t => {
  const f = fixture(t);
  assert.throws(() => new AssistantCommandClient({ ...f.options, readerCredentialFile: undefined! }), failure("withheld"));
  for (const patch of [{ audience: "agent-track" }, { revision: 0 }, { revision: 1.2 }, { user: "Me@example.com" }, { authority: true }, { nativeOrigin: "http://example.com" }]) {
    f.edit(patch); assert.throws(() => new AssistantCommandClient(f.options), failure("withheld"));
  }
  f.edit({});
  for (const path of [f.readerKey, f.proxy]) {
    writeFileSync(path, "  " + "w".repeat(43) + "\n");
    assert.throws(() => new AssistantCommandClient(f.options), failure("withheld")); writeFileSync(path, "x".repeat(43));
  }
  writeFileSync(f.readerCredentialFile, JSON.stringify({ secretFile: f.secretFile }));
  assert.throws(() => new AssistantCommandClient(f.options), failure("withheld"));
  assert.equal(f.calls.length, 0);
});
test("capability mismatch and rotation before dispatch prove zero POST", async t => {
  for (const patch of [{ ownerId: "sso-sub:" + "b".repeat(64) }, { principalId: "other" }, { trackUser: "other@example.com" }, { grantRevision: 2 }, { commands: ["resume", "retry"] }, { private: true }]) {
    const f = fixture(t); f.respond(async () => Response.json({ ...caps, ...patch }));
    await assert.rejects(new AssistantCommandClient(f.options).command(id(1), id(2), input), failure("withheld"));
    assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
  }
  const f = fixture(t); const client = new AssistantCommandClient(f.options);
  f.respond(async () => { writeFileSync(f.secretFile, "z".repeat(43)); return Response.json(caps); });
  await assert.rejects(client.command(id(1), id(2), input), failure("withheld"));
});
test("callback failure is typed withheld with zero POST; options are frozen", async t => {
  const f = fixture(t), client = new AssistantCommandClient(f.options);
  f.options.baseUrl = "http://evil.invalid";
  await assert.rejects(client.command(id(1), id(2), input, () => { throw new Error("private"); }), failure("withheld"));
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0]!.url.startsWith("http://127.0.0.1:"));
});
test("POST failures are ambiguous, bounded and never retried", async t => {
  const cases: (() => Response | Promise<Response>)[] = [
    () => { throw new Error("network"); },
    () => new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }),
    () => new Response("x".repeat(16_385), { status: 202, headers: { "content-type": "application/json" } }),
    () => new Response("{", { status: 202, headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array([255]), { status: 202, headers: { "content-type": "application/json" } }),
    () => Response.json(receipt, { status: 200 }),
    () => new Response(JSON.stringify(receipt), { status: 202 }),
    ...["operationId", "executionId", "roleId"].map(key => () => Response.json({ ...receipt, command: { ...receipt.command, [key]: id(9) } }, { status: 202 })),
    () => Response.json({ ...receipt, command: { ...receipt.command, kind: "resume" } }, { status: 202 }),
    () => Response.json({ ...receipt, private: true }, { status: 202 }),
    () => { const r = Response.json(receipt, { status: 202 }); Object.defineProperty(r, "url", { value: "https://evil.invalid/path" }); return r; },
  ];
  for (const response of cases) {
    const f = fixture(t); f.respond(async (url) => url.endsWith("capabilities") ? Response.json(caps) : response());
    await assert.rejects(new AssistantCommandClient(f.options).command(id(1), id(2), input), failure("ambiguous"));
    assert.equal(f.calls.filter(c => c.init.method === "POST").length, 1);
  }
});
test("rotation after fetch and during stream fails closed", async t => {
  for (const streamed of [false, true]) {
    const f = fixture(t), client = new AssistantCommandClient(f.options);
    f.respond(async url => {
      if (url.endsWith("capabilities")) return Response.json(caps);
      if (!streamed) { f.edit({ revision: 2 }); return Response.json(receipt, { status: 202 }); }
      return new Response(new ReadableStream({ pull(controller) {
        f.edit({ revision: 2 }); controller.enqueue(new TextEncoder().encode(JSON.stringify(receipt))); controller.close();
      } }), { status: 202, headers: { "content-type": "application/json" } });
    });
    await assert.rejects(client.command(id(1), id(2), input), failure("ambiguous"));
  }
});
test("receipt recovery validates exact operation and kind under current credentials", async t => {
  const f = fixture(t), client = new AssistantCommandClient(f.options); f.setClock(instant + 120_000);
  await assert.rejects(client.receipt(id(1), id(2), id(4), "retry"), failure("withheld"));
  await assert.rejects(client.receipt(id(1), id(2), id(3), "resume"), failure("withheld"));
  assert.equal(f.calls.some(c => c.init.method === "POST"), false);
});
test("timeout covers fetch and stalled response stream without POST retry", async t => {
  await Promise.all([false, true].map(async streamed => {
    const f = fixture(t);
    f.respond(async url => {
      if (url.endsWith("capabilities")) return Response.json(caps);
      if (!streamed) return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }), { status: 202, headers: { "content-type": "application/json" } });
    });
    await assert.rejects(new AssistantCommandClient(f.options).command(id(1), id(2), input), failure("ambiguous"));
    assert.equal(f.calls.filter(c => c.init.method === "POST").length, 1);
  }));
});
test("local file bounds, fatal UTF-8, clock expiry and strict input withhold dispatch", async t => {
  for (const bytes of [Buffer.alloc(4097, 119), Buffer.from([255]), Buffer.from("short")]) {
    const f = fixture(t); writeFileSync(f.secretFile, bytes);
    assert.throws(() => new AssistantCommandClient(f.options), failure("withheld")); assert.equal(f.calls.length, 0);
  }
  const f = fixture(t), client = new AssistantCommandClient(f.options);
  for (const patch of [{ expectedRevision: 0 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { authority: "owner" }, { kind: "cancel" }, { expiresAt: "tomorrow" }]) {
    await assert.rejects(client.command(id(1), id(2), { ...input, ...patch } as typeof input), failure("withheld"));
  }
  assert.equal(f.calls.length, 0);
  f.setClock(Number.NaN); await assert.rejects(client.capabilities(), failure("withheld"));
  f.setClock(Date.parse("2026-11-15T00:00:00Z")); await assert.rejects(client.capabilities(), failure("withheld"));
  assert.equal(f.calls.length, 0);
});

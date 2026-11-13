import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import test from "node:test";
import { createDelegatedProxy } from "../deploy/demian/delegated-proxy.mjs";

const hostname = "delegated.example.test";
const organizationId = "org-synthetic";
const bearer = "synthetic-test-only-bearer";
const envelope = `DemianWork v1.test.eyJ0ZXN0Ijp0cnVlfQ.${"a".repeat(43)}`;
const uuid = "12345678-abcd-1234-abcd-123456789012";
const session = `/api/v1/sessions/${uuid}`;
const run = `/api/v1/runs/${uuid}`;
const validHeaders = ["Host", hostname, "Authorization", `Bearer ${bearer}`, "x-demian-delegation", envelope, "x-demian-organization-id", organizationId];

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function send(port: number, path = "/api/v1/me", headers = validHeaders, method = "GET", body = Buffer.alloc(0)) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port, path, method, headers, agent: false }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function replace(name: string, ...values: string[]) {
  const result: string[] = [];
  for (let index = 0; index < validHeaders.length; index += 2) {
    if (validHeaders[index]!.toLowerCase() !== name.toLowerCase()) result.push(validHeaders[index]!, validHeaders[index + 1]!);
  }
  for (const value of values) result.push(name, value);
  return result;
}

async function fixture(timeoutMs = 1000) {
  const seen: { url: string; method: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];
  let current: string | null = bearer;
  let mode = "ok";
  let resolutions = 0;
  const backend = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ url: req.url!, method: req.method!, headers: req.headers, body: Buffer.concat(chunks) });
    if (mode === "timeout") return;
    if (mode === "partial") { res.writeHead(200); res.write("partial"); return; }
    if (mode === "disconnect") { req.socket.destroy(); return; }
    if (mode === "redirect") { res.writeHead(302, { location: "http://foreign.invalid/", "set-cookie": "secret=1" }); res.end("redirect"); return; }
    res.writeHead(201, {
      "content-type": "application/octet-stream", "set-cookie": "browser=secret", "cache-control": "public",
      "content-disposition": "attachment; filename=artifact.bin", "x-content-sha256": "a".repeat(64),
      "x-untrusted": "omit", connection: "x-artifact-sha256", "x-artifact-sha256": "omit",
    });
    res.write(Buffer.from([0, 255]));
    res.end("unchanged");
  });
  const backendPort = await listen(backend);
  const handler = createDelegatedProxy({ hostname, organizationId, upstreamPort: backendPort, timeoutMs,
    resolveBearer: async () => {
      resolutions++;
      if (mode === "resolver-error") throw new Error("sensitive");
      if (mode === "resolver-timeout") return new Promise<string | null>(() => {});
      return current;
    } });
  const proxy = createServer(async (req, res) => {
    res.setHeader("x-browser-marker", "unchanged");
    if (!await handler(req, res)) {
      res.statusCode = 418;
      res.end(JSON.stringify({ url: req.url, headers: req.headers, body: await (async () => {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks).toString();
      })() }));
    }
  });
  const port = await listen(proxy);
  return { port, seen, setBearer: (value: string | null) => { current = value; }, setMode: (value: string) => { mode = value; },
    resolutions: () => resolutions, close: async () => { await close(proxy); await close(backend); } };
}

test("forwards exact allowed targets and UTF8 wire bytes; isolates headers and streams artifact bytes", async () => {
  const f = await fixture();
  try {
    const paths = ["/api/v1/capabilities", "/api/v1/me", session, `${session}/requests/${uuid}`,
      `${session}/requests/${encodeURIComponent("opaque:한글+key")}`, run, `${run}/artifacts/${uuid}/content`];
    for (const path of paths) {
      const response = await send(f.port, path, [...replace("Host", `${hostname}:443`), "Cookie", "browser=private", "Forwarded", "for=1", "X-Forwarded-User", "admin", "Proxy-Authorization", "Basic private", "Connection", "x-browser", "X-Browser", "private"]);
      assert.equal(response.status, 201);
      assert.equal(f.seen.at(-1)!.url, path);
      assert.deepEqual(response.body, Buffer.concat([Buffer.from([0, 255]), Buffer.from("unchanged")]));
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers["set-cookie"], undefined);
      assert.equal(response.headers["content-disposition"], "attachment; filename=artifact.bin");
      assert.equal(response.headers["x-content-sha256"], "a".repeat(64));
      assert.equal(response.headers["x-artifact-sha256"], undefined);
      assert.equal(response.headers["x-browser-marker"], undefined);
      const headers = f.seen.at(-1)!.headers;
      assert.equal(headers.host, hostname);
      assert.equal(headers.authorization, `Bearer ${bearer}`);
      assert.equal(headers["x-demian-delegation"], envelope);
      for (const key of ["cookie", "forwarded", "x-forwarded-user", "proxy-authorization", "x-browser"]) assert.equal(headers[key], undefined);
    }
    const body = Buffer.from('{ "message": "안녕 🌎", "order": [2, 1] }\n');
    for (const path of [`${session}/runs`, `${run}/cancel`]) {
      const response = await send(f.port, path, [...validHeaders, "Content-Type", "application/json; charset=utf-8", "Idempotency-Key", "opaque:Keep-THIS_123", "Content-Length", String(body.length)], "POST", body);
      assert.equal(response.status, 201);
      assert.deepEqual(f.seen.at(-1)!.body, body);
      assert.equal(f.seen.at(-1)!.url, path);
      assert.equal(f.seen.at(-1)!.headers["idempotency-key"], "opaque:Keep-THIS_123");
      assert.equal(f.seen.at(-1)!.headers["content-type"], "application/json; charset=utf-8");
    }
  } finally { await f.close(); }
});

test("missing, repeated, incorrect and revoked credentials fail closed before backend", async () => {
  const f = await fixture();
  try {
    const cases = [replace("Authorization"), replace("Authorization", "Basic synthetic"), replace("Authorization", "Bearer wrong"),
      replace("Authorization", `Bearer ${bearer}`, `Bearer ${bearer}`), replace("x-demian-delegation"),
      replace("x-demian-delegation", envelope, envelope), replace("x-demian-delegation", "invalid"),
      replace("x-demian-delegation", envelope.replace("v1.", "v2.")), replace("x-demian-delegation", envelope.slice(0, -1)),
      replace("x-demian-organization-id"), replace("x-demian-organization-id", "wrong"), replace("x-demian-organization-id", organizationId, organizationId),
      [...validHeaders, "Connection", "authorization"], [...validHeaders, "Idempotency-Key", "a", "Idempotency-Key", "b"],
      [...validHeaders, "Idempotency-Key", "x".repeat(257)]];
    for (const headers of cases) {
      const response = await send(f.port, "/api/v1/me", headers);
      assert([401, 403].includes(response.status));
      assert.equal(response.headers["cache-control"], "no-store");
      assert.match(response.body.toString(), /^(Unauthorized|Forbidden)$/);
    }
    assert.equal(f.seen.length, 0);
    assert.equal((await send(f.port)).status, 201);
    f.setBearer(null);
    assert.equal((await send(f.port)).status, 401);
    f.setBearer("rotated-synthetic");
    assert.equal((await send(f.port)).status, 401);
    assert.equal((await send(f.port, "/api/v1/me", replace("Authorization", "Bearer rotated-synthetic"))).status, 201);
    f.setMode("resolver-error");
    assert.equal((await send(f.port)).status, 401);
    assert.equal(f.seen.length, 2);
  } finally { await f.close(); }
});

test("rejects weird paths, host variants, methods, GET bodies and oversized POST before backend", async () => {
  const f = await fixture();
  try {
    for (const path of ["/api/v1/me?", "/api/v1/me?x=1", "/api/v1/../v1/me", "/api//v1/me", "http://foreign.invalid/api/v1/me", "/unknown",
      `${session}/requests/.`, `${session}/requests/%2E%2E`, `${session}/requests/a%2Fb`, `${session}/requests/a%5Cb`, `${session}/requests/%00`,
      `${session}/requests/%ZZ`, `${session}/requests/${"a".repeat(257)}`, `${session.toUpperCase()}`, `${run}/artifacts/no/content`]) {
      assert.equal((await send(f.port, path)).status, 403, path);
    }
    for (const headers of [replace("Host", "foreign.invalid"), replace("Host", `${hostname}:80`), replace("Host", `${hostname}.`), replace("Host", hostname.toUpperCase()), replace("Host", hostname, hostname)]) {
      assert.equal((await send(f.port, "/api/v1/me", headers)).status, 403);
    }
    // Node's HTTP parser rejects absent Host before invoking the handler.
    assert.equal((await send(f.port, "/api/v1/me", replace("Host"))).status, 400);
    assert.equal((await send(f.port, "/api/v1/me", validHeaders, "DELETE")).status, 403);
    assert.equal((await send(f.port, "/api/v1/me", [...validHeaders, "Content-Length", "1"], "GET", Buffer.from("x"))).status, 403);
    assert.equal((await send(f.port, "/api/v1/me", [...validHeaders, "Transfer-Encoding", "chunked"], "GET", Buffer.from("x"))).status, 403);
    const oversized = Buffer.alloc(1024 * 1024 + 1, "x");
    // A declared oversize must be denied without waiting for any body bytes.
    assert.equal((await send(f.port, `${session}/runs`, [...validHeaders, "Content-Length", String(oversized.length)], "POST")).status, 403);
    assert.equal((await send(f.port, `${session}/runs`, [...validHeaders, "Transfer-Encoding", "chunked"], "POST", oversized)).status, 403);
    assert.equal(f.seen.length, 0);
    assert.equal((await send(f.port, `${session}/runs`, [...validHeaders, "Transfer-Encoding", "chunked"], "POST", oversized.subarray(0, -1))).status, 201);
    assert.equal(f.seen[0]!.body.length, 1024 * 1024);
  } finally { await f.close(); }
});

test("ordinary browser Basic and unauthenticated requests fall through without touching headers or body", async () => {
  const f = await fixture();
  try {
    for (const auth of [[], ["Authorization", "Basic synthetic-browser"]]) {
      const body = Buffer.from("browser body");
      const response = await send(f.port, "/browser?unchanged=1", ["Host", "browser.example.test", "Cookie", "session=keep", ...auth, "Content-Length", String(body.length)], "POST", body);
      assert.equal(response.status, 418);
      assert.equal(response.headers["x-browser-marker"], "unchanged");
      assert.equal(response.headers["cache-control"], undefined);
      const decoded = JSON.parse(response.body.toString());
      assert.equal(decoded.body, body.toString());
      assert.equal(decoded.url, "/browser?unchanged=1");
      assert.equal(decoded.headers.cookie, "session=keep");
      assert.equal(decoded.headers.authorization, auth[1]);
    }
    assert.equal(f.seen.length, 0);
    assert.equal(f.resolutions(), 0);
  } finally { await f.close(); }
});

test("timeout and backend disconnect yield generic 502; redirects never followed", async () => {
  const f = await fixture(100);
  try {
    for (const mode of ["timeout", "disconnect"]) {
      f.setMode(mode);
      const response = await send(f.port);
      assert.equal(response.status, 502);
      assert.equal(response.body.toString(), "Bad gateway");
      assert.equal(response.headers["cache-control"], "no-store");
    }
    f.setMode("redirect");
    const response = await send(f.port);
    assert.equal(response.status, 302);
    assert.equal(response.body.toString(), "redirect");
    assert.equal(response.headers.location, undefined);
    assert.equal(response.headers["set-cookie"], undefined);
    assert.equal(f.seen.length, 3);
  } finally { await f.close(); }
});

test("validates fixed destination and resolver options", () => {
  const options = { hostname, organizationId, upstreamPort: 12345, resolveBearer: async () => bearer };
  for (const bad of [{ hostname: "http://bad" }, { hostname: "a:443" }, { hostname: "a..b" }, { hostname: "-bad" },
    { hostname: "a\r\n" }, { organizationId: "" }, { organizationId: "a\r\n" }, { upstreamPort: 0 }, { upstreamPort: 65536 },
    { upstreamPort: 1.5 }, { timeoutMs: 0 }, { timeoutMs: Infinity }]) {
    assert.throws(() => createDelegatedProxy({ ...options, ...bad }), /Invalid delegated proxy options/);
  }
  assert.throws(() => createDelegatedProxy({ ...options, resolveBearer: null as never }));
});

test("deadline bounds resolver, unfinished upload and streaming response", { timeout: 5000 }, async () => {
  const f = await fixture(100);
  try {
    f.setMode("resolver-timeout");
    assert.equal((await send(f.port)).status, 502);
    assert.equal(f.seen.length, 0);
    f.setMode("ok");
    const status = await new Promise<number>((resolve, reject) => {
      const upload = request({ hostname: "127.0.0.1", port: f.port, method: "POST", path: `${session}/runs`,
        headers: [...validHeaders, "Content-Length", "100"], agent: false }, response => {
        response.resume();
        response.on("end", () => { resolve(response.statusCode!); upload.destroy(); });
      });
      upload.on("error", reject);
      upload.write("unfinished");
    });
    assert.equal(status, 502);
    assert.equal(f.seen.length, 0);
    f.setMode("partial");
    // Once bytes are streamed HTTP cannot replace the status; close the stream.
    await assert.rejects(send(f.port), /aborted|reset/i);
    assert.equal(f.seen.length, 1);
  } finally { await f.close(); }
});

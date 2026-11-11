import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import { ContextSummaryClient } from "../packages/context/client.ts";
import type { ContextTarget } from "../packages/context/contracts.ts";

const target: ContextTarget = { kind: "project", sourceId: "demian", projectId: "123e4567-e89b-42d3-a456-426614174000" };
const at = "2026-11-12T00:00:00.000Z";
const statusCounts = { queued: 0, leasing: 0, running: 0, waiting_for_permission: 0, cancelling: 0, succeeded: 0, failed: 0, cancelled: 0, expired: 0, interrupted: 0, unknown: 0 };
const summary = {
  version: 1, context: target, observedAt: at, task: null, runs: [],
  counts: { runs: 0, sessions: 0, byStatus: statusCounts },
  coverage: { kind: "observed-window", limit: 50, capped: false, unavailable: false }, trackUrl: null,
};
const tokenA = "a".repeat(48);
const tokenB = "b".repeat(48);

async function fixture(handler: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void | Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "agent-track-context-"));
  const resolvedDir = resolve(dir);
  if (!resolvedDir.startsWith(resolve(tmpdir()) + sep)) throw new Error("Temporary directory escaped tmpdir");
  const tokenFile = join(resolvedDir, "token.txt");
  await writeFile(tokenFile, tokenA, "utf8");
  const server: Server = createServer((request, response) => { void handler(request, response); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No HTTP server port");
  return {
    tokenFile,
    baseUrl: `http://127.0.0.1:${address.port}`,
    client: (timeoutMs = 2000) => new ContextSummaryClient({ baseUrl: `http://127.0.0.1:${address.port}`, readerId: "native-ui", tokenFile, publicOrigin: "https://track.example", timeoutMs }),
    cleanup: async () => {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      const resolvedFile = resolve(tokenFile);
      if (!resolvedFile.startsWith(resolvedDir + sep)) throw new Error("Cleanup path escaped owned temp directory");
      await rm(resolvedDir, { recursive: true, force: true });
    },
  };
}

function sendJson(response: import("node:http").ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

test("uses private authenticated GET, target path, and the freshly rotated token on every read", async () => {
  const auth: string[] = [];
  const paths: string[] = [];
  const headers: Array<[string, string]> = [];
  const f = await fixture((request, response) => {
    auth.push(String(request.headers.authorization)); paths.push(String(request.url));
    headers.push([String(request.headers["x-track-context-reader"]), String(request.headers.accept)]); sendJson(response, summary);
  });
  try {
    const client = f.client();
    assert.equal((await client.read(target)).state, "connected");
    await writeFile(f.tokenFile, tokenB, "utf8");
    assert.equal((await client.read(target)).state, "connected");
    assert.deepEqual(auth, [`Bearer ${tokenA}`, `Bearer ${tokenB}`]);
    assert.deepEqual(headers, [["native-ui", "application/json"], ["native-ui", "application/json"]]);
    assert.deepEqual(paths, ["/api/integrations/context/v1/projects/demian/123e4567-e89b-42d3-a456-426614174000", "/api/integrations/context/v1/projects/demian/123e4567-e89b-42d3-a456-426614174000"]);
  } finally { await f.cleanup(); }
});

test("maps forbidden responses, lost service, and timeout to summary-free results", async () => {
  const f = await fixture((_request, response) => sendJson(response, { error: "secret detail" }, 403));
  try { assert.deepEqual(await f.client().read(target), { state: "forbidden", summary: null }); }
  finally { await f.cleanup(); }

  const timeout = await fixture((_request, response) => { setTimeout(() => sendJson(response, summary), 150); });
  try { assert.deepEqual(await timeout.client(25).read(target), { state: "unavailable", summary: null }); }
  finally { await timeout.cleanup(); }

  const lost = await fixture((_request, response) => sendJson(response, summary));
  await lost.cleanup();
  assert.deepEqual(await lost.client().read(target), { state: "unavailable", summary: null });
});

test("deadline wins over a late custom fetch result and cancels its body", async () => {
  const f = await fixture((_request, response) => sendJson(response, summary));
  let bodyCancelled = false;
  const lateFetch: typeof fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(summary))); },
      cancel() { bodyCancelled = true; },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const client = new ContextSummaryClient({ baseUrl: f.baseUrl, readerId: "native-ui", tokenFile: f.tokenFile, publicOrigin: "https://track.example", fetch: lateFetch, timeoutMs: 20 });
    const started = Date.now();
    assert.deepEqual(await client.read(target), { state: "unavailable", summary: null });
    assert.ok(Date.now() - started < 100);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(bodyCancelled, true);
  } finally { await f.cleanup(); }
});

test("deadline cancels a response body that stalls after headers", async () => {
  const f = await fixture((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write("{\"partial\":");
  });
  try {
    const started = Date.now();
    assert.deepEqual(await f.client(35).read(target), { state: "unavailable", summary: null });
    assert.ok(Date.now() - started < 150);
  } finally { await f.cleanup(); }
});

test("cancels bodies for non-JSON and non-OK responses", async () => {
  const f = await fixture((_request, response) => sendJson(response, summary));
  try {
    const cancelled: string[] = [];
    for (const [name, init] of [["not-json", { status: 200, contentType: "text/plain" }], ["server-error", { status: 503, contentType: "application/json" }]] as const) {
      const fetchMock: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode("body")); },
        cancel() { cancelled.push(name); },
      }), { status: init.status, headers: { "content-type": init.contentType } });
      const client = new ContextSummaryClient({ baseUrl: f.baseUrl, readerId: "native-ui", tokenFile: f.tokenFile, publicOrigin: "https://track.example", fetch: fetchMock });
      assert.deepEqual(await client.read(target), { state: "unavailable", summary: null });
    }
    assert.deepEqual(cancelled.sort(), ["not-json", "server-error"]);
  } finally { await f.cleanup(); }
});

test("rejects malformed identity, external URLs, oversized bodies, redirects, and invalid credentials", async () => {
  const otherTarget = { ...target, projectId: "223e4567-e89b-42d3-a456-426614174000" };
  const cases: Array<[string, (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void]> = [
    ["identity mismatch", (_request, response) => sendJson(response, { ...summary, context: otherTarget })],
    ["malformed summary", (_request, response) => sendJson(response, { ...summary, unexpected: "field" })],
    ["external URL", (_request, response) => sendJson(response, { ...summary, trackUrl: "https://evil.example/" })],
    ["oversize", (_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end(" ".repeat(512 * 1024 + 1)); }],
    ["redirect", (_request, response) => { response.writeHead(302, { location: "https://evil.example/" }); response.end(); }],
  ];
  for (const [name, handler] of cases) {
    const f = await fixture(handler);
    try { assert.deepEqual(await f.client().read(target), { state: "unavailable", summary: null }, name); }
    finally { await f.cleanup(); }
  }
  const invalid = await fixture((_request, response) => sendJson(response, summary));
  try {
    await writeFile(invalid.tokenFile, "short credential", "utf8");
    assert.deepEqual(await invalid.client().read(target), { state: "unavailable", summary: null });
    assert.equal(await readFile(invalid.tokenFile, "utf8"), "short credential");
  } finally { await invalid.cleanup(); }
});

test("rejects non-loopback roots and excessive injected timeouts", () => {
  const options = { readerId: "native-ui", tokenFile: "token", publicOrigin: "https://track.example" };
  assert.throws(() => new ContextSummaryClient({ ...options, baseUrl: "https://remote.example" }));
  assert.throws(() => new ContextSummaryClient({ ...options, baseUrl: "http://localhost/path" }));
  assert.throws(() => new ContextSummaryClient({ ...options, baseUrl: "http://localhost", timeoutMs: 2001 }));
  assert.throws(() => new ContextSummaryClient({ ...options, baseUrl: "http://localhost", readerId: "Reader ID" }));
});

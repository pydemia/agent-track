import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { SourceError } from "../packages/adapters/demian/index.ts";
import { DemianOrchestrationReader, type OrchestrationSupport } from "../packages/adapters/demian/orchestration.ts";

const provider = "codex-primary";
const checkedAt = new Date().toISOString();
const secret = "DO_NOT_LEAK_CREDENTIAL";

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    object: "demian.runtime_capabilities",
    checked_at: checkedAt,
    worker_count: 4,
    features: { goals: true, cowork: true, managed_child_v1: true },
    ...overrides,
  };
}

function connection(overrides: Record<string, unknown> = {}) {
  return {
    provider,
    provider_type: "codex-app-server",
    configured: true,
    worker_count: 3,
    checked_at: checkedAt,
    message: "PRIVATE_NATIVE_MESSAGE",
    auth_job_id: "PRIVATE_AUTH_JOB_ID",
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function reader(fetch: typeof globalThis.fetch, options: Record<string, unknown> = {}) {
  return new DemianOrchestrationReader({
    sourceId: "native",
    baseUrl: "https://demian.invalid/",
    fetch,
    ...options,
  });
}

function unknownSupport(value: OrchestrationSupport) {
  assert.deepEqual(value, {
    provider,
    providerType: null,
    providerConfigured: null,
    toolOrchestration: "unknown",
    reported: { goals: null, cowork: null, managedChild: null },
    workers: null,
    checkedAt: null,
  });
}

test("reads selected provider and allowlisted global orchestration report", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await reader(async (input, init) => {
    requests.push({ url: String(input), ...(init ? { init } : {}) });
    return String(input).endsWith("runtime/capabilities")
      ? jsonResponse(capabilities())
      : jsonResponse({ object: "list", data: [connection()] });
  }).read(provider);

  assert.deepEqual(requests.map((request) => request.url), [
    "https://demian.invalid/api/v1/runtime/capabilities",
    "https://demian.invalid/api/v1/provider-connections",
  ]);
  for (const request of requests) {
    assert.equal(request.init?.method, undefined);
    assert.equal(request.init?.redirect, "error");
    assert.equal(request.init?.signal instanceof AbortSignal, true);
  }
  assert.deepEqual(result, {
    provider,
    providerType: "codex-app-server",
    providerConfigured: true,
    toolOrchestration: "external",
    reported: { goals: true, cowork: true, managedChild: true },
    workers: 3,
    checkedAt,
  });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|auth_job_id|message/);
});

test("classifies known internal and external types, leaving new types unknown", async () => {
  for (const [providerType, expected] of [
    ["codex", "demian"],
    ["claudecode", "external"],
    ["future-provider-runtime", "unknown"],
  ] as const) {
    const result = await reader(async (input) => String(input).endsWith("runtime/capabilities")
      ? jsonResponse(capabilities())
      : jsonResponse({ object: "list", data: [connection({ provider_type: providerType })] }))
      .read(provider);
    assert.equal(result.toolOrchestration, expected);
  }
});

test("unknown provider and stale or malformed feature reports remain explicit", async () => {
  const notFound = await reader(async (input) => String(input).endsWith("runtime/capabilities")
    ? jsonResponse(capabilities())
    : jsonResponse({ object: "list", data: [] })).read(provider);
  assert.equal(notFound.providerType, null);
  assert.equal(notFound.providerConfigured, null);
  assert.equal(notFound.toolOrchestration, "unknown");

  const staleAt = new Date(Date.now() - 91_000).toISOString();
  const stale = await reader(async (input) => String(input).endsWith("runtime/capabilities")
    ? jsonResponse(capabilities({ checked_at: staleAt }))
    : jsonResponse({ object: "list", data: [connection()] })).read(provider);
  assert.equal(stale.checkedAt, staleAt);
  assert.deepEqual(stale.reported, { goals: null, cowork: null, managedChild: null });
  assert.equal(stale.toolOrchestration, "external");

  const malformedFeatures = await reader(async (input) => String(input).endsWith("runtime/capabilities")
    ? jsonResponse(capabilities({ features: { goals: "yes", cowork: false } }))
    : jsonResponse({ object: "list", data: [connection()] })).read(provider);
  assert.deepEqual(malformedFeatures.reported, { goals: null, cowork: false, managedChild: null });

  const futureAt = new Date(Date.now() + 60_000).toISOString();
  const future = await reader(async (input) => String(input).endsWith("runtime/capabilities")
    ? jsonResponse(capabilities({ checked_at: futureAt }))
    : jsonResponse({ object: "list", data: [connection()] })).read(provider);
  assert.equal(future.checkedAt, futureAt);
  assert.deepEqual(future.reported, { goals: null, cowork: null, managedChild: null });
});

test("evaluates freshness after each asynchronous response arrives", async () => {
  const result = await reader(async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return String(input).endsWith("runtime/capabilities")
      ? jsonResponse(capabilities({ checked_at: new Date().toISOString() }))
      : jsonResponse({ object: "list", data: [connection({ checked_at: new Date().toISOString() })] });
  }).read(provider);
  assert.deepEqual(result.reported, { goals: true, cowork: true, managedChild: true });
  assert.equal(result.providerConfigured, true);
  assert.equal(result.toolOrchestration, "external");
});

test("does not export malformed provider type identifiers", async () => {
  const privateType = "PRIVATE PROVIDER TYPE SECRET";
  const result = await reader(async (input) => String(input).endsWith("runtime/capabilities")
    ? jsonResponse(capabilities())
    : jsonResponse({ object: "list", data: [connection({ provider_type: privateType })] })).read(provider);
  assert.equal(result.providerType, null);
  assert.equal(result.toolOrchestration, "unknown");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE PROVIDER TYPE SECRET/);
});

test("rejects duplicate selected identities and caps provider connection lists", async () => {
  for (const data of [
    [connection(), connection()],
    Array.from({ length: 101 }, (_, index) => connection({ provider: `provider-${index}` })),
  ]) {
    const target = reader(async (input) => String(input).endsWith("runtime/capabilities")
      ? jsonResponse(capabilities())
      : jsonResponse({ object: "list", data }));
    await assert.rejects(target.read(provider), /Ambiguous|Invalid Demian provider connections/);
  }
});

test("rejects malformed, non-JSON, and oversized responses without exposing bodies", async () => {
  const malformed = reader(async (input) => String(input).endsWith("runtime/capabilities")
    ? jsonResponse({ object: "wrong", private_message: "PRIVATE_NATIVE_OUTPUT" })
    : jsonResponse({ object: "list", data: [] }));
  await assert.rejects(malformed.read(provider), (error: unknown) =>
    error instanceof Error && /Invalid Demian runtime capabilities/.test(error.message) &&
    !error.message.includes("PRIVATE_NATIVE_OUTPUT"));

  const nonJson = reader(async () => new Response("PRIVATE_NATIVE_OUTPUT", {
    headers: { "content-type": "text/plain" },
  }));
  await assert.rejects(nonJson.read(provider), /Expected Demian orchestration JSON/);

  const oversized = reader(async () => new Response("x".repeat(1_048_577), {
    headers: { "content-type": "application/json" },
  }));
  await assert.rejects(oversized.read(provider), /exceeds 1 MiB/);
});

async function withCredential(action: (tokenFile: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "demian-orchestration-"));
  try {
    const tokenFile = join(dir, "credential.json");
    await writeFile(tokenFile, JSON.stringify({ apiToken: secret }), "utf8");
    await action(tokenFile);
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("demian-orchestration-"));
    await rm(dir, { recursive: true, force: true });
  }
}

test("freshly reads service credentials and organization scope for each GET", async () => {
  await withCredential(async (tokenFile) => {
    let calls = 0;
    const target = reader(async (_input, init) => {
      calls++;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-demian-organization-id"), "organization-scope");
      if (calls === 1) {
        assert.equal(headers.get("authorization"), `Bearer ${secret}`);
        await writeFile(tokenFile, JSON.stringify({ apiToken: "ROTATED_TOKEN" }), "utf8");
        return jsonResponse(capabilities());
      }
      assert.equal(headers.get("authorization"), "Bearer ROTATED_TOKEN");
      return jsonResponse({ object: "list", data: [connection()] });
    }, { tokenFile, credentialFormat: "demian-service", organizationId: "organization-scope" });
    await target.read(provider);
    assert.equal(calls, 2);
  });
});

test("invalid credentials and transport errors do not leak credential or native text", async () => {
  await withCredential(async (tokenFile) => {
    await writeFile(tokenFile, "{broken", "utf8");
    const invalid = reader(async () => jsonResponse(capabilities()), {
      tokenFile,
      credentialFormat: "demian-service",
    });
    await assert.rejects(invalid.read(provider), (error: unknown) =>
      error instanceof Error && error.message === "Invalid source credential file" &&
      !error.message.includes(secret));
  });

  const brokenTransport = reader(async () => { throw new Error(`PRIVATE_NATIVE_OUTPUT ${secret}`); });
  await assert.rejects(brokenTransport.read(provider), (error: unknown) =>
    error instanceof Error && error.message === "Demian orchestration request failed" &&
    !error.message.includes(secret));

  const denied = reader(async () => new Response(secret, {
    status: 403,
    headers: { "content-type": "application/json" },
  }));
  await assert.rejects(denied.read(provider), (error: unknown) =>
    error instanceof SourceError && error.status === 403 && !error.message.includes(secret));
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { SourceError } from "../packages/adapters/demian/index.ts";
import {
  DemianAssignmentAccessChanged,
  DemianAssignmentExpired,
  DemianAssignmentRejected,
  DemianRunWriter,
  prepareRunInput,
} from "../packages/adapters/demian/assignment.ts";

const sessionId = "12345678-1234-4234-8234-123456789abc";
const workspaceId = "22345678-1234-4234-8234-123456789abc";
const requestId = "32345678-1234-4234-8234-123456789abc";
const runId = "42345678-1234-4234-8234-123456789abc";
const at = "2026-11-11T01:02:03.000Z";
const secret = "DO_NOT_LEAK_CREDENTIAL";

function session(overrides: Record<string, unknown> = {}) {
  return {
    object: "demian.session", id: sessionId, workspace_id: workspaceId, title: "Assignment",
    agent: "build", provider: "test", model: null, mode: "single-agent", permission_policy: "ask",
    active_run_id: null, archived_at: null, created_at: at, updated_at: at,
    private_binding: "MUST_NOT_ESCAPE", ...overrides,
  };
}

function run(text: string, overrides: Record<string, unknown> = {}) {
  return {
    object: "demian.run", id: runId, session_id: sessionId, status: "queued",
    input: [{ type: "input_text", text }], output_text: "PRIVATE_OUTPUT", usage: { private: true },
    error: { private: true }, created_at: at, started_at: null, completed_at: null,
    ...overrides,
  };
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status });
}

async function withCredential(action: (tokenFile: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "demian-assignment-"));
  try {
    const tokenFile = join(dir, "credential.json");
    await writeFile(tokenFile, JSON.stringify({ apiToken: secret }), "utf8");
    await action(tokenFile);
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("demian-assignment-"));
    await rm(dir, { recursive: true, force: true });
  }
}

test("prepareRunInput hashes canonical single-text input and enforces UTF-8 byte bounds", () => {
  const prepared = prepareRunInput("café 🧭");
  const canonical = JSON.stringify([{ type: "input_text", text: "café 🧭" }]);
  assert.equal(prepared.inputSha256, createHash("sha256").update(canonical, "utf8").digest("hex"));
  assert.equal(prepared.body, JSON.stringify({ input: [{ type: "input_text", text: "café 🧭" }] }));
  assert.throws(() => prepareRunInput(""), /nonempty/);
  assert.throws(() => prepareRunInput("é".repeat(4097)), /8192/);
  assert.doesNotThrow(() => prepareRunInput("é".repeat(4096)));
});

test("session returns only the allowlisted metadata", async () => {
  const writer = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async () => response(session()) });
  const result = await writer.session(sessionId);
  assert.deepEqual(result, {
    sessionId, workspaceId, title: "Assignment", agent: "build", provider: "test", model: null,
    mode: "single-agent", permissionPolicy: "ask", activeRunId: null, archived: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /MUST_NOT_ESCAPE|private_binding/);
});

test("bounded JSON reader rejects non-JSON and responses over 1 MiB", async () => {
  const nonJson = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async () =>
    new Response(JSON.stringify(session()), { headers: { "content-type": "text/plain" } }) });
  await assert.rejects(nonJson.session(sessionId), SourceError);
  const oversized = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async () =>
    new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      controller.close();
    } }), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(oversized.session(sessionId), SourceError);
});

test("JSONB-reordered input keys preserve acceptance and request lookup hashes", async () => {
  const text = "Round trip 🧭"; const stored = run(text, { input: [{ text, type: "input_text" }] });
  assert.deepEqual(Object.keys(stored.input[0]!), ["text", "type"]);
  const writer = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async (url) => {
    if (String(url).includes("/requests/")) return response({ object: "demian.run_request_status", request_id: requestId, status: "found", run: stored });
    return response(String(url).endsWith("/runs") ? stored : session());
  } });
  const accepted = await writer.start(sessionId, requestId, text, { expiresAt: "2999-01-01T00:00:00Z", refreshAuthorization: async () => {}, isAuthorized: () => true });
  assert.equal(accepted.inputSha256, prepareRunInput(text).inputSha256);
  assert.equal((await writer.lookup(sessionId, requestId, accepted.inputSha256))?.runId, runId);
});

test("start posts exact native idempotency header and only canonical input, returns redacted acceptance", async () => {
  await withCredential(async (tokenFile) => {
    const text = "Solve this safely 🧭";
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    let calls = 0;
    const writer = new DemianRunWriter({
      sourceId: "test", baseUrl: "https://demian.invalid/", tokenFile, credentialFormat: "demian-service",
      organizationId: "org-scope",
      fetch: async (input, init) => {
        calls++;
        seen.push({ url: String(input), ...(init ? { init } : {}) });
        if (calls === 1) return response(session());
        return response(run(text), 202);
      },
    });
    const receipt = await writer.start(sessionId, requestId, text, {
      expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => true,
    });
    assert.equal(seen[0]?.url, `https://demian.invalid/api/v1/sessions/${sessionId}`);
    assert.equal(seen[1]?.url, `https://demian.invalid/api/v1/sessions/${sessionId}/runs`);
    assert.equal(seen[1]?.init?.method, "POST");
    const headers = new Headers(seen[1]?.init?.headers);
    assert.equal(headers.get("Idempotency-Key"), requestId);
    assert.equal(headers.get("nativeIdempotency-Key"), null);
    assert.equal(headers.get("authorization"), `Bearer ${secret}`);
    assert.equal(headers.get("x-demian-organization-id"), "org-scope");
    assert.equal(seen[1]?.init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(seen[1]?.init?.body)), { input: [{ type: "input_text", text }] });
    assert.deepEqual(receipt, {
      runId, sessionId, status: "queued", inputSha256: prepareRunInput(text).inputSha256,
      createdAt: at, startedAt: null, completedAt: null,
    });
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_OUTPUT|usage|error|input_text|Solve this|DO_NOT_LEAK/);
  });
});

test("start rejects archived or active sessions without posting", async () => {
  for (const details of [session({ archived_at: at }), session({ active_run_id: runId })]) {
    let calls = 0;
    const writer = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async () => {
      calls++;
      return response(details);
    } });
    await assert.rejects(writer.start(sessionId, requestId, "task", {
      expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => true,
    }), DemianAssignmentRejected);
    assert.equal(calls, 1);
  }
});

test("lookup validates request identity and returns only an exact matching run or null", async () => {
  const text = "recover me";
  const expectedHash = prepareRunInput(text).inputSha256;
  const writer = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async (input) => {
    assert.equal(String(input), `https://demian.invalid/api/v1/sessions/${sessionId}/requests/${requestId}`);
    return response({ object: "demian.run_request_status", request_id: requestId, status: "found", run: run(text) });
  } });
  assert.equal((await writer.lookup(sessionId, requestId, expectedHash))?.runId, runId);
  const absent = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async () =>
    response({ object: "demian.run_request_status", request_id: requestId, status: "not_found", run: null }) });
  assert.equal(await absent.lookup(sessionId, requestId, expectedHash), null);
});

test("rejects invalid identifiers, malformed native payloads, wrong scope and mismatched input", async () => {
  const okSession = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async () => response(session()) });
  await assert.rejects(okSession.session("not-a-uuid"));
  const okRun = run("wanted");
  for (const malformed of [
    { ...okRun, object: "other" },
    { ...okRun, session_id: workspaceId },
    { ...okRun, input: [{ type: "input_text", text: "wanted" }, { type: "input_text", text: "extra" }] },
    { ...okRun, input: [{ type: "input_text", text: "different" }] },
    { ...okRun, created_at: "yesterday" },
  ]) {
    const writer = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async (input) =>
      String(input).endsWith("/runs") ? response(malformed) : response(session()) });
    await assert.rejects(writer.start(sessionId, requestId, "wanted", {
      expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => true,
    }), SourceError);
  }
  const badLookup = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async () =>
    response({ object: "demian.run_request_status", request_id: runId, status: "not_found", run: null }) });
  await assert.rejects(badLookup.lookup(sessionId, requestId, prepareRunInput("wanted").inputSha256), SourceError);
});

test("source 4xx, authoritative POST 4xx, and transport failures keep distinct typed errors", async () => {
  const sourceDenied = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async () => response({}, 403) });
  await assert.rejects(sourceDenied.session(sessionId), (error: unknown) => error instanceof SourceError && error.status === 403);
  const rejected = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async (input) =>
    String(input).endsWith("/runs") ? response({}, 422) : response(session()) });
  await assert.rejects(rejected.start(sessionId, requestId, "task", {
    expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => true,
  }), (error: unknown) => error instanceof DemianAssignmentRejected && error.status === 422);
  const timeout = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async (input) => {
    if (String(input).endsWith("/runs")) throw new Error(`transport included ${secret}`);
    return response(session());
  } });
  await assert.rejects(timeout.start(sessionId, requestId, "task", {
    expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => true,
  }), (error: unknown) => error instanceof SourceError && error.status === 502 && !error.message.includes(secret));
});

test("preflight session failures and missing POST credentials are definitive no-send outcomes", async () => {
  let timeoutCalls = 0;
  const timeout = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", fetch: async () => {
    timeoutCalls++;
    throw new Error("timeout");
  } });
  await assert.rejects(timeout.session(sessionId), SourceError);
  await assert.rejects(timeout.start(sessionId, requestId, "task", {
    expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => true,
  }), DemianAssignmentAccessChanged);
  assert.equal(timeoutCalls, 2);
  await withCredential(async (tokenFile) => {
    let calls = 0;
    const writer = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", tokenFile, fetch: async () => {
      calls++;
      await rm(tokenFile, { force: true });
      return response(session());
    } });
    await assert.rejects(writer.start(sessionId, requestId, "task", {
      expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => true,
    }), DemianAssignmentAccessChanged);
    assert.equal(calls, 1);
  });
});

test("deadline and authorization are checked after credential await directly before POST", async () => {
  await withCredential(async (tokenFile) => {
    let calls = 0;
    const writer = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", tokenFile, fetch: async () => {
      calls++;
      return response(session());
    } });
    await assert.rejects(writer.start(sessionId, requestId, "task", {
      expiresAt: "2000-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => true,
    }), DemianAssignmentExpired);
    assert.equal(calls, 1);
    await assert.rejects(writer.start(sessionId, requestId, "task", {
      expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => false,
    }), DemianAssignmentAccessChanged);
    assert.equal(calls, 2);
    await assert.rejects(writer.start(sessionId, requestId, "task", {
      expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => { throw new Error(secret); }, isAuthorized: () => true,
    }), (error: unknown) => error instanceof DemianAssignmentAccessChanged && !error.message.includes(secret));
    assert.equal(calls, 3);
  });
});

test("credential is freshly read for POST after source-session verification", async () => {
  await withCredential(async (tokenFile) => {
    let calls = 0;
    const writer = new DemianRunWriter({ sourceId: "test", baseUrl: "https://demian.invalid", tokenFile, fetch: async (_input, init) => {
      calls++;
      if (calls === 1) {
        await writeFile(tokenFile, "ROTATED_TOKEN", "utf8");
        return response(session());
      }
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ROTATED_TOKEN");
      return response(run("task"));
    } });
    await writer.start(sessionId, requestId, "task", {
      expiresAt: "2999-01-01T00:00:00.000Z", refreshAuthorization: async () => {}, isAuthorized: () => true,
    });
    assert.equal(calls, 2);
  });
});

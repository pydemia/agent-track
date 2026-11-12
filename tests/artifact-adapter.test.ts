import assert from "node:assert/strict";
import test from "node:test";
import { DemianClient } from "../packages/adapters/demian/index.ts";

const runId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const timestamp = "2026-11-11T01:02:03.000Z";

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, object: "demian.artifact", id: id(10),
    organization_id: id(20), workspace_id: id(21), session_id: sessionId,
    owner_user_id: id(22), run_id: runId, kind: "result", filename: "report.txt",
    media_type: "text/plain", size_bytes: 42, sha256: "a".repeat(64),
    representation: "original", source_artifact_id: null, source_sha256: null,
    created_at: timestamp, revoked_at: null,
    ...overrides,
  };
}

function clientWith(body: unknown, check: (input: RequestInfo | URL, init?: RequestInit) => void = () => {}) {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    check(input, init);
    return Response.json(body);
  };
  return new DemianClient({ sourceId: "native", baseUrl: "https://demian.example/", fetch });
}

test("artifacts reads only the authorized session list and returns allowlisted Run metadata", async () => {
  const data = [
    manifest({ owner_user_id: id(23), organization_id: id(24), workspace_id: id(25),
      content_base64: "RAW_CONTENT_SECRET", input_text: "PRIVATE_INPUT", output_text: "PRIVATE_OUTPUT",
      summary: "PRIVATE_SUMMARY", reference_uri: "https://private.example/" }),
    manifest({ id: id(11), run_id: null }),
    manifest({ id: id(12), run_id: id(99) }),
    manifest({ id: id(13), revoked_at: timestamp }),
  ];
  let calls = 0;
  const client = clientWith({ object: "list", data, limit: 100 }, (input, init) => {
    calls++;
    assert.equal(String(input), "https://demian.example/api/v1/sessions/00000000-0000-4000-8000-000000000002/artifacts");
    assert.equal(init?.method, undefined);
    assert.equal(new Headers(init?.headers).get("accept"), "application/json");
  });
  const result = await client.artifacts(runId, sessionId);
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    artifacts: [{ id: id(10), runId, sessionId, kind: "result", filename: "report.txt", mediaType: "text/plain",
      sizeBytes: 42, sha256: "a".repeat(64), representation: "original", createdAt: timestamp }],
    scanned: 4, limit: 100, complete: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /owner_user_id|organization_id|RAW_CONTENT|PRIVATE_|reference_uri|content_base64/);
});

test("artifacts scans a native 100-item page and always reports incomplete history", async () => {
  const data = Array.from({ length: 100 }, (_, index) => manifest({
    id: id(index + 100), run_id: index % 2 === 0 ? runId : null,
  }));
  const result = await clientWith({ object: "list", data, limit: 100 }).artifacts(runId, sessionId);
  assert.equal(result.scanned, 100);
  assert.equal(result.artifacts.length, 50);
  assert.equal(result.limit, 100);
  assert.equal(result.complete, false);
});

test("artifacts rejects mismatched sessions and malformed native metadata", async () => {
  await assert.rejects(
    () => clientWith({ object: "list", data: [manifest({ session_id: id(77) })], limit: 100 }).artifacts(runId, sessionId),
    /session identity mismatch/,
  );
  for (const malformed of [
    manifest({ filename: "../private.txt" }),
    manifest({ media_type: "not a media type" }),
    manifest({ size_bytes: -1 }),
    manifest({ sha256: "not-a-digest" }),
    manifest({ representation: "unknown" }),
    manifest({ created_at: "yesterday" }),
    manifest({ owner_user_id: "not-a-uuid" }),
  ]) {
    await assert.rejects(() => clientWith({ object: "list", data: [malformed], limit: 100 }).artifacts(runId, sessionId));
  }
  await assert.rejects(() => clientWith({ object: "list", data: [], limit: 99 }).artifacts(runId, sessionId));
  await assert.rejects(() => clientWith({ object: "list", data: Array(101).fill(manifest()), limit: 100 }).artifacts(runId, sessionId));
});

test("artifacts preserves attachment semantics and rejects duplicate native identities", async () => {
  const result = await clientWith({ object: "list", data: [manifest({ kind: "attachment" })], limit: 100 }).artifacts(runId, sessionId);
  assert.equal(result.artifacts[0]!.kind, "attachment");
  for (const duplicate of [manifest(), manifest({ id: id(10).toUpperCase() })]) {
    await assert.rejects(clientWith({ object: "list", data: [manifest(), duplicate], limit: 100 }).artifacts(runId, sessionId), /Duplicate native artifact identity/);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { fetchArtifactEvidence } from "../apps/web/src/artifact-client.ts";
import { PrivateReadError } from "../apps/web/src/private-json.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date().toISOString(), run = { key: "run-key", runId: id(1), sessionId: id(2) };
const payload = () => ({ state: "connected", runKey: run.key, observedAt: at, detail: "Recent metadata", artifacts: [{ id: id(3),
  runId: run.runId, sessionId: run.sessionId, kind: "attachment", filename: "reference.txt", mediaType: "text/plain", sizeBytes: 4,
  sha256: "a".repeat(64), representation: "reference", createdAt: at }], scanned: 1, limit: 100, complete: false });
const load = (data: unknown) => fetchArtifactEvidence(run, new AbortController().signal, (async () => Response.json(data)) as typeof fetch);

test("artifact browser uses only same-origin metadata GET and validates exact Run and Session", async () => {
  let path = "", options: RequestInit | undefined;
  const value = await fetchArtifactEvidence(run, new AbortController().signal, (async (url, init) => {
    path = String(url); options = init; return Response.json(payload());
  }) as typeof fetch);
  assert.equal(value.artifacts[0]!.kind, "attachment"); assert.equal(path, "/api/runs/run-key/artifacts");
  assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error");
  assert.equal(options?.body, undefined); assert.equal(options?.headers, undefined);
  for (const patch of [{ runKey: "foreign" }, { extra: "PRIVATE_BODY" }, { complete: true }, { state: "forbidden" },
    { artifacts: [{ ...payload().artifacts[0], runId: id(9) }] }, { artifacts: [{ ...payload().artifacts[0], sessionId: id(9) }] },
    { artifacts: [{ ...payload().artifacts[0], body: "PRIVATE_BODY" }] }, { artifacts: [payload().artifacts[0], payload().artifacts[0]] }]) {
    await assert.rejects(load({ ...payload(), ...patch }), error => {
      assert(error instanceof PrivateReadError); assert.equal(error.kind, "failure"); assert.doesNotMatch(error.message, /PRIVATE_BODY|foreign/); return true;
    });
  }
});

test("artifact browser rejects private path injection before fetch and separates expiry from native denial", async () => {
  let calls = 0; const fetcher = (async () => { calls++; return Response.json(payload()); }) as typeof fetch;
  for (const key of ["//external", "a/b", "a?query", "x\n"]) await assert.rejects(fetchArtifactEvidence({ ...run, key }, new AbortController().signal, fetcher));
  assert.equal(calls, 0);
  for (const status of [401, 403, 404]) await assert.rejects(fetchArtifactEvidence(run, new AbortController().signal,
    (async () => new Response("PRIVATE_BODY", { status })) as typeof fetch), error => {
    assert(error instanceof PrivateReadError); assert.equal(error.kind, status === 401 ? "unauthorized" : "unavailable");
    assert.doesNotMatch(error.message, /PRIVATE_BODY/); return true;
  });
  const denied = await load({ ...payload(), state: "forbidden", artifacts: [], scanned: 0 }); assert.deepEqual(denied.artifacts, []);
});

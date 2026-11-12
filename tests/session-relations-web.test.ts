import assert from "node:assert/strict";
import test from "node:test";
import { fetchSessionRelations } from "../apps/web/src/session-relations-client.ts";
import { PrivateReadError } from "../apps/web/src/private-json.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const run = { key: "run-key", sourceId: "native", sessionId: id(1) };
function data() { return { ...run, runKey: run.key, kind: "managed-children", state: "connected", relations: [{ kind: "managed-child",
  sessionId: id(1), runId: id(2), operationId: id(3), parentInvocationId: "parent", childInvocationId: "child", status: "running" }],
  nextCursor: null, hasMore: false, omitted: 0, coverage: "managed-child-receipts", observedAt: new Date().toISOString(), detail: "Window" }; }
const payload = () => { const { key: _key, ...rest } = data(); return rest; };
test("relation browser request keeps encrypted continuation opaque and validates exact Run/source/session/kind", async () => {
  let path = ""; let options: RequestInit | undefined;
  const fetcher = (async (url, init) => { path = String(url); options = init; return Response.json(payload()); }) as typeof fetch;
  const value = await fetchSessionRelations(run, "managed-children", "A".repeat(60), new AbortController().signal, fetcher);
  assert.equal(value.relations.length, 1); assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "same-origin");
  assert.equal(options?.headers, undefined); assert.equal(options?.body, undefined); assert.equal(options?.redirect, "error");
  assert.equal(path, "/api/runs/run-key/session-relations?kind=managed-children&cursor=" + "A".repeat(60));
  for (const patch of [{ runKey: "other" }, { sourceId: "other" }, { sessionId: id(4) }, { kind: "peer-processing" },
    { output: "PRIVATE_BODY" }, { nextCursor: "7", hasMore: true }, { state: "forbidden" }, { relations: [payload().relations[0], payload().relations[0]] }]) {
    await assert.rejects(fetchSessionRelations(run, "managed-children", null, new AbortController().signal,
      (async () => Response.json({ ...payload(), ...patch })) as typeof fetch), error => {
        assert(error instanceof PrivateReadError); assert.equal(error.kind, "failure"); assert.doesNotMatch(error.message, /PRIVATE_BODY|other/); return true;
      });
  }
});
test("invalid relation routes and raw UUID/SSE cursors do not reach transport", async () => {
  let calls = 0; const fetcher = (async () => { calls++; return Response.json(payload()); }) as typeof fetch;
  for (const key of ["//outside", "a/b", "x\n"]) await assert.rejects(fetchSessionRelations({ ...run, key }, "managed-children", null, new AbortController().signal, fetcher));
  for (const cursor of ["7", id(4), "x?private"]) await assert.rejects(fetchSessionRelations(run, "managed-children", cursor, new AbortController().signal, fetcher));
  assert.equal(calls, 0);
});
test("unconfigured registry is retained as unavailable coverage without any private relations", async () => {
  const value = { ...payload(), kind: "peer-processing", coverage: "peer-processing-receipts", state: "unconfigured", relations: [] };
  const result = await fetchSessionRelations(run, "peer-processing", null, new AbortController().signal, (async () => Response.json(value)) as typeof fetch);
  assert.equal(result.state, "unconfigured"); assert.deepEqual(result.relations, []);
});

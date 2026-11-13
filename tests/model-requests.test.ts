import assert from "node:assert/strict";
import test from "node:test";
import { projectModelRequests } from "../packages/adapters/demian/model-requests.ts";
import { DemianClient, normalizeEvent } from "../packages/adapters/demian/index.ts";

const runId = "00000000-0000-4000-8000-000000000001", at = "2026-11-13T06:00:00Z";
const event = (sequence: number, type: string, extra: object = {}) => ({ api_version: "2026-09-01", run_id: runId,
  sequence_text: String(sequence), created_at: at, type, data: { sessionId: "PRIVATE_NATIVE_SESSION", provider: "codex", model: "gpt-6-astra", ...extra } });
const project = (rows: ReturnType<typeof event>[]) => projectModelRequests(rows, runId, rows.map(row => row.sequence_text));

test("source model lifecycle preserves exact sequence/duration without leaking provider payload or native identity", () => {
  const rows = [event(1, "model.request", { prompt: "PRIVATE_PROMPT", tokens: "PRIVATE_TOKEN" }),
    event(2, "model.request.completed", { durationMs: 4233, response: "PRIVATE_OUTPUT" })];
  const result = project(rows), call = result.modelRequests[0]!;
  assert.equal(call.phase, "ended"); assert.equal(call.reportedDurationMs, 4233); assert.deepEqual(call.sequences, ["1", "2"]);
  assert.equal(call.provider, "codex"); assert.equal(call.model, "gpt-6-astra"); assert.match(call.contextKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|prompt|response|tokens|sessionId/);
  assert.equal(project([rows[0]!, rows[0]!, rows[1]!]).modelRequests.length, 1);
});

test("overlapping requests in a context never invent a matching end or per-call duration", () => {
  const result = project([event(1, "model.request"), event(2, "model.request"), event(3, "model.request.completed", { durationMs: 10 }), event(4, "model.request.completed", { durationMs: 20 })]);
  assert.equal(result.modelRequests.length, 2);
  for (const call of result.modelRequests) { assert.equal(call.phase, "ambiguous"); assert.equal(call.ended, null); assert.equal(call.reportedDurationMs, undefined); assert.deepEqual(call.sequences, [call.id]); }
});

test("independent native contexts pair through overlapping sequence ranges without parent guessing", () => {
  const result = project([event(1, "model.request"), event(2, "model.request", { sessionId: "other" }),
    event(3, "model.request.completed", { durationMs: 10 }), event(4, "model.request.completed", { sessionId: "other", durationMs: 20 })]);
  assert.deepEqual(result.modelRequests.map(call => call.sequences), [["1", "3"], ["2", "4"]]);
  assert(result.modelRequests.every(call => call.phase === "ended" && call.invocationId === null));
});

test("journal gaps, conflicting sequence variants and missing starts stay explicit", () => {
  assert.equal(project([event(1, "model.request"), event(3, "model.request.completed")]).modelRequests[0]?.phase, "ambiguous");
  const conflict = project([event(1, "model.request"), event(1, "model.request", { model: "other" }), event(2, "model.request.completed")]);
  assert.equal(conflict.unidentifiedModelEvents, 1); assert.equal(conflict.modelRequests[0]?.phase, "end-only");
  assert.equal(project([event(1, "model.request.completed")]).modelRequests[0]?.started, null);
  assert.equal(project([event(1, "model.request")]).modelRequests[0]?.phase, "started");
  assert.equal(project([event(1, "model.request", { provider: "https://private.example/?secret=value" })]).unidentifiedModelEvents, 1);
  assert.equal(project([event(1, "model.request", { invocationId: "one", invocation_id: "two" })]).unidentifiedModelEvents, 1);
});

test("foreign Run, mismatched SSE IDs and invalid clocks fail at source boundary", () => {
  assert.throws(() => projectModelRequests([{ ...event(1, "model.request"), run_id: "other" }], runId, ["1"]));
  assert.throws(() => projectModelRequests([event(1, "model.request")], runId, ["2"]));
  assert.throws(() => projectModelRequests([{ ...event(1, "model.request"), created_at: "yesterday" }], runId, ["1"]));
});

test("unidentifiable or conflicting interior model events prevent assigning a plausible end to a start", () => {
  for (const interior of [[event(2, "model.request", { sessionId: null })],
    [event(2, "model.request"), event(2, "model.request", { model: "other" })]]) {
    const result = project([event(1, "model.request"), ...interior, event(3, "model.request.completed", { durationMs: 200 })]);
    assert.equal(result.unidentifiedModelEvents, 1);
    assert.equal(result.modelRequests[0]?.phase, "ambiguous");
    assert.equal(result.modelRequests[0]?.ended, null);
    assert.equal(result.modelRequests[0]?.reportedDurationMs, undefined);
  }
});

test("one existing bounded SSE read supplies both tool and model metadata while normalized model events remain unchanged", async () => {
  const rows = [event(1, "model.request"), event(2, "model.request.completed", { durationMs: 4233 })];
  let reads = 0;
  const client = new DemianClient({ sourceId: "source", baseUrl: "http://native.test", fetch: async () => {
    reads++; return new Response(rows.map(row => `id: ${row.sequence_text}\ndata: ${JSON.stringify(row)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  } });
  const page = await client.toolEvidence(runId, "2", true);
  assert.equal(reads, 1); assert.equal(page.complete, true); assert.equal(page.modelRequestCoverage, "native-model-lifecycle");
  assert.equal(page.modelRequests?.length, 1); assert.deepEqual(page.calls, []);
  assert.deepEqual(normalizeEvent("source", rows[0]).data, { redacted: true });
  const legacy = await client.toolEvidence(runId, "2");
  assert.equal(legacy.modelRequestCoverage, undefined);assert.equal(legacy.modelRequests, undefined);
  assert.equal(legacy.complete, true);
});

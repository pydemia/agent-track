import assert from "node:assert/strict";
import { test } from "node:test";
import { DemianClient } from "../packages/adapters/demian/index.ts";

const runId = "00000000-0000-4000-8000-000000000001";
const otherRunId = "00000000-0000-4000-8000-000000000002";
const now = "2026-11-12T09:00:00.000Z";
const frame = (sequence: number | string, type: string, data: object = {}, target = runId) =>
  `id: ${sequence}\ndata: ${JSON.stringify({ api_version: "2026-09-01", run_id: target, sequence_text: String(sequence), type, created_at: now, data })}\n\n`;
function client(text: string, onFetch?: (input: RequestInfo | URL, init?: RequestInit) => void) {
  return new DemianClient({ sourceId: "native", baseUrl: "http://native.test", fetch: async (input, init) => {
    onFetch?.(input, init);
    return new Response(text, { headers: { "content-type": "text/event-stream" } });
  } });
}

test("projects requested, actual start and end separately without retaining raw payloads", async () => {
  let requested: RequestInfo | URL | undefined;
  const source = client(
    frame(1, "tool.requested", { callId: "call-a", invocationId: "inv-a", name: "shell", input: "PRIVATE_INPUT" }) +
    frame(2, "tool.started", { call_id: "call-a", invocation_id: "inv-a", tool: "shell", command: "PRIVATE_COMMAND" }) +
    frame(3, "tool.completed", { callId: "call-a", invocationId: "inv-a", tool: "shell", ok: true, output: "PRIVATE_OUTPUT" }),
    (input) => { requested = input; },
  );
  const page = await source.toolEvidence(runId, "3");
  assert.equal(String(requested), `http://native.test/api/v1/runs/${runId}/events?after=0`);
  assert.equal(page.complete, true);
  assert.equal(page.throughSequence, "3");
  assert.equal(page.calls.length, 1);
  assert.deepEqual(page.calls[0], {
    invocationId: "inv-a", callId: "call-a", tool: "shell",
    requested: [{ type: "tool.requested", sequence: "1", occurredAt: now }],
    started: [{ type: "tool.started", sequence: "2", occurredAt: now }],
    ended: [{ type: "tool.completed", sequence: "3", occurredAt: now, ok: true }],
    outcome: "succeeded",
  });
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|input|output|command|preview|executor/);
});

test("distinguishes failed completion from missing completion outcome", async () => {
  const page = await client(
    frame(1, "tool.requested", { callId: "false", name: "read" }) +
    frame(2, "tool.completed", { callId: "false", name: "read", ok: false, preview: "PRIVATE" }) +
    frame(3, "tool.requested", { callId: "unknown", name: "read" }) +
    frame(4, "tool.completed", { callId: "unknown", name: "read", preview: "PRIVATE" }),
  ).toolEvidence(runId, "4");
  assert.equal(page.calls.find((call) => call.callId === "false")?.outcome, "failed");
  assert.equal(page.calls.find((call) => call.callId === "unknown")?.outcome, "unknown");
});

test("keeps event/run scope and partial journal coverage explicit", async () => {
  const gap = await client(frame(1, "tool.started", { callId: "call" }) + frame(3, "tool.completed", { callId: "call", ok: true }))
    .toolEvidence(runId, "3");
  assert.equal(gap.gaps, true);
  assert.equal(gap.targetReached, false);
  assert.equal(gap.complete, false);
  const partialSuccess = await client(
    frame(1, "tool.completed", { callId: "partial", name: "read", ok: true }),
  ).toolEvidence(runId, "3");
  assert.equal(partialSuccess.calls[0]?.ended[0]?.ok, true);
  assert.equal(partialSuccess.calls[0]?.outcome, "unknown");
  assert.equal(partialSuccess.complete, false);
  await assert.rejects(client(frame(1, "tool.started", { callId: "call" }, otherRunId)).toolEvidence(runId, "1"));
  let calls = 0;
  const empty = await client("", () => { calls++; }).toolEvidence(runId, "0");
  assert.equal(empty.complete, true);
  assert.equal(calls, 0);
});

test("preserves duplicate events and marks duplicate or conflicting identity evidence ambiguous", async () => {
  const page = await client(
    frame(1, "tool.requested", { callId: "duplicate", invocationId: "inv", name: "read" }) +
    frame(2, "tool.started", { callId: "duplicate", invocationId: "inv", name: "read" }) +
    frame(3, "tool.started", { callId: "duplicate", invocationId: "inv", name: "read" }) +
    frame(4, "tool.completed", { callId: "duplicate", invocationId: "inv", name: "read", ok: true }) +
    frame(5, "tool.requested", { callId: "conflict", call_id: "other", name: "shell" }) +
    frame(6, "tool.started", { callId: "same-sequence", name: "one" }) +
    frame(6, "tool.failed", { callId: "same-sequence", name: "one" }) + frame(7, "response.created"),
  ).toolEvidence(runId, "7");
  assert.equal(page.calls.find((call) => call.callId === "duplicate")?.started.length, 2);
  assert.equal(page.calls.find((call) => call.callId === "duplicate")?.outcome, "ambiguous");
  assert.deepEqual(page.calls.filter((call) => call.callId === "conflict" || call.callId === "other").map((call) => call.outcome), ["ambiguous", "ambiguous"]);
  assert.equal(page.unidentifiedEvents, 0);
  assert.equal(page.calls.find((call) => call.callId === "same-sequence")?.outcome, "ambiguous");
});

test("caps emitted calls and marks omissions incomplete", async () => {
  const text = Array.from({ length: 501 }, (_, index) => frame(index + 1, "tool.requested", { callId: `call-${index}`, name: "read" })).join("");
  const page = await client(text).toolEvidence(runId, "501");
  assert.equal(page.calls.length, 500);
  assert.equal(page.omittedCalls, 1);
  assert.equal(page.complete, false);
});

test("reaching the target cannot hide unidentifiable tool events behind a complete empty call list", async () => {
  const page = await client(frame(1, "tool.started", { name: "read" })).toolEvidence(runId, "1");
  assert.equal(page.targetReached, true); assert.equal(page.unidentifiedEvents, 1);
  assert.equal(page.calls.length, 0); assert.equal(page.complete, false);
});

test("event and transport byte limits return incomplete pages", async () => {
  const tooMany = Array.from({ length: 2001 }, (_, index) => frame(index + 1, "response.created")).join("");
  const eventLimited = await client(tooMany).toolEvidence(runId, "2001");
  assert.equal(eventLimited.scanned, 2000);
  assert.equal(eventLimited.truncated, true);
  assert.equal(eventLimited.complete, false);
  const byteLimited = await client("x".repeat(8_388_609)).toolEvidence(runId, "1");
  assert.equal(byteLimited.scanned, 0);
  assert.equal(byteLimited.truncated, true);
  assert.equal(byteLimited.complete, false);
});

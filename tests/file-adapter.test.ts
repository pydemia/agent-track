import assert from "node:assert/strict";
import { test } from "node:test";
import { DemianClient } from "../packages/adapters/demian/index.ts";

const runId = "00000000-0000-4000-8000-000000000001";
const now = new Date().toISOString();
const frame = (sequence: number | string, type: string, data: object = {}, target = runId) => `id: ${sequence}\ndata: ${JSON.stringify({ api_version: "2026-09-01", run_id: target, sequence_text: String(sequence), type, created_at: now, data })}\n\n`;
const requested = (callId: string, paths = ["qa.txt"]) => ({ executor: "codex-app-server", name: "fileChange", callId,
  input: { changes: paths.map((path) => ({ path, kind: { type: "add" }, diff: "PRIVATE_PATCH" })) } });
const completed = (callId: string) => ({ executor: "codex-app-server", name: "fileChange", callId, ok: true, preview: "PRIVATE_PREVIEW" });
function client(text: string, onFetch?: (input: RequestInfo | URL) => void) {
  return new DemianClient({ sourceId: "native", baseUrl: "http://native.test", fetch: async (input) => { onFetch?.(input); return new Response(text, { headers: { "content-type": "text/event-stream" } }); } });
}

test("file evidence stops at the authorized journal high water and keeps only paired metadata", async () => {
  let calls = 0;
  const source = client(frame(1, "response.created") + frame(2, "tool.requested", requested("call")) + frame(3, "tool.completed", completed("call")) + "id: 4\ndata: INVALID_PRIVATE_JSON\n\n", (input) => {
    calls++; assert.equal(String(input), `http://native.test/api/v1/runs/${runId}/events?after=0`);
  });
  const result = await source.fileChanges(runId, "3");
  assert.equal(result.complete, true); assert.equal(result.scanned, 3); assert.equal(result.throughSequence, "3");
  assert.equal(result.changes.length, 1); assert.equal(result.changes[0]!.state, "reported"); assert.equal(result.changes[0]!.path, "qa.txt");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|input|preview|diffContent|threadId/); assert.equal(calls, 1);
  assert.equal((await source.fileChanges(runId, "0")).scanned, 0); assert.equal(calls, 1, "unobserved Runs must not trigger an open-ended replay");
});

test("missing sequences and premature termination remain incomplete rather than complete empty histories", async () => {
  const gap = await client(frame(1, "tool.requested", requested("call")) + frame(3, "tool.completed", completed("call"))).fileChanges(runId, "3");
  assert.equal(gap.complete, false); assert.equal(gap.throughSequence, "3");
  const ended = await client(frame(1, "response.created")).fileChanges(runId, "3"); assert.equal(ended.complete, false);
  await assert.rejects(client(frame(1, "response.created", {}, "00000000-0000-4000-8000-000000000002")).fileChanges(runId, "1"));
});

test("native file replay bounds event count, transport bytes and displayed metadata rows", async () => {
  const many = await client(Array.from({ length: 2001 }, (_, i) => frame(i + 1, "response.created")).join("")).fileChanges(runId, "2001");
  assert.equal(many.scanned, 2000); assert.equal(many.complete, false);
  const oversized = await client("x".repeat(8_388_609)).fileChanges(runId, "1"); assert.equal(oversized.complete, false); assert.equal(oversized.scanned, 0);
  const chunks: string[] = [];
  for (let i = 0; i < 6; i++) {
    chunks.push(frame(i * 2 + 1, "tool.requested", requested(`call${i}`, Array.from({ length: 100 }, (_, n) => `file-${i}-${n}.txt`))));
    chunks.push(frame(i * 2 + 2, "tool.completed", completed(`call${i}`)));
  }
  const rows = await client(chunks.join("")).fileChanges(runId, "12");
  assert.equal(rows.changes.length, 500); assert.equal(rows.omittedChanges, 100); assert.equal(rows.complete, false);
});

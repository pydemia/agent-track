import assert from "node:assert/strict";
import { test } from "node:test";
import { DemianClient } from "../packages/adapters/demian/index.ts";

const runId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const row = (sequence: string, phase = "tool_started") => ({ sequence, attempt: 1,
  executor: "codex-app-server", provider: "codex-native", phase,
  native_thread_id: "thread-1", native_turn_id: "turn-1", native_item_id: "item-1",
  invocation_id: "invocation-1" });
const payload = (observations: unknown[], next_cursor: string, has_more = false, run_id = runId) => ({
  run_id, session_id: sessionId, observations, next_cursor, has_more,
});
function client(value: unknown, options: { body?: BodyInit; onUrl?: (url: string) => void } = {}) {
  return new DemianClient({ sourceId: "native", baseUrl: "http://native.test", fetch: async (input) => {
    const url = String(input); options.onUrl?.(url);
    return new Response(options.body ?? JSON.stringify(value), { headers: { "content-type": "application/json" } });
  } });
}

test("lineage uses its fixed paged route and returns only bounded UI metadata", async () => {
  let requested = "";
  const result = await client({ ...payload([{
    ...row("7"), prompt: "PRIVATE_PROMPT", input: { secret: "PRIVATE_ARGS" }, raw_message: "PRIVATE_MESSAGE",
    parent_invocation_id: "invented-source-extra",
  }], "7"), messages: [{ id: "message-secret", sequence: "9", body: "PRIVATE_MESSAGE" }] }, {
    onUrl: (url) => { requested = url; },
  }).lineage(runId, "0", 250);
  assert.equal(requested, `http://native.test/api/v1/runs/${runId}/lineage?after=0&limit=250`);
  assert.equal(result.sessionId, sessionId);
  assert.equal(result.nextCursor, "7");
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0]?.sequence, "7");
  assert.equal(result.observations[0]?.invocationId, "invocation-1");
  assert.equal(result.observations[0]?.parentInvocationId, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|message-secret|parentInvocationId/);
});

test("lineage validates route inputs, IDs, rows, exact cursor and ordering while allowing sequence gaps", async () => {
  await assert.rejects(client(payload([], "0")).lineage("not-a-uuid"));
  await assert.rejects(client(payload([], "0")).lineage(runId, "01"));
  await assert.rejects(client(payload([], "0")).lineage(runId, "9223372036854775808"));
  await assert.rejects(client(payload([], "0")).lineage(runId, "0", 251));
  await assert.rejects(client(payload([row("1")], "1", false, sessionId)).lineage(runId));
  await assert.rejects(client(payload([{ ...row("1"), attempt: 0 }], "1")).lineage(runId));
  await assert.rejects(client(payload([row("3"), row("3")], "3")).lineage(runId));
  await assert.rejects(client(payload([row("3"), row("2")], "2")).lineage(runId));
  await assert.rejects(client(payload([row("4")], "5")).lineage(runId));
  await assert.rejects(client(payload([], "1", true)).lineage(runId));
  const valid = await client(payload([row("3"), row("8", "tool_completed")], "8")).lineage(runId);
  assert.deepEqual(valid.observations.map((item) => item.sequence), ["3", "8"]);
});

test("lineage rejects oversized and non-JSON source responses", async () => {
  await assert.rejects(client(null, { body: " ".repeat(1_048_577) }).lineage(runId), /1 MiB/);
  const nonJson = new DemianClient({ sourceId: "native", baseUrl: "http://native.test",
    fetch: async () => new Response("{}", { headers: { "content-type": "text/plain" } }) });
  await assert.rejects(nonJson.lineage(runId), /JSON/);
});

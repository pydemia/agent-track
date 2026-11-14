import assert from "node:assert/strict";
import { test } from "node:test";
import { readCoordinatorCommands, readCoordinatorCommand, writeCoordinatorCommand, mergeCoordinatorCommands } from "../apps/web/src/coordinator-command-client.ts";
import type { CoordinatorReceipt } from "../packages/contracts/coordinator-commands.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const runKey = "synthetic-run", at = "2026-11-14T00:00:00.000Z";
const receipt: CoordinatorReceipt = { id: id(1), runKey, kind: "retry", expiresAt: "2026-11-14T00:01:00.000Z",
  state: "prepared", detail: "review_ready", coordinatorReceipt: null, createdAt: at, updatedAt: at };
const available = { runKey, state: "available", availableKinds: ["retry"], detail: "ready" };
const signal = () => new AbortController().signal;
const transport = (value: unknown): typeof fetch => async () => Response.json(value);

test("browser reads only closed, current-Run coordinator DTOs and exact request IDs", async () => {
  assert.equal((await readCoordinatorCommands(runKey, signal(), transport({ availability: available, receipts: [receipt], hasMore: false }))).receipts.length, 1);
  for (const page of [
    { availability: { ...available, runKey: "foreign" }, receipts: [receipt], hasMore: false },
    { availability: available, receipts: [{ ...receipt, runKey: "foreign" }], hasMore: false },
    { availability: available, receipts: [{ ...receipt, state: "accepted" }], hasMore: false },
    { availability: available, receipts: [{ ...receipt, authority: "private" }], hasMore: false },
  ]) await assert.rejects(readCoordinatorCommands(runKey, signal(), transport(page)));
  await assert.rejects(readCoordinatorCommand(runKey, id(2), signal(), transport({ receipt })));
});

test("browser review and confirmation each send one explicit POST; acknowledgement must match the reviewed identity", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(options?.method, "POST"); assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error");
    calls.push({ url: String(url), body: JSON.parse(String(options?.body)) }); return Response.json({ receipt });
  };
  const input = { id: receipt.id, runKey, kind: "retry" as const, expiresAt: receipt.expiresAt };
  await writeCoordinatorCommand(runKey, "review", input, signal(), fetcher);
  await writeCoordinatorCommand(runKey, "dispatch", receipt.id, signal(), fetcher);
  assert.deepEqual(calls.map(call => call.body), [input, {}]);
  assert.ok(calls[0]!.url.endsWith("/reviews")); assert.ok(calls[1]!.url.endsWith(`/${receipt.id}/dispatch`));
  await assert.rejects(writeCoordinatorCommand(runKey, "review", input, signal(), transport({ receipt: { ...receipt, kind: "resume" } })));
});

test("browser never retries an ambiguous POST and same-ID recovery is GET only", async () => {
  let posts = 0, gets = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    if (options?.method === "POST") { posts++; throw new Error("Lost response"); }
    gets++; return Response.json({ receipt });
  };
  await assert.rejects(writeCoordinatorCommand(runKey, "dispatch", receipt.id, signal(), fetcher));
  assert.equal(posts, 1); await readCoordinatorCommand(runKey, receipt.id, signal(), fetcher);
  assert.equal(posts, 1); assert.equal(gets, 1);
});

test("browser retains saved intent against stale states and drops records outside the authorized window", () => {
  const saved: CoordinatorReceipt = { ...receipt, state: "intent_saved", detail: "intent_saved", coordinatorReceipt: { version: 1,
    command: { operationId: receipt.id, executionId: id(2), roleId: id(3), kind: "retry", attempt: 2, intentState: "saved", createdAt: at } } };
  assert.deepEqual(mergeCoordinatorCommands([saved], [receipt]), [saved]);
  assert.deepEqual(mergeCoordinatorCommands([saved], []), []);
});

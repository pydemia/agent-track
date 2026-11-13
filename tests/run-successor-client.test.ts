import assert from "node:assert/strict";
import { test } from "node:test";
import { externalKey } from "../packages/contracts/index.ts";
import type { SuccessorReceipt } from "../packages/contracts/run-successors.ts";
import { mergeSuccessors, readSuccessor, readSuccessors, selectSuccessorKind, successorRunKey, writeSuccessor } from "../apps/web/src/run-successor-client.ts";
import { PrivateReadError } from "../apps/web/src/private-json.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = externalKey("native", id(1)), at = "2026-11-14T00:00:00.000Z", expiry = "2026-11-14T00:01:00.000Z";
const receipt = (): SuccessorReceipt => ({ id: id(3), runKey: key, sourceId: "native", runId: id(1), sessionId: id(2), kind: "retry",
  sourceStatus: "failed", expectedCursor: "1", state: "prepared", detail: "review_ready", expiresAt: expiry, createdAt: at, updatedAt: at,
  newRunId: null, relation: null, observationState: null });
const panel = () => ({ availability: { state: "available", runKey: key, availableKinds: ["retry", "continue"], detail: "ready" },
  receipts: [receipt()], hasMore: false });

test("browser successor client preserves exact Run/command routes and sends only the reviewed request", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ path: String(url), method: options?.method ?? "GET", body: options?.body ? JSON.parse(String(options.body)) : null });
    return Response.json(String(url).endsWith("/successor-commands") ? panel() : { receipt: receipt() });
  };
  const signal = new AbortController().signal;
  await readSuccessors(key, signal, fetcher); await readSuccessor(key, id(3), signal, fetcher);
  await writeSuccessor(key, "review", { id: id(3), runKey: key, kind: "retry", expiresAt: expiry }, signal, fetcher);
  await writeSuccessor(key, "dispatch", id(3), signal, fetcher);
  assert.deepEqual(calls.map(call => call.method), ["GET", "GET", "POST", "POST"]);
  assert.equal(calls[2]!.path, `/api/runs/${key}/successor-commands/reviews`);
  assert.deepEqual(calls[3]!.body, {});
  assert.equal(calls[3]!.path, `/api/runs/${key}/successor-commands/${id(3)}/dispatch`);
  assert.equal(successorRunKey("native", id(1)), key);
});

test("receipt and page validation rejects private fields, duplicate IDs and wrong Run tuples", async () => {
  const signal = new AbortController().signal;
  for (const value of [
    { ...panel(), authority: "PRIVATE" }, { ...panel(), receipts: [receipt(), receipt()] },
    { ...panel(), receipts: [{ ...receipt(), sourceId: "another" }] },
    { ...panel(), receipts: [{ ...receipt(), private_json: "PRIVATE" }] },
    { ...panel(), availability: { ...panel().availability, availableKinds: ["retry", "retry"] } },
    { ...panel(), receipts: [{ ...receipt(), runKey: "another" }] },
  ]) await assert.rejects(readSuccessors(key, signal, async () => Response.json(value)), error => error instanceof PrivateReadError && error.kind === "failure");
  await assert.rejects(readSuccessor(key, id(3), signal, async () => Response.json({ receipt: { ...receipt(), id: id(99) } })));
});

test("lost POST response is never automatically resent; exact receipt recovery is a GET", async () => {
  let posts = 0, gets = 0;
  const signal = new AbortController().signal;
  const fetcher: typeof fetch = async (_url, options) => {
    if (options?.method === "POST") { posts++; throw new Error("ACK lost PRIVATE_ERROR"); }
    gets++; return Response.json({ receipt: { ...receipt(), state: "unknown", detail: "outcome_unknown" } });
  };
  await assert.rejects(writeSuccessor(key, "dispatch", id(3), signal, fetcher));
  assert.equal(posts, 1); assert.equal((await readSuccessor(key, id(3), signal, fetcher)).state, "unknown");
  assert.equal(posts, 1); assert.equal(gets, 1);
});

test("displayed available kind is the exact selected draft kind; continuation requires input", async () => {
  assert.equal(selectSuccessorKind("retry", ["continue"]), "continue");
  assert.equal(selectSuccessorKind("resume", ["retry", "continue"]), "retry");
  assert.equal(selectSuccessorKind("retry", []), undefined);
  let posts = 0;
  await assert.rejects(writeSuccessor(key, "review", { id: id(3), runKey: key, kind: "continue", expiresAt: expiry },
    new AbortController().signal, async () => { posts++; return Response.json({}); }));
  assert.equal(posts, 0);
});

test("current authorized windows drop absent receipts and accepted/observed does not roll back on delayed responses", () => {
  const prepared = receipt(), accepted: SuccessorReceipt = { ...prepared, state: "accepted", detail: "accepted", newRunId: id(4),
    relation: "retry_of", observationState: "observed" };
  assert.deepEqual(mergeSuccessors([accepted], []), []);
  assert.deepEqual(mergeSuccessors([accepted], [prepared]), [accepted]);
  assert.deepEqual(mergeSuccessors([accepted], [{ ...accepted, observationState: "pending" }]), [accepted]);
});

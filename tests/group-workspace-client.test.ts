import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { fetchGroupTaskMetadata, GroupWorkspaceReadError } from "../apps/web/src/group-workspace-client.ts";

const sourceId = "projects-main";
const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const actor = "reader@example.test";
const ref = { sourceId, projectId, taskId };
const task = { id: taskId, projectId, title: "Visible task", revision: "7", state: "todo", requiresTest: true };
const envelope = { actor, sourceId, projectId, task };
const controller = () => new AbortController();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

test("sends a bounded same-origin GET and validates exact response scope", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, `/api/projects/${sourceId}/${projectId}/tasks/${taskId}`);
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store");
    return Response.json(envelope);
  };
  assert.deepEqual(await fetchGroupTaskMetadata(ref, actor, controller().signal, fetcher), task);
  for (const body of [
    { ...envelope, actor: "other@example.test" },
    { ...envelope, sourceId: "foreign" },
    { ...envelope, projectId: "33333333-3333-4333-8333-333333333333" },
    { ...envelope, task: { ...task, id: "33333333-3333-4333-8333-333333333333" } },
    { ...envelope, task: { ...task, projectId: "33333333-3333-4333-8333-333333333333" } },
    { ...envelope, task: { ...task, body: "private" } },
  ]) {
    await assert.rejects(fetchGroupTaskMetadata(ref, actor, controller().signal, async () => Response.json(body)),
      (error: unknown) => error instanceof GroupWorkspaceReadError && error.kind === "failure");
  }
});

test("maps auth and not-found separately from other HTTP errors", async () => {
  for (const [status, kind] of [[401, "unauthorized"], [403, "unauthorized"], [404, "unavailable"], [502, "failure"]] as const) {
    const body = new ReadableStream<Uint8Array>({ cancel() {} });
    await assert.rejects(fetchGroupTaskMetadata(ref, actor, controller().signal,
      async () => new Response(body, { status })), (error: unknown) =>
      error instanceof GroupWorkspaceReadError && error.kind === kind);
  }
});

test("enforces the 64 KiB cap for headers and streamed bytes and cancels bodies", async () => {
  for (const response of [
    new Response("{}", { headers: { "content-length": "65537" } }),
    new Response(new Uint8Array(65_537)),
  ]) {
    await assert.rejects(fetchGroupTaskMetadata(ref, actor, controller().signal, async () => response));
    assert.equal(response.bodyUsed, true);
  }
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(new Uint8Array(65_537)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(fetchGroupTaskMetadata(ref, actor, controller().signal, async () => new Response(body)));
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("hard deadline settles ignored fetch aborts and cancels a late body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const late = deferred<Response>(); let cancelled = false;
  const pending = fetchGroupTaskMetadata(ref, actor, controller().signal, () => late.promise);
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof GroupWorkspaceReadError && /deadline/.test(error.message));
  t.mock.timers.tick(4_000); await rejected;
  late.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await setImmediate(); assert.equal(cancelled, true);
});

test("deadline covers a hanging body and caller abort cancels it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const pending = fetchGroupTaskMetadata(ref, actor, controller().signal, async () =>
    new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const rejected = assert.rejects(pending, /deadline/);
  await setImmediate(); t.mock.timers.tick(4_000); await rejected;
  assert.equal(cancelled, true);

  const aborted = controller();
  const hanging = fetchGroupTaskMetadata(ref, actor, aborted.signal, () => new Promise(() => {}));
  const abortResult = assert.rejects(hanging, /aborted/);
  aborted.abort(); await abortResult;
});

test("invalid input is unavailable", async () => {
  await assert.rejects(fetchGroupTaskMetadata({ ...ref, taskId: "bad" }, actor, controller().signal),
    (error: unknown) => error instanceof GroupWorkspaceReadError && error.kind === "unavailable");
});

test("upstream and validation failures do not copy private payloads into error messages", async () => {
  for (const fetcher of [
    async () => { throw new Error("PRIVATE_BODY_TOKEN"); },
    async () => Response.json({ ...envelope, task: { ...task, state: { private: "PRIVATE_BODY_TOKEN" } } }),
  ]) await assert.rejects(fetchGroupTaskMetadata(ref, actor, controller().signal, fetcher), error => {
    assert.ok(error instanceof GroupWorkspaceReadError); assert.doesNotMatch(error.message, /PRIVATE_BODY_TOKEN/); return true;
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { AssistantWebError, fetchAssistantExecution, fetchAssistantExecutions,
  fetchAssistantEvents } from "../apps/web/src/assistant-client.ts";
import type { AssistantExecutionView } from "../packages/contracts/assistant-view.ts";

const source = "assistant-main";
const id = (n: number) => `${String(n).padStart(8, "0")}-1234-4234-8234-123456789abc`;
const instant = "2026-11-12T01:02:03Z";
const signal = () => new AbortController().signal;
const limit = 2 * 1024 * 1024;
function execution(): AssistantExecutionView {
  return { sourceId: source, sourceLabel: "Assistant", device: "Desktop",
    native: { id: id(1), instructionId: id(2), instructionRevision: "1",
      revision: "1", state: "running", errorCode: null,
      task: { projectId: id(3), taskId: id(4), revision: "1", state: "todo", observedAt: instant },
      roles: [{ id: id(5), assignmentId: "assignment", workPackageId: "package",
        teamId: "team", membershipId: "member", membershipRevision: "1",
        label: "Reviewer", teamLabel: "Team", agentLabel: "Agent",
        responsibility: "reviewer", state: "running", attempts: 0,
        runtime: { taskId: null, threadId: "thread", turnId: null },
        observation: { queuedAt: instant, startedAt: instant, endedAt: null,
          seconds: null, timingComplete: false,
          basis: "server_dispatch_to_terminal_including_sdk_preparation" } }],
      createdAt: instant, updatedAt: instant },
    currentTask: { projectsSourceId: "projects-main",
      projectKey: `project:${createHash("sha256").update(JSON.stringify(["projects-main", id(3)])).digest("base64url")}`,
      project: { id: id(3), title: "Project", revision: "2", accessRevision: "1", archived: false },
      task: { id: id(4), projectId: id(3), title: "Task", revision: "2", state: "in_progress", requiresTest: true },
      observedAt: instant } };
}
function list() {
  return { version: 1, sourceId: source, observedAt: instant,
    executions: [execution()], cursor: null as string | null,
    hasMore: false, omitted: 0, complete: false };
}
function events() {
  return { execution: execution(), page: { version: 1, observedAt: instant,
    executionId: id(1), events: [{ executionId: id(1), sequence: "2", revision: "1",
      state: "running", errorCode: null, occurredAt: instant }],
    cursor: "2", hasMore: false, complete: false } };
}
const transport = (value: unknown): typeof fetch => async () => Response.json(value);
const detail = (value: unknown) => fetchAssistantExecution(source, id(1), signal(), transport(value));
function safeError(kind: AssistantWebError["kind"] = "failure") {
  return (error: unknown) => {
    assert.ok(error instanceof AssistantWebError);
    assert.equal(error.kind, kind);
    assert.equal(error.message, new AssistantWebError(kind).message);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error).sort(), ["kind", "name"]);
    return true;
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}
function streamed(chunks: Uint8Array[], close = true, headers: Record<string, string> = {}) {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    if (close) controller.close();
  }, cancel() { cancelled++; } });
  return { body, response: new Response(body, { headers: { "content-type": "application/json", ...headers } }),
    cancelled: () => cancelled };
}

test("relative GET routes encode cursors and use same-origin cookies without authorization headers", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push(String(input));
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json(requests.length <= 2 ? list() : requests.length === 3 ? execution() : events());
  };
  await fetchAssistantExecutions(source, null, signal(), fetcher);
  await fetchAssistantExecutions(source, "a&b/?= +", signal(), fetcher);
  await fetchAssistantExecution(source, id(1), signal(), fetcher);
  await fetchAssistantEvents(source, id(1), "1", signal(), fetcher);
  const base = `/api/assistant/${source}/executions`;
  assert.deepEqual(requests, [base, `${base}?cursor=a%26b%2F%3F%3D+%2B`,
    `${base}/${id(1)}`, `${base}/${id(1)}/events?after=1`]);
});

test("preserves historical Task r1 versus current r2 and native execution identity, never a Run", async () => {
  const value = execution();
  const result = await detail(value);
  assert.deepEqual(result, value);
  assert.equal(result.native.task?.revision, "1");
  assert.equal(result.currentTask?.task.revision, "2");
  assert.equal(result.native.task?.state, "todo");
  assert.equal(result.currentTask?.task.state, "in_progress");
  assert.equal("run" in result, false);
  value.native.task = null; value.currentTask = null;
  assert.deepEqual(await detail(value), value);
});

test("detail rejects extra body fields, native schema violations and all Task peer identity mismatches", async () => {
  const mutate: Array<(value: AssistantExecutionView) => unknown> = [
    v => ({ ...v, body: "private" }),
    v => ({ ...v, native: { ...v.native, instructionText: "private" } }),
    v => { v.native.revision = "9007199254740992"; return v; },
    v => { v.native.revision = "1\n"; return v; },
    v => { v.native.roles.push(v.native.roles[0]!); return v; },
    v => { v.native.roles[0]!.runtime.threadId = "x".repeat(513); return v; },
    v => { v.sourceId = "foreign"; return v; },
    v => { v.native.id = id(9); return v; },
    v => { v.sourceLabel = "x".repeat(121); return v; },
    v => { v.device = "bad\nlabel"; return v; },
    v => { v.currentTask = null; return v; },
    v => { v.native.task = null; return v; },
    v => { v.currentTask!.task.id = id(9); return v; },
    v => { v.currentTask!.task.projectId = id(9); return v; },
    v => { v.currentTask!.project.id = id(9); return v; },
    v => { v.currentTask!.projectsSourceId = "../projects"; return v; },
    v => ({ ...v, currentTask: { ...v.currentTask, projectKey: undefined } }),
    v => { v.currentTask!.projectKey = `project:${"a".repeat(42)}`; return v; },
    v => { v.currentTask!.projectKey += "\n"; return v; },
    v => { v.currentTask!.projectKey = `project:${"a".repeat(42)}+`; return v; },
    v => ({ ...v, currentTask: { ...v.currentTask, extra: "private" } }),
    v => { v.currentTask!.observedAt = "yesterday"; return v; },
    v => { v.currentTask!.project.accessRevision = "0"; return v; },
    v => { v.currentTask!.task.revision = "9223372036854775808"; return v; },
    v => { v.currentTask!.task.state = "x".repeat(101); return v; },
    v => { v.currentTask!.task.title = "x".repeat(301); return v; },
    v => ({ ...v, currentTask: { ...v.currentTask, task: { ...v.currentTask!.task, body: "private" } } }),
    v => ({ ...v, currentTask: { ...v.currentTask, project: { ...v.currentTask!.project, body: "private" } } }),
  ];
  for (const change of mutate) await assert.rejects(detail(change(execution())), safeError());
});

test("list bounds, continuation, exact scope, unique native IDs and strict envelope", async () => {
  const read = (value: unknown) => fetchAssistantExecutions(source, null, signal(), transport(value));
  assert.deepEqual(await read(list()), list());
  assert.equal((await read({ ...list(), cursor: "next", hasMore: true })).cursor, "next");
  for (const bad of [
    { version: 2 }, { sourceId: "foreign" }, { observedAt: "invalid" },
    { executions: [execution(), execution()] }, { executions: Array(51).fill(execution()) },
    { executions: [{ ...execution(), sourceId: "foreign" }] },
    { cursor: "next" }, { hasMore: true }, { cursor: "", hasMore: true },
    { cursor: "x".repeat(2049), hasMore: true }, { cursor: "\u007f", hasMore: true },
    { omitted: -1 }, { omitted: Number.MAX_SAFE_INTEGER + 1 }, { complete: true }, { body: "private" },
  ]) await assert.rejects(read({ ...list(), ...bad }), safeError());
});

test("events enforce native ordering, after boundary, scope and exact empty-page cursor", async () => {
  const read = (value: unknown, after = "1") => fetchAssistantEvents(source, id(1), after, signal(), transport(value));
  assert.deepEqual(await read(events()), events());
  const empty = { ...events(), page: { ...events().page, events: [], cursor: "1" } };
  assert.deepEqual(await read(empty), empty);
  assert.equal((await read({ ...empty, page: { ...empty.page, cursor: "9007199254740991" } },
    "9007199254740991")).page.cursor, "9007199254740991");
  const event = events().page.events[0]!;
  for (const bad of [
    { executionId: id(9) }, { cursor: "3" }, { cursor: "9007199254740992" },
    { events: [], cursor: "0" }, { events: [], cursor: "1", hasMore: true },
    { events: [{ ...event, sequence: "1" }], cursor: "1" },
    { events: [event, event] }, { events: Array(101).fill(event) },
    { events: [{ ...event, executionId: id(9) }] },
    { events: [{ ...event, payload: "private" }] },
    { events: [{ ...event, sequence: "02" }] }, { complete: true }, { body: "private" },
  ]) await assert.rejects(read({ ...events(), page: { ...events().page, ...bad } }), safeError());
  for (const value of [{ ...events(), execution: { ...execution(), sourceId: "foreign" } },
    { ...events(), execution: { ...execution(), native: { ...execution().native, id: id(9) } } },
    { ...events(), body: "private" }]) await assert.rejects(read(value), safeError());
});

test("401 is global unauthorized; 403/404 are scope unavailable; HTTP bodies are cancelled", async () => {
  for (const [status, kind] of [[401, "unauthorized"], [403, "unavailable"],
    [404, "unavailable"], [302, "failure"], [500, "failure"]] as const) {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    await assert.rejects(fetchAssistantExecution(source, id(1), signal(), async () =>
      new Response(body, { status, headers: { "x-secret": "private" } })), safeError(kind));
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  }
  await assert.rejects(fetchAssistantExecution(source, id(1), signal(), async () => {
    throw new Error("https://user:password@private.test secret header/body");
  }), safeError());
});

test("UTF8, JSON, media type, declared size and aggregate streamed size are bounded", async () => {
  const read = (response: Response) => fetchAssistantExecution(source, id(1), signal(), async () => response);
  for (const response of [
    new Response("{}"), new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response(null, { headers: { "content-type": "application/json" } }),
    streamed([new Uint8Array([0xc3, 0x28])]).response,
    streamed([new TextEncoder().encode("{")]).response,
    ...["2097153", "-1", "NaN", "1e3", "9".repeat(200)].map(length =>
      streamed([], false, { "content-length": length }).response),
  ]) {
    await assert.rejects(read(response), safeError());
    assert.equal(response.body?.locked ?? false, false);
  }
  const oversized = streamed([new Uint8Array(limit / 2), new Uint8Array(limit / 2 + 1)], false,
    { "content-length": "1" });
  await assert.rejects(read(oversized.response), safeError());
  assert.equal(oversized.cancelled(), 1);
  assert.equal(oversized.body.locked, false);
  const bytes = new TextEncoder().encode(JSON.stringify(execution()));
  const exact = new Uint8Array(limit).fill(32); exact.set(bytes);
  const valid = streamed([exact.subarray(0, 17), exact.subarray(17)], true,
    { "content-type": "application/json; charset=utf-8", "content-length": String(limit) });
  assert.deepEqual(await read(valid.response), execution());
  assert.equal(valid.body.locked, false);
});

test("12 second header deadline cancels late ignored-abort bodies without unhandled rejection", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const later = deferred<Response>();
  let innerSignal: AbortSignal | null | undefined;
  const pending = fetchAssistantExecution(source, id(1), signal(), (_url, init) => {
    innerSignal = init?.signal; return later.promise;
  });
  const rejected = assert.rejects(pending, safeError());
  t.mock.timers.tick(11_999);
  assert.equal(innerSignal?.aborted, false);
  t.mock.timers.tick(1); await rejected;
  assert.equal(innerSignal?.aborted, true);
  const late = streamed([], false);
  later.resolve(late.response); await setImmediate();
  assert.equal(late.cancelled(), 1); assert.equal(late.body.locked, false);
  const rejecting = deferred<Response>();
  const second = assert.rejects(fetchAssistantExecution(source, id(1), signal(), () => rejecting.promise), safeError());
  t.mock.timers.tick(12_000); await second;
  rejecting.reject(new Error("late private transport error")); await setImmediate();
});

test("deadline includes streamed body and validation; body lock and abort listener are released", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const body = streamed([new TextEncoder().encode("{")], false);
  const controller = new AbortController();
  const remove = t.mock.method(controller.signal, "removeEventListener");
  const pending = assert.rejects(fetchAssistantExecution(source, id(1), controller.signal,
    async () => body.response), safeError());
  await setImmediate(); t.mock.timers.tick(12_000); await pending; await setImmediate();
  assert.equal(body.cancelled(), 1); assert.equal(body.body.locked, false);
  assert.equal(remove.mock.callCount(), 1);
  // Synchronous validation cannot yield to a timer: the monotonic check must reject it.
  let elapsed = 0;
  t.mock.method(performance, "now", () => elapsed);
  const original = JSON.parse;
  t.mock.method(JSON, "parse", (...args: Parameters<typeof JSON.parse>) => {
    const result: unknown = original(...args); elapsed = 12_001; return result;
  });
  await assert.rejects(detail(execution()), safeError());
});

test("caller abort settles headers and streams, cancels late responses and skips preaborted fetch", async () => {
  const controller = new AbortController(); const later = deferred<Response>();
  const pending = assert.rejects(fetchAssistantExecution(source, id(1), controller.signal,
    () => later.promise), safeError());
  controller.abort(new Error("private abort reason")); await pending;
  const late = streamed([], false); later.resolve(late.response); await setImmediate();
  assert.equal(late.cancelled(), 1);
  const streaming = new AbortController(); const body = streamed([], false);
  const reading = assert.rejects(fetchAssistantExecution(source, id(1), streaming.signal,
    async () => body.response), safeError());
  await setImmediate(); streaming.abort(); await reading; await setImmediate();
  assert.equal(body.cancelled(), 1); assert.equal(body.body.locked, false);
  await assert.rejects(fetchAssistantExecution(source, id(1), controller.signal,
    async () => { assert.fail("preaborted fetch"); }), safeError());
});

test("malformed source, UUID and cursors never reach fetch", async () => {
  let calls = 0;
  const never: typeof fetch = async () => { calls++; return Response.json({}); };
  for (const bad of ["", "../evil", "https://user:pass@host", "a".repeat(81), "a\n"])
    await assert.rejects(fetchAssistantExecutions(bad, null, signal(), never), safeError());
  for (const bad of ["", "../evil", "not-uuid", undefined as unknown as string])
    await assert.rejects(fetchAssistantExecution(source, bad, signal(), never), safeError());
  for (const bad of ["", "x".repeat(2049), "a\nb", "a\n"])
    await assert.rejects(fetchAssistantExecutions(source, bad, signal(), never), safeError());
  for (const bad of ["", "01", "-1", "1.5", "1e2", "9007199254740992", "1\n"])
    await assert.rejects(fetchAssistantEvents(source, id(1), bad, signal(), never), safeError());
  assert.equal(calls, 0);
});

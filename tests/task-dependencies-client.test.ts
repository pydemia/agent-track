import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { fetchTaskDependencies, pollTaskDependencies, validateDependencyPage,
  TaskDependenciesError, type DependencySnapshot } from "../apps/web/src/task-dependencies-client.ts";

const sourceId = "projects-main";
const id = (n: number) => `${String(n).padStart(8, "0")}-1234-4234-8234-123456789abc`;
const projectId = id(1);
const task = (n: number) => ({ id: id(n), projectId, title: "Native Task", revision: "9",
  state: "todo", requiresTest: true });
function page() {
  return { sourceId, projectId, supported: true, observedAt: "2026-11-12T01:02:03Z",
    dependencies: [{ id: id(4), projectId, relation: "depends_on", fromTask: task(2),
      toTask: task(3), fromRevision: "2", toRevision: "3" }], hasMore: false };
}
const controller = () => new AbortController();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

test("bounded runtime metadata validation enforces exact scope, UUID, revisions and native contract", () => {
  assert.equal(validateDependencyPage(page(), sourceId, projectId).dependencies[0]!.fromRevision, "2");
  for (const value of [
    { ...page(), sourceId: "foreign" }, { ...page(), projectId: id(5) },
    { ...page(), supported: false }, { ...page(), observedAt: null },
    { ...page(), dependencies: Array(201).fill(page().dependencies[0]) },
    { ...page(), dependencies: [{ ...page().dependencies[0], id: "invalid" }] },
    { ...page(), dependencies: [{ ...page().dependencies[0], fromRevision: "0" }] },
    { ...page(), dependencies: [{ ...page().dependencies[0], fromRevision: "9223372036854775808" }] },
    { ...page(), dependencies: [{ ...page().dependencies[0], fromTask: { ...task(2), title: "x".repeat(301) } }] },
    { ...page(), dependencies: [{ ...page().dependencies[0], toTask: { ...task(3), body: "private" } }] },
  ]) assert.throws(() => validateDependencyPage(value, sourceId, projectId));
  assert.equal(validateDependencyPage({ ...page(), supported: false, observedAt: null,
    dependencies: [] }, sourceId, projectId).supported, false);
  const unrelated = { ...page(), dependencies: [{ ...page().dependencies[0], projectId: id(5),
    fromTask: { ...task(2), projectId: id(5) }, toTask: { ...task(3), projectId: id(5) } }] };
  assert.throws(() => validateDependencyPage(unrelated, sourceId, projectId));
  assert.throws(() => validateDependencyPage({ ...page(), dependencies: [page().dependencies[0],
    { ...page().dependencies[0], id: id(8), fromTask: { ...task(2), revision: "10" } }] }, sourceId, projectId));
});

test("HTTP read uses the authorized route and classifies global auth versus scope 404", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, `/api/projects/${sourceId}/${projectId}/task-dependencies`);
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "same-origin");
    return Response.json(page());
  };
  assert.equal((await fetchTaskDependencies(sourceId, projectId, controller().signal, fetcher)).supported, true);
  const nativeBody = Response.json(page());
  await fetchTaskDependencies(sourceId, projectId, controller().signal, async () => nativeBody);
  assert.equal(nativeBody.body?.locked, false, "a successful metadata reader releases its body lock");
  for (const [status, kind] of [[401, "unauthorized"], [403, "unauthorized"],
    [404, "unavailable"], [502, "failure"]] as const) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    await assert.rejects(fetchTaskDependencies(sourceId, projectId, controller().signal,
      async () => new Response(body, { status })), (error: unknown) =>
      error instanceof TaskDependenciesError && error.kind === kind);
    assert.equal(cancelled, true);
  }
});

test("rejects oversized headers/stream bytes, malformed JSON and metadata; cleans up bodies", async () => {
  for (const response of [
    new Response("{}", { headers: { "content-length": "1048577" } }),
    new Response(new Uint8Array(1_048_577)), new Response("{"),
    Response.json({ ...page(), sourceId: "foreign" }),
  ]) {
    await assert.rejects(fetchTaskDependencies(sourceId, projectId, controller().signal, async () => response));
    assert.equal(response.bodyUsed, true);
  }
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array(1_048_577)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(fetchTaskDependencies(sourceId, projectId, controller().signal,
    async () => new Response(stream)), /too large/);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false, "an oversized metadata reader releases its body lock");
});

test("hard deadline settles a hanging custom fetch and cancels its late body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const response = deferred<Response>(); let cancelled = false;
  const pending = fetchTaskDependencies(sourceId, projectId, controller().signal, () => response.promise);
  const rejected = assert.rejects(pending, /deadline/);
  t.mock.timers.tick(4_000); await rejected;
  response.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await setImmediate(); assert.equal(cancelled, true);
});

test("the same four-second deadline includes hanging streamed body and abort cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const pending = fetchTaskDependencies(sourceId, projectId, controller().signal, async () =>
    new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const rejected = assert.rejects(pending, /deadline/);
  await setImmediate(); t.mock.timers.tick(4_000); await rejected;
  assert.equal(cancelled, true);
  const aborted = controller();
  const hanging = fetchTaskDependencies(sourceId, projectId, aborted.signal, () => new Promise(() => {}));
  const abortResult = assert.rejects(hanging, /aborted/);
  aborted.abort(); await abortResult;
});

test("polling waits 15 seconds after completion, never overlaps, clears old IDs on failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = deferred<Response>(); const second = deferred<Response>(); let calls = 0;
  let scopeUnavailable = 0;
  const states: DependencySnapshot[] = [];
  const dispose = pollTaskDependencies(sourceId, projectId, (s) => states.push(s), () => assert.fail("unexpected auth"),
    () => { calls++; return calls === 1 ? first.promise : second.promise; }, () => { scopeUnavailable++; });
  assert.equal(calls, 1);
  t.mock.timers.tick(2_000); assert.equal(calls, 1);
  first.resolve(Response.json(page())); await setImmediate();
  assert.equal(states.at(-1)?.status, "ready");
  t.mock.timers.tick(14_999); assert.equal(calls, 1);
  t.mock.timers.tick(1); assert.equal(calls, 2);
  second.resolve(new Response(null, { status: 404 })); await setImmediate();
  assert.deepEqual(states.at(-1), { status: "unavailable", page: null });
  assert.equal(scopeUnavailable, 1, "scope denial must clear the parent task Map context even if its requested project remains authorized");
  t.mock.timers.tick(15_000); assert.equal(calls, 2, "a revoked scope does not keep polling");
  dispose(); t.mock.timers.tick(15_000); assert.equal(calls, 2);
});

test("disposal discards late responses and late auth; global auth clears graph and stops polling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const status of [200, 401, 403, 404]) {
    const later = deferred<Response>(); const states: DependencySnapshot[] = []; let auth = 0;
    const dispose = pollTaskDependencies(sourceId, projectId, (s) => states.push(s), () => { auth++; }, () => later.promise, () => { auth++; });
    dispose(); later.resolve(status === 200 ? Response.json(page()) : new Response(null, { status }));
    await setImmediate(); assert.equal(states.length, 1); assert.equal(auth, 0);
  }
  for (const status of [401, 403]) {
    const states: DependencySnapshot[] = []; let auth = 0; let calls = 0;
    const dispose = pollTaskDependencies(sourceId, projectId, (s) => states.push(s), () => { auth++; },
      async () => { calls++; return new Response(null, { status }); });
    await setImmediate(); assert.deepEqual(states.at(-1), { status: "unauthorized", page: null });
    assert.equal(auth, 1); t.mock.timers.tick(15_000); assert.equal(calls, 1); dispose();
  }
});

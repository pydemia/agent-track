import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNativeSessionRelationsPage as parse, readBoundedSessionRelationsJson as read } from "../packages/adapters/demian/session-relations.ts";

const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const expected = { kind: "managed-children" as const, sessionId: id(1), after: null, limit: 2 };
const row = (n = 2) => ({ object: "demian.managed_child_relation", kind: "managed_child", session_id: id(1),
  run_id: id(n), operation_id: id(n + 100), parent_invocation_id: "parent", child_invocation_id: "child", status: "succeeded" });
const page = () => ({ object: "list", session_id: id(1), data: [row()], next_cursor: null as string | null,
  has_more: false, availability: "available", coverage: "managed-child-receipts" });
const rejectPage = (value: unknown, request = expected) => assert.throws(() => parse(value, request),
  { message: "Invalid native session relations page" });
const json = (body: BodyInit | null, type = "application/json") => new Response(body, { headers: { "content-type": type } });
const rejectBody = async (response: Response, signal?: AbortSignal) => {
  await assert.rejects(read(response, signal), { message: "Invalid native session relations response" });
  assert.equal(response.body?.locked ?? false, false);
};

test("normalizes managed and peer resources through the shared contract", () => {
  assert.deepEqual(parse(page(), expected), { kind: "managed-children", sessionId: id(1),
    relations: [{ kind: "managed-child", sessionId: id(1), runId: id(2), operationId: id(102),
      parentInvocationId: "parent", childInvocationId: "child", status: "succeeded" }],
    nextCursor: null, hasMore: false, availability: "available", coverage: "managed-child-receipts" });
  const peer = { ...page(), coverage: "peer-processing-receipts", data: [{ object: "demian.peer_processing_relation",
    kind: "peer_processing", session_id: id(1), run_id: id(2), operation_id: id(102),
    connection_id: "conn", conversation_id: "conversation", message_id: "message", status: "running" }] };
  assert.equal(parse(peer, { ...expected, kind: "peer-processing" }).relations[0]!.kind, "peer-processing");
  rejectPage(peer);
});

test("closed shape rejects missing, partial, private, camelCase and malformed fields without disclosing values", () => {
  for (const value of [null, [], {}, { ...page(), private_secret: "PRIVATE" }, { ...page(), availability: "partial" },
    { ...page(), object: "other" }, { ...page(), has_more: "false" }, { ...page(), next_cursor: undefined }]) rejectPage(value);
  for (const patch of [{ prompt: "PRIVATE" }, { runId: id(2) }, { status: "PRIVATE" }, { operation_id: "PRIVATE" },
    { parent_invocation_id: "x\nsecret" }, { child_invocation_id: "x".repeat(513) }, { child_invocation_id: "" },
    { run_id: id(15).toUpperCase() }, { object: "demian.peer_processing_relation" }, { session_id: undefined }]) {
    rejectPage({ ...page(), data: [{ ...row(), ...patch }] });
  }
});

test("enforces endpoint/session scope, ascending keyset, unique operations and continuation", () => {
  for (const patch of [{ session_id: id(9) }, { coverage: "peer-processing-receipts" },
    { data: [{ ...row(), session_id: id(9) }] }, { data: [row(3), row(2)] }, { data: [row(), row()] },
    { data: [row(), { ...row(3), operation_id: row().operation_id }] },
    { next_cursor: id(2) }, { has_more: true }, { has_more: true, next_cursor: id(9) },
    { data: [], has_more: true, next_cursor: id(2) }]) rejectPage({ ...page(), ...patch });
  for (const after of [id(2), id(3), "bad"]) assert.throws(() => parse(page(), { ...expected, after }));
  assert.equal(parse({ ...page(), has_more: true, next_cursor: id(2) }, { ...expected, after: id(1) }).nextCursor, id(2));
  assert.equal(parse({ ...page(), data: [] }, { ...expected, after: id(9) }).relations.length, 0);
});

test("bounds limits and unavailable pages; available partial-sized pages are valid", () => {
  for (const limit of [0, 251, 1.5, NaN, Infinity]) rejectPage(page(), { ...expected, limit });
  rejectPage({ ...page(), data: [row(), row(3)] }, { ...expected, limit: 1 });
  for (const availability of ["unsupported", "unconfigured"]) {
    rejectPage({ ...page(), availability });
    rejectPage({ ...page(), availability, data: [], has_more: true, next_cursor: id(2) });
    assert.equal(parse({ ...page(), availability, data: [] }, expected).availability, availability);
  }
  for (const limit of [1, 250]) assert.equal(parse(page(), { ...expected, limit }).relations.length, 1);
});

test("reads strict UTF8 across chunks and accepts only the application/json media type", async () => {
  const bytes = new TextEncoder().encode('{"value":"한"}');
  const response = json(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }), "Application/JSON; charset=utf-8");
  assert.deepEqual(await read(response), { value: "한" });
  assert.equal(response.body?.locked, false);
  for (const type of ["text/application/json", "application/jsonp", "application/problem+json", "text/plain"]) await rejectBody(json("{}", type));
  for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0x22, 0xc3, 0x22]), new Uint8Array([0xc3])]) await rejectBody(json(bytes));
  await rejectBody(json('{"private":"SECRET"'));
  await rejectBody(json(null));
});

test("enforces 1 MiB by actual bytes and cancels oversized streams", async () => {
  assert.equal(typeof await read(json('"' + "x".repeat(1_048_574) + '"')), "string");
  let cancelled = false;
  const response = json(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_048_577)); },
    cancel() { cancelled = true; return new Promise(() => {}); } }));
  await rejectBody(response);
  assert.equal(cancelled, true);
});

test("abort defeats hanging pull/cancel and releases locks; late body cannot be consumed", async () => {
  const abort = new AbortController();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const response = json(new ReadableStream<Uint8Array>({ start(value) { controller = value; },
    pull() { return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } }));
  const pending = rejectBody(response, abort.signal);
  abort.abort(new Error("PRIVATE abort reason"));
  await pending;
  assert.equal(cancelled, true);
  assert.throws(() => controller.enqueue(new TextEncoder().encode("{}")));
  await rejectBody(json("{}"), abort.signal);
});

test("rejects stream failures with static errors and cancels rejected media without waiting", async () => {
  await rejectBody(json(new ReadableStream({ pull(controller) { controller.error(new Error("PRIVATE")); } })));
  let cancelled = false;
  await rejectBody(json(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }), "text/plain"));
  assert.equal(cancelled, true);
});

test("overall ten-second deadline cancels a body that never produces bytes", { timeout: 12_000 }, async () => {
  let cancelled = false;
  const response = json(new ReadableStream({ pull() { return new Promise(() => {}); },
    cancel() { cancelled = true; return new Promise(() => {}); } }));
  const start = Date.now();
  await rejectBody(response);
  assert.ok(Date.now() - start >= 9_900);
  assert.equal(cancelled, true);
});

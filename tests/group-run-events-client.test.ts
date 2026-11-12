import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { fetchGroupRunEvents, GroupRunEventsError } from "../apps/web/src/group-run-events-client.ts";
const run = { key: JSON.stringify(["native", "r"]), sourceId: "native", runId: "r" };
const time = "2026-11-13T00:00:00.000Z";
const event = (sequence = "1") => ({ key: "e" + sequence, sourceId: "native", runId: "r", sequence, type: "response.created", occurredAt: time, receivedAt: time, data: { redacted: true } });
const page = (events = [event()]) => ({ events, nextCursor: events.at(-1)?.sequence ?? "0", hasMore: false });
const controller = () => new AbortController();

test("group event pages preserve source/Run/sequence and use a same-origin no-store read", async () => {
  const result = await fetchGroupRunEvents(run, null, controller().signal, async (input, options) => {
    assert.equal(input, `/api/runs/${encodeURIComponent(run.key)}/events`);
    assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    return Response.json(page());
  });
  assert.deepEqual(result.events, [event()]);
});

for (const [label, value] of [
  ["wrong source", page([{ ...event(), sourceId: "other" }])],
  ["wrong Run", page([{ ...event(), runId: "other" }])],
  ["duplicate", page([event(), event()])],
  ["reverse sequence", page([event("2"), event("1")])],
  ["raw content", page([{ ...event(), data: { redacted: true, prompt: "private" } } as any])],
  ["stuck cursor", { events: [], nextCursor: "0", hasMore: true }],
] as const) test(`group event page rejects ${label}`, async () => {
  await assert.rejects(fetchGroupRunEvents(run, null, controller().signal, async () => Response.json(value)), GroupRunEventsError);
});

test("group event paging rejects earlier events and handles authorization separately", async () => {
  await assert.rejects(fetchGroupRunEvents(run, "2", controller().signal, async () => Response.json(page([event("1")]))), GroupRunEventsError);
  for (const [status, kind] of [[401, "unauthorized"], [403, "unauthorized"], [404, "unavailable"], [503, "failure"]] as const)
    await assert.rejects(fetchGroupRunEvents(run, null, controller().signal, async () => new Response("{}", { status })),
      error => error instanceof GroupRunEventsError && error.kind === kind);
});

test("group event read enforces body cap and cancels a body delayed beyond deadline", async t => {
  await assert.rejects(fetchGroupRunEvents(run, null, controller().signal, async () => new Response("x".repeat(1024 * 1024 + 1))), GroupRunEventsError);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const pending = fetchGroupRunEvents(run, null, controller().signal, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const rejected = assert.rejects(pending, GroupRunEventsError);
  await setImmediate(); t.mock.timers.tick(4000); await rejected; assert.equal(cancelled, true);
});

test("disposing the lane rejects an abort-ignoring fetch and cancels its late body", async () => {
  let resolve!: (value: Response) => void; let cancelled = false;
  const pendingResponse = new Promise<Response>(value => { resolve = value; });
  const active = controller(), request = fetchGroupRunEvents(run, null, active.signal, () => pendingResponse);
  const rejected = assert.rejects(request, GroupRunEventsError); active.abort(); await rejected;
  resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await setImmediate(); assert.equal(cancelled, true);
});

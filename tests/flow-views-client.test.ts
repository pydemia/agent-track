import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchFlowViews, saveFlowView, removeFlowView, flowViewContextId, FlowViewsReadError } from "../apps/web/src/flow-views-client.ts";
import type { FlowViewContent, SavedFlowView } from "../packages/contracts/flow-views.ts";

const actor = "alice@example.test", id = "11111111-1111-4111-8111-111111111111", contextId = "a".repeat(64);
const content: FlowViewContent = { version: 1, contextId, name: "Saved view", anchors: { tasks: [{ sourceId: "projects", projectId: id, taskId: id }], runs: [], assistants: [] }, state: { by: "task", depth: "structure", bundles: [], overrides: [], focus: null } };
const saved: SavedFlowView = { id, revision: 1, content, createdAt: "2026-11-13T00:00:00.000Z", updatedAt: "2026-11-13T00:00:00.000Z" };
const signal = () => new AbortController().signal;
test("saved-view transport preserves same-origin safety and sends only explicit save/delete bodies", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => { assert(init); seen.push({ url: String(url), init }); return Response.json(init.method === "GET" ? { actor, views: [saved] } : init.method === "POST" ? { actor, view: saved } : { actor, deleted: true }); };
  assert.deepEqual(await fetchFlowViews(actor, contextId, signal(), fetcher), [saved]);
  assert.deepEqual(await saveFlowView(actor, id, 0, content, signal(), fetcher), saved);
  await removeFlowView(actor, saved, signal(), fetcher);
  assert.deepEqual(seen.map(row => row.init.method), ["GET", "POST", "DELETE"]);
  for (const row of seen) { assert(row.url.startsWith("/api/flow-views")); assert.equal(row.init.redirect, "error"); assert.equal(row.init.credentials, "same-origin"); assert(row.init.signal); }
  assert.deepEqual(JSON.parse(String(seen[1]!.init.body)), { id, expectedRevision: 0, content });
  assert.deepEqual(JSON.parse(String(seen[2]!.init.body)), { expectedRevision: 1 });
  assert.notEqual(await flowViewContextId("actor-a/scope"), await flowViewContextId("actor-b/scope"));
  assert.equal(await flowViewContextId("scope"), await flowViewContextId("scope"));
});
test("saved-view replies reject other actors, contexts, duplicates, revisions and mutations without echoing content", async () => {
  for (const raw of [{ actor: "bob@example.test", views: [saved] }, { actor, views: [saved, saved] }, { actor, views: [{ ...saved, content: { ...content, contextId: "b".repeat(64) } }] }]) {
    await assert.rejects(fetchFlowViews(actor, contextId, signal(), async () => Response.json(raw)), error => error instanceof FlowViewsReadError && !error.message.includes("Saved view"));
  }
  for (const view of [{ ...saved, revision: 2 }, { ...saved, content: { ...content, name: "Changed response" } }]) await assert.rejects(saveFlowView(actor, id, 0, content, signal(), async () => Response.json({ actor, view })));
  await assert.rejects(removeFlowView(actor, saved, signal(), async () => Response.json({ actor: "bob@example.test", deleted: true })));
  for (const status of [401, 403, 404, 409, 503]) await assert.rejects(fetchFlowViews(actor, contextId, signal(), async () => new Response("PRIVATE_SOURCE_ERROR", { status })), error => error instanceof FlowViewsReadError && !error.message.includes("PRIVATE"));
});
test("invalid client input never reaches the network and aborted late responses cannot publish saved names", async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; return Response.json({ actor, views: [saved] }); };
  await assert.rejects(fetchFlowViews(actor, "bad", signal(), fetcher));
  await assert.rejects(saveFlowView(actor, id, 0, { ...content, name: "" }, signal(), fetcher)); assert.equal(calls, 0);
  const controller = new AbortController(); let release!: (response: Response) => void;
  const promise = fetchFlowViews(actor, contextId, controller.signal, () => new Promise(resolve => { release = resolve; }));
  controller.abort(); await assert.rejects(promise); release(Response.json({ actor, views: [saved] }));
});

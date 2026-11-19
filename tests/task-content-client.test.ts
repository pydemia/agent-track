import assert from "node:assert/strict";
import test from "node:test";
import { fetchTaskContent } from "../apps/web/src/task-content-client.ts";
import { PrivateReadError } from "../apps/web/src/private-json.ts";

const projectId = "11111111-1111-4111-8111-111111111111", taskId = "22222222-2222-4222-8222-222222222222";
const ref = { sourceId: "projects", projectId, taskId };
const content = () => ({ task: { id: taskId, projectId, title: "실패 원인 조사", revision: "3", state: "in_review", requiresTest: true },
  body: "오류를 재현하고 응답을 검증한다.\n<script>alert(1)</script>", acceptanceCriteria: ["실패 경계 확인"], complete: true, reviewSha256: "a".repeat(64) });
const transport = (value: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const signal = () => new AbortController().signal;

test("task content reads exact existing read-only review route and returns body and criteria", async () => {
  let requests = 0;
  const value = await fetchTaskContent(ref, signal(), async (url, init) => {
    requests++;
    assert.equal(url, `/api/projects/projects/${projectId}/tasks/${taskId}/review`);
    assert.equal(init?.method, "GET"); assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined);
    return transport(content())(url, init);
  });
  assert.equal(requests, 1); assert.equal(value.body, content().body); assert.deepEqual(value.acceptanceCriteria, ["실패 경계 확인"]);
});

test("wrong Project/Task, partial text and oversized content cannot masquerade as a full review", async () => {
  for (const value of [
    { ...content(), task: { ...content().task, id: projectId } },
    { ...content(), task: { ...content().task, projectId: taskId } },
    { ...content(), complete: false }, { ...content(), body: "a".repeat(5001) },
    { ...content(), body: "가".repeat(3000) }, { ...content(), acceptanceCriteria: Array(21).fill("criterion") },
    { ...content(), rawToken: "PRIVATE" },
  ]) await assert.rejects(fetchTaskContent(ref, signal(), transport(value)), error => error instanceof PrivateReadError && !error.message.includes("PRIVATE"));
  const value = await fetchTaskContent(ref, signal(), transport({ ...content(), complete: false, body: "", acceptanceCriteria: [], reviewSha256: null }));
  assert.equal(value.complete, false); assert.equal(value.body, "");
});

test("access withdrawal and late responses never return stale body", async () => {
  for (const [status, kind] of [[401, "unauthorized"], [403, "unavailable"], [404, "unavailable"]] as const)
    await assert.rejects(fetchTaskContent(ref, signal(), transport(content(), status)), error => error instanceof PrivateReadError && error.kind === kind);
  const controller = new AbortController();
  let resolve!: (value: Response) => void;
  const pending = fetchTaskContent(ref, controller.signal, () => new Promise(value => { resolve = value; }));
  controller.abort(); resolve(new Response(JSON.stringify(content()), { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(pending, PrivateReadError);
});

test("invalid entity selectors never issue a request", async () => {
  for (const candidate of [{ ...ref, sourceId: "../private" }, { ...ref, taskId: "../../secret" }]) {
    let calls = 0;
    await assert.rejects(fetchTaskContent(candidate, signal(), async () => { calls++; return new Response(); }), PrivateReadError);
    assert.equal(calls, 0);
  }
});

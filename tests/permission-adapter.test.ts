import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionJson, permissionList, permissionReview } from "../packages/adapters/demian/permissions.ts";
import { DemianClient } from "../packages/adapters/demian/index.ts";

const runId = "00000000-0000-4000-8000-000000000001";
const permissionId = "00000000-0000-4000-8000-000000000002";
const now = new Date().toISOString();
const native = () => ({ id: permissionId, object: "demian.permission_request", run_id: runId, call_id: "call", tool: "write_file", input: { path: "qa.txt", content: "PRIVATE_CONTENT" },
  actor: "build", reason: "QA request", status: "pending", decision: null, created_at: now, resolved_at: null, expires_at: new Date(Date.now() + 60_000).toISOString() });

test("permission metadata excludes arguments; explicit review is complete and fingerprint pins scope, content and expiry", () => {
  const value = native(); const review = permissionReview(value, runId);
  assert.doesNotMatch(JSON.stringify(review.request), /PRIVATE_CONTENT|qa.txt|input|reason|actor/);
  assert.match(review.reviewText, /PRIVATE_CONTENT/); assert.equal(review.reviewComplete, true);
  assert.equal(permissionReview({ ...value, input: { content: "PRIVATE_CONTENT", path: "qa.txt" } }, runId).request.fingerprint, review.request.fingerprint);
  assert.equal(permissionReview({ ...value, status: "resolved", decision: "allow_once", resolved_at: now }, runId).request.fingerprint, review.request.fingerprint);
  assert.notEqual(permissionReview({ ...value, tool: "bash" }, runId).request.fingerprint, review.request.fingerprint);
  assert.notEqual(permissionReview({ ...value, input: { path: "other.txt" } }, runId).request.fingerprint, review.request.fingerprint);
  assert.notEqual(permissionReview({ ...value, expires_at: new Date(Date.now() + 120_000).toISOString() }, runId).request.fingerprint, review.request.fingerprint);
});

test("permission adapter rejects wrong scopes, duplicate IDs, missing inputs and unbounded review/transport", async () => {
  assert.throws(() => permissionReview({ ...native(), run_id: permissionId }, runId));
  assert.throws(() => permissionReview({ ...native(), input: undefined }, runId));
  assert.throws(() => permissionList({ object: "list", data: [native(), native()] }, runId));
  const large = permissionReview({ ...native(), input: { content: "x".repeat(70_000) } }, runId);
  assert.equal(large.reviewComplete, false); assert.doesNotMatch(large.reviewText, /xxxx/);
  await assert.rejects(permissionJson(new Response("x".repeat(1_048_577))));
});

test("native decision uses only the fixed scoped route and validates the acknowledgement identity", async () => {
  let posts = 0;
  const client = new DemianClient({ sourceId: "native", baseUrl: "http://source.test", fetch: async (input, init) => {
    assert.equal(String(input), `http://source.test/api/v1/runs/${runId}/permissions/${permissionId}/decision`);
    assert.equal(init?.method, "POST"); assert.deepEqual(JSON.parse(String(init?.body)), { decision: "allow_once" }); posts++;
    return Response.json({ ...native(), status: "resolved", decision: "allow_once", resolved_at: now });
  } });
  assert.equal((await client.decidePermission(runId, permissionId, "allow_once")).request.decision, "allow_once"); assert.equal(posts, 1);
  const wrong = new DemianClient({ sourceId: "native", baseUrl: "http://source.test", fetch: async () => Response.json({ ...native(), id: runId }) });
  await assert.rejects(wrong.decidePermission(runId, permissionId, "deny"));
});

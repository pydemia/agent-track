import assert from "node:assert/strict";
import { test } from "node:test";
import type { PermissionView } from "../packages/contracts/index.ts";
import { currentPermissionReview } from "../packages/projection/permission-review.ts";

test("a pending list row cannot authorize controls for a review already resolved or expired at the source", () => {
  const now = Date.now(); const pending: PermissionView = { id: "permission", runId: "run", callId: "call", tool: "tool", status: "pending", decision: null,
    createdAt: new Date(now - 1000).toISOString(), resolvedAt: null, expiresAt: new Date(now + 1000).toISOString(), fingerprint: "a".repeat(64) };
  assert.equal(currentPermissionReview(pending, pending, now), true);
  assert.equal(currentPermissionReview(pending, { ...pending, status: "resolved", decision: "allow_once" }, now), false);
  assert.equal(currentPermissionReview(pending, { ...pending, status: "expired" }, now), false);
  assert.equal(currentPermissionReview(pending, pending, now + 1000), false);
  assert.equal(currentPermissionReview(pending, { ...pending, fingerprint: "b".repeat(64) }, now), false);
  assert.equal(currentPermissionReview(pending, { ...pending, runId: "other-run" }, now), false);
});

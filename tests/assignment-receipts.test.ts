import test from "node:test";
import assert from "node:assert/strict";
import { mergeAssignmentReceipt, mergeAssignmentReceiptWindow } from "../packages/projection/assignment-receipts.ts";
import type { AssignmentReceiptSnapshot } from "../packages/projection/assignment-receipts.ts";

type TestReceipt = AssignmentReceiptSnapshot & { runId: string | null };
const base: TestReceipt = { id: "request", state: "unknown", bindingState: null, updatedAt: "2026-11-12T00:00:01.000Z", runId: null };

test("late POST unknown cannot overwrite a polled accepted and bound receipt", () => {
  const accepted: TestReceipt = { ...base, state: "accepted", bindingState: "bound", runId: "run", updatedAt: "2026-11-12T00:00:01.500Z" };
  const latePost: TestReceipt = { ...base, state: "unknown", updatedAt: "2026-11-12T00:00:02.000Z" };
  assert.deepEqual(mergeAssignmentReceipt(accepted, latePost), accepted);
});

test("accepted binding cannot regress and stale polls cannot undo newer state", () => {
  const bound: TestReceipt = { ...base, state: "accepted", bindingState: "bound", runId: "run", updatedAt: "2026-11-12T00:00:03.000Z" };
  const stalePending: TestReceipt = { ...bound, bindingState: "pending", updatedAt: "2026-11-12T00:00:02.000Z" };
  assert.deepEqual(mergeAssignmentReceipt(bound, stalePending), bound);
});

test("authorized receipt windows discard rows omitted by the current response", () => {
  const visible: TestReceipt = { ...base, id: "visible" };
  const revoked: TestReceipt = { ...base, id: "revoked", state: "accepted", bindingState: "bound", runId: "private-run" };
  assert.deepEqual(mergeAssignmentReceiptWindow([visible, revoked], [{ ...visible, updatedAt: "2026-11-12T00:00:02.000Z" }]), [
    { ...visible, updatedAt: "2026-11-12T00:00:02.000Z" },
  ]);
});

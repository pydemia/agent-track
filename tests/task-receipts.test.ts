import test from "node:test";
import assert from "node:assert/strict";
import { mergeTaskReceipts } from "../packages/projection/task-receipts.ts";
import type { TaskCreationReceipt } from "../packages/commands/create-task.ts";

test("late task receipt responses preserve terminal state and reject older nonterminal state", () => {
  const receipt: TaskCreationReceipt = { id: "request", actor: "owner", sourceId: "projects", projectId: "project", state: "created",
    taskId: "task", taskRevision: "1", createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:02Z" };
  const late = { ...receipt, state: "unknown" as const, taskId: null, taskRevision: null, updatedAt: "2026-11-11T00:00:01Z" };
  assert.deepEqual(mergeTaskReceipts([receipt], [late]), [receipt]);
  assert.deepEqual(mergeTaskReceipts([receipt], [{ ...late, updatedAt: "2026-11-11T00:00:03Z" }]), [receipt]);
  const current = { ...late, updatedAt: "2026-11-11T00:00:04Z" };
  assert.deepEqual(mergeTaskReceipts([current], [late]), [current]);
  assert.deepEqual(mergeTaskReceipts([late], [receipt]), [receipt]);
});

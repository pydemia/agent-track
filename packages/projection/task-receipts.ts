import type { TaskCreationReceipt } from "../commands/create-task.ts";

const terminal = new Set(["created", "failed", "expired"]);
/** Delayed GET/POST responses cannot reopen a locally observed terminal receipt. */
export function mergeTaskReceipts(previous: TaskCreationReceipt[], incoming: TaskCreationReceipt[]): TaskCreationReceipt[] {
  const records = new Map(previous.map((receipt) => [receipt.id, receipt]));
  for (const receipt of incoming) {
    const old = records.get(receipt.id);
    if (!old || !terminal.has(old.state) && Date.parse(receipt.updatedAt) >= Date.parse(old.updatedAt)) records.set(receipt.id, receipt);
  }
  return [...records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-100);
}

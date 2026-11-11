import type { ApprovalReceipt } from "../contracts/index.ts";

const terminal = new Set(["succeeded", "failed", "expired"]);
export function mergeApprovalReceipts(previous: ApprovalReceipt[], incoming: ApprovalReceipt[]): ApprovalReceipt[] {
  const byId = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) {
    const old = byId.get(item.id);
    if (!old || (!terminal.has(old.state) && (terminal.has(item.state) || item.updatedAt > old.updatedAt))) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

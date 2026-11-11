export type AssignmentReceiptState = "requested" | "dispatching" | "accepted" | "unknown" | "failed" | "expired";
export type AssignmentBindingState = "pending" | "bound" | "conflict" | null;
export interface AssignmentReceiptSnapshot {
  id: string;
  state: AssignmentReceiptState;
  bindingState: AssignmentBindingState;
  updatedAt: string;
}

const terminal = new Set<AssignmentReceiptState>(["accepted", "failed", "expired"]);
const bindingRank: Record<Exclude<AssignmentBindingState, null>, number> = { pending: 1, conflict: 2, bound: 3 };

/** A delayed POST or poll cannot roll back a terminal receipt or a stronger binding result. */
export function mergeAssignmentReceipt<T extends AssignmentReceiptSnapshot>(previous: T | undefined, incoming: T): T {
  if (!previous) return incoming;
  if (terminal.has(previous.state) && incoming.state !== previous.state) return previous;
  if (terminal.has(incoming.state) && !terminal.has(previous.state)) return incoming;
  if (Date.parse(incoming.updatedAt) < Date.parse(previous.updatedAt)) return previous;
  if (previous.state === "accepted" && incoming.state === "accepted") {
    const oldRank = previous.bindingState ? bindingRank[previous.bindingState] : 0;
    const newRank = incoming.bindingState ? bindingRank[incoming.bindingState] : 0;
    if (oldRank > newRank) return { ...incoming, bindingState: previous.bindingState };
  }
  return incoming;
}

export function mergeAssignmentReceiptWindow<T extends AssignmentReceiptSnapshot>(previous: T[], incoming: T[]): T[] {
  const visibleIds = new Set(incoming.map((receipt) => receipt.id));
  const records = new Map(previous.filter((receipt) => visibleIds.has(receipt.id)).map((receipt) => [receipt.id, receipt]));
  for (const receipt of incoming) records.set(receipt.id, mergeAssignmentReceipt(records.get(receipt.id), receipt));
  return [...records.values()];
}

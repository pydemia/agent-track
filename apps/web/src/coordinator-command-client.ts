import { z } from "zod";
import { coordinatorPanelSchema, type CoordinatorPanel } from "../../../packages/contracts/coordinator-panel.ts";
import { coordinatorReceiptSchema, coordinatorReviewInputSchema, type CoordinatorReceipt, type CoordinatorReviewInput } from "../../../packages/contracts/coordinator-commands.ts";
import { fetchPrivateJson } from "./private-json.ts";

const envelope = z.strictObject({ receipt: coordinatorReceiptSchema });
const path = (key: string) => `/api/runs/${encodeURIComponent(key)}/coordinator-commands`;
const uuid = (value: string) => z.uuid().parse(value).toLowerCase();

export function readCoordinatorCommands(runKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<CoordinatorPanel> {
  return fetchPrivateJson(path(runKey), signal, fetcher, value => {
    const page = coordinatorPanelSchema.parse(value);
    if (page.availability.runKey !== runKey || page.receipts.some(receipt => receipt.runKey !== runKey)) throw new Error("Command scope mismatch");
    return page;
  });
}
export async function readCoordinatorCommand(runKey: string, id: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const receipt = await fetchPrivateJson(`${path(runKey)}/${uuid(id)}`, signal, fetcher, value => envelope.parse(value).receipt);
  if (receipt.runKey !== runKey || receipt.id !== uuid(id)) throw new Error("Command identity mismatch");
  return receipt;
}
export async function writeCoordinatorCommand(runKey: string, action: "review" | "dispatch" | "discard",
  value: CoordinatorReviewInput | string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const input = typeof value === "string" ? null : coordinatorReviewInputSchema.parse(value);
  if (action === "review" ? !input || input.runKey !== runKey : typeof value !== "string") throw new Error("Invalid command action");
  const id = input?.id ?? uuid(String(value));
  const endpoint = action === "review" ? `${path(runKey)}/reviews` : `${path(runKey)}/${uuid(id)}/${action}`;
  const receipt = await fetchPrivateJson(endpoint, signal, (url, options) => fetcher(url, {
    ...options, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input ?? {}),
  }), value => envelope.parse(value).receipt);
  if (receipt.runKey !== runKey || receipt.id !== id || input && (receipt.kind !== input.kind || receipt.expiresAt !== input.expiresAt))
    throw new Error("Command acknowledgement mismatch");
  return receipt;
}
export function mergeCoordinatorCommands(previous: CoordinatorReceipt[], incoming: CoordinatorReceipt[]) {
  return incoming.map(receipt => {
    const old = previous.find(item => item.id === receipt.id && item.runKey === receipt.runKey);
    if (!old) return receipt;
    if (old.state === "intent_saved" && receipt.state !== "intent_saved") return old;
    return Date.parse(old.updatedAt) > Date.parse(receipt.updatedAt) ? old : receipt;
  });
}

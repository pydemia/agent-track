import { z } from "zod";
import { successorPanelSchema, successorReceiptSchema, successorReviewInputSchema,
  type SuccessorReviewInput, type SuccessorReceipt, type SuccessorPanel } from "../../../packages/contracts/run-successors.ts";
import { fetchPrivateJson } from "./private-json.ts";

const receiptEnvelope = z.object({ receipt: successorReceiptSchema }).strict();
const path = (runKey: string) => `/api/runs/${encodeURIComponent(runKey)}/successor-commands`;
const idValue = (id: string) => z.uuid().parse(id).toLowerCase();
export const successorRunKey = (sourceId: string, runId: string) =>
  btoa(JSON.stringify([sourceId, runId])).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
export const selectSuccessorKind = (selected: SuccessorReviewInput["kind"], available: SuccessorReviewInput["kind"][]) =>
  available.includes(selected) ? selected : available[0];
const validReceipt = (receipt: SuccessorReceipt) => {
  if (successorRunKey(receipt.sourceId, receipt.runId) !== receipt.runKey) throw new Error("Run tuple mismatch");
  return receipt;
};
export const readSuccessors = (runKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SuccessorPanel> =>
  fetchPrivateJson(path(runKey), signal, fetcher, value => {
    const result = successorPanelSchema.parse(value);
    result.receipts.forEach(validReceipt);
    if (result.availability.runKey !== runKey || result.receipts.some(receipt => receipt.runKey !== runKey)) throw new Error("Command scope mismatch");
    return result;
  });
export async function readSuccessor(runKey: string, id: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SuccessorReceipt> {
  const receipt = await fetchPrivateJson(`${path(runKey)}/${idValue(id)}`, signal, fetcher, value => receiptEnvelope.parse(value).receipt);
  validReceipt(receipt);
  if (receipt.runKey !== runKey || receipt.id !== idValue(id)) throw new Error("Command receipt mismatch");
  return receipt;
}
export async function writeSuccessor(runKey: string, action: "review" | "dispatch" | "discard", value: SuccessorReviewInput | string,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SuccessorReceipt> {
  const input = typeof value === "string" ? null : successorReviewInputSchema.parse(value);
  if (action === "review" ? !input || input.runKey !== runKey : typeof value !== "string") throw new Error("Invalid command action");
  const id = input?.id ?? idValue(String(value));
  const endpoint = action === "review" ? `${path(runKey)}/reviews` : `${path(runKey)}/${idValue(id)}/${action}`;
  const result = await fetchPrivateJson(endpoint, signal,
    (url, options) => fetcher(url, { ...options, method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(input ?? {}) }), value => receiptEnvelope.parse(value).receipt);
  validReceipt(result);
  if (result.id !== idValue(id) || result.runKey !== runKey || input && (result.kind !== input.kind || result.expiresAt !== input.expiresAt))
    throw new Error("Command acknowledgement mismatch");
  return result;
}

/** Only the current authorized window is retained; observed admission never rolls back. */
export function mergeSuccessors(previous: SuccessorReceipt[], incoming: SuccessorReceipt[]): SuccessorReceipt[] {
  return incoming.map(receipt => {
    const old = previous.find(item => item.id === receipt.id && item.runKey === receipt.runKey);
    if (!old) return receipt;
    if (old.state === "accepted" && receipt.state !== "accepted") return old;
    if (old.state === "accepted" && old.observationState === "observed" && receipt.state === "accepted" && receipt.observationState === "pending") return old;
    return Date.parse(old.updatedAt) > Date.parse(receipt.updatedAt) ? old : receipt;
  });
}

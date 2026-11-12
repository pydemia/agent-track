import { z } from "zod";
import { saveFlowViewSchema, savedFlowViewSchema, type FlowViewContent, type SavedFlowView } from "../../../packages/contracts/flow-views.ts";
import { fetchPrivateJson, PrivateReadError } from "./private-json.ts";

export { PrivateReadError as FlowViewsReadError };
const listSchema = z.object({ actor: z.string().min(1), views: z.array(savedFlowViewSchema).max(20) }).strict();
const saveSchema = z.object({ actor: z.string().min(1), view: savedFlowViewSchema }).strict();

export async function flowViewContextId(scope: string): Promise<string> {
  if (!scope || scope.length > 8192) throw new PrivateReadError("failure");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchFlowViews(actor: string, contextId: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SavedFlowView[]> {
  if (!actor || !/^[a-f0-9]{64}$/.test(contextId)) throw new PrivateReadError("failure");
  return fetchPrivateJson(`/api/flow-views?contextId=${contextId}`, signal, fetcher, raw => {
    const value = listSchema.parse(raw);
    if (value.actor !== actor || value.views.some(view => view.content.contextId !== contextId) || new Set(value.views.map(view => view.id)).size !== value.views.length)
      throw new PrivateReadError("failure");
    return value.views;
  });
}

export async function saveFlowView(actor: string, id: string, expectedRevision: number, content: FlowViewContent,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SavedFlowView> {
  const body = saveFlowViewSchema.safeParse({ id, expectedRevision, content });
  if (!actor || !body.success) throw new PrivateReadError("failure");
  const mutation: typeof fetch = (url, options) => fetcher(url, { ...options, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body.data) });
  return fetchPrivateJson("/api/flow-views", signal, mutation, raw => {
    const value = saveSchema.parse(raw);
    if (value.actor !== actor || value.view.id !== id || value.view.revision !== expectedRevision + 1 || JSON.stringify(value.view.content) !== JSON.stringify(body.data.content)) throw new PrivateReadError("failure");
    return value.view;
  });
}

export async function removeFlowView(actor: string, view: SavedFlowView, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<void> {
  const checked = savedFlowViewSchema.safeParse(view);
  if (!actor || !checked.success) throw new PrivateReadError("failure");
  const mutation: typeof fetch = (url, options) => fetcher(url, { ...options, method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: view.revision }) });
  await fetchPrivateJson(`/api/flow-views/${view.id}`, signal, mutation, raw => {
    const value = z.object({ actor: z.string(), deleted: z.literal(true) }).strict().parse(raw);
    if (value.actor !== actor) throw new PrivateReadError("failure");
  });
}

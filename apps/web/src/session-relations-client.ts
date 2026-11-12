import type { RunView } from "../../../packages/contracts/index.ts";
import { sessionRelationsEvidenceSchema, type SessionRelationKind, type SessionRelationsEvidence } from "../../../packages/contracts/session-relations.ts";
import { PrivateReadError, fetchPrivateJson } from "./private-json.ts";

export async function fetchSessionRelations(run: Pick<RunView, "key" | "sourceId" | "sessionId">,
  kind: SessionRelationKind, cursor: string | null, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SessionRelationsEvidence> {
  if (!/^[A-Za-z0-9_-]+$/.test(run.key) || !["managed-children", "peer-processing"].includes(kind) ||
      cursor !== null && !/^[A-Za-z0-9_-]{40,1024}$/.test(cursor)) throw new PrivateReadError("failure");
  const query = new URLSearchParams({ kind, ...(cursor ? { cursor } : {}) });
  return fetchPrivateJson(`/api/runs/${encodeURIComponent(run.key)}/session-relations?${query}`, signal, fetcher, raw => {
    const value = sessionRelationsEvidenceSchema.parse(raw);
    if (value.runKey !== run.key || value.sourceId !== run.sourceId || value.sessionId !== run.sessionId || value.kind !== kind) throw new PrivateReadError("failure");
    return value;
  });
}

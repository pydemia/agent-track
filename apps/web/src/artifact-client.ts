import type { ArtifactEvidence, RunView } from "../../../packages/contracts/index.ts";
import { parseArtifactEvidence } from "../../../packages/contracts/artifacts.ts";
import { PrivateReadError, fetchPrivateJson } from "./private-json.ts";

export async function fetchArtifactEvidence(run: Pick<RunView, "key" | "runId" | "sessionId">,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ArtifactEvidence> {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(run.key)) throw new PrivateReadError("failure");
  return fetchPrivateJson(`/api/runs/${encodeURIComponent(run.key)}/artifacts`, signal, fetcher, raw => {
    const value = parseArtifactEvidence(raw);
    if (value.runKey !== run.key || value.artifacts.some(row => row.runId !== run.runId || row.sessionId !== run.sessionId)) throw new PrivateReadError("failure");
    return value;
  });
}

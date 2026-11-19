import type { RunView } from "../../../packages/contracts/index.ts";
import { runContentViewSchema, type RunContentView } from "../../../packages/contracts/work-content.ts";
import { fetchPrivateJson, PrivateReadError } from "./private-json.ts";

export async function fetchRunContent(run: RunView, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RunContentView> {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(run.key)) throw new PrivateReadError("failure");
  return fetchPrivateJson(`/api/runs/${run.key}/content`, signal, fetcher, raw => {
    const value = runContentViewSchema.parse(raw), ref = run.assistantAttempt;
    if (value.runKey !== run.key || value.sourceId !== run.sourceId || value.runId !== run.runId || value.sessionId !== run.sessionId ||
        value.state === "connected" && ref && (!value.attempt || value.attempt.sourceId !== ref.assistantSourceId ||
          value.attempt.executionId !== ref.executionId || value.attempt.roleId !== ref.roleId || value.attempt.attemptId !== ref.attemptId || value.attempt.ordinal !== ref.ordinal))
      throw new PrivateReadError("failure");
    return value;
  });
}

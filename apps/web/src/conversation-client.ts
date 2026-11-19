import type { RunView } from "../../../packages/contracts/index.ts";
import { runConversationViewSchema, conversationCursorSchema, type RunConversationView } from "../../../packages/contracts/conversation.ts";
import { fetchPrivateJson } from "./private-json.ts";

export function fetchConversation(run: RunView, after: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RunConversationView> {
  conversationCursorSchema.parse(after);
  return fetchPrivateJson(`/api/runs/${run.key}/conversation?after=${after}&limit=20`, signal, fetcher, raw => {
    const value = runConversationViewSchema.parse(raw), expected = run.assistantAttempt;
    if (value.runKey !== run.key || value.sourceId !== run.sourceId || value.runId !== run.runId || value.sessionId !== run.sessionId ||
        value.page && (value.page.after !== after || value.page.limit !== 20 || value.page.run.workspaceId !== run.workspaceId) ||
        value.state === "connected" && (expected ? !value.attempt || value.attempt.sourceId !== expected.assistantSourceId ||
          value.attempt.executionId !== expected.executionId || value.attempt.roleId !== expected.roleId || value.attempt.attemptId !== expected.attemptId ||
          value.attempt.ordinal !== expected.ordinal : value.attempt !== null)) throw Error("Conversation identity changed");
    return value;
  });
}

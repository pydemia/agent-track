import type { RunView } from "../../../packages/contracts/index.ts";
import { runConversationViewSchema, conversationCursorSchema, type RunConversationView } from "../../../packages/contracts/conversation.ts";
import { fetchPrivateJson } from "./private-json.ts";
import { conversationMatches } from "../../../packages/projection/conversation-reading.ts";
import type { MissionNode } from "../../../packages/projection/mission-flow.ts";

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

export async function fetchConversationWindow(run: RunView, cursor: string, node: MissionNode | undefined,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ value: RunConversationView; searched: number }> {
  let after = cursor;
  const seen = new Set<string>();
  for (let searched = 1; searched <= 5; searched++) {
    if (seen.has(after)) throw Error("Repeated conversation cursor");
    seen.add(after);
    const value = await fetchConversation(run, after, signal, fetcher), page = value.page;
    if (page?.next && seen.has(page.next)) throw Error("Repeated conversation cursor");
    if (searched === 5 || !page?.next || page.entries.some(entry => conversationMatches(entry, node))) return { value, searched };
    after = page.next;
  }
  throw Error("Conversation search did not terminate");
}

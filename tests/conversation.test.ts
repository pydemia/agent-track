import assert from "node:assert/strict";
import test from "node:test";
import { conversationPageSchema, runConversationViewSchema } from "../packages/contracts/conversation.ts";
import { fetchConversation } from "../apps/web/src/conversation-client.ts";
import { runConversation } from "../apps/api/run-conversation.ts";
import { externalKey, type RunView, type Snapshot } from "../packages/contracts/index.ts";
import type { Config } from "../apps/api/config.ts";
import { createTrackServer } from "../apps/api/server.ts";
import { Store } from "../packages/storage/store.ts";
import { listenHttp } from "./helpers/http-listen.ts";
import { conversationMatches } from "../apps/web/src/ConversationPanel.tsx";
import type { MissionNode } from "../packages/projection/mission-flow.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-19T00:00:00.000Z", user = "owner@example.test";
const page = () => conversationPageSchema.parse({ version: 1, object: "demian.run_conversation_page", run: { id: id(1), sessionId: id(2), workspaceId: id(3) },
  after: "0", limit: 20, through: "9007199254740993", next: null, recording: "messages-v2", incomplete: false, terminal: true,
  entries: [{ id: "9007199254740993:0:0", messageId: "9007199254740993", sequence: "1", part: 0, offset: 0, end: 4, total: 4,
    occurredAt: at, kind: "tool-result", role: "tool", text: "원본응답", tool: "read", callId: "call", isError: false, contentSource: "original", observation: null }] });
function run(): RunView {
  return { sourceId: "protected", runId: id(1), key: externalKey("protected", id(1)), sessionId: id(2), workspaceId: id(3),
    title: "업무 검증", status: "succeeded", createdAt: at, startedAt: at, completedAt: at, observedAt: at, cursor: "0", highWater: "0",
    incomplete: false, stale: false, sourceLabel: "Protected", device: "test", sourceState: "connected", sourceUrl: null,
    workspaceKey: null, projectKey: null, capabilities: [], binding: null,
    assistantAttempt: { assistantSourceId: "assistant", executionId: id(4), roleId: id(5), attemptId: id(6), ordinal: 1, command: null } };
}
function content() { return { version: 1 as const, executionId: id(4), roleId: id(5), attemptId: id(6), ordinal: 1, current: false, page: page() }; }
function config() { return { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user },
  sources: [{ id: "protected", kind: "demian", label: "Protected", device: "test", users: [user], assistantNativeSourceId: "assistant", repositoryRoots: [] }] } as unknown as Config; }

test("conversation contracts reject corrupt fragments, unsafe IDs, internal fields and unexpected message kinds", () => {
  const p = page(); assert.equal(p.entries[0]!.text, "원본응답");
  for (const patch of [{ messageId: "garbage" }, { sequence: "9223372036854775808" }, { role: "system" }, { kind: "reasoning" },
    { end: 3 }, { offset: 1 }, { contentSource: "original", credential: "private" }]) {
    assert.equal(conversationPageSchema.safeParse({ ...p, entries: [{ ...p.entries[0], ...patch }] }).success, false);
  }
  assert.equal(conversationPageSchema.safeParse({ ...p, entries: [p.entries[0], p.entries[0]] }).success, false);
  assert.equal(conversationPageSchema.safeParse({ ...p, through: "0" }).success, false);
});

test("tool selection never combines identical local call IDs from different Agent invocations", () => {
  const entry = page().entries[0]!, node = { kind: "tool", callId: "call", invocationId: "child-1" } as MissionNode;
  assert.equal(conversationMatches(entry, node), false);
  const observation = { invocationId: "child-1", parentInvocationId: "root", agentSessionId: "child-session", agent: "Child" };
  assert.equal(conversationMatches({ ...entry, observation }, node), true);
  assert.equal(conversationMatches({ ...entry, observation: { ...observation, invocationId: "child-2" } }, node), false);
  assert.equal(conversationMatches(entry, { kind: "tool", callId: "call" } as MissionNode), true);
  assert.equal(conversationMatches({ ...entry, observation }, { kind: "tool", callId: "call" } as MissionNode), false);
});

test("browser pages are bound to exact Run, Session, workspace, attempt and requested cursor", async () => {
  const r = run(), ref = r.assistantAttempt!;
  const value = { version: 1, runKey: r.key, sourceId: r.sourceId, runId: r.runId, sessionId: r.sessionId, state: "connected", page: page(),
    attempt: { sourceId: ref.assistantSourceId, executionId: ref.executionId, roleId: ref.roleId, attemptId: ref.attemptId, ordinal: 1, current: false }, detail: "" };
  const fetcher = async (url: unknown) => { assert.match(String(url), /conversation\?after=0&limit=20$/); return Response.json(value); };
  assert.equal((await fetchConversation(r, "0", new AbortController().signal, fetcher)).page?.entries[0]!.text, "원본응답");
  for (const changed of [
    { ...value, runId: id(9) }, { ...value, page: { ...value.page, run: { ...value.page.run, workspaceId: id(9) } } },
    { ...value, attempt: { ...value.attempt, attemptId: id(9) } }, { ...value, page: { ...value.page, after: "different" } },
  ]) await assert.rejects(fetchConversation(r, "0", new AbortController().signal, async () => Response.json(changed)));
});

test("conversation BFF discards body when source or project access changes during the async read", async () => {
  const settings = config(), r = run();
  const snapshot = { runs: [r], sources: [{ id: r.sourceId, state: "connected" }] } as unknown as Snapshot;
  let reads = 0;
  const sources = { projects: { refresh: async () => {} }, assistant: { attemptConversation: async () => { reads++; settings.sources[0]!.users = []; return content(); } } };
  await assert.rejects(runConversation(() => settings, () => snapshot, sources as never, user, r.key, "0", 20));
  assert.equal(reads, 1);
  r.sourceState = "forbidden"; settings.sources[0]!.users = [user];
  const denied = await runConversation(() => settings, () => snapshot, sources as never, user, r.key, "0", 20);
  assert.equal(denied.page, null); assert.equal(reads, 1);
});

test("HTTP conversation uses a stable protected view and rejects malformed queries before body reads", async t => {
  const r = run(), store = new Store(":memory:"), settings = config(); let admitted = false, reads = 0;
  const key = store.observeRun({ sourceId: r.sourceId, runId: r.runId, sessionId: r.sessionId, workspaceId: r.workspaceId, title: r.title, status: "succeeded",
    createdAt: at, startedAt: at, completedAt: at, observedAt: new Date().toISOString(), assistantAttempt: r.assistantAttempt! });
  const sources = { views: () => [{ id: r.sourceId, kind: "demian", label: "Protected", device: "test", state: admitted ? "connected" : "forbidden",
    capabilities: [], lastObservedAt: at, detail: "", authorizedRunIds: admitted ? [r.runId] : [] }], projects: { refresh: async () => {} },
    assistantNative: { hasFreshReadView: () => true, withStableView: async (_user: string, _source: string, read: () => Promise<unknown>) => {
      admitted = true; try { return await read(); } finally { admitted = false; }
    } }, assistant: { attemptConversation: async () => { assert.equal(admitted, true); reads++; return content(); } } };
  const { server } = createTrackServer(store, () => settings, "dist/web", sources as never), origin = await listenHttp(server);
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); store.close(); });
  const url = `${origin}/api/runs/${key}/conversation`;
  for (const query of ["", "?after=%30&limit=20", "?after=0&limit=51", "?after=0&limit=20&latest=1", "?limit=20&after=0"])
    assert.equal((await fetch(url + query)).status, 400);
  assert.equal((await fetch(url + "?after=0&limit=20", { method: "POST" })).status, 405); assert.equal(reads, 0);
  const response = await fetch(url + "?after=0&limit=20"), value = runConversationViewSchema.parse(await response.json());
  assert.equal(value.page?.entries[0]!.text, "원본응답"); assert.equal(reads, 1); assert.equal(admitted, false);
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

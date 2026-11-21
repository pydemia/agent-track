import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadableText, readableUrl } from "../apps/web/src/ReadableText.tsx";
import { fetchConversationWindow } from "../apps/web/src/conversation-client.ts";
import { toolWorkTitle, withConversationLabels, readingFlow, focusedFlow } from "../packages/projection/conversation-reading.ts";
import { conversationPageSchema, type ConversationEntry, type RunConversationView } from "../packages/contracts/conversation.ts";
import { externalKey, type RunView } from "../packages/contracts/index.ts";
import { missionFlow, missionEntityKey, type MissionNode } from "../packages/projection/mission-flow.ts";
import { nativeFlowGroupDefinitions } from "../packages/projection/flow-group-definitions.ts";
import { projectFlowGroups } from "../packages/projection/flow-groups.ts";
import { LocalToolContent, localToolMessages } from "../apps/web/src/LocalToolContent.tsx";
import { contentText, type WorkContent } from "../packages/contracts/work-content.ts";
import { WorkContentPanel } from "../apps/web/src/WorkContentPanel.tsx";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-21T00:00:00Z";
const run: RunView = { key: externalKey("native", id(1)), sourceId: "native", sourceLabel: "Demian", sourceState: "connected", sourceUrl: null,
  runId: id(1), sessionId: id(2), workspaceId: id(3), title: "업무 안내 작성", status: "succeeded", createdAt: at, startedAt: at, completedAt: at,
  observedAt: at, cursor: "0", highWater: "0", incomplete: false, stale: false, device: "test", workspaceKey: null, projectKey: null, binding: null, capabilities: [] };
const node: MissionNode = { key: missionEntityKey(run.sourceId, "tool", "call", run.runId), sourceId: run.sourceId, runKey: run.key,
  kind: "tool", id: "call", callId: "call", invocationId: "child", label: "read_file", description: "", status: "completed", details: [], sequences: [] };
function entry(invocation = "child", text = '{"path":"docs/conversation.md"}'): ConversationEntry {
  return { id: "1:0:0", messageId: "1", sequence: "1", part: 0, offset: 0, end: text.length, total: text.length, occurredAt: at,
    kind: "tool-call", role: "assistant", tool: "read_file", callId: "call", text, isError: null, contentSource: "original",
    observation: { invocationId: invocation, parentInvocationId: "root", agentSessionId: "session", agent: "文書検討 Agent" } };
}
function view(after: string, invocation: string, next: string | null = null): RunConversationView {
  return { version: 1, runKey: run.key, sourceId: run.sourceId, runId: run.runId, sessionId: run.sessionId, state: "connected", attempt: null, detail: "",
    page: conversationPageSchema.parse({ version: 1, object: "demian.run_conversation_page", run: { id: run.runId, sessionId: run.sessionId, workspaceId: run.workspaceId },
      after, limit: 20, through: "1", next, entries: [entry(invocation)], recording: "messages-v2", incomplete: false, terminal: true }) };
}

test("read mode renders headings, tables, code and safe links without executable HTML or automatic image requests", () => {
  const text = '# 결과\n\n| 작업 | 상태 |\n| --- | --- |\n| 읽기 | 확인 |\n\n```js\nalert("표시만")\n```\n\n[원본](https://example.test/doc) [차단](javascript:alert%281%29) ![그림](https://example.test/tracker.png)\n<script>alert(1)</script>';
  const html = renderToStaticMarkup(createElement(ReadableText, { text }));
  assert.match(html, /<h1>결과<\/h1>/); assert.match(html, /<table>/); assert.match(html, /<pre><code/);
  assert.match(html, /href="https:\/\/example.test\/doc"/); assert.doesNotMatch(html, /<script|<img|href="javascript:|src="https:/);
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///private", "/source-relative", "//tracker.test/a", "https://user:pass@example.test", "https:\n//example.test"]) assert.equal(readableUrl(url), undefined);
  assert.equal(readableUrl("mailto:owner@example.test"), "mailto:owner@example.test");
});

test("node display names use the exact invocation's original complete tool input and keep IDs/states unchanged", () => {
  const other = { ...entry("other"), text: '{"path":"private/other.md"}' };
  assert.equal(toolWorkTitle("read_file", [entry()]), "문서 읽기 · conversation.md");
  assert.equal(toolWorkTitle("read_file", [{ ...entry(), offset: 1 }]), "read_file");
  assert.equal(toolWorkTitle("read_file", [{ ...entry(), contentSource: "preview" }]), "read_file");
  assert.equal(toolWorkTitle("read_file", [entry(), other]), "read_file");
  const invocation = { ...node, key: "child", kind: "invocation", id: "child", label: "호출 child" };
  const base = { ...missionFlow(run, [run], [], []), nodes: [node, invocation] };
  const before = JSON.stringify(base), output = withConversationLabels(base, run, view("0", "child"));
  assert.equal(output.nodes[0]?.label, "문서 읽기 · conversation.md"); assert.equal(output.nodes[1]?.label, "文書検討 Agent");
  assert.equal(output.nodes[0]?.key, node.key); assert.equal(output.nodes[0]?.status, node.status); assert.equal(JSON.stringify(base), before);
  assert.equal(withConversationLabels(base, run, { ...view("0", "child"), runKey: "wrong" }).nodes[0]?.label, "read_file");
});

test("scoped v1 fallback finds later matching pages without substituting a different Agent's call", async () => {
  const seen: string[] = [];
  const fetcher: typeof fetch = async url => { const after = new URL(String(url), "http://test").searchParams.get("after")!; seen.push(after);
    return Response.json(view(after, after === "b" ? "child" : "other", after === "0" ? "a" : after === "a" ? "b" : null)); };
  const result = await fetchConversationWindow(run, "0", node, new AbortController().signal, fetcher);
  assert.deepEqual(seen, ["0", "a", "b"]); assert.equal(result.searched, 3); assert.equal(result.value.page?.after, "b");
  assert.equal(result.value.page?.entries[0]?.observation?.invocationId, "child");
});

test("scoped search is bounded, detects repeated cursors, propagates permission loss and rejects changed attempts", async () => {
  let count = 0;
  const fetcher: typeof fetch = async url => { const after = new URL(String(url), "http://test").searchParams.get("after")!;
    count++; return Response.json(view(after, "other", String(count))); };
  const result = await fetchConversationWindow(run, "0", node, new AbortController().signal, fetcher);
  assert.equal(count, 5); assert.equal(result.searched, 5); assert.equal(result.value.page?.next, "5");
  await assert.rejects(fetchConversationWindow(run, "0", node, new AbortController().signal, async () => Response.json(view("0", "other", "0"))), /Repeated/);
  let n = 0;
  await assert.rejects(fetchConversationWindow(run, "0", node, new AbortController().signal, async () => ++n === 1 ? Response.json(view("0", "other", "1")) : new Response(null, { status: 403 })));
  await assert.rejects(fetchConversationWindow(run, "0", node, new AbortController().signal, async () => Response.json({ ...view("0", "child"), runId: id(99) })));
});

test("Map removes execution detail while Trace defaults to work; technical toggle restores original endpoints", () => {
  const base = { ...missionFlow(run, [run], [], []), nodes: [node, { ...node, key: "model", kind: "model-request" }, { ...node, key: "run", kind: "run" }],
    edges: [{ key: "e", from: "run", to: node.key, kind: "tool-of", label: "도구 호출", detail: "explicit", sourceId: run.sourceId, sequences: [] }] };
  assert.equal(readingFlow(base, "execution", false).nodes.length, 2);
  assert.deepEqual(readingFlow(base, "mission", false).nodes.map(item => item.key), ["run"]);
  assert.equal(readingFlow(base, "mission", false).edges.length, 0); assert.equal(readingFlow(base, "execution", true), base);
});

test("entering an Agent bundle removes surrounding hierarchy but preserves original boundary evidence", () => {
  const root = { ...node, key: "root", id: run.runId, kind: "run" };
  const agent = { ...node, key: "agent", id: "child", kind: "invocation" };
  const base = { ...missionFlow(run, [run], [], []), nodes: [root, agent, node], edges: [
    { key: "root-agent", from: "root", to: "agent", kind: "invocation-root", label: "실행 호출", detail: "원본", sourceId: run.sourceId, sequences: [] },
    { key: "agent-tool", from: "agent", to: node.key, kind: "tool-of", label: "도구 호출", detail: "원본", sourceId: run.sourceId, sequences: [] }] };
  const projection = projectFlowGroups(base, nativeFlowGroupDefinitions(base, "run"), new Set());
  const group = projection.groups.find(item => item.kind === "invocation")!;
  const focused = focusedFlow(projection.nodes, projection.edges, projection.parents, projection.groups, group.key);
  assert(focused.nodes.some(item => item.key === node.key)); assert(focused.nodes.some(item => item.key === group.key));
  assert(!focused.nodes.some(item => item.key === "root")); assert(focused.edges.every(edge => focused.nodes.some(item => item.key === edge.from) && focused.nodes.some(item => item.key === edge.to)));
  assert(base.edges.some(edge => edge.key === "root-agent"));
  const boundary = focusedFlow(projection.nodes, projection.edges, projection.parents, projection.groups, group.key, ["root", "agent"]);
  assert.equal(boundary.nodes, projection.nodes); assert.equal(boundary.edges, projection.edges);
});

test("local turn tools remain readable without a conversation journal and cannot borrow another call or invocation", () => {
  const content: WorkContent = { title: "로컬 도구 검사", purpose: null, acceptanceCriteria: [], steps: [], result: null, failure: null,
    coverage: "local-session-turn", incomplete: false, observedAt: at, messages: [
      { id: "in", role: "tool", callId: "call", tool: "read_file", text: contentText('{"path":"docs/local.md"}'), occurredAt: at },
      { id: "out", role: "tool", callId: "call", tool: "read_file", text: contentText("LOCAL_ORIGINAL_OUTPUT"), occurredAt: at },
      { id: "other", role: "tool", callId: "other", tool: "read_file", text: contentText("OTHER_CALL_OUTPUT"), occurredAt: at }] };
  const { invocationId: _invocation, ...localNode } = node;
  const html = renderToStaticMarkup(createElement(LocalToolContent, { content, node: localNode }));
  assert.match(html, /docs\/local.md/); assert.match(html, /LOCAL_ORIGINAL_OUTPUT/); assert.doesNotMatch(html, /OTHER_CALL_OUTPUT/);
  assert.equal(localToolMessages(content).length, 3); assert.equal(localToolMessages(content, node).length, 0);
  assert.equal(localToolMessages({ ...content, coverage: "native-message-journal" }, localNode).length, 0);
  const read = { value: { version: 1 as const, runKey: run.key, sourceId: run.sourceId, runId: run.runId, sessionId: run.sessionId,
    state: "connected" as const, attempt: null, content, detail: "" }, busy: false, error: false, retry: () => {} };
  const panel = renderToStaticMarkup(createElement(WorkContentPanel, { run, read, node: localNode }));
  assert.match(panel, /LOCAL_ORIGINAL_OUTPUT/); assert.doesNotMatch(panel, /OTHER_CALL_OUTPUT/);
});

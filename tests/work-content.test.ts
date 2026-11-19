import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentText, workContentSchema } from "../packages/contracts/work-content.ts";
import { readCodexContent } from "../packages/adapters/codex/content.ts";
import { withWorkContent } from "../packages/projection/work-content-flow.ts";
import { missionFlow } from "../packages/projection/mission-flow.ts";
import { externalKey, type RunView, type Snapshot } from "../packages/contracts/index.ts";
import type { Config } from "../apps/api/config.ts";
import { runContent } from "../apps/api/run-content.ts";
import { createServer } from "node:http";
import { createTrackServer } from "../apps/api/server.ts";
import { Store } from "../packages/storage/store.ts";
import { listenHttp } from "./helpers/http-listen.ts";
import { fetchRunContent } from "../apps/web/src/work-content-client.ts";

const at = "2026-11-19T00:00:00.000Z", user = "owner@example.test";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const content = () => workContentSchema.parse({ title: "권한 오류 수정", purpose: contentText("업무 결과를 안전하게 게시한다"),
  acceptanceCriteria: [], steps: [{ id: "fix", title: "게시 권한을 확인한다", status: "failed", detail: null }],
  messages: [{ id: "request", role: "user", text: contentText("권한을 점검해 주세요"), occurredAt: null, tool: null, callId: null }],
  result: null, failure: { code: "permission_denied", message: contentText("게시 권한이 철회되었습니다"), basis: "native" },
  coverage: "request-response", incomplete: false, observedAt: at });
function run(): RunView {
  return { sourceId: "protected", runId: id(1), key: externalKey("protected", id(1)), sessionId: id(2), workspaceId: id(3),
    title: id(1), status: "failed", createdAt: at, startedAt: at, completedAt: at, observedAt: at, cursor: "0", highWater: "0",
    incomplete: false, stale: false, sourceLabel: "Protected", device: "test", sourceState: "connected", sourceUrl: null,
    workspaceKey: null, projectKey: null, capabilities: [], binding: { sourceId: "protected", runId: id(1),
      projectSourceId: "projects", projectId: "project", taskId: "task", taskRevision: "1", projectTitle: "보호 업무", taskTitle: "결과 게시", provenance: "source" },
    assistantAttempt: { assistantSourceId: "assistant", executionId: id(4), roleId: id(5), attemptId: id(6), ordinal: 1, command: null } };
}
test("content graph names the work and connects the exact request, role work and failure without invented dependencies", () => {
  const r = run(), c = content(), flow = withWorkContent(missionFlow(r, [r], [], []), r, c);
  assert.ok(flow.nodes.some(node => node.label === "시도 1 · 결과 게시"));
  assert.ok(flow.nodes.some(node => node.label === "게시 권한을 확인한다"));
  assert.ok(flow.nodes.some(node => node.label === "게시 권한이 철회되었습니다"));
  assert.ok(!flow.nodes.some(node => node.kind === "work-response"));
  assert.ok(flow.nodes.filter(node => node.kind.startsWith("work-")).every(node => node.runKey === r.key));
  assert.ok(!flow.edges.some(edge => edge.kind === "dependency"));
});
test("source-bound work is a readable Task node only for the exact selected run", () => {
  const r = run(), flow = missionFlow(r, [r], [], [], { mode: "mission" });
  const task = flow.nodes.find(node => node.kind === "task");
  assert.equal(task?.label, "결과 게시");
  assert.deepEqual(task?.taskRef, { sourceId: "projects", projectId: "project", taskId: "task" });
  assert.ok(task?.details.some(detail => detail.label === "프로젝트 이름" && detail.value === "보호 업무"));
  assert.ok(flow.edges.some(edge => edge.kind === "task-binding" && edge.from === task?.key));
  assert.equal(missionFlow({ ...r, binding: { ...r.binding!, runId: id(99) } }, [r], [], [], { mode: "mission" }).nodes.some(node => node.kind === "task"), false);
});
test("inline protected reads use only exact attempt authority and discard bodies after Project withdrawal", async () => {
  for (const withdraw of [false, true]) {
    const r = run(); let reads = 0, refreshes = 0;
    const config = { auth: { mode: "proxy", users: [user] }, sources: [{ id: "protected", kind: "demian", users: [user],
      assistantNativeSourceId: "assistant", baseUrl: "http://must-never-fallback.invalid", repositoryRoots: [] }] } as unknown as Config;
    const snapshot = () => ({ runs: [r], sources: [{ id: "protected", state: "connected" }, { id: "projects", kind: "projects", state: "connected",
      authorizedProjectIds: withdraw && refreshes > 1 ? [] : ["project"] }] }) as unknown as Snapshot;
    const sources = { projects: { refresh: async () => { refreshes++; } }, assistant: { attemptContent: async (...args: unknown[]) => {
      reads++; assert.deepEqual(args.slice(0, 5), [user, "assistant", id(4), id(5), id(6)]);
      assert.deepEqual(args[5], { sourceId: "protected", runId: id(1), sessionId: id(2), workspaceId: id(3) });
      return { version: 1, executionId: id(4), roleId: id(5), attemptId: id(6), ordinal: 1, current: false, state: "failed",
        run: { id: id(1), sessionId: id(2), workspaceId: id(3) }, content: content() };
    } } };
    const read = () => runContent(() => config, snapshot, sources as never, user, r.key);
    if (withdraw) await assert.rejects(read, /현재 접근 가능한 업무/);
    else { const value = await read(); assert.equal(value.content?.failure?.message?.text, "게시 권한이 철회되었습니다"); assert.equal(value.attempt?.current, false); }
    assert.equal(reads, 1);
  }
});
test("missing attempt identity cannot trigger an ordinary Demian credential fallback", async () => {
  const r = run(); delete r.assistantAttempt;
  const config = { auth: { mode: "proxy", users: [user] }, sources: [{ id: "protected", kind: "demian", users: [user], assistantNativeSourceId: "assistant" }] } as unknown as Config;
  const value = await runContent(() => config, () => ({ runs: [r], sources: [{ id: "protected", state: "connected" },
    { id: "projects", kind: "projects", state: "connected", authorizedProjectIds: ["project"] }] }) as unknown as Snapshot,
    { projects: { refresh: async () => {} }, assistant: { attemptContent: () => { throw Error("Unexpected read"); } } } as never, user, r.key);
  assert.equal(value.state, "unsupported"); assert.equal(value.content, null);
});
test("Codex inline content is confined to a known turn and repository; user-visible messages and plans exclude reasoning", async t => {
  const root = await mkdtemp(join(tmpdir(), "track-inline-")), repo = join(root, "repo"), logs = join(root, "logs");
  await mkdir(repo); await mkdir(logs); t.after(() => rm(root, { recursive: true, force: true }));
  const row = (type: string, payload: unknown) => ({ type, payload, timestamp: at });
  const rows = [row("session_meta", { id: "session-a", cwd: repo }),
    row("event_msg", { type: "task_started", turn_id: "old" }), row("event_msg", { type: "user_message", message: "OTHER_TURN" }),
    row("event_msg", { type: "task_complete", turn_id: "old" }), row("event_msg", { type: "task_started", turn_id: "target" }),
    row("event_msg", { type: "user_message", message: "권한 오류를 수정해 주세요" }),
    row("response_item", { type: "reasoning", summary: "PRIVATE_REASONING" }),
    row("response_item", { type: "message", role: "assistant", phase: "analysis", content: [{ text: "PRIVATE_REASONING" }] }),
    row("response_item", { type: "message", role: "system", content: [{ text: "PRIVATE_SYSTEM" }] }),
    row("response_item", { type: "function_call", name: "update_plan", call_id: "plan", arguments: JSON.stringify({ plan: [{ step: "권한 회귀 확인", status: "completed" }] }) }),
    row("event_msg", { type: "agent_message", message: "권한 검증을 완료했습니다" }),
    row("event_msg", { type: "task_complete", turn_id: "target", last_agent_message: "권한 검증을 완료했습니다" }),
    row("event_msg", { type: "task_started", turn_id: "next" }), row("event_msg", { type: "user_message", message: "NEXT_TURN" })];
  await writeFile(join(logs, "rollout-session-a.jsonl"), rows.map(item => JSON.stringify(item)).join("\n") + "\n");
  const options = { sourceId: "codex", logRoot: logs, repositoryRoots: [repo], maxFiles: 100, sinceDays: 30 };
  const c = await readCodexContent(options, "session-a", "target");
  assert.equal(c.title, "권한 오류를 수정해 주세요"); assert.equal(c.result?.text, "권한 검증을 완료했습니다");
  assert.equal(c.steps[0]?.title, "권한 회귀 확인"); assert.equal(c.incomplete, false);
  assert.doesNotMatch(JSON.stringify(c), /PRIVATE_REASONING|PRIVATE_SYSTEM|OTHER_TURN|NEXT_TURN/);
  await assert.rejects(readCodexContent({ ...options, repositoryRoots: [logs] }, "session-a", "target"));
  await assert.rejects(readCodexContent(options, "session-a", "missing"));
});
test("content bounds preserve Unicode and report truncation", () => {
  const value = contentText("a".repeat(31_999) + "😀"); assert.equal(value.truncated, true);
  assert.equal(value.text.length, 31_999); assert.ok(workContentSchema.safeParse(content()).success);
});

test("HTTP inline read returns native conversation and error, rejects query/writes and discards a late actor change", async t => {
  let revoke = false, reads = 0;
  const settings = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user }, sources: [] } as unknown as Config;
  const native = createServer((request, response) => {
    assert.equal(request.method, "GET"); response.setHeader("Content-Type", "application/json");
    if (request.url === `/api/v1/sessions/${id(2)}`) response.end(JSON.stringify({ id: id(2), workspace_id: id(3), title: "업무" }));
    else if (request.url === `/api/v1/runs/${id(1)}`) {
      reads++; if (revoke) settings.auth = { mode: "local", user: "other@example.test" };
      response.end(JSON.stringify({ id: id(1), session_id: id(2), status: "failed", created_at: at, started_at: at, completed_at: at,
        input: [{ type: "input_text", text: "게시 권한을 점검한다" }], output_text: "선택한 시도의 실제 응답", error: { code: "acl_denied", message: "이 시도의 원본 ACL 오류" } }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  const nativeOrigin = await listenHttp(native);
  const source = { id: "native", kind: "demian", label: "Native", device: "test", users: [user], baseUrl: nativeOrigin,
    runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 } as Config["sources"][number];
  settings.sources = [source]; const store = new Store(":memory:"), r = run();
  const key = store.observeRun({ sourceId: source.id, runId: r.runId, sessionId: r.sessionId, workspaceId: r.workspaceId, title: "업무", status: "failed",
    createdAt: at, startedAt: at, completedAt: at, observedAt: new Date().toISOString() });
  const sources = { views: () => [{ id: source.id, kind: "demian", label: "Native", device: "test", state: "connected", capabilities: [], lastObservedAt: at, detail: "" }],
    projects: { refresh: async () => {} }, refreshProjectGrants: async () => { throw Error("Unrelated collector forbidden"); } };
  const { server } = createTrackServer(store, () => settings, "dist/web", sources as never), origin = await listenHttp(server);
  t.after(async () => { for (const item of [server, native]) { item.closeAllConnections(); await new Promise<void>(done => item.close(() => done())); } store.close(); });
  const url = `${origin}/api/runs/${key}/content`;
  assert.equal((await fetch(url + "?latest=1")).status, 400);
  assert.equal((await fetch(url, { method: "POST" })).status, 405); assert.equal(reads, 0);
  const response = await fetch(url), value = await response.json(); assert.equal(response.status, 200);
  assert.equal(value.content.result.text, "선택한 시도의 실제 응답"); assert.equal(value.content.failure.message.text, "이 시도의 원본 ACL 오류");
  assert.equal(value.content.messages[0].text.text, "게시 권한을 점검한다"); assert.match(response.headers.get("cache-control")!, /no-store/);
  revoke = true; const denied = await fetch(url); assert.equal(denied.status, 401); assert.doesNotMatch(await denied.text(), /실제 응답|원본 ACL 오류/);
});

test("browser content parser rejects a different attempt even when run IDs match", async () => {
  const r = run(), value = { version: 1, runKey: r.key, sourceId: r.sourceId, runId: r.runId, sessionId: r.sessionId, state: "connected",
    content: content(), detail: "", attempt: { sourceId: "assistant", executionId: id(4), roleId: id(5), attemptId: id(6), ordinal: 1, current: false } };
  const get = async () => Response.json(value);
  const ok = await fetchRunContent(r, new AbortController().signal, get); assert.equal(ok.content?.title, "권한 오류 수정");
  value.attempt.attemptId = id(7); await assert.rejects(fetchRunContent(r, new AbortController().signal, get));
});

test("protected HTTP content enters the stable collection window before its first snapshot and keeps admission across async reads", async t => {
  let admitted = false, refreshes = 0, reads = 0;
  const r = run(), store = new Store(":memory:");
  const config = { port: 14345, database: ":memory:", publicOrigin: "http://localhost", auth: { mode: "local", user },
    sources: [{ id: r.sourceId, kind: "demian", label: "Protected", device: "test", users: [user], assistantNativeSourceId: "assistant", repositoryRoots: [] }] } as unknown as Config;
  const key = store.observeRun({ sourceId: r.sourceId, runId: r.runId, sessionId: r.sessionId, workspaceId: r.workspaceId, title: "보호 업무", status: "failed",
    createdAt: at, startedAt: at, completedAt: at, observedAt: new Date().toISOString(), assistantAttempt: r.assistantAttempt! });
  const sources = { views: () => [{ id: r.sourceId, kind: "demian", label: "Protected", device: "test", state: admitted ? "connected" : "forbidden",
    capabilities: [], lastObservedAt: at, detail: "", authorizedRunIds: admitted ? [r.runId] : [] }],
    projects: { refresh: async () => {} }, refreshProjectGrants: async () => { throw Error("Unrelated collector forbidden"); },
    assistantNative: {
      hasFreshReadView: () => false,
      refresh: async (actor: string, sourceId: string) => { assert.equal(actor, user); assert.equal(sourceId, r.sourceId); refreshes++; },
      withStableView: async (_actor: string, sourceId: string, read: () => Promise<unknown>) => {
        assert.equal(sourceId, r.sourceId); admitted = true; try { return await read(); } finally { admitted = false; }
      },
    }, assistant: { attemptContent: async () => {
      assert.equal(admitted, true); reads++; await Promise.resolve(); assert.equal(admitted, true);
      return { version: 1, executionId: id(4), roleId: id(5), attemptId: id(6), ordinal: 1, current: false, state: "failed", run: { id: id(1), sessionId: id(2), workspaceId: id(3) }, content: content() };
    } },
  };
  const { server } = createTrackServer(store, () => config, "dist/web", sources as never), origin = await listenHttp(server);
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); store.close(); });
  const response = await fetch(`${origin}/api/runs/${key}/content`), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.content.failure.message.text, "게시 권한이 철회되었습니다");
  assert.equal(refreshes, 1); assert.equal(reads, 1); assert.equal(admitted, false);
});

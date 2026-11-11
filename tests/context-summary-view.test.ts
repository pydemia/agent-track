import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutionContextSummary } from "../packages/context/ExecutionSummary.tsx";
import type { ContextResult } from "../packages/context/contracts.ts";

const taskTarget = { kind: "task" as const, sourceId: "demian", projectId: "123e4567-e89b-42d3-a456-426614174000", taskId: "223e4567-e89b-42d3-a456-426614174000" };
const statusCounts = { queued: 0, leasing: 0, running: 0, waiting_for_permission: 0, cancelling: 0, succeeded: 1, failed: 0, cancelled: 0, expired: 0, interrupted: 0, unknown: 0 };
const connected: ContextResult = {
  state: "connected",
  summary: {
    version: 1, context: taskTarget, observedAt: "2026-11-12T00:00:00.000Z",
    task: { id: taskTarget.taskId, revision: "3", state: "todo <script>alert(1)</script>", requiresTest: true },
    runs: [{ sourceId: "demian", runId: "323e4567-e89b-42d3-a456-426614174000", sessionId: "423e4567-e89b-42d3-a456-426614174000", status: "succeeded", binding: { projectSourceId: "demian", projectId: taskTarget.projectId, taskId: taskTarget.taskId, revision: "3" }, observedAt: "2026-11-12T00:00:00.000Z", cursor: "8", highWater: "9", stale: false, incomplete: false, url: "https://track.example/?view=run&run=323e4567-e89b-42d3-a456-426614174000" }],
    counts: { runs: 1, sessions: 1, byStatus: statusCounts },
    coverage: { kind: "observed-window", limit: 50, capped: false, unavailable: true },
    trackUrl: null,
  },
};

test("renders escaped Korean summary, original Task separately from Run result, partial coverage and server URLs", () => {
  const html = renderToStaticMarkup(createElement(ExecutionContextSummary, { result: connected }));
  assert.match(html, /aria-label="연결된 실행"/);
  assert.match(html, /원본 업무/);
  assert.match(html, /상태 todo &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Run 323e4567 · 세션 423e4567 · 상태 성공/);
  assert.match(html, /원본 식별자/);
  assert.match(html, /Run <code>323e4567-e89b-42d3-a456-426614174000<\/code>/);
  assert.match(html, /업무 식별자/);
  assert.match(html, /223e4567-e89b-42d3-a456-426614174000/);
  assert.match(html, /관측 구간 · 일부일 수 있음 · 일부 Run을 확인할 수 없음/);
  assert.doesNotMatch(html, /대기열 0개|실행 중 0개/);
  assert.match(html, /href="https:\/\/track\.example\/\?view=run&amp;run=323e4567-e89b-42d3-a456-426614174000"/);
  assert.doesNotMatch(html, /<script>/);
});

test("renders compact forbidden, failed, and empty states without browser-side fetch behavior", () => {
  assert.match(renderToStaticMarkup(createElement(ExecutionContextSummary, { result: { state: "forbidden", summary: null } })), /실행 컨텍스트를 표시할 수 없습니다/);
  assert.match(renderToStaticMarkup(createElement(ExecutionContextSummary, { result: { state: "unavailable", summary: null } })), /실행 컨텍스트를 불러오지 못했습니다/);
  const empty = { ...connected, summary: { ...connected.summary, task: null, runs: [], counts: { runs: 0, sessions: 0, byStatus: { queued: 0, leasing: 0, running: 0, waiting_for_permission: 0, cancelling: 0, succeeded: 0, failed: 0, cancelled: 0, expired: 0, interrupted: 0, unknown: 0 } }, context: { kind: "project" as const, sourceId: "demian", projectId: taskTarget.projectId } } };
  const html = renderToStaticMarkup(createElement(ExecutionContextSummary, { result: empty }));
  assert.match(html, /관측 구간에 표시할 Run이 없습니다/);
  assert.doesNotMatch(html, /<iframe|<button/);
});

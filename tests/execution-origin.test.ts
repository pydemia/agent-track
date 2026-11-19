import assert from "node:assert/strict";
import test from "node:test";
import type { SourceView } from "../packages/contracts/index.ts";
import type { AssistantExecutionView } from "../packages/contracts/assistant-view.ts";
import { assistantExecutionOrigin, executionFailureMessage } from "../apps/web/src/execution-origin.ts";

const id = "11111111-1111-4111-8111-111111111111", instructionId = "22222222-2222-4222-8222-222222222222";
const source: SourceView = { id: "assistant", kind: "assistant", label: "Assistant", device: "Server", state: "connected", detail: "", capabilities: [], lastObservedAt: null, uiBaseUrl: "https://assistant.example.test/" };
const execution = { sourceId: source.id, native: { id, instructionId }, currentTask: null } as AssistantExecutionView;

test("Assistant link uses the exact original instruction/execution route without credentials", () => {
  const url = new URL(assistantExecutionOrigin([source], execution)!);
  assert.equal(url.origin, "https://assistant.example.test"); assert.equal(url.search, ""); assert.equal(url.username, "");
  assert.equal(url.hash, `#workbench/projects/${instructionId}/executions/${id}`);
});

test("unavailable/ambiguous source and unsafe or unconfigured UI remove links", () => {
  for (const sources of [[], [source, source], [{ ...source, state: "disconnected" as const }], [{ ...source, kind: "demian" as const }]])
    assert.equal(assistantExecutionOrigin(sources, execution), null);
  for (const uiBaseUrl of [undefined, "javascript:alert(1)", "https://user:password@example.test/", "https://example.test/?token=PRIVATE", "https://example.test/#private", " https://example.test/"])
    assert.equal(assistantExecutionOrigin([{ ...source, ...(uiBaseUrl === undefined ? {} : { uiBaseUrl }), ...(!uiBaseUrl ? { uiBaseUrl: "" } : {}) }], execution), null);
  assert.equal(assistantExecutionOrigin([source], { ...execution, native: { ...execution.native, instructionId: "../other" } }), null);
});

test("withdrawn Project access suppresses original execution links too", () => {
  const linked = { ...execution, currentTask: { projectsSourceId: "projects", project: { id }, task: { id: instructionId, projectId: id } } } as AssistantExecutionView;
  const projects: SourceView = { ...source, id: "projects", kind: "projects", authorizedProjectIds: [id] };
  assert(assistantExecutionOrigin([source, projects], linked));
  for (const candidate of [{ ...projects, authorizedProjectIds: [] }, { ...projects, state: "forbidden" as const }])
    assert.equal(assistantExecutionOrigin([source, candidate], linked), null);
});

test("failure classification does not invent the underlying cause", () => {
  assert.match(executionFailureMessage("deployment_execution_failed"), /런타임 실행 실패/);
  assert.match(executionFailureMessage("unknown_code"), /상세 원인을 뜻하지 않습니다/);
  assert.match(executionFailureMessage(null), /현재 Track 읽기 계약/);
  assert(!executionFailureMessage("deployment_execution_failed").includes("ACL"));
});

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { ContextSummaryClient } from "./client.mjs";

// Runs from the private QA directory on the native application host. The client
// key remains a mounted file; no source application's login/config is changed.
const publicOrigin = "https://track.pydemia.ai";
const projectId = "7b0bc73a-8a1f-4111-9d7f-cc85efad3fea";
const taskId = "a061ce29-f674-4449-86c3-2902b16713c5";
const client = (readerId, key, baseUrl = "http://127.0.0.1:14346") => new ContextSummaryClient({
  readerId, tokenFile: new URL(key, import.meta.url).pathname, baseUrl, publicOrigin,
});
const started = performance.now();
const task = await client("projects-context-qa", "projects.key").read({ kind: "task", sourceId: "projects-native", projectId, taskId });
assert.equal(task.state, "connected"); assert.equal(task.summary.counts.runs, 2); assert.equal(task.summary.counts.sessions, 2);
assert.equal(task.summary.counts.byStatus.succeeded, 2); assert.equal(task.summary.task.id, taskId); assert.equal(task.summary.task.state, "todo");
const elapsed = performance.now() - started;
const session = await client("demian-context-qa", "demian.key").read({ kind: "session", sourceId: "demian-local", sessionId: "6e26fd8b-76ff-43ec-8b55-1c42fd86da94" });
assert.equal(session.state, "connected");
assert.ok(session.summary.runs.some((run) => run.runId === "865dd2b3-e362-4f60-9b7b-728ff1c8aeca" && run.status === "succeeded"));
const forbidden = await client("projects-context-qa", "projects.key").read({ kind: "project", sourceId: "projects-native", projectId: "00000000-0000-4000-8000-000000000099" });
assert.deepEqual(forbidden, { state: "forbidden", summary: null });
const downAt = performance.now();
const disconnected = await client("projects-context-qa", "projects.key", "http://127.0.0.1:1").read({ kind: "task", sourceId: "projects-native", projectId, taskId });
assert.deepEqual(disconnected, { state: "unavailable", summary: null });
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), ready: true, scope: "independent server-side QA client, not embedded native application UI",
  task: { id: taskId, revision: task.summary.task.revision, state: task.summary.task.state, runs: task.summary.counts.runs, sessions: task.summary.counts.sessions,
    succeeded: task.summary.counts.byStatus.succeeded, elapsedMs: Math.round(elapsed), coverage: task.summary.coverage },
  session: { id: session.summary.context.sessionId, runs: session.summary.counts.runs }, outsideScope: forbidden.state,
  disconnected: { state: disconnected.state, elapsedMs: Math.round(performance.now() - downAt) }, nativeMutations: 0, privateCredentialExported: false, nativeUiIntegrated: false }, null, 2));

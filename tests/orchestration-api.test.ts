import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { orchestrationEvidence } from "../apps/api/orchestration.ts";
import type { Config } from "../apps/api/config.ts";
import type { Snapshot } from "../packages/contracts/index.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = "owner@example.test", runId = id(1), sessionId = id(2), workspaceId = id(3), projectId = id(4), key = "qa-run-key";
const at = new Date().toISOString();

test("orchestration support separates global declarations from provider ownership and reauthorizes without writes", async () => {
  let revoked = false, revokeDuringRead = false, nativeDenied = false, changePolicy = false, sessionReads = 0;
  const paths: string[] = [];
  const native = createServer((request, response) => {
    paths.push(`${request.method} ${request.url}`); response.setHeader("Content-Type", "application/json");
    if (request.method !== "GET") { response.writeHead(405); response.end("{}"); return; }
    if (request.url === `/api/v1/runs/${runId}`) {
      if (nativeDenied) { response.writeHead(403); response.end("{}"); return; }
      response.end(JSON.stringify({ id: runId, session_id: sessionId, status: "succeeded", created_at: at, started_at: at, completed_at: at, output_text: "PRIVATE_OUTPUT" })); return;
    }
    if (request.url === `/api/v1/sessions/${sessionId}`) {
      sessionReads++;
      response.end(JSON.stringify({ object: "demian.session", id: sessionId, workspace_id: workspaceId, title: "QA", agent: "general", provider: "codex-native", model: null,
        mode: "multi-agent", permission_policy: changePolicy && sessionReads > 2 ? "auto" : "ask", active_run_id: null, archived_at: null })); return;
    }
    if (request.url === "/api/v1/runtime/capabilities") {
      response.end(JSON.stringify({ object: "demian.runtime_capabilities", features: { goals: true, cowork: true, managed_child_v1: true }, worker_count: 1, checked_at: new Date().toISOString(), private: "PRIVATE_CAPABILITY" })); return;
    }
    if (request.url === "/api/v1/provider-connections") {
      if (revokeDuringRead) revoked = true;
      response.end(JSON.stringify({ object: "list", data: [{ provider: "codex-native", provider_type: "codex-app-server", configured: true, checked_at: new Date().toISOString(), auth_job_id: "PRIVATE_JOB", message: "PRIVATE_MESSAGE" }] })); return;
    }
    response.writeHead(404); response.end("{}");
  });
  await new Promise<void>((resolve) => native.listen(0, "127.0.0.1", resolve));
  const address = native.address(); assert.ok(address && typeof address !== "string");
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "https://track.test",
    auth: { mode: "proxy", secretFile: "C:/fixture/key", users: [user] }, sources: [{ id: "native", kind: "demian", label: "Native", device: "fixture", users: [user],
      baseUrl: `http://127.0.0.1:${address.port}`, runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] };
  const run = { key, sourceId: "native", runId, sessionId, workspaceId, sourceState: "connected", binding: { projectSourceId: "projects", projectId } };
  const snapshot = () => ({ runs: [run], sources: [{ id: "projects", kind: "projects", state: revoked ? "forbidden" : "connected", authorizedProjectIds: revoked ? [] : [projectId] }] }) as unknown as Snapshot;
  const read = (actor = user) => orchestrationEvidence(() => config, snapshot, actor, key, async () => {});
  try {
    const result = await read(); assert.equal(result.state, "connected"); assert.equal(result.sessionMode, "multi-agent");
    assert.equal(result.support?.reported.managedChild, true); assert.equal(result.support?.toolOrchestration, "external");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|auth_job_id|output_text|message|targets/);
    assert.ok(paths.every((path) => path.startsWith("GET ") && !path.includes("targets") && !path.includes("directory")));
    const count = paths.length; await assert.rejects(read("other@example.test")); assert.equal(paths.length, count);
    nativeDenied = true; const denied = await read(); assert.equal(denied.state, "forbidden"); assert.equal(denied.support, null);
    nativeDenied = false; revokeDuringRead = true; await assert.rejects(read(), (error: unknown) => (error as {status: number}).status === 404);
    revokeDuringRead = false; revoked = false; sessionReads = 0; changePolicy = true;
    const changed = await read(); assert.equal(changed.state, "forbidden"); assert.equal(changed.support, null);
  } finally { native.closeAllConnections(); await new Promise<void>((resolve) => native.close(() => resolve())); }
});

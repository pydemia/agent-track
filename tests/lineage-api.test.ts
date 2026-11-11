import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { lineageEvidence } from "../apps/api/lineage.ts";
import { CommandError } from "../packages/commands/index.ts";
import type { Config } from "../apps/api/config.ts";
import type { Snapshot } from "../packages/contracts/index.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = "owner@example.com";
const runId = id(1);
const sessionId = id(2);
const runKey = "native-run-key";
const now = new Date().toISOString();
const nativeRow = { sequence: "7", attempt: 1, executor: "codex-app-server", provider: "codex-native",
  phase: "tool_started", native_thread_id: "thread-1", native_turn_id: "turn-1",
  native_item_id: "item-1", invocation_id: "invocation-1", input: "PRIVATE_ARGS" };

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("lineage evidence rechecks native session and Project grants and returns no private payload", async () => {
  let nativeDenied = false;
  let revokeNativeDuringPage = false;
  let revokeProjectDuringPage = false;
  let projectGranted = true;
  let runReads = 0;
  let lineageReads = 0;
  const native = createServer((request, response) => {
    if (request.method !== "GET") { response.writeHead(405); response.end("{}"); return; }
    response.setHeader("Content-Type", "application/json");
    if (request.url === `/api/v1/runs/${runId}`) {
      runReads++;
      if (nativeDenied) { response.writeHead(403); response.end("{}"); return; }
      response.end(JSON.stringify({ id: runId, session_id: sessionId, status: "succeeded",
        created_at: now, started_at: now, completed_at: now })); return;
    }
    if (request.url === `/api/v1/sessions/${sessionId}`) {
      response.end(JSON.stringify({ id: sessionId, workspace_id: id(3), title: "QA" })); return;
    }
    if (request.url === `/api/v1/runs/${runId}/lineage?after=0&limit=250`) {
      lineageReads++;
      if (revokeNativeDuringPage) nativeDenied = true;
      if (revokeProjectDuringPage) projectGranted = false;
      response.end(JSON.stringify({ run_id: runId, session_id: sessionId,
        observations: [nativeRow], next_cursor: "7", has_more: false,
        messages: [{ id: "PRIVATE_MESSAGE_ID", body: "PRIVATE_MESSAGE" }] })); return;
    }
    response.writeHead(404); response.end("{}");
  });
  const baseUrl = await listen(native);
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "https://track.test",
    auth: { mode: "proxy", secretFile: "C:/fixture/key", users: [user] },
    sources: [
      { id: "native", kind: "demian", label: "Native", device: "fixture", users: [user], baseUrl,
        runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 },
      { id: "projects", kind: "projects", label: "Projects", device: "fixture", users: [user],
        runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 },
    ] };
  const run = { key: runKey, sourceId: "native", runId, sessionId, workspaceId: id(3), title: "QA",
    status: "succeeded", createdAt: now, startedAt: now, completedAt: now, observedAt: now,
    cursor: "9", highWater: "9", incomplete: false, stale: false, sourceLabel: "Native", device: "fixture",
    sourceState: "connected", sourceUrl: null, workspaceKey: null, projectKey: id(4), capabilities: ["run.read"],
    binding: { sourceId: "native", runId, projectSourceId: "projects", projectId: id(4), taskId: null,
      taskRevision: null, projectTitle: "Project", taskTitle: null, provenance: "operator" } };
  const snapshot = (_actor: string) => ({ runs: [run], sources: [
    { id: "native", kind: "demian", label: "Native", device: "fixture", state: "connected",
      lastObservedAt: now, detail: "fixture", capabilities: ["run.read"] },
    { id: "projects", kind: "projects", label: "Projects", device: "fixture",
      state: projectGranted ? "connected" : "forbidden", lastObservedAt: now, detail: "fixture",
      capabilities: projectGranted ? ["projects.read"] : [], authorizedProjectIds: projectGranted ? [id(4)] : [] },
  ] }) as unknown as Snapshot;
  let currentUser = user;
  const refresh = async () => {};
  try {
    const success = await lineageEvidence(() => config, snapshot, user, runKey, refresh);
    assert.equal(success.state, "connected");
    assert.equal(success.observations[0]?.nativeItemId, "item-1");
    assert.equal(success.nextCursor, "7");
    assert.doesNotMatch(JSON.stringify(success), /PRIVATE_|input|messages|parentInvocationId/);
    assert.equal(runReads, 2, "native run/session must be checked around the page read");
    assert.equal(lineageReads, 1);

    currentUser = "other@example.com";
    await assert.rejects(lineageEvidence(() => config, snapshot, currentUser, runKey, refresh));
    assert.equal(lineageReads, 1, "root scope denial happens before the native read");
    currentUser = user;

    revokeNativeDuringPage = true;
    const nativeRevoked = await lineageEvidence(() => config, snapshot, user, runKey, refresh);
    assert.equal(nativeRevoked.state, "forbidden");
    assert.deepEqual(nativeRevoked.observations, []);
    revokeNativeDuringPage = false; nativeDenied = false;

    revokeProjectDuringPage = true;
    await assert.rejects(lineageEvidence(() => config, snapshot, user, runKey, refresh),
      (error: unknown) => error instanceof CommandError && error.status === 404);
    revokeProjectDuringPage = false; projectGranted = true;
    const unbound = (actor: string) => ({ ...snapshot(actor), runs: [{ ...run, binding: null, projectKey: null }] }) as unknown as Snapshot;
    assert.equal((await lineageEvidence(() => config, unbound, user, runKey, refresh)).state, "connected", "standalone Demian Runs do not require a Task binding");
  } finally { await close(native); }
});

test("lineage evidence rejects a noncanonical cursor before refreshing or reading", async () => {
  let refreshes = 0;
  const config = { auth: { mode: "proxy", users: [user] }, sources: [] } as unknown as Config;
  await assert.rejects(lineageEvidence(() => config, () => ({ runs: [], sources: [] }) as unknown as Snapshot,
    user, runKey, async () => { refreshes++; }, "00"));
  assert.equal(refreshes, 0);
});

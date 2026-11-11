import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { toolEvidence } from "../apps/api/tools.ts";
import { CommandError } from "../packages/commands/index.ts";
import type { Config } from "../apps/api/config.ts";
import type { Snapshot } from "../packages/contracts/index.ts";

test("tool evidence returns allowlisted results only after native and current Project reauthorization", async () => {
  const user = "owner@example.com"; const runId = "00000000-0000-4000-8000-000000000001";
  const sessionId = "00000000-0000-4000-8000-000000000002"; const at = new Date().toISOString();
  let denied = false; let grant = true; let during: "none" | "native" | "project" = "none"; let reads = 0;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === `/api/v1/runs/${runId}`) {
      if (denied) { response.writeHead(403).end("{}"); return; }
      response.end(JSON.stringify({ id: runId, session_id: sessionId, status: "succeeded", created_at: at, started_at: at, completed_at: at })); return;
    }
    if (request.url === `/api/v1/sessions/${sessionId}`) { response.end(JSON.stringify({ id: sessionId, workspace_id: "workspace", title: "QA" })); return; }
    if (request.url === `/api/v1/runs/${runId}/events?after=0`) {
      reads++; if (during === "native") denied = true; if (during === "project") grant = false;
      response.setHeader("Content-Type", "text/event-stream"); response.end(`id: 1\ndata: ${JSON.stringify({ api_version: "2026-09-01", run_id: runId,
        sequence_text: "1", type: "tool.completed", created_at: at, data: { call_id: "call", invocation_id: "inv", name: "shell", ok: false, input: "PRIVATE_INPUT", output: "PRIVATE_OUTPUT" } })}\n\n`); return;
    }
    response.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address !== "string");
  const source = { id: "native", kind: "demian", label: "Native", device: "test", users: [user], baseUrl: `http://127.0.0.1:${address.port}`,
    runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 } as const;
  const config = { auth: { mode: "proxy", users: [user] }, sources: [source] } as unknown as Config;
  let bound = true;
  const snapshot = () => ({ runs: [{ key: "key", sourceId: "native", sourceState: "connected", runId, sessionId, highWater: "1",
    binding: bound ? { projectSourceId: "projects", projectId: "project" } : null }], sources: [{ id: "projects", kind: "projects", state: grant ? "connected" : "forbidden",
    authorizedProjectIds: grant ? ["project"] : [] }] }) as unknown as Snapshot;
  try {
    const page = await toolEvidence(() => config, snapshot, user, "key", async () => {});
    assert.equal(page.state, "connected"); assert.equal(page.calls[0]?.outcome, "failed"); assert.equal(page.complete, true);
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|"input"|"output"/);
    await assert.rejects(toolEvidence(() => config, snapshot, "other", "key", async () => {})); assert.equal(reads, 1);
    during = "native"; const native = await toolEvidence(() => config, snapshot, user, "key", async () => {});
    assert.equal(native.state, "forbidden"); assert.deepEqual(native.calls, []); denied = false;
    during = "project";
    await assert.rejects(toolEvidence(() => config, snapshot, user, "key", async () => {}), (error: unknown) => error instanceof CommandError && error.status === 404);
    during = "none"; bound = false;
    assert.equal((await toolEvidence(() => config, snapshot, user, "key", async () => {})).state, "connected");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

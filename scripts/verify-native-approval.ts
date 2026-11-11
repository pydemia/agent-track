import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import { readConfig } from "../apps/api/config.ts";
import { DemianClient } from "../packages/adapters/demian/index.ts";
import { approvalRequestSchema, externalKey, type ApprovalReceipt } from "../packages/contracts/index.ts";

// Exact, operator-authorized QA file change only. No arbitrary approval IDs or paths.
async function main() {
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  if (config.auth.mode !== "proxy" || config.auth.users.length !== 1) throw new Error("Single-owner required");
  const user = config.auth.users[0]!;
  const source = config.sources.find((item) => item.id === "demian-local");
  if (!source?.approvalUsers?.includes(user) || source.baseUrl !== "http://127.0.0.1:8080" || !source.tokenFile || source.credentialFormat !== "demian-service") throw new Error("Explicit installed QA authority required");
  const sessionScope = process.argv[2] === "session";
  if (process.argv[2] && !sessionScope) throw new Error("Unknown QA scope");
  const statePath = join(homedir(), `.local/share/agent-track/native-approval-${sessionScope ? "session" : "editor"}-check.json`);
  const state = z.object({ operationId: z.uuid(), workspaceId: z.uuid(), sessionId: z.uuid(), runId: z.uuid(), command: approvalRequestSchema.optional() }).strict()
    .parse(JSON.parse(await readFile(statePath, "utf8")));
  const key = externalKey(source.id, state.runId);
  const base = `http://127.0.0.1:${config.port}`;
  const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": user,
    "content-type": "application/json", origin: config.publicOrigin };
  const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl, tokenFile: source.tokenFile, credentialFormat: "demian-service" });
  const filename = sessionScope ? "track-approval-session-a.txt" : "track-approval-proof.txt";
  const expectedFile = join(homedir(), ".demian/service/workspaces", state.workspaceId, filename);
  const expected = "Agent Track approval verified\n";
  if (!state.command) {
    const requests = await client.permissions(state.runId);
    const pending = requests.filter((item) => item.request.status === "pending"); assert.equal(pending.length, 1);
    const review = pending[0]!; assert.equal(review.request.tool, "codex-app-server.fileChange"); assert.equal(review.reviewComplete, true);
    const details = JSON.parse(review.reviewText); const changes = details.input?.nativeItem?.changes;
    assert.equal(changes?.length, 1); assert.equal(resolve(changes[0].path), resolve(expectedFile));
    assert.deepEqual(changes[0].kind, { type: "add" }); assert.equal(changes[0].diff, expected);
    assert.equal(details.input.grantRoot, null); assert.ok(!details.input.networkApprovalContext && !details.input.additionalPermissions && !details.input.command);
    assert.equal(existsSync(expectedFile), false, "QA must add a new file, not overwrite existing data");
    state.command = { id: randomUUID(), runKey: key, permissionId: review.request.id, fingerprint: review.request.fingerprint, decision: sessionScope ? "allow_session" : "allow_once",
      expiresAt: new Date(Math.min(Date.parse(review.request.expiresAt), Date.now() + 90_000)).toISOString() };
    await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
  const send = () => fetch(base + "/api/commands/approval", { method: "POST", headers, body: JSON.stringify(state.command), signal: AbortSignal.timeout(30_000) });
  const response = await send(); assert.equal(response.status, 200);
  const { receipt } = await response.json() as { receipt: ApprovalReceipt }; assert.equal(receipt.state, "succeeded");
  const duplicate = await send(); assert.equal(duplicate.status, 200); assert.deepEqual((await duplicate.json() as { receipt: ApprovalReceipt }).receipt, receipt);
  let observed = await client.observe(state.runId);
  for (let i = 0; i < 50 && !["succeeded", "failed", "cancelled", "expired"].includes(observed.status); i++) {
    await new Promise((done) => setTimeout(done, 1000)); observed = await client.observe(state.runId);
  }
  assert.equal(observed.status, "succeeded");
  const bytes = await readFile(expectedFile); assert.equal(bytes.toString("utf8"), expected);
  const requests = await client.permissions(state.runId);
  const native = requests.find((item) => item.request.id === state.command!.permissionId)!;
  assert.equal(native.request.status, "resolved"); assert.equal(native.request.decision, sessionScope ? "allow_session" : "allow_once");
  let completedFileCalls = 1;
  if (sessionScope) {
    const second = await readFile(join(homedir(), ".demian/service/workspaces", state.workspaceId, "track-approval-session-b.txt"));
    assert.equal(second.toString("utf8"), expected); assert.equal(requests.length, 1, "the second same-tool call must reuse the session grant");
    const events: Array<{ type: string; data: { tool?: string } }> = [];
    await client.stream(state.runId, "0", (event) => events.push(event), AbortSignal.timeout(10_000));
    completedFileCalls = events.filter((event) => event.type === "tool.completed" && event.data.tool === "fileChange").length;
    assert.equal(completedFileCalls, 2);
  }
  const db = new DatabaseSync(config.database, { readOnly: true });
  try {
    const rows = db.prepare("SELECT payload FROM events WHERE run_key=? UNION ALL SELECT payload FROM approval_receipts WHERE run_key=?").all(key, key);
    assert.doesNotMatch(JSON.stringify(rows), /Agent Track approval verified|nativeItem|reviewText|threadId|grantRoot/);
  } finally { db.close(); }
  const result = { verifiedAt: new Date().toISOString(), isolatedQaFileOnly: true, runId: state.runId, sessionId: state.sessionId,
    permissionId: state.command.permissionId, decision: sessionScope ? "allow_session" : "allow_once", scope: sessionScope ? "same QA session and fileChange tool; two new files, no network grant or existing-file overwrite" : "one native fileChange call; no session grant, network grant or existing-file overwrite",
    receiptState: receipt.state, identicalDuplicateReceipt: true, nativePermissionStatus: native.request.status, nativeRunStatus: observed.status,
    file: filename, completedFileCalls, nativePermissionCount: requests.length, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), rawArgumentsNotPersisted: true };
  await writeFile(sessionScope ? "docs/native-approval-session-verification.json" : "docs/native-approval-verification.json", JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
}
await main().catch(() => { console.error("Isolated native approval verification failed; private values omitted."); process.exitCode = 1; });

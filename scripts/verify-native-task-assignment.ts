import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { readConfig } from "../apps/api/config.ts";
import { taskReviewFingerprint } from "../apps/api/task-assignment.ts";
import { ProjectsClient } from "../packages/adapters/projects/index.ts";
import { DemianRunWriter } from "../packages/adapters/demian/assignment.ts";
import { externalKey, type Snapshot } from "../packages/contracts/index.ts";

// No native mutation or command replay. Reads the existing public-UI QA receipts
// and their exact source request IDs; never saves source prompts or output text.
async function main() {
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  if (config.auth.mode !== "proxy" || config.auth.users.length !== 1) throw new Error("Single owner required");
  const ledger = z.object({ preparedAt: z.iso.datetime(), projectSourceId: z.string(), projectId: z.uuid(), taskId: z.uuid(), taskRevision: z.string(),
    reviewSha256: z.string(), inputSha256: z.string(), instructions: z.string(), sessions: z.array(z.object({ sourceId: z.string(), sessionId: z.uuid() })).length(2) })
    .parse(JSON.parse(await readFile(join(homedir(), ".local/share/agent-track/native-task-assignment-check.json"), "utf8")));
  const project = config.sources.find((source) => source.id === ledger.projectSourceId); assert.ok(project?.projectsCredentialFile && project.baseUrl);
  const review = await new ProjectsClient({ sourceId: project.id, baseUrl: project.baseUrl, user: project.projectsUser!, accountId: project.projectsAccountId!,
    principalId: project.projectsPrincipalId!, credentialFile: project.projectsCredentialFile }).taskReview(ledger.taskId, ledger.projectId);
  assert.equal(review.complete, true); assert.equal(review.task.revision, ledger.taskRevision); assert.equal(review.task.state, "todo");
  assert.equal(taskReviewFingerprint(project.id, review), ledger.reviewSha256);
  const db = new DatabaseSync(config.database, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT * FROM task_assignment_receipts WHERE actor=? AND project_source_id=? AND project_id=? AND task_id=? AND created_at>=? ORDER BY created_at`)
      .all(config.auth.users[0]!, ledger.projectSourceId, ledger.projectId, ledger.taskId, ledger.preparedAt) as unknown as Array<Record<string, string | null>>;
    const accepted = rows.filter((row) => row.state === "accepted");
    assert.ok(accepted.length <= 2, "QA must not create another accepted Run for the same target");
    const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0]! };
    const snapshotResponse = await fetch(`http://127.0.0.1:${config.port}/api/snapshot`, { headers }); assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json() as Snapshot; const runs = [];
    for (const row of accepted) {
      assert.equal(row.input_sha256, ledger.inputSha256); assert.equal(row.binding_state, "bound");
      const target = ledger.sessions.find((session) => session.sourceId === row.demian_source_id && session.sessionId === row.session_id); assert.ok(target);
      const source = config.sources.find((item) => item.id === target.sourceId); assert.ok(source?.baseUrl && source.tokenFile);
      const writer = new DemianRunWriter({ sourceId: source.id, baseUrl: source.baseUrl, tokenFile: source.tokenFile,
        ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}), ...(source.organizationId ? { organizationId: source.organizationId } : {}) });
      const original = await writer.lookup(target.sessionId, row.id!, ledger.inputSha256); assert.ok(original); assert.equal(original.runId, row.run_id);
      const session = await writer.session(target.sessionId); assert.equal(session.provider, "codex-native"); assert.equal(session.permissionPolicy, "ask");
      const projected = snapshot.runs.find((run) => run.key === externalKey(source.id, original.runId)); assert.ok(projected);
      assert.equal(projected.binding?.taskId, ledger.taskId); assert.equal(projected.binding?.taskRevision, ledger.taskRevision); assert.equal(projected.sessionId, target.sessionId);
      const credential = (await readFile(source.tokenFile, "utf8")).replace(/^\uFEFF/, "").trim();
      const token: string = source.credentialFormat === "demian-service" ? JSON.parse(credential).apiToken : credential;
      const response = await fetch(`${source.baseUrl}/api/v1/runs/${original.runId}`, { headers: { Authorization: `Bearer ${token}`,
        ...(source.organizationId ? { "X-Demian-Organization-Id": source.organizationId } : {}) }, signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200); const native = await response.json() as { id: string; status: string; output_text: string | null; started_at: string | null };
      assert.equal(native.id, original.runId);
      const outputMatches = !!native.output_text && native.output_text.toLowerCase().includes("agent track task assignment verified") && native.output_text.includes(ledger.taskId);
      runs.push({ requestId: row.id, runId: original.runId, sessionId: target.sessionId, provider: session.provider, nativeState: native.status,
        started: native.started_at !== null, exactInputHashMatched: true, outputMarkerAndTaskIdMatched: outputMatches, bindingState: row.binding_state,
        projectedState: projected.status, cursor: projected.cursor, highWater: projected.highWater });
    }
    assert.doesNotMatch(JSON.stringify(rows), /Agent Track 기존 업무 배정|PRIVATE_/);
    assert.ok(!review.body || !JSON.stringify(rows).includes(review.body));
    const ready = runs.length === 2 && new Set(runs.map((run) => run.sessionId)).size === 2 && new Set(runs.map((run) => run.runId)).size === 2 &&
      runs.every((run) => run.nativeState === "succeeded" && run.started && run.outputMarkerAndTaskIdMatched && run.projectedState === "succeeded" && run.cursor === run.highWater);
    console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), ready, scope: "public UI assignments to two existing native codex Sessions; native reads only in this verifier",
      taskId: ledger.taskId, originalTaskRevision: review.task.revision, originalTaskState: review.task.state, originalTaskContentUnchanged: true,
      acceptedReceipts: accepted.length, unresolvedReceipts: rows.filter((row) => ["requested", "dispatching", "unknown"].includes(String(row.state))).length,
      nativeMutationsByVerifier: 0, instructionsAndTaskBodyAbsentFromAssignmentJournal: true, runs }, null, 2));
  } finally { db.close(); }
}
await main().catch(() => { console.error("Native Task assignment verification failed; private source text and credential values omitted."); process.exitCode = 1; });

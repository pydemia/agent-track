import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { readConfig } from "../apps/api/config.ts";
import { ProjectsTaskWriter, prepareProjectsTaskCreate } from "../packages/adapters/projects/writer.ts";

// Observe only the one QA Task submitted through the public UI. Never POST.
async function main() {
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  if (config.auth.mode !== "proxy" || config.auth.users.length !== 1) throw new Error();
  const actor = config.auth.users[0]!;
  const source = config.sources.find((item) => item.id === "projects-native" && item.projectsUser === actor);
  if (!source?.baseUrl || !source.projectsTaskCreatorCredentialFile || !source.projectsTaskCreatorPrincipalId || !source.projectsAccountId) throw new Error();
  const path = join(homedir(), ".local/share/agent-track/native-task-create-check.json");
  const qa = z.object({ qaId: z.uuid(), operationId: z.uuid(), projectId: z.literal("7b0bc73a-8a1f-4111-9d7f-cc85efad3fea"),
    title: z.string().startsWith("Agent Track QA · 원본 업무 생성 · "), body: z.string(), acceptanceCriteria: z.array(z.string()), requiresTest: z.literal(true), taskId: z.uuid().optional() })
    .parse(JSON.parse(await readFile(path, "utf8")));
  const prepared = prepareProjectsTaskCreate(qa.projectId, { operation_id: qa.operationId, title: qa.title, body: qa.body,
    acceptance_criteria: qa.acceptanceCriteria, requires_test: qa.requiresTest });
  const writer = new ProjectsTaskWriter({ sourceId: source.id, baseUrl: source.baseUrl, user: actor, accountId: source.projectsAccountId,
    principalId: source.projectsTaskCreatorPrincipalId, credentialFile: source.projectsTaskCreatorCredentialFile });
  const native = await writer.reconcile(qa.projectId, qa.operationId, prepared.requestBodySha256);
  assert.equal(native.task.title, qa.title); assert.equal(native.task.revision, "1"); assert.equal(native.task.state, "todo");
  if (qa.taskId) assert.equal(qa.taskId, native.task.id);
  // A fixed native detail GET verifies the original body/criteria in process only.
  const credential = z.object({ user: z.literal(actor), principalId: z.literal(source.projectsTaskCreatorPrincipalId), accountId: z.literal(source.projectsAccountId),
    secretFile: z.string(), kid: z.string(), revision: z.number().int().positive() }).parse(JSON.parse(await readFile(source.projectsTaskCreatorCredentialFile, "utf8")));
  const key = Buffer.from((await readFile(credential.secretFile, "utf8")).trim(), "base64url"); assert.equal(key.length, 32);
  const nativePath = `/api/integrations/assistant/v1/tasks/${native.task.id}`; const issued = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(JSON.stringify([1, "projects", credential.kid, issued, issued + 30, randomUUID(), "GET", nativePath,
    createHash("sha256").update("").digest("hex"), credential.principalId, credential.revision])).toString("base64url");
  const signature = createHmac("sha256", key).update(encoded, "ascii").digest("base64url");
  const response = await fetch(source.baseUrl + nativePath, { redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${encoded}.${signature}` } });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const detail = z.object({ id: z.literal(native.task.id), project_id: z.literal(qa.projectId), body: z.string(),
    data: z.object({ state: z.literal("todo"), acceptance_criteria: z.array(z.string()), requires_test: z.literal(true) }) }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  assert.equal(detail.body, qa.body); assert.deepEqual(detail.data.acceptance_criteria, qa.acceptanceCriteria);
  const db = new DatabaseSync(config.database, { readOnly: true });
  try {
    const rows = db.prepare("SELECT * FROM task_creation_receipts WHERE actor=? AND id=?").all(actor, qa.operationId);
    assert.equal(rows.length, 1); const row = rows[0]!;
    assert.equal(row.source_id, source.id); assert.equal(row.project_id, qa.projectId); assert.equal(row.state, "created");
    assert.equal(row.body_sha256, prepared.requestBodySha256); assert.equal(row.task_id, native.task.id); assert.equal(row.task_revision, "1");
    const journal = JSON.stringify(rows);
    for (const value of [qa.title, qa.body, ...qa.acceptanceCriteria]) assert.equal(journal.includes(value), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM bindings WHERE json_extract(payload,'$.taskId')=?").get(native.task.id)!.total, 0);
  } finally { db.close(); }
  await writeFile(path, JSON.stringify({ ...qa, taskId: native.task.id }, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), operationId: qa.operationId, taskId: native.task.id, projectId: qa.projectId,
    revision: native.task.revision, nativeState: native.task.state, requestBodyHashMatched: true, nativeBodyAndCriteriaMatched: true,
    sourceReceiptMatched: true, trackReceiptCount: 1, draftTextAbsentFromTrackJournal: true, runBindingCount: 0, nativeMutationsByVerifier: 0 }));
}
await main().catch(() => { console.error("Native Task creation verification failed; private values omitted."); process.exitCode = 1; });

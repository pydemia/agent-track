import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { readConfig } from "../apps/api/config.ts";
import { externalKey, type FileChangeEvidence } from "../packages/contracts/index.ts";

// Read-only checks of the existing isolated QA Runs and their known file paths.
async function main() {
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  if (config.auth.mode !== "proxy" || config.auth.users.length !== 1) throw new Error("Single owner required");
  const root = join(homedir(), ".local/share/agent-track");
  const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0]! };
  const db = new DatabaseSync(config.database, { readOnly: true });
  const results: object[] = [];
  try {
    for (const [variant, names, expectedState] of [
      ["editor", ["track-approval-proof.txt"], "reported"],
      ["session", ["track-approval-session-a.txt", "track-approval-session-b.txt"], "reported"],
      ["deny", ["track-approval-denied.txt"], "failed"],
      ["expiry", ["track-approval-expiry.txt"], "failed"],
    ] as const) {
      const state = z.object({ workspaceId: z.uuid(), runId: z.uuid() }).parse(JSON.parse(await readFile(join(root, `native-approval-${variant}-check.json`), "utf8")));
      const key = externalKey("demian-local", state.runId);
      const before = db.prepare("SELECT ordinal,digest,payload FROM events WHERE run_key=? ORDER BY ordinal").all(key);
      const response = await fetch(`http://127.0.0.1:${config.port}/api/runs/${key}/files`, { headers, signal: AbortSignal.timeout(20_000) });
      assert.equal(response.status, 200);
      const evidence = await response.json() as FileChangeEvidence;
      assert.equal(evidence.state, "connected"); assert.equal(evidence.complete, true); assert.equal(evidence.changes.length, names.length);
      assert.equal(evidence.omittedChanges, 0);
      const files = [];
      for (const name of names) {
        const path = join(homedir(), ".demian/service/workspaces", state.workspaceId, name);
        const item = evidence.changes.find((row) => resolve(row.path) === resolve(path)); assert.ok(item);
        assert.equal(item.state, expectedState); assert.equal(item.operation, "add"); assert.ok(item.requestedSequence && item.completedSequence);
        if (expectedState === "reported") {
          const bytes = await readFile(path); assert.equal(bytes.toString("utf8"), "Agent Track approval verified\n");
          files.push({ file: name, state: item.state, requestedSequence: item.requestedSequence, completedSequence: item.completedSequence,
            bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
        } else { assert.equal(existsSync(path), false); files.push({ file: name, state: item.state, fileAbsent: true }); }
      }
      assert.doesNotMatch(JSON.stringify(evidence), /Agent Track approval verified|nativeItem|reviewText|diffContent|threadId|"input"|"preview"/);
      assert.deepEqual(db.prepare("SELECT ordinal,digest,payload FROM events WHERE run_key=? ORDER BY ordinal").all(key), before);
      results.push({ variant, runId: state.runId, files, scanned: evidence.scanned, targetSequence: evidence.targetSequence,
        throughSequence: evidence.throughSequence, completeThroughTarget: evidence.complete, immutableJournalUnchanged: true, rawArgumentsNotExported: true });
    }
  } finally { db.close(); }
  const record = { verifiedAt: new Date().toISOString(), source: "demian-local", scope: "native fileChange proposals paired with native completion; no general filesystem diff or final-state claim", results };
  await writeFile("docs/native-files-verification.json", JSON.stringify(record, null, 2) + "\n"); console.log(JSON.stringify(record));
}
await main().catch(() => { console.error("Native file evidence verification failed; private values omitted."); process.exitCode = 1; });

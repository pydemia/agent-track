import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readConfig } from "../apps/api/config.ts";
import { DemianClient } from "../packages/adapters/demian/index.ts";
import { externalKey, terminalStatuses } from "../packages/contracts/index.ts";

// Read-only outcome checks. A timed-out observer never restarts or decides a Run.
async function main() {
  const variant = process.argv[2]; if (variant !== "deny" && variant !== "expiry") throw new Error("Explicit QA variant required");
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  if (config.auth.mode !== "proxy" || config.auth.users.length !== 1) throw new Error("Single-owner required");
  const source = config.sources.find((item) => item.id === "demian-local");
  if (!source?.tokenFile || source.baseUrl !== "http://127.0.0.1:8080" || source.credentialFormat !== "demian-service") throw new Error("Installed QA source required");
  const root = join(homedir(), ".local/share/agent-track");
  const state = z.object({ workspaceId: z.uuid(), sessionId: z.uuid(), runId: z.uuid() })
    .parse(JSON.parse(await readFile(join(root, `native-approval-${variant}-check.json`), "utf8")));
  const original = z.object({ workspaceId: z.uuid() }).parse(JSON.parse(await readFile(join(root, "native-observation-check.json"), "utf8")));
  assert.equal(state.workspaceId, original.workspaceId);
  const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl, tokenFile: source.tokenFile, credentialFormat: "demian-service" });
  const limit = Date.now() + 7 * 60_000;
  let run = await client.observe(state.runId); let requests = await client.permissions(state.runId);
  while (process.argv[3] === "wait" && Date.now() < limit && (!terminalStatuses.has(run.status) || requests.length !== 1 || requests[0]!.request.status === "pending")) {
    console.log(JSON.stringify({ observing: variant, runId: state.runId, runStatus: run.status,
      permissionStatus: requests[0]?.request.status ?? "not-yet-observed", expiresAt: requests[0]?.request.expiresAt ?? null }));
    await new Promise((done) => setTimeout(done, 20_000)); run = await client.observe(state.runId); requests = await client.permissions(state.runId);
  }
  assert.equal(terminalStatuses.has(run.status), true); assert.equal(run.sessionId, state.sessionId); assert.equal(requests.length, 1);
  const request = requests[0]!.request;
  assert.equal(request.tool, "codex-app-server.fileChange"); assert.equal(request.decision, "deny");
  assert.equal(request.status, variant === "deny" ? "resolved" : "expired");
  const filename = variant === "deny" ? "track-approval-denied.txt" : "track-approval-expiry.txt";
  assert.equal(existsSync(join(homedir(), ".demian/service/workspaces", state.workspaceId, filename)), false);
  const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0]! };
  const response = await fetch(`http://127.0.0.1:${config.port}/api/approvals?run=${externalKey(source.id, state.runId)}`, { headers });
  assert.equal(response.status, 200); const body = await response.json() as { receipts: Array<{ decision: string; state: string; createdAt: string }> };
  if (variant === "deny") { assert.equal(body.receipts.length, 1); assert.equal(body.receipts[0]!.state, "succeeded"); assert.equal(body.receipts[0]!.decision, "deny"); }
  else assert.ok(body.receipts.every((item) => item.state === "expired" && request.resolvedAt && Date.parse(item.createdAt) >= Date.parse(request.resolvedAt)),
    "only rejected late requests recorded after native expiry may exist");
  const result = { verifiedAt: new Date().toISOString(), variant, runId: state.runId, sessionId: state.sessionId, permissionId: request.id,
    nativePermissionStatus: request.status, nativeDecision: request.decision, nativeRunStatus: run.status, fileAbsent: true,
    trackReceiptCount: body.receipts.length, sourceExpiryUnmodified: true };
  await writeFile(`docs/native-approval-${variant}-verification.json`, JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
}
await main().catch(() => { console.error("Read-only native approval outcome check failed; existing Runs preserved, private values omitted."); process.exitCode = 1; });

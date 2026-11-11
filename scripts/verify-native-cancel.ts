import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../apps/api/config.ts";
import type { Snapshot } from "../packages/contracts/index.ts";
import type { Receipt } from "../packages/commands/index.ts";

// Explicit operator check. It can only target the isolated Run in this private ledger.
// A repeat invocation observes/reuses the same operation and command; it never creates another Run.
const config = readConfig(process.env.TRACK_CONFIG ?? "");
if (config.auth.mode !== "proxy" || config.auth.users.length !== 1) throw new Error("Single-owner proxy required");
const actor = config.auth.users[0]!;
const source = config.sources.find((item) => item.id === "demian-local");
if (!source?.cancelUsers?.includes(actor) || !source.tokenFile || !source.baseUrl) throw new Error("Explicit native cancel grant required");
if (source.credentialFormat !== "demian-service" || source.baseUrl !== "http://127.0.0.1:8080") throw new Error("Installed loopback service required");
const privateRoot = join(homedir(), ".local/share/agent-track");
const statePath = join(privateRoot, "native-cancel-check.json");
type State = { operationId: string; workspaceId?: string; sessionId?: string; runId?: string; command?: object };
let state: State;
try { state = JSON.parse(await readFile(statePath, "utf8")) as State; }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Invalid check ledger"); state = { operationId: randomUUID() }; }
const save = () => writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
await save();
const secret = JSON.parse((await readFile(source.tokenFile, "utf8")).replace(/^\uFEFF/, "")) as { apiToken: string };
async function native(path: string, body?: object, extra: Record<string, string> = {}) {
  const response = await fetch(source!.baseUrl! + path, { method: body ? "POST" : "GET", redirect: "error",
    headers: { authorization: `Bearer ${secret.apiToken}`, "content-type": "application/json", ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Native check failed (${response.status})`); }
  return response.json() as Promise<Record<string, unknown>>;
}
const name = `Agent Track cancel check ${state.operationId.slice(0, 8)}`;
if (!state.workspaceId) {
  const check = JSON.parse(await readFile(join(privateRoot, "native-observation-check.json"), "utf8")) as { workspaceId: string };
  state.workspaceId = check.workspaceId; await save();
}
if (!state.sessionId) {
  const list = await native(`/api/v1/sessions?workspace_id=${encodeURIComponent(state.workspaceId)}`);
  const found = (list.data as { id: string; title: string }[]).filter((item) => item.title === name);
  if (found.length > 1) throw new Error("Ambiguous isolated check session");
  const session = found[0] ?? await native("/api/v1/sessions", { workspace_id: state.workspaceId, title: name,
    provider: "codex-native", agent: "build", mode: "single-agent", permission_policy: "deny" });
  state.sessionId = String(session.id); await save();
}
if (!state.runId) {
  const run = await native(`/api/v1/sessions/${encodeURIComponent(state.sessionId)}/runs`, {
    input: [{ type: "input_text", text: "This is an isolated Agent Track cancellation integration test in an empty workspace. Do not call tools, modify files, or delegate. Generate a numbered list of integers from 1 to 2000, each on its own line. The operator will cancel this test while it runs." }],
  }, { "Idempotency-Key": `track-cancel-${state.operationId}` });
  state.runId = String(run.id); await save();
}
const proxyHeaders = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": actor };
const base = `http://127.0.0.1:${config.port}`;
let observed;
for (let i = 0; i < 45; i++) {
  const response = await fetch(base + "/api/snapshot", { headers: proxyHeaders });
  assert.equal(response.status, 200);
  const snapshot = await response.json() as Snapshot;
  observed = snapshot.runs.find((item) => item.sourceId === source.id && item.runId === state.runId);
  if (observed) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.ok(observed, "Isolated Run was not discovered");
assert.ok(observed.capabilities.includes("run.cancel"));
if (!state.command) {
  state.command = { kind: "cancel", runKey: observed.key, idempotencyKey: state.operationId,
    expectedCursor: observed.cursor, expiresAt: new Date(Date.now() + 90_000).toISOString() };
  await save();
}
const send = () => fetch(base + "/api/commands/cancel", { method: "POST", redirect: "error",
  headers: { ...proxyHeaders, "content-type": "application/json", origin: config.publicOrigin }, body: JSON.stringify(state.command) });
const response = await send();
assert.equal(response.status, 200);
const { receipt } = await response.json() as { receipt: Receipt };
assert.ok(["accepted", "succeeded"].includes(receipt.state), `Cancellation was not acknowledged (${receipt.state})`);
const duplicate = await send();
assert.equal(duplicate.status, 200);
assert.deepEqual((await duplicate.json() as { receipt: Receipt }).receipt, receipt);
let final = receipt;
for (let i = 0; i < 30; i++) {
  const result = await fetch(`${base}/api/commands?run=${observed.key}`, { headers: proxyHeaders });
  assert.equal(result.status, 200);
  const body = await result.json() as { receipts: Receipt[] };
  final = body.receipts.find((item) => item.id === state.operationId)!;
  if (final.state === "succeeded") break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(final.state, "succeeded");
const nativeRun = await native(`/api/v1/runs/${encodeURIComponent(state.runId!)}`);
assert.equal(nativeRun.status, "cancelled");
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), isolatedNativeRun: true, runId: state.runId,
  sessionId: state.sessionId, runKey: observed.key, firstReceiptState: receipt.state, finalReceiptState: final.state,
  nativeStatus: nativeRun.status, exactDuplicateReceipt: true, scope: "single-owner-native-cancel-only" }, null, 2));

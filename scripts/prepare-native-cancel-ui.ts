import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readConfig } from "../apps/api/config.ts";
import { externalKey } from "../packages/contracts/index.ts";

// One persisted, isolated QA Run. Cancellation is submitted only through the UI.
async function main() {
  const action = process.argv[2];
  if (!["start", "inspect", "verify"].includes(action ?? "")) throw new Error("Explicit QA action required");
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  const source = config.sources.find((item) => item.id === "demian-local");
  if (config.auth.mode !== "proxy" || config.auth.users.length !== 1 || !source?.tokenFile ||
      source.baseUrl !== "http://127.0.0.1:8080" || source.credentialFormat !== "demian-service" ||
      !source.cancelUsers?.includes(config.auth.users[0]!)) throw new Error("Installed owner cancellation grant required");
  const root = join(homedir(), ".local/share/agent-track");
  const ledger = join(root, "native-cancel-ui-check.json");
  const schema = z.object({ operationId: z.uuid(), workspaceId: z.uuid(), sessionId: z.uuid().optional(), runId: z.uuid().optional() }).strict();
  let state: z.infer<typeof schema>;
  try { state = schema.parse(JSON.parse(await readFile(ledger, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || action !== "start") throw new Error("QA ledger unavailable");
    const baseline = z.object({ workspaceId: z.uuid() }).parse(JSON.parse(await readFile(join(root, "native-observation-check.json"), "utf8")));
    state = { operationId: randomUUID(), workspaceId: baseline.workspaceId };
  }
  const save = () => writeFile(ledger, JSON.stringify(state, null, 2), { mode: 0o600 });
  const secret = z.object({ apiToken: z.string().min(1) }).parse(JSON.parse(await readFile(source.tokenFile, "utf8")));
  async function native(path: string, body?: object, extra: Record<string, string> = {}) {
    const response = await fetch(source!.baseUrl! + path, { method: body ? "POST" : "GET", redirect: "error",
      headers: { authorization: `Bearer ${secret.apiToken}`, "content-type": "application/json", ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Native QA request unavailable"); }
    return response.json() as Promise<unknown>;
  }
  const workspace = z.object({ id: z.uuid(), name: z.string(), status: z.literal("ready"), source: z.object({ type: z.literal("empty"), mode: z.literal("copy") }) })
    .parse(await native(`/api/v1/workspaces/${state.workspaceId}`));
  if (!workspace.name.startsWith("Agent Track native check ")) throw new Error("Isolated QA workspace required");
  const filename = "track-cancel-ui-proof.txt";
  if (action === "start") {
    await save();
    const title = `Agent Track UI cancel check ${state.operationId.slice(0, 8)}`;
    if (!state.sessionId) {
      const list = z.object({ data: z.array(z.object({ id: z.uuid(), title: z.string() })) }).parse(await native(`/api/v1/sessions?workspace_id=${state.workspaceId}`));
      // A lost non-idempotent session response needs manual reconciliation.
      if (list.data.some((item) => item.title === title)) throw new Error("An unrecorded QA session already exists");
      state.sessionId = z.object({ id: z.uuid() }).parse(await native("/api/v1/sessions", { workspace_id: state.workspaceId,
        title, provider: "codex-native", agent: "build", mode: "single-agent", permission_policy: "ask" })).id;
      await save();
    }
    if (!state.runId) {
      assert.equal(existsSync(join(homedir(), ".demian/service/workspaces", state.workspaceId, filename)), false);
      state.runId = z.object({ id: z.uuid() }).parse(await native(`/api/v1/sessions/${state.sessionId}/runs`, {
        input: [{ type: "input_text", text: `This is an isolated Agent Track UI cancellation test in an empty QA workspace. Request permission to ADD ${filename} using your native file-editing tool. Wait for human approval; the operator will cancel this Run instead of approving. Do not use shell, network, file reads, delegation, or change other files. If denied, expired, or cancelled, do not retry or use a workaround. The test must leave no file.` }],
      }, { "Idempotency-Key": `track-ui-cancel-${state.operationId}` })).id;
      await save();
    }
  }
  if (!state.runId) throw new Error("QA Run not recorded");
  const run = z.object({ id: z.uuid(), session_id: z.uuid(), status: z.string() }).parse(await native(`/api/v1/runs/${state.runId}`));
  assert.equal(run.session_id, state.sessionId);
  const runKey = externalKey(source.id, state.runId);
  const result: Record<string, unknown> = { isolatedEmptyWorkspace: true, runId: state.runId, sessionId: state.sessionId, runKey, nativeStatus: run.status,
    publicUrl: `${config.publicOrigin}/?view=track&run=${runKey}` };
  if (action === "verify") {
    assert.equal(run.status, "cancelled");
    assert.equal(existsSync(join(homedir(), ".demian/service/workspaces", state.workspaceId, filename)), false);
    const response = await fetch(`http://127.0.0.1:${config.port}/api/commands?run=${runKey}`, { headers: {
      "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0]! }, signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200);
    const body = z.object({ receipts: z.array(z.object({ id: z.uuid(), kind: z.literal("cancel"), state: z.string() })) }).parse(await response.json());
    assert.equal(body.receipts.length, 1); assert.equal(body.receipts[0]!.state, "succeeded");
    Object.assign(result, { receiptId: body.receipts[0]!.id, receiptState: "succeeded", fileAbsent: true, cancellationSubmittedByScript: false, verifiedAt: new Date().toISOString() });
  }
  console.log(JSON.stringify(result));
}
await main().catch(() => { console.error("Native UI cancellation QA failed; private values omitted."); process.exitCode = 1; });

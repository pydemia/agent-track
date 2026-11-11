import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readConfig } from "../apps/api/config.ts";
import { DemianClient } from "../packages/adapters/demian/index.ts";
import { approvalRequestSchema } from "../packages/contracts/index.ts";

// Explicit operator workflow, restricted to the prior empty QA workspace.
// It never makes decisions or targets existing user Runs.
async function main() {
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  const source = config.sources.find((item) => item.id === "demian-local");
  if (config.auth.mode !== "proxy" || config.auth.users.length !== 1 || !source?.baseUrl || !source.tokenFile ||
      source.baseUrl !== "http://127.0.0.1:8080" || source.credentialFormat !== "demian-service") throw new Error("Installed single-owner source required");
  const privateRoot = join(homedir(), ".local/share/agent-track");
  const variant = process.argv[3] ?? "builtin";
  if (!["builtin", "native-editor", "native-deny", "native-expiry", "native-session"].includes(variant)) throw new Error("Unknown QA variant");
  const nativeEditor = variant !== "builtin";
  const suffix = variant === "native-editor" ? "editor" : variant === "native-deny" ? "deny" : variant === "native-session" ? "session" : "expiry";
  const filename = variant === "native-deny" ? "track-approval-denied.txt" : variant === "native-expiry" ? "track-approval-expiry.txt" : variant === "native-session" ? "track-approval-session-a.txt" : "track-approval-proof.txt";
  const statePath = join(privateRoot, nativeEditor ? `native-approval-${suffix}-check.json` : "native-approval-check.json");
  const stateSchema = z.object({ operationId: z.uuid(), workspaceId: z.uuid(), sessionId: z.uuid().optional(), runId: z.uuid().optional(), command: approvalRequestSchema.optional() }).strict();
  let state: z.infer<typeof stateSchema>;
  try { state = stateSchema.parse(JSON.parse(await readFile(statePath, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Invalid approval check ledger");
    if (process.argv[2] !== "start") throw new Error("Explicit start required");
    const baseline = z.object({ workspaceId: z.uuid() }).parse(JSON.parse(await readFile(join(privateRoot, "native-observation-check.json"), "utf8")));
    state = { operationId: randomUUID(), workspaceId: baseline.workspaceId };
  }
  const secret = z.object({ apiToken: z.string().min(1) }).parse(JSON.parse(await readFile(source.tokenFile, "utf8")));
  const save = () => writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  async function native(path: string, body?: object, extra: Record<string, string> = {}) {
    const response = await fetch(source!.baseUrl! + path, { redirect: "error", signal: AbortSignal.timeout(15_000),
      method: body ? "POST" : "GET", headers: { authorization: `Bearer ${secret.apiToken}`, "content-type": "application/json", ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Native QA request unavailable"); }
    return response.json() as Promise<unknown>;
  }
  const workspace = z.object({ id: z.uuid(), name: z.string(), status: z.literal("ready"), source: z.object({ type: z.literal("empty"), mode: z.literal("copy") }) })
    .parse(await native(`/api/v1/workspaces/${state.workspaceId}`));
  if (!workspace.name.startsWith("Agent Track native check ")) throw new Error("Not the isolated QA workspace");
  if (process.argv[2] === "start") {
    await save();
    const title = `Agent Track approval check ${state.operationId.slice(0, 8)}`;
    if (!state.sessionId) {
      const list = z.object({ data: z.array(z.object({ id: z.uuid(), title: z.string() })) }).parse(await native(`/api/v1/sessions?workspace_id=${state.workspaceId}`));
      const found = list.data.filter((item) => item.title === title);
      if (found.length > 1) throw new Error("Ambiguous QA session");
      state.sessionId = found[0]?.id ?? z.object({ id: z.uuid() }).parse(await native("/api/v1/sessions", { workspace_id: state.workspaceId, title,
        provider: "codex-native", agent: "build", mode: "single-agent", permission_policy: "ask" })).id;
      await save();
    }
    if (!state.runId) {
      const result = z.object({ id: z.uuid() }).parse(await native(`/api/v1/sessions/${state.sessionId}/runs`, {
        input: [{ type: "input_text", text: nativeEditor
          ? `This is an isolated Agent Track approval test in its empty QA workspace. Use your native apply_patch/file-editing tool once to ADD a new relative file ${filename} containing exactly: Agent Track approval verified\n. I authorize that QA file creation subject to the runtime's approval. ${variant === "native-session" ? "After the first file succeeds, make a SECOND SEPARATE call to the SAME editing tool to ADD track-approval-session-b.txt with identical content. Exactly two separate calls, one file per call; never combine the files in one patch. Both named QA files are authorized. This tests a same-session/same-tool grant; a second prompt may be automatically allowed by the runtime. If a second prompt is required, wait rather than finding a workaround." : ""} Do not use write_file (unavailable in this provider), shell, network, file reads, or delegation. Do not modify existing files. Request approval if required and wait. If unavailable, denied or expired, report that outcome and do not find a workaround or attempt another write. After a successful edit, answer briefly.`
          : "This is an isolated Agent Track approval integration test in its empty QA workspace. Call only the write_file tool once to create track-approval-proof.txt with exactly this text: Agent Track approval verified\n. Do not read files, run shell commands, use network, delegate, or modify any other file. A human operator will approve or deny this single tool call. Wait for that decision. If denied or expired, report that outcome and do not try another tool or another write. After an allowed write, report success briefly." }],
      }, { "Idempotency-Key": `track-approval-${state.operationId}` }));
      state.runId = result.id; await save();
    }
  }
  if (!state.runId) throw new Error("QA Run not started");
  const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl, tokenFile: source.tokenFile, credentialFormat: "demian-service" });
  const observed = await client.observe(state.runId); const permissions = await client.permissions(state.runId);
  console.log(JSON.stringify({ isolatedEmptyWorkspace: true, sessionId: state.sessionId, runId: state.runId, status: observed.status,
    requests: permissions.map(({ request, reviewComplete }) => ({ id: request.id, tool: request.tool, status: request.status, decision: request.decision, expiresAt: request.expiresAt, reviewComplete })) }));
}
await main().catch(() => { console.error("Isolated native approval check failed; private values omitted."); process.exitCode = 1; });

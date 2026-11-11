import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Explicit operator integration check: one isolated, tool-free native text Run.
// A durable operation ID prevents repeated invocations from starting extra Runs.
const root = join(homedir(), ".demian/service");
const statePath = join(homedir(), ".local/share/agent-track/native-observation-check.json");
const service = JSON.parse(await readFile(join(root, "service.json"), "utf8"));
const secret = JSON.parse((await readFile(join(root, "secrets.json"), "utf8")).replace(/^\uFEFF/, ""));
const origin = new URL(service.apiUrl);
if (origin.hostname !== "127.0.0.1" || origin.port !== "8080") throw new Error("Expected the installed loopback Demian service");
const headers = { authorization: `Bearer ${secret.apiToken}`, "content-type": "application/json" };
async function request(path, body, extra = {}) {
  const response = await fetch(new URL(path, origin), { method: body ? "POST" : "GET", headers: { ...headers, ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Native check request rejected (${response.status}); no source body printed`); }
  return response.json();
}
let state;
try { state = JSON.parse(await readFile(statePath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw new Error("Invalid private native check state"); state = { operationId: randomUUID(), createdAt: new Date().toISOString() }; }
const save = () => writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
await save();
const name = `Agent Track native check ${state.operationId.slice(0, 8)}`;
if (!state.workspaceId) {
  const list = await request("/api/v1/workspaces");
  const existing = list.data.filter((w) => w.name === name);
  if (existing.length > 1) throw new Error("Ambiguous check workspace; no automatic retry");
  const workspace = existing[0] ?? await request("/api/v1/workspaces", { name });
  state.workspaceId = workspace.id; await save();
}
if (!state.sessionId) {
  const list = await request(`/api/v1/sessions?workspace_id=${encodeURIComponent(state.workspaceId)}`);
  const existing = list.data.filter((s) => s.title === name);
  if (existing.length > 1) throw new Error("Ambiguous check session; no automatic retry");
  const session = existing[0] ?? await request("/api/v1/sessions", {
    workspace_id: state.workspaceId, title: name, provider: "codex-native", agent: "build", mode: "single-agent", permission_policy: "deny",
  });
  state.sessionId = session.id; await save();
}
if (!state.runId) {
  const run = await request(`/api/v1/sessions/${encodeURIComponent(state.sessionId)}/runs`, {
    input: [{ type: "input_text", text: "This is an Agent Track observation check in an isolated empty workspace. Do not call tools, modify files, or delegate. Reply with exactly: Agent Track native observation verified." }],
  }, { "Idempotency-Key": `track-observation-${state.operationId}` });
  state.runId = run.id; await save();
}
const run = await request(`/api/v1/runs/${encodeURIComponent(state.runId)}`);
state.lastStatus = run.status; state.observedAt = new Date().toISOString(); await save();
const configPath = process.env.TRACK_CONFIG;
if (configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const source = config.sources.find((s) => s.id === "demian-local");
  if (!source) throw new Error("Expected configured native source");
  source.runIds = [...new Set([...(source.runIds ?? []), state.runId])];
  await writeFile(configPath, JSON.stringify(config, null, 2));
}
console.log(JSON.stringify({ workspaceId: state.workspaceId, sessionId: state.sessionId, runId: state.runId,
  status: state.lastStatus, observedAt: state.observedAt, scope: "one-real-native-run-no-file-tools" }, null, 2));

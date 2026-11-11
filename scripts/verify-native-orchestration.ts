import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../apps/api/config.ts";
import { externalKey } from "../packages/contracts/index.ts";
import type { OrchestrationEvidence } from "../apps/api/orchestration.ts";

// Reads an already observed QA Run and the installed module. Never starts a
// Session/Run, enumerates child targets or refreshes a deployment directory.
async function main() {
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  assert.ok(config.auth.mode === "proxy" && config.auth.users.length === 1);
  const runId = "865dd2b3-e362-4f60-9b7b-728ff1c8aeca";
  const source = config.sources.find((item) => item.id === "demian-local"); assert.ok(source?.kind === "demian");
  const key = externalKey(source.id, runId);
  const response = await fetch(`http://127.0.0.1:${config.port}/api/runs/${key}/orchestration`, {
    headers: { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0]! },
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200); const result = await response.json() as OrchestrationEvidence;
  assert.equal(result.runKey, key); assert.equal(result.state, "connected"); assert.ok(result.support);
  assert.equal(result.support.provider, "codex-native"); assert.equal(result.support.providerType, "codex-app-server");
  assert.equal(result.support.toolOrchestration, "external"); assert.equal(result.support.reported.managedChild, true);
  const service = JSON.parse(await readFile(join(homedir(), ".demian/service/service.json"), "utf8"));
  const worker = JSON.parse(await readFile(join(homedir(), ".demian/service/worker-process.json"), "utf8"));
  const modulePath = join(service.repository, "nodejs/dist/index.mjs");
  const module = await readFile(modulePath, "utf8");
  const builtBeforeWorkerStart = (await stat(modulePath)).mtime.getTime() <= Date.parse(worker.startedAt);
  assert.ok(builtBeforeWorkerStart);
  const index = module.indexOf("function usesExternalToolOrchestration");
  const externalGuard = index >= 0 && ["claudecode", "antigravity-cli", "antigravity-acp", "gemini-cli", "codex-app-server"].every((type) => module.slice(index, index + 600).includes(type));
  const childGuard = /if\s*\(!primary\s*\|\|\s*usesExternalToolOrchestration\(primary\)\)\s*return\s*\[\]/.test(module);
  assert.ok(externalGuard && childGuard);
  console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), ready: true, runId, state: result.state,
    sessionMode: result.sessionMode, support: result.support, nativeMutationsByVerifier: 0, childTargetsEnumerated: false,
    installedRuntime: { module: "nodejs/dist/index.mjs", sha256: createHash("sha256").update(module).digest("hex"), externalProviderGuardPresent: externalGuard,
      managedChildExternalGuardPresent: childGuard, builtBeforeWorkerStart }, actualManagedChildExecutionProven: false }, null, 2));
}
await main().catch(() => { console.error("Native orchestration verification failed; private configuration and source payloads omitted."); process.exitCode = 1; });

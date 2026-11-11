import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../apps/api/config.ts";
import { DemianClient } from "../packages/adapters/demian/index.ts";
import type { ArtifactEvidence, Snapshot } from "../packages/contracts/index.ts";

const config = readConfig(process.env.TRACK_CONFIG ?? "");
if (config.auth.mode !== "proxy") throw new Error("Private operator configuration required");
const source = config.sources.find((item) => item.id === "demian-local");
if (!source?.baseUrl || !source.tokenFile) throw new Error("Native source required");
const check = JSON.parse(await readFile(join(homedir(), ".local/share/agent-track/native-observation-check.json"), "utf8")) as { runId: string; sessionId: string };
const native = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl, tokenFile: source.tokenFile,
  ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}) });
const expected = await native.artifacts(check.runId, check.sessionId);
const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0]! };
const base = `http://127.0.0.1:${config.port}`;
const snapshot = await (await fetch(base + "/api/snapshot", { headers })).json() as Snapshot;
const run = snapshot.runs.find((item) => item.sourceId === source.id && item.runId === check.runId);
assert.ok(run);
const response = await fetch(`${base}/api/runs/${run.key}/artifacts`, { headers });
assert.equal(response.status, 200);
const actual = await response.json() as ArtifactEvidence;
assert.equal(actual.state, "connected");
assert.deepEqual(actual.artifacts, expected.artifacts); assert.equal(actual.scanned, expected.scanned);
assert.equal(actual.complete, false);
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), runId: check.runId, state: actual.state,
  nativeMetadataMatchesTrack: true, matchedRunArtifacts: actual.artifacts.length, scannedSessionArtifacts: actual.scanned,
  recentListLimit: actual.limit, completeHistory: actual.complete, sourceContentRequested: false,
  scope: actual.artifacts.length ? "run-bound-metadata" : "live-empty-recent-page; nonempty/revoked/foreign-Run cases covered by fixtures" }, null, 2));

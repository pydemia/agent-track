import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../apps/api/config.ts";
import { DemianClient } from "../packages/adapters/demian/index.ts";
import type { EventView, ObservationEvent, Snapshot } from "../packages/contracts/index.ts";

const path = process.env.TRACK_CONFIG;
if (!path) throw new Error("Private TRACK_CONFIG is required");
const config = readConfig(path);
assert.equal(config.auth.mode, "proxy");
if (config.auth.mode !== "proxy") throw new Error("Expected operator proxy mode");
const source = config.sources.find((item) => item.id === "demian-local");
if (!source?.baseUrl || !source.tokenFile) throw new Error("Native read source is not configured");
const check = JSON.parse(await readFile(join(homedir(), ".local/share/agent-track/native-observation-check.json"), "utf8")) as { runId: string };
const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl, tokenFile: source.tokenFile,
  ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}) });
const native = await client.observe(check.runId);
const sourceEvents: ObservationEvent[] = [];
await client.stream(check.runId, "0", (event) => sourceEvents.push(event), AbortSignal.timeout(10_000));
assert.ok(sourceEvents.length > 0);
const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0]! };
const base = `http://127.0.0.1:${config.port}`;
const response = await fetch(base + "/api/snapshot", { headers });
assert.equal(response.status, 200);
const snapshot = await response.json() as Snapshot;
const observed = snapshot.runs.find((run) => run.sourceId === source.id && run.runId === check.runId);
assert.ok(observed);
assert.equal(observed.status, native.status);
assert.equal(observed.sessionId, native.sessionId);
assert.equal(observed.cursor, sourceEvents.at(-1)!.sequence);
assert.equal(observed.highWater, observed.cursor);
assert.equal(observed.incomplete, false);
const journal: ObservationEvent[] = [];
let cursor = "0";
for (let page = 0; page < 50; page++) {
  const pageResponse = await fetch(`${base}/api/runs/${observed.key}/events?after=${cursor}`, { headers });
  assert.equal(pageResponse.status, 200);
  const data = await pageResponse.json() as { events: EventView[]; nextCursor: string; hasMore: boolean };
  journal.push(...data.events.map(({ key: _key, receivedAt: _received, ...event }) => event));
  if (!data.hasMore) break;
  cursor = data.nextCursor;
}
assert.deepEqual(journal, sourceEvents);
let replayed = 0;
await client.stream(check.runId, observed.cursor, () => replayed++, AbortSignal.timeout(10_000));
assert.equal(replayed, 0);
assert.ok(journal.every((event) => event.data.redacted));
assert.doesNotMatch(JSON.stringify(journal), /Agent Track native observation verified/);
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), liveNativeRun: true, sourceId: source.id,
  runId: check.runId, sessionId: native.sessionId, status: native.status,
  sourceEventCount: sourceEvents.length, journalEventCount: journal.length, cursor: observed.cursor,
  incomplete: observed.incomplete, resumedEventsAfterCursor: replayed, metadataMatchesSource: true,
  nativeOutputNotStored: true }, null, 2));

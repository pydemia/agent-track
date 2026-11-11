import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { readConfig } from "../apps/api/config.ts";
import { externalKey, type EventView, type Snapshot } from "../packages/contracts/index.ts";
import { parseSse } from "../packages/adapters/demian/index.ts";
import type { ToolEvidence } from "../apps/api/tools.ts";
import type { LineageEvidence } from "../apps/api/lineage.ts";
import { missionFlow } from "../packages/projection/mission-flow.ts";
import { withNativeLineage } from "../packages/projection/lineage-flow.ts";
import { withToolEvidence } from "../packages/projection/tool-flow.ts";

async function main() {
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  if (config.auth.mode !== "proxy" || config.auth.users.length !== 1) throw new Error("Owner proxy required");
  const source = config.sources.find((item) => item.id === "demian-local");
  if (!source?.baseUrl || !source.tokenFile) throw new Error("Native source required");
  const credential = (await readFile(source.tokenFile, "utf8")).replace(/^\uFEFF/, "").trim();
  const token: string = source.credentialFormat === "demian-service" ? JSON.parse(credential).apiToken : credential;
  assert.ok(token && !/\s/.test(token));
  const nativeHeaders = { Authorization: `Bearer ${token}`, ...(source.organizationId ? { "X-Demian-Organization-Id": source.organizationId } : {}) };
  const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0]! };
  const runId = "d8131c91-8d67-457e-8b95-99bc6c8bfef3"; const key = externalKey(source.id, runId);
  const base = `http://127.0.0.1:${config.port}`;
  async function get<T>(route: string): Promise<T> { const response = await fetch(base + route, { headers, signal: AbortSignal.timeout(20_000) }); assert.equal(response.status, 200); return response.json() as Promise<T>; }
  const snapshot = await get<Snapshot>("/api/snapshot"); const run = snapshot.runs.find((value) => value.key === key); assert.ok(run);
  const db = new DatabaseSync(config.database, { readOnly: true });
  try {
    const before = db.prepare("SELECT ordinal,digest,payload FROM events WHERE run_key=? ORDER BY ordinal").all(key);
    const [lineage, tools] = await Promise.all([get<LineageEvidence>(`/api/runs/${key}/lineage`), get<ToolEvidence>(`/api/runs/${key}/tools`)]);
    assert.equal(lineage.state, "connected"); assert.equal(tools.state, "connected"); assert.equal(tools.complete, true);
    const raw = await fetch(`${source.baseUrl}/api/v1/runs/${runId}/events?after=0`, { headers: nativeHeaders, signal: AbortSignal.timeout(15_000) });
    assert.equal(raw.status, 200); assert.ok(raw.body);
    const completions: Array<{ sequence: string; callId: string; invocationId: string | null; ok: boolean | null }> = [];
    let count = 0; const stop = new Error("Known target reached");
    try { await parseSse(raw.body, (id, value) => {
      const event = value as { run_id: string; sequence_text: string; type: string; data: { call_id?: string; callId?: string; invocation_id?: string; invocationId?: string; ok?: boolean } };
      assert.equal(event.run_id, runId); assert.equal(event.sequence_text, id); count++; assert.ok(count <= 2000);
      if (event.type === "tool.completed") completions.push({ sequence: id, callId: event.data.call_id ?? event.data.callId ?? "",
        invocationId: event.data.invocation_id ?? event.data.invocationId ?? null, ok: typeof event.data.ok === "boolean" ? event.data.ok : null });
      if (id === run.highWater) throw stop;
    }); } catch (error) { if (error !== stop) throw error; }
    for (const end of completions) {
      const call = tools.calls.find((value) => value.callId === end.callId && value.invocationId === end.invocationId); assert.ok(call);
      assert.equal(call.ended[0]?.sequence, end.sequence); assert.equal(call.ended[0]?.ok ?? null, end.ok);
      assert.equal(call.outcome, end.ok === false ? "failed" : end.ok === true ? "succeeded" : "unknown");
    }
    const events = before.map((row) => ({ ...JSON.parse(String(row.payload)), key: String(row.ordinal), receivedAt: run.observedAt })) as EventView[];
    const model = withNativeLineage(withToolEvidence(missionFlow(run, snapshot.runs, snapshot.relations, events, { mode: "execution" }), run, tools), run, lineage.observations);
    assert.equal(model.nodes.filter((node) => node.kind === "tool").length, tools.calls.length);
    assert.ok(model.edges.every((edge) => model.nodes.some((node) => node.key === edge.from) && model.nodes.some((node) => node.key === edge.to)));
    assert.deepEqual(db.prepare("SELECT ordinal,digest,payload FROM events WHERE run_key=? ORDER BY ordinal").all(key), before);
    assert.doesNotMatch(JSON.stringify({ tools, lineage }), /"input"|"output"|"preview"|"messages"|"arguments"|"command"/);
    console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), sourceId: source.id, runId, sessionId: run.sessionId,
      nativeEventCount: count, immutableJournalRows: before.length, immutableJournalUnchanged: true, rawPayloadNotExported: true,
      lineageRows: lineage.observations.length, exactNativeItemJoins: tools.calls.filter((call) => lineage.observations.some((row) => row.nativeItemId === call.callId && row.invocationId === call.invocationId)).length,
      toolCalls: tools.calls.length, nativeCompletionResultsMatched: completions.length, failuresReported: tools.calls.filter((call) => call.outcome === "failed").length,
      sourceResultSuccesses: tools.calls.filter((call) => call.outcome === "succeeded").length, requestedIsNotStart: tools.calls.every((call) => call.started.length === 0),
      completeThroughTarget: tools.complete, cursor: run.highWater, nodes: model.nodes.length, edges: model.edges.length,
      actualManagedChildOrPeerVerified: false, actualCrossDeviceVerified: false }, null, 2));
  } finally { db.close(); }
}
await main().catch(() => { console.error("Native flow verification failed; private source values omitted."); process.exitCode = 1; });

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DemianClient, parseSse } from "../packages/adapters/demian/index.ts";
import { Store } from "../packages/storage/store.ts";
import { createTrackServer } from "../apps/api/server.ts";
import type { Sources } from "../apps/api/runner.ts";
import type { SourceView, Snapshot, RunObservation } from "../packages/contracts/index.ts";

const time = "2026-11-11T12:00:00.000Z";
const run: RunObservation = { sourceId: "native", runId: "run", sessionId: "session", workspaceId: "ws", title: "recovery test",
  status: "queued", createdAt: time, startedAt: null, completedAt: null, observedAt: time };
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }

test("HTTP snapshots and pushed state agree; disconnected observations remain stale until reauthorization", { timeout: 10_000 }, async () => {
  const store = new Store(":memory:"); store.observeRun(run);
  let state: SourceView["state"] = "connected";
  const sources = { views: () => [{ id: "native", kind: "demian", label: "native", device: "test", state,
    lastObservedAt: time, detail: "HTTP fixture", capabilities: ["run.read"] }] } as unknown as Sources;
  const { server } = createTrackServer(store, () => ({ port: 14345, database: ":memory:", publicOrigin: "http://localhost",
    auth: { mode: "local", user: "owner@example.com" }, sources: [] }), "dist/web", sources);
  const base = await listen(server);
  const controller = new AbortController();
  let parsing = Promise.resolve();
  try {
    const initial = await (await fetch(base + "/api/snapshot")).json() as Snapshot;
    assert.equal(initial.runs[0]!.status, "queued");
    const response = await fetch(base + "/api/stream", { signal: controller.signal });
    const frames: Snapshot[] = [];
    let wake: (() => void) | undefined;
    parsing = parseSse(response.body!, (_id, value) => { frames.push(value as Snapshot); wake?.(); wake = undefined; })
      .catch((error: unknown) => { if (!controller.signal.aborted) throw error; });
    const next = async () => {
      if (!frames.length) await new Promise<void>((resolve) => { wake = resolve; });
      return frames.shift()!;
    };
    const first = await next();
    assert.deepEqual(first.runs, initial.runs);
    for (const [index, status] of (["leasing", "running", "waiting_for_permission", "cancelling", "failed"] as const).entries()) {
      store.observeRun({ ...run, status, observedAt: `2026-11-11T12:00:0${index + 1}.000Z`, completedAt: status === "failed" ? time : null });
      const snapshot = await (await fetch(base + "/api/snapshot")).json() as Snapshot;
      assert.equal(snapshot.runs[0]!.status, status);
      assert.equal(snapshot.runs[0]!.observedAt, `2026-11-11T12:00:0${index + 1}.000Z`);
    }
    const pushed = await next();
    assert.equal(pushed.runs[0]!.status, "failed");
    assert.notEqual(pushed.generatedAt, pushed.runs[0]!.observedAt);
    state = "disconnected";
    assert.equal(((await (await fetch(base + "/api/snapshot")).json()) as Snapshot).runs[0]!.stale, true);
    state = "forbidden";
    assert.equal(((await (await fetch(base + "/api/snapshot")).json()) as Snapshot).runs.length, 0);
    state = "connected";
    const recovered = await (await fetch(base + "/api/snapshot")).json() as Snapshot;
    assert.equal(recovered.runs[0]!.stale, false);
    assert.equal(recovered.runs[0]!.status, "failed");
  } finally { controller.abort(); await parsing; await close(server); store.close(); }
});

test("native HTTP replay after a process restart backfills a gap without duplicating journal entries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "track-http-recovery-"));
  const path = join(directory, "journal.sqlite");
  const cursors: string[] = [];
  const native = createServer((request, response) => {
    const after = new URL(request.url!, "http://localhost").searchParams.get("after")!;
    cursors.push(after);
    response.setHeader("Content-Type", "text/event-stream");
    for (const sequence of after === "0" ? ["1", "3"] : ["2", "3"]) {
      response.write(`id: ${sequence}\ndata: ${JSON.stringify({ api_version: "2026-09-01", run_id: "run", sequence_text: sequence,
        type: "run.updated", created_at: time, data: {} })}\n\n`);
    }
    response.end();
  });
  const baseUrl = await listen(native);
  let store = new Store(path);
  const client = new DemianClient({ sourceId: "native", baseUrl });
  try {
    const key = store.observeRun(run);
    await client.stream("run", store.cursor("native", "run"), (event) => store.ingest(event), AbortSignal.timeout(2000));
    assert.equal(store.run(key)!.cursor, "1"); assert.equal(store.run(key)!.high_water, "3");
    store.close(); store = new Store(path);
    await client.stream("run", store.cursor("native", "run"), (event) => store.ingest(event), AbortSignal.timeout(2000));
    assert.deepEqual(cursors, ["0", "1"]);
    assert.equal(store.run(key)!.cursor, "3"); assert.equal(store.run(key)!.high_water, "3");
    assert.equal(store.events(key).events.length, 3);
  } finally { await close(native); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

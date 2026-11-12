import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { artifactEvidence, type ArtifactReadOptions } from "../apps/api/evidence.ts";
import { CommandError } from "../packages/commands/index.ts";
import { SourceError } from "../packages/adapters/demian/index.ts";
import type { Config } from "../apps/api/config.ts";
import type { ArtifactMetadataPage, RunView, Snapshot, SourceView } from "../packages/contracts/index.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = "owner@example.test", now = new Date().toISOString();
function fixture() {
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "http://127.0.0.1:14345", auth: { mode: "local", user },
    sources: [{ id: "native", kind: "demian", label: "Native", device: "test", users: [user], baseUrl: "https://native.example.test",
      runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] };
  const run: RunView = { key: "key1", sourceId: "native", runId: id(1), sessionId: id(2), workspaceId: id(3),
    title: "Fixture", status: "succeeded", createdAt: now, startedAt: now, completedAt: now, observedAt: now,
    cursor: "1", highWater: "1", incomplete: false, stale: false, sourceLabel: "Native", device: "test", sourceState: "connected",
    sourceUrl: null, workspaceKey: null, projectKey: null, capabilities: ["session.link"],
    binding: { sourceId: "native", runId: id(1), projectSourceId: "projects", projectId: id(90), taskId: id(91),
      taskRevision: "1", projectTitle: "Project", taskTitle: "Task", provenance: "operator" } };
  const views: SourceView[] = [{ id: "native", kind: "demian", label: "Native", device: "test", state: "connected", lastObservedAt: now,
    detail: "fixture", capabilities: [] }, { id: "projects", kind: "projects", label: "Projects", device: "test", state: "connected",
    lastObservedAt: now, detail: "fixture", capabilities: [], authorizedProjectIds: [id(90)] }];
  let calls = 0, observes = 0, refreshes = 0;
  const page: ArtifactMetadataPage = { artifacts: [{ id: id(4), runId: id(1), sessionId: id(2), kind: "result", filename: "report.txt",
    mediaType: "text/plain", sizeBytes: 4, sha256: "a".repeat(64), representation: "original", createdAt: now }], scanned: 1, limit: 100, complete: false };
  const state = { refresh: async (_n: number) => {}, read: async () => page, observe: async () => run };
  const options: ArtifactReadOptions = { factory: () => ({ observe: async () => { observes++; return state.observe(); },
    artifacts: async () => { calls++; return state.read(); } }) };
  const read = (extra: ArtifactReadOptions = {}) => artifactEvidence(() => config, () => ({ runs: [run], sources: views }) as Snapshot,
    user, run.key, async () => { await state.refresh(++refreshes); }, { ...options, ...extra });
  return { config, source: config.sources[0]!, run, views, page, state, read, counts: () => ({ calls, observes, refreshes }) };
}
const denied = (status: number) => (error: unknown) => error instanceof CommandError && error.status === status;

test("artifact metadata requires both initial and final native Run and Projects authority", async () => {
  const f = fixture(); const value = await f.read();
  assert.equal(value.state, "connected"); assert.equal(value.artifacts[0]!.kind, "result");
  assert.deepEqual(f.counts(), { calls: 1, observes: 2, refreshes: 2 });
  for (const change of ["project", "binding", "source", "actor", "membership"] as const) {
    const f = fixture(); f.state.refresh = async n => { if (n !== 2) return;
      if (change === "project") f.views[1]!.authorizedProjectIds = [];
      if (change === "binding") f.run.binding!.taskId = id(92);
      if (change === "source") f.source.baseUrl = "https://rotated.example.test";
      if (change === "actor") f.config.auth = { mode: "local", user: "other@example.test" };
      if (change === "membership") f.source.users = [];
    };
    await assert.rejects(f.read(), denied(change === "actor" ? 403 : 404));
  }
});

test("stale and disconnected runs never read artifacts; initial Project denial never reaches native", async () => {
  for (const bound of [true, false]) {
    const f = fixture(); if (!bound) f.run.binding = null; f.run.stale = true;
    if (bound) await assert.rejects(f.read(), denied(404));
    else assert.equal((await f.read()).state, "disconnected");
    assert.equal(f.counts().calls, 0); assert.equal(f.counts().observes, 0);
  }
  const f = fixture(); f.views[1]!.authorizedProjectIds = [];
  await assert.rejects(f.read(), denied(404)); assert.equal(f.counts().observes, 0);
});

test("final native revoke and malformed metadata return no buffered filename or body", async () => {
  for (const change of ["revoke", "run", "duplicate", "extra"] as const) {
    const f = fixture();
    if (change === "revoke") f.state.observe = async () => { if (f.counts().observes > 1) throw new SourceError(403); return f.run; };
    if (change === "run") f.page.artifacts[0]!.runId = id(9);
    if (change === "duplicate") f.page.artifacts.push({ ...f.page.artifacts[0]! });
    if (change === "extra") Object.assign(f.page.artifacts[0]!, { body: "PRIVATE_BODY" });
    const value = await f.read(); assert.equal(value.state, ["revoke", "run"].includes(change) ? "forbidden" : "disconnected");
    assert.deepEqual(value.artifacts, []); assert.equal(value.scanned, 0); assert.doesNotMatch(JSON.stringify(value), /report.txt|PRIVATE_BODY/);
  }
});

test("credential file replacement invalidates buffered artifact metadata", async t => {
  const directory = mkdtempSync(join(tmpdir(), "track-artifact-authority-"));
  t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert(basename(directory).startsWith("track-artifact-authority-")); rmSync(directory, { recursive: true, force: true }); });
  const f = fixture(); f.source.tokenFile = join(directory, "key"); writeFileSync(f.source.tokenFile, "fixture-key-before");
  f.state.refresh = async n => { if (n === 2) writeFileSync(f.source.tokenFile!, "fixture-key-after"); };
  await assert.rejects(f.read(), denied(404));
});

test("native authority revoked during the final Projects refresh removes buffered artifacts", async () => {
  const f = fixture(); let revoked = false;
  f.state.refresh = async n => { if (n === 2) revoked = true; };
  f.state.observe = async () => { if (revoked) throw new SourceError(403); return f.run; };
  const value = await f.read(); assert.equal(value.state, "forbidden"); assert.deepEqual(value.artifacts, []);
  assert.doesNotMatch(JSON.stringify(value), /report.txt/);
});

test("artifact grant refresh, native body and caller cancellation obey one total deadline", async () => {
  for (const step of ["refresh", "body", "abort"] as const) {
    const f = fixture(), controller = new AbortController();
    if (step === "refresh") f.state.refresh = () => new Promise(() => {});
    else f.state.read = () => new Promise(() => {});
    const pending = f.read({ timeoutMs: 40, signal: controller.signal });
    if (step === "abort") controller.abort(new Error("PRIVATE_REASON"));
    const value = await pending; assert.equal(value.state, "disconnected"); assert.deepEqual(value.artifacts, []);
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE_REASON|report.txt/);
  }
});

test("artifact final microtask cannot publish after the monotonic deadline", async t => {
  const f = fixture(); let clock = performance.now(); t.mock.method(performance, "now", () => clock);
  f.state.refresh = async n => { if (n === 2) clock += 101; };
  const value = await f.read({ timeoutMs: 100 }); assert.equal(value.state, "disconnected"); assert.deepEqual(value.artifacts, []);
});

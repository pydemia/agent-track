import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/store.ts";
import { externalKey, sequenceSchema, type ObservationEvent, type RunBinding, type RunObservation, type SourceView } from "../packages/contracts/index.ts";
import { DemianClient, normalizeEvent, parseSse } from "../packages/adapters/demian/index.ts";
import { createTrackServer } from "../apps/api/server.ts";
import type { Config } from "../apps/api/config.ts";
import type { Sources } from "../apps/api/runner.ts";

const timestamp = "2026-11-11T10:00:00.000Z";
function run(sourceId = "demian", runId = "run-1"): RunObservation {
  return { sourceId, runId, sessionId: "session-1", workspaceId: "ws-1", title: "검증 실행", status: "running",
    createdAt: timestamp, startedAt: timestamp, completedAt: null, observedAt: timestamp };
}
function event(sequence: string, data: ObservationEvent["data"] = { redacted: true }): ObservationEvent {
  return { sourceId: "demian", runId: "run-1", sequence, type: "agent.invocation.started", occurredAt: timestamp, data };
}
function source(id = "demian"): SourceView {
  return { id, kind: "demian", label: "Demian", device: "test", state: "connected", lastObservedAt: timestamp, detail: "test", capabilities: ["run.read"] };
}

test("external identity is unambiguous across source and run tuples", () => {
  assert.notEqual(externalKey("a/b", "c"), externalKey("a", "b/c"));
  const db = new Store(":memory:");
  db.observeRun(run("a")); db.observeRun(run("b"));
  assert.equal(db.snapshot("owner", [source("a"), source("b")]).runs.length, 2);
  db.close();
});
test("int64 sequences never pass through JS Number", () => {
  for (const value of ["9007199254740993", "9223372036854775807"]) assert.equal(sequenceSchema.parse(value), value);
  for (const value of ["01", "-1", "1.1", "9223372036854775808", 9007199254740992]) assert.equal(sequenceSchema.safeParse(value).success, false);
});
test("out-of-order events retain gaps, dedupe and advance only the contiguous cursor", () => {
  const db = new Store(":memory:"); db.observeRun(run());
  db.ingest(event("3")); db.ingest(event("1"));
  let view = db.snapshot("owner", [source()]).runs[0]!;
  assert.equal(view.cursor, "1"); assert.equal(view.highWater, "3"); assert.equal(view.incomplete, true);
  db.ingest(event("2")); assert.equal(db.ingest(event("2")), "duplicate");
  view = db.snapshot("owner", [source()]).runs[0]!;
  assert.equal(view.cursor, "3"); assert.equal(view.incomplete, false);
  assert.throws(() => db.ingest(event("2", { redacted: true, invocationId: "conflict" })), /Conflicting/);
  db.close();
});
test("journal and cursor survive process restart; source sequence differs from local page cursor", () => {
  const dir = mkdtempSync(join(tmpdir(), "track-core-"));
  try {
    const path = join(dir, "journal.sqlite"); let db = new Store(path);
    const key = db.observeRun(run());
    db.ingest(event("9007199254740993")); db.ingest(event("1")); db.close();
    db = new Store(path);
    assert.equal(db.cursor("demian", "run-1"), "1");
    const first = db.events(key, "0", 1);
    assert.equal(first.events[0]?.sequence, "9007199254740993");
    assert.equal(first.nextCursor, "1"); assert.equal(first.hasMore, true);
    assert.equal(db.events(key, first.nextCursor).events[0]?.sequence, "1");
    assert.equal(db.integrity(), "ok"); db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("replayed metadata cannot revive a terminal Run or change its Session", () => {
  const db = new Store(":memory:");
  db.observeRun({ ...run(), status: "succeeded", completedAt: timestamp });
  db.observeRun({ ...run(), observedAt: "2026-11-11T11:00:00.000Z" });
  assert.equal(db.snapshot("owner", [source()]).runs[0]?.status, "succeeded");
  assert.throws(() => db.observeRun({ ...run(), sessionId: "other" }), /identity/); db.close();
});
test("binding history remains Run-scoped and requires both source grants", () => {
  const db = new Store(":memory:"); const key = db.observeRun(run()); db.observeRun(run("demian", "run-2"));
  const binding: RunBinding = { sourceId: "demian", runId: "run-1", projectSourceId: "projects", projectId: "project-1", taskId: "task-1",
    taskRevision: "4", projectTitle: "프로젝트", taskTitle: "업무", provenance: "operator" };
  db.bind(binding, "owner"); db.bind({ ...binding, taskId: "task-2", taskRevision: "5" }, "owner");
  assert.equal(db.bindingHistory(key).length, 2);
  assert.equal(db.snapshot("owner", [source()]).runs.length, 1);
  const snapshot = db.snapshot("owner", [source(), source("projects")]);
  assert.equal(snapshot.runs.find((r) => r.runId === "run-1")?.binding?.taskId, "task-2");
  assert.equal(snapshot.runs.find((r) => r.runId === "run-2")?.binding, null); db.close();
});
test("project/workspace filter identities include source IDs and never merge equal titles", () => {
  const db = new Store(":memory:");
  db.observeRun(run("native-a")); db.observeRun(run("native-b"));
  for (const [sourceId, projectId] of [["native-a", "project-a"], ["native-b", "project-b"]]) {
    db.bind({ sourceId: sourceId!, runId: "run-1", projectSourceId: "projects", projectId: projectId!,
      projectTitle: "같은 제목", taskId: null, taskRevision: null, taskTitle: null, provenance: "operator" }, "owner");
  }
  const runs = db.snapshot("owner", [source("native-a"), source("native-b"), source("projects")]).runs;
  assert.equal(new Set(runs.map((r) => r.projectKey)).size, 2);
  assert.equal(new Set(runs.map((r) => r.workspaceKey)).size, 2);
  assert.ok(runs.every((r) => !r.projectKey?.includes("같은 제목") && !r.workspaceKey?.includes("ws-1")));
  db.close();
});
test("typed relations do not inflate Run counts or merge invocation, cowork and peer", () => {
  const db = new Store(":memory:"); db.observeRun(run());
  db.ingest(event("1", { redacted: true, invocationId: "child", parentInvocationId: "root" }));
  db.ingest({ ...event("2", { redacted: true, groupId: "group", memberId: "child" }), type: "cowork.member.started" });
  db.ingest({ ...event("3", { redacted: true, childRunId: "separate" }), type: "managed_child.observed" });
  db.ingest({ ...event("4", { redacted: true, peerSessionId: "peer" }), type: "peer.observed" });
  const snapshot = db.snapshot("owner", [source()]);
  assert.equal(snapshot.runs.length, 1);
  assert.deepEqual(new Set(snapshot.relations.map((e) => e.kind)), new Set(["invocation", "cowork", "managed-child", "peer"]));
  assert.ok(snapshot.relations.every((r) => r.evidenceSequence && r.observedAt)); db.close();
});
test("metadata allowlist rejects storage injection and removes native private content", () => {
  const native = { api_version: "2026-09-01", run_id: "run-1", sequence_text: "9007199254740993", sequence: null,
    type: "tool.started", created_at: timestamp,
    data: { callId: "call-1", tool: "shell", input: "SECRET INPUT", output: "SECRET OUTPUT", password: "SECRET PASSWORD", invocationId: "inv-1" } };
  const normalized = normalizeEvent("demian", native);
  assert.equal(normalized.sequence, "9007199254740993"); assert.equal(normalized.data.callId, "call-1");
  assert.doesNotMatch(JSON.stringify(normalized), /SECRET|password|output|input/);
  const db = new Store(":memory:"); db.observeRun(run());
  assert.throws(() => db.ingest({ ...normalized, data: { ...normalized.data, input: "NO" } } as ObservationEvent));
  db.close();
});
test("Demian diff stores only the observed path and IDs, never file contents", () => {
  const normalized = normalizeEvent("demian", { api_version: "2026-09-01", run_id: "run-1", sequence_text: "1",
    type: "workspace.diff.updated", created_at: timestamp, data: { invocationId: "inv", callId: "call",
      change: { path: "src/main.ts", diff: "SECRET", beforeContent: "SECRET", afterContent: "SECRET" } } });
  assert.equal(normalized.data.path, "src/main.ts"); assert.equal(normalized.data.invocationId, "inv");
  assert.doesNotMatch(JSON.stringify(normalized), /SECRET|Content|diff\"/);
});
test("revoked sources hide previously cached runs and relations", () => {
  const db = new Store(":memory:"); db.observeRun(run()); db.ingest(event("1", { invocationId: "child", redacted: true }));
  const snapshot = db.snapshot("owner", [{ ...source(), state: "forbidden" }]);
  assert.equal(snapshot.runs.length, 0); assert.equal(snapshot.relations.length, 0);
  assert.equal(db.snapshot("other", []).runs.length, 0); db.close();
});
test("SSE handles UTF-8/CRLF chunks, multiline frames and does not commit partial frames", async () => {
  const payload = { title: "실행", sequence_text: "9007199254740993" };
  const bytes = new TextEncoder().encode(`: comment\r\nid: 9007199254740993\r\ndata: ${JSON.stringify(payload)}\r\n\r\nid: 2\ndata: {"partial":true}`);
  const frames: unknown[] = [];
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close();
  } });
  await parseSse(body, (id, value) => frames.push({ id, value }));
  assert.deepEqual(frames, [{ id: "9007199254740993", value: payload }]);
});
test("native adapter only accepts matching Run and SSE cursor identity", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/events")) return new Response(`id: 2\ndata: ${JSON.stringify({ api_version: "2026-09-01", run_id: "run-1", sequence_text: "1", type: "run.started", created_at: timestamp, data: {} })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    return Response.json({ id: "wrong-run", session_id: "session-1", status: "running", created_at: timestamp, started_at: timestamp, completed_at: null });
  };
  const client = new DemianClient({ sourceId: "demian", baseUrl: "http://localhost:8080", fetch: fakeFetch });
  await assert.rejects(() => client.observe("run-1"), /identity/);
  await assert.rejects(() => client.stream("run-1", "0", () => {}, AbortSignal.timeout(3000)), /identity/);
});
test("native service credential references private JSON without exporting unrelated values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "track-credential-"));
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify({ apiToken: "test-only-native-token", databasePassword: "must-not-forward" }));
  const fakeFetch: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-only-native-token");
    assert.doesNotMatch(JSON.stringify([...headers]), /must-not-forward/);
    return Response.json({ id: "run-1", session_id: "session-1", status: "running", created_at: timestamp, started_at: timestamp, completed_at: null, workspace_id: "ws", title: "test" });
  };
  try {
    const client = new DemianClient({ sourceId: "demian", baseUrl: "http://localhost:8080", tokenFile: file, credentialFormat: "demian-service", fetch: fakeFetch });
    // Session identity validation still applies after the credential is resolved.
    await assert.rejects(() => client.observe("run-1"), /identity/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("native cancel uses the fixed Run route and validates the source acknowledgement", async () => {
  const fakeFetch: typeof fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, "/api/v1/runs/run-1/cancel");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), {});
    return Response.json({ id: "run-1", status: "cancelling" });
  };
  const client = new DemianClient({ sourceId: "demian", baseUrl: "http://localhost:8080", fetch: fakeFetch });
  assert.deepEqual(await client.cancel("run-1"), { runId: "run-1", status: "cancelling" });
  const wrong = new DemianClient({ sourceId: "demian", baseUrl: "http://localhost:8080", fetch: async () => Response.json({ id: "other", status: "cancelled" }) });
  await assert.rejects(() => wrong.cancel("run-1"), /identity/);
});
test("native history discovery retains only Run IDs and a separate string message cursor", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/workspaces")) return Response.json({ data: [{ id: "ws" }] });
    if (url.pathname === "/api/v1/sessions") return Response.json({ data: [{ id: "session" }] });
    if (url.pathname.endsWith("/messages")) {
      assert.equal(url.searchParams.get("after"), "9007199254740993");
      return Response.json({ data: ["SECRET MESSAGE"], entries: [{ run_id: "historical-run", sequence: "9007199254740994" }],
        next_cursor: null, has_more: false, incomplete_history: false });
    }
    return Response.json({ active_run_id: null });
  };
  const client = new DemianClient({ sourceId: "demian", baseUrl: "http://localhost:8080", fetch: fakeFetch });
  const result = await client.discoverRuns({ history: true, cursor: () => "9007199254740993" });
  assert.deepEqual(result.runIds, ["historical-run"]);
  assert.equal(result.cursors.get("session"), "9007199254740994");
  assert.equal(result.incompleteSessions, 0);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|MESSAGE/);
});
test("API enforces proxy identity, rejects Basic/forgeries, revokes streams and filters projects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "track-api-"));
  const secret = "test-only-proxy-key-32-characters-minimum"; writeFileSync(join(dir, "proxy-key"), secret);
  const db = new Store(":memory:"); const key = db.observeRun(run()); db.ingest(event("1"));
  let users = ["owner@example.com"];
  const config = (): Config => ({ port: 14345, database: join(dir, "test.sqlite"), publicOrigin: "https://track.example.com",
    auth: { mode: "proxy", secretFile: join(dir, "proxy-key"), users }, sources: [] });
  const sources = { views(user: string) { return user === "owner@example.com" ? [source()] : []; } } as unknown as Sources;
  const { server } = createTrackServer(db, config, dir, sources);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { "x-track-proxy-key": secret, "x-forwarded-email": "owner@example.com" };
  try {
    for (const forged of [{}, { authorization: "Basic dGVzdDp0ZXN0" }, { "x-forwarded-email": "owner@example.com" }, { ...headers, "x-track-proxy-key": "bad" }]) {
      assert.equal((await fetch(`${base}/api/snapshot`, { headers: forged })).status, 401);
    }
    const response = await fetch(`${base}/api/snapshot`, { headers });
    assert.equal(response.status, 200); assert.equal((await response.json()).runs.length, 1);
    assert.equal((await fetch(`${base}/api/runs/${key}/events?after=-1`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/api/runs/not-authorized/events`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/command`, { headers, method: "POST", body: "{}" })).status, 405);
    users = [];
    assert.equal((await fetch(`${base}/api/snapshot`, { headers })).status, 401);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

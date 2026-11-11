import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { AssistantReadService, AssistantReadError, ASSISTANT_READ_PREFIX as prefix,
  type AssistantReadPort, type AssistantReaderConfig } from "../packages/assistant-read/service.ts";
import { assistantExecutionPageSchema, assistantExecutionEventsPageSchema } from "../packages/contracts/assistant.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const instant = "2026-11-12T00:00:00.000Z";
const owner = "sso-sub:" + "a".repeat(64);
function execution(n = 1) {
  return { id: id(n), instructionId: id(900), instructionRevision: 1, revision: 3, state: "completed", errorCode: null,
    taskRef: { sourceService: "projects", sourceId: id(800), projectId: id(700), revision: 1, state: "todo",
      asOf: instant, url: `https://projects.pydemia.ai/?project=${id(700)}&view=tasks&item=${id(800)}` },
    roles: [{ id: id(600), assignmentId: "writer", workPackageId: "draft", teamId: "team", membershipId: "member", membershipRevision: 1,
      teamName: "Team", personaName: "Writer", role: "draft", responsibility: "contributor", state: "completed", attempts: 1,
      runtimeTaskId: id(500), threadId: "thread", turnId: "turn", prompt: "PRIVATE_ROLE_PROMPT",
      observation: { source: "runtime_monotonic", basis: "server_dispatch_to_terminal_including_sdk_preparation",
        queuedAt: instant, startedAt: instant, endedAt: instant, executionSeconds: 1, timingComplete: true } }],
    createdAt: instant, updatedAt: instant, result: "PRIVATE_RESULT", note: { body: "PRIVATE_NOTE" } };
}
function fixture(t: test.TestContext, portOverrides: Partial<AssistantReadPort> = {}) {
  const root = mkdtempSync(join(tmpdir(), "track-assistant-read-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("track-assistant-read-"));
    rmSync(root, { recursive: true, force: true });
  });
  const secret = randomBytes(32).toString("base64url");
  const configFile = join(root, "reader.json"); const secretFile = join(root, "reader.key");
  let clock = Date.parse(instant); let currentOwner: string | null = owner;
  const config: AssistantReaderConfig = { version: 1, enabled: true, audience: "agent-track", principalId: "track-reader",
    ownerId: owner, revision: 1, notBefore: "2026-11-11T00:00:00Z", expiresAt: "2026-12-12T00:00:00Z", secretFile };
  writeFileSync(configFile, JSON.stringify(config)); writeFileSync(secretFile, secret);
  const rows = [1, 2, 3]; let reads = 0;
  const port: AssistantReadPort = {
    scan(actor, window, limit) {
      assert.equal(actor, owner); reads++;
      const through = window.through ?? String(Math.max(...rows));
      const candidates = rows.filter(n => BigInt(n) <= BigInt(through) && (window.after === null || BigInt(n) < BigInt(window.after)))
        .sort((a, b) => b - a);
      return { rows: candidates.slice(0, limit).map(n => ({ id: id(n), ordinal: String(n) })), through, hasMore: candidates.length > limit };
    },
    execution(actor, key) { assert.equal(actor, owner); reads++; return execution(Number(key.slice(-12))); },
    events(actor, key, after) {
      assert.equal(actor, owner); reads++;
      return { events: [1, 2, 3].filter(n => BigInt(n) > BigInt(after)).map(sequence => ({ executionId: key,
        sequence, revision: sequence, state: "completed", errorCode: null, occurredAt: instant, body: "PRIVATE_EVENT_BODY" })), hasMore: false };
    }, ...portOverrides,
  };
  const service = new AssistantReadService({ configFile, configuredOwner: () => currentOwner, port, now: () => clock });
  const headers: Record<string, string | string[] | undefined> = { authorization: `Bearer ${secret}`, "x-agent-track-principal": "track-reader" };
  const request = (path = "/executions", method = "GET") => service.handle({ url: prefix + path, method, headers });
  const edit = (value: Record<string, unknown>) => writeFileSync(configFile, JSON.stringify({ ...JSON.parse(readFileSync(configFile, "utf8")), ...value }));
  return { root, config, configFile, secretFile, secret, rows, headers, service, request, edit,
    reads: () => reads, owner: (value: string | null) => { currentOwner = value; }, advance: (milliseconds: number) => { clock += milliseconds; } };
}
const status = (expected: number) => (error: unknown) => error instanceof AssistantReadError && error.status === expected &&
  /^track_[a-z_]+$/.test(error.message);

test("dedicated read capabilities work without browser session and never advertise runtime control or Demian refs", async t => {
  const f = fixture(t); const result = await f.request("/capabilities");
  assert.deepEqual(result, { version: 1, service: "assistant", audience: "agent-track", ownerId: owner,
    principalId: "track-reader", revision: "1", executionsRead: true, eventsRead: true, controls: false,
    listLimit: 50, eventLimit: 100, demianReferencesSupported: false });
  assert.equal(f.reads(), 0);
});

test("wrong credential, duplicate identity, disabled owner and expired/not-yet-valid reader cannot reach native records", async t => {
  const f = fixture(t);
  for (const header of [undefined, "Basic test", "Bearer " + "x".repeat(43), [f.headers.authorization as string]]) {
    const before = f.headers.authorization; f.headers.authorization = header;
    await assert.rejects(f.request(), status(401)); f.headers.authorization = before;
  }
  f.headers["x-agent-track-principal"] = ["track-reader"]; await assert.rejects(f.request(), status(401));
  f.headers["x-agent-track-principal"] = "other"; await assert.rejects(f.request(), status(401)); f.headers["x-agent-track-principal"] = "track-reader";
  f.owner("sso-sub:" + "b".repeat(64)); await assert.rejects(f.request(), status(401)); f.owner(owner);
  for (const edit of [{ enabled: false }, { expiresAt: instant }, { notBefore: "2026-11-13T00:00:00Z" }, { audience: "projects" }]) {
    f.edit(edit); await assert.rejects(f.request(), status(401)); writeFileSync(f.configFile, JSON.stringify(f.config));
  }
  writeFileSync(f.secretFile, "x".repeat(5000)); await assert.rejects(f.request(), status(401));
  assert.equal(f.reads(), 0);
});

test("mutations, unknown paths, duplicate or owner-expanding query parameters are rejected", async t => {
  const f = fixture(t);
  await assert.rejects(f.request("/executions", "POST"), status(405));
  await assert.rejects(f.request("/executions/../result"), status(404));
  await assert.rejects(f.request("/executions?owner=other"), status(400));
  await assert.rejects(f.request("/executions?cursor=a&cursor=b"), status(400));
  await assert.rejects(f.request("/capabilities?owner=other"), status(404));
  assert.equal(f.reads(), 0);
});

test("execution metadata keeps native identities, role references and historical Task state without private bodies", async t => {
  const f = fixture(t); const page = assistantExecutionPageSchema.parse(await f.request());
  assert.equal(page.executions[0]!.task!.taskId, id(800));
  assert.equal(page.executions[0]!.task!.state, "todo"); assert.equal(page.executions[0]!.state, "completed");
  assert.equal(page.executions[0]!.roles[0]!.runtime.taskId, id(500)); assert.equal(page.complete, false);
  assert.equal(page.executions.length, 3); assert.equal(page.cursor, null);
  assert.equal(JSON.stringify(page).includes("PRIVATE_"), false);
});

test("stable list paging freezes its high water and handles a hundred-plus executions without gaps or duplicates", async t => {
  const f = fixture(t); f.rows.splice(0, f.rows.length, ...Array.from({ length: 103 }, (_, n) => n + 1));
  const first = assistantExecutionPageSchema.parse(await f.request()); assert.equal(first.executions.length, 50); assert.ok(first.cursor);
  f.rows.push(104);
  const second = assistantExecutionPageSchema.parse(await f.request("/executions?cursor=" + first.cursor));
  const third = assistantExecutionPageSchema.parse(await f.request("/executions?cursor=" + second.cursor));
  const actual = [...first.executions, ...second.executions, ...third.executions].map(value => value.id);
  assert.equal(second.executions.length, 50); assert.equal(third.executions.length, 3);
  assert.equal(third.cursor, null); assert.equal(third.hasMore, false);
  assert.deepEqual(actual, Array.from({ length: 103 }, (_, n) => id(103 - n)));
});

test("list cursors reject tampering, expiry, credential rotation and reader revision changes", async t => {
  const f = fixture(t); f.rows.push(...Array.from({ length: 50 }, (_, n) => n + 4));
  const page = assistantExecutionPageSchema.parse(await f.request()); assert.ok(page.cursor);
  await assert.rejects(f.request("/executions?cursor=" + page.cursor.slice(0, -1) + "!"), status(400));
  f.advance(900_001); await assert.rejects(f.request("/executions?cursor=" + page.cursor), status(400)); f.advance(-900_001);
  f.edit({ revision: 2 }); await assert.rejects(f.request("/executions?cursor=" + page.cursor), status(400)); f.edit({ revision: 1 });
  const replacement = randomBytes(32).toString("base64url"); writeFileSync(f.secretFile, replacement);
  f.headers.authorization = "Bearer " + replacement; await assert.rejects(f.request("/executions?cursor=" + page.cursor), status(400));
});

test("revocation while a native record read is awaited discards the entire result", async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const start = new Promise<void>(resolve => { entered = resolve; });
  const f = fixture(t, { execution: async () => { entered(); await gate; return execution(); } });
  const pending = f.request("/executions/" + id(1)); await start; f.edit({ enabled: false }); release();
  await assert.rejects(pending, status(401));
});

test("a withdrawn native context is omitted from the list and missing to detail/events callers", async t => {
  let eventReads = 0;
  const f = fixture(t, { execution: () => null, events: () => { eventReads++; return { events: [], hasMore: false }; } });
  const page = assistantExecutionPageSchema.parse(await f.request()); assert.equal(page.omitted, 3); assert.deepEqual(page.executions, []);
  await assert.rejects(f.request("/executions/" + id(1)), status(404));
  await assert.rejects(f.request("/executions/" + id(1) + "/events"), status(404)); assert.equal(eventReads, 0);
});

test("events have an independent safe-integer cursor and cannot cross execution scope or leak bodies", async t => {
  const f = fixture(t); const route = "/executions/" + id(1) + "/events";
  const page = assistantExecutionEventsPageSchema.parse(await f.request(route + "?after=1"));
  assert.deepEqual(page.events.map(event => event.sequence), ["2", "3"]); assert.equal(page.cursor, "3");
  assert.equal(JSON.stringify(page).includes("PRIVATE_EVENT_BODY"), false);
  await assert.rejects(f.request(route + "?after=4"), status(409));
  await assert.rejects(f.request(route + "?after=9007199254740992"), status(400));
  const bad = fixture(t, { events: () => ({ events: [{ executionId: id(2), sequence: 1, revision: 1,
    state: "running", errorCode: null, occurredAt: instant }], hasMore: false }) });
  await assert.rejects(bad.request(route), status(503));
});

test("event metadata is discarded if native context is withdrawn after the event read", async t => {
  let calls = 0;
  const f = fixture(t, { execution: () => ++calls === 1 ? execution() : null });
  await assert.rejects(f.request("/executions/" + id(1) + "/events"), status(404));
});

test("an execution advancing while events are read is validated against freshly authorized metadata", async t => {
  let revision = 1;
  const f = fixture(t, {
    execution: () => ({ ...execution(), revision }),
    events: () => {
      revision = 2;
      return { events: [{ executionId: id(1), sequence: 2, revision: 2, state: "running", errorCode: null, occurredAt: instant }], hasMore: false };
    },
  });
  const page = assistantExecutionEventsPageSchema.parse(await f.request("/executions/" + id(1) + "/events?after=1"));
  assert.equal(page.cursor, "2");
});

test("owner removal or expiry during an awaited native read is checked immediately before return", async t => {
  for (const change of ["owner", "expiry"] as const) {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const start = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture(t, { execution: async () => { entered(); await gate; return execution(); } });
    const pending = f.request("/executions/" + id(1)); await start;
    if (change === "owner") f.owner(null); else f.advance(31 * 86_400_000);
    release(); await assert.rejects(pending, status(401));
  }
});

test("a malformed or stalled native list cannot create a non-advancing continuation", async t => {
  for (const scan of [
    { rows: [], through: "3", hasMore: true },
    { rows: [{ id: id(1), ordinal: "4" }], through: "3", hasMore: false },
    { rows: [{ id: id(1), ordinal: "2" }, { id: id(1), ordinal: "1" }], through: "3", hasMore: false },
  ]) {
    const f = fixture(t, { scan: () => scan }); await assert.rejects(f.request(), status(503));
  }
});

test("native failures expose no source errors or credentials", async t => {
  const f = fixture(t, { execution: () => { throw new Error("PRIVATE_RESULT with credential value"); } });
  await assert.rejects(f.request(), error => status(503)(error) && !(error as Error).message.includes("PRIVATE_"));
});

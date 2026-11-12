import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantAuthority, AssistantAuthorityError, type AssistantReader } from "../apps/api/assistant-authority.ts";
import type { Config, SourceConfig } from "../apps/api/config.ts";
import { ProjectsAuthority } from "../apps/api/projects-authority.ts";
import { sourceIdentity } from "../apps/api/source-identity.ts";
import { AssistantSourceError, type AssistantClientOptions } from "../packages/adapters/assistant/index.ts";
import { ProjectsClient, ProjectsSourceError } from "../packages/adapters/projects/index.ts";
import type { AssistantCapabilities, AssistantExecutionMetadata, AssistantExecutionPage, AssistantExecutionEventsPage } from "../packages/contracts/assistant.ts";
import type { ProjectMetadata, ProjectTaskMetadata, SourceView } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";

const user = "owner@example.com";
const other = "other@example.com";
const ownerId = `sso-sub:${"a".repeat(64)}`;
const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const taskId = "44444444-4444-4444-8444-444444444444";
const now = "2026-11-12T00:00:00.000Z";

function native(executionId = id): AssistantExecutionMetadata {
  return { id: executionId, instructionId: id2, instructionRevision: "1", revision: "3",
    state: "completed", errorCode: null,
    task: { projectId, taskId, revision: "1", state: "todo", observedAt: now },
    roles: [{ id: id2, assignmentId: "assignment", workPackageId: "work", teamId: "team",
      membershipId: "member", membershipRevision: "1", label: "private-role", teamLabel: "team",
      agentLabel: "agent", responsibility: "accountable", state: "completed", attempts: 1,
      runtime: { taskId: "runtime-task-is-not-project-task", threadId: "thread", turnId: "turn" },
      observation: { queuedAt: now, startedAt: now, endedAt: now, seconds: 0,
        timingComplete: true, basis: "server_dispatch_to_terminal_including_sdk_preparation" } }],
    createdAt: now, updatedAt: now };
}

function gate() {
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  return { release, waiting, hold: async () => { entered(); await blocked; } };
}

// Only remote ports are synthetic. SQLite pins and authority orchestration are real.
function fixture(requestTimeoutMs = 10_000) {
  const store = new Store(":memory:");
  const common = { users: [user, other], device: "test", runIds: [], discoverActive: false,
    repositoryRoots: [], maxFiles: 10, sinceDays: 7 };
  const source: SourceConfig = { ...common, id: "assistant", kind: "assistant", label: "Assistant",
    baseUrl: "https://assistant.example", assistantCredentialFile: "C:/inert/assistant.json",
    assistantUser: user, assistantOwnerId: ownerId, assistantPrincipalId: "reader",
    assistantProjectsSourceId: "projects" };
  const peer: SourceConfig = { ...common, id: "projects", kind: "projects", label: "Projects",
    baseUrl: "https://projects.example", projectsCredentialFile: "C:/inert/projects.json",
    projectsUser: user, projectsAccountId: projectId, projectsPrincipalId: "reader" };
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "https://track.example",
    auth: { mode: "proxy", users: [user, other], secretFile: "C:/inert/proxy" }, sources: [source, peer] };
  const project: ProjectMetadata = { id: projectId, title: "private-project", revision: "2", accessRevision: "3", archived: false };
  const task: ProjectTaskMetadata = { id: taskId, projectId, title: "private-task", revision: "2", state: "done", requiresTest: true };
  let catalog = [project];
  let state: SourceView["state"] = "connected";
  let refreshCalls = 0;
  let taskCalls = 0;
  let capsCalls = 0;
  const taskArgs: string[][] = [];
  const clientArgs: string[][] = [];
  const eventArgs: string[][] = [];
  const cursors: (string | null | undefined)[] = [];
  const options: AssistantClientOptions[] = [];
  let refreshHook = async () => {};
  let taskHook = async () => {};
  let capsHook = async () => {};
  let listHook = async () => {};
  let detailHook = async () => {};
  let eventsHook = async () => {};
  let execution = native();
  let page: AssistantExecutionPage = { version: 1, observedAt: now, executions: [native()], cursor: null, hasMore: false, omitted: 0, complete: false };
  let eventPage: AssistantExecutionEventsPage = { version: 1, observedAt: now, executionId: id,
    events: [{ executionId: id, sequence: "8", revision: "3", state: "completed", errorCode: null, occurredAt: now }],
    cursor: "8", hasMore: false, complete: false };
  const caps: AssistantCapabilities = { version: 1, service: "assistant", audience: "agent-track",
    ownerId, principalId: "reader", revision: "1", executionsRead: true, eventsRead: true,
    controls: false, listLimit: 50, eventLimit: 100, demianReferencesSupported: false };
  class TaskPort extends ProjectsClient {
    override async task(actualTask: string, actualProject: string) {
      taskCalls++; taskArgs.push([actualTask, actualProject]); await taskHook(); return { ...task };
    }
  }
  const taskPort = new TaskPort({ sourceId: peer.id, baseUrl: peer.baseUrl!, credentialFile: peer.projectsCredentialFile!,
    user, accountId: projectId, principalId: "reader" });
  class ProjectsPort extends ProjectsAuthority {
    override async refresh(actor: string) { assert.equal(actor, user); refreshCalls++; await refreshHook(); }
    override view(value: SourceConfig, actor: string): SourceView {
      assert.equal(value.id, peer.id); assert.equal(actor, user);
      return { id: peer.id, kind: "projects", label: peer.label, device: peer.device,
        state, lastObservedAt: now, detail: "fixture", capabilities: [] };
    }
    override catalog(sourceId: string, actor: string) {
      assert.equal(sourceId, peer.id); assert.equal(actor, user); return catalog;
    }
    override client(sourceId: string, actor: string) { clientArgs.push([sourceId, actor]); return taskPort; }
  }
  const reader: AssistantReader = {
    capabilities: async () => { capsCalls++; await capsHook(); return { ...caps }; },
    executions: async cursor => { cursors.push(cursor); await listHook(); return structuredClone(page); },
    execution: async actual => { assert.equal(actual, id); await detailHook(); return structuredClone(execution); },
    events: async (actual, after) => { eventArgs.push([actual, after!]); await eventsHook(); return structuredClone(eventPage); },
  };
  const projects = new ProjectsPort(store, () => config);
  const authority = new AssistantAuthority(store, () => config, projects, value => { options.push(value); return reader; }, requestTimeoutMs);
  return { store, source, peer, config, authority, caps, task, options, taskArgs, clientArgs, eventArgs, cursors,
    get counts() { return { refreshCalls, taskCalls, capsCalls }; },
    set catalog(value: ProjectMetadata[]) { catalog = value; },
    set state(value: SourceView["state"]) { state = value; },
    set execution(value: AssistantExecutionMetadata) { execution = value; },
    set page(value: AssistantExecutionPage) { page = value; },
    set eventPage(value: AssistantExecutionEventsPage) { eventPage = value; },
    set refreshHook(value: () => Promise<void>) { refreshHook = value; },
    set taskHook(value: () => Promise<void>) { taskHook = value; },
    set capsHook(value: () => Promise<void>) { capsHook = value; },
    set listHook(value: () => Promise<void>) { listHook = value; },
    set detailHook(value: () => Promise<void>) { detailHook = value; },
    set eventsHook(value: () => Promise<void>) { eventsHook = value; } };
}

async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof AssistantAuthorityError);
    assert.equal(error.status, status);
    assert.equal(error.message, "assistant_authority_unavailable");
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(JSON.stringify(error), /private|https:|inert|token|secret/i);
    return true;
  });
}

test("capability-only refresh, exact factory binding, distinct historical and current task metadata", async t => {
  const f = fixture(); t.after(() => f.store.close());
  assert.equal(f.authority.view(f.source, user).state, "forbidden");
  await f.authority.refresh(user);
  assert.deepEqual(f.counts, { refreshCalls: 0, taskCalls: 0, capsCalls: 1 });
  assert.equal(f.authority.view(f.source, user).state, "connected");
  assert.deepEqual(f.options[0], { sourceId: "assistant", baseUrl: f.source.baseUrl,
    credentialFile: f.source.assistantCredentialFile, user, ownerId, principalId: "reader", protocol: 1 });
  const result = await f.authority.detail(user, "assistant", id);
  assert.equal(result.native.state, "completed");
  assert.equal(result.native.task?.state, "todo");
  assert.equal(result.native.task?.revision, "1");
  assert.equal(result.currentTask?.task.state, "done");
  assert.equal(result.currentTask?.task.revision, "2");
  assert.equal(result.currentTask?.projectsSourceId, "projects");
  assert.deepEqual(f.taskArgs, [[taskId, projectId]]);
  assert.deepEqual(f.clientArgs, [["projects", user]]);
  assert.equal(f.counts.refreshCalls, 2);
  for (const table of ["runs", "events", "bindings"]) {
    assert.equal(f.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
  }
});

test("placeholder stays unsupported and unlinked owner executions need no Projects peer", async t => {
  const f = fixture(); t.after(() => f.store.close());
  delete f.source.assistantProjectsSourceId;
  const value = native(); value.task = null; f.execution = value;
  assert.equal((await f.authority.detail(user, "assistant", id)).currentTask, null);
  assert.equal(f.counts.taskCalls, 0);
  delete f.source.assistantCredentialFile;
  assert.equal(f.authority.view(f.source, user).state, "unsupported");
  await rejects(f.authority.detail(user, "assistant", id), 403);
});

for (const change of ["other actor", "root removal", "source user removal", "actor binding", "identity drift", "store pin"] as const) {
  test(`owner scope rejects ${change}`, async t => {
    const f = fixture(); t.after(() => f.store.close());
    if (change === "store pin") f.store.pinSourceIdentity("assistant", "different");
    else await f.authority.refresh(user);
    if (change === "root removal") f.config.auth = { mode: "local", user: other };
    if (change === "source user removal") f.source.users = [other];
    if (change === "actor binding") f.source.assistantUser = other;
    if (change === "identity drift") f.source.baseUrl = "https://changed.example";
    const actor = change === "other actor" ? other : user;
    const calls = f.counts.capsCalls;
    await rejects(f.authority.detail(actor, "assistant", id), 403);
    assert.equal(f.counts.capsCalls, calls);
    assert.equal(f.authority.view(f.source, actor).state, "forbidden");
  });
}

for (const change of ["assistant credential", "peer credential", "peer identity", "root removal", "source removal", "source identity", "peer removal"] as const) {
  test(`config ${change} during native read fails closed`, async t => {
    const f = fixture(); t.after(() => f.store.close());
    const hold = gate(); f.detailHook = hold.hold;
    const pending = f.authority.detail(user, "assistant", id);
    await hold.waiting;
    if (change === "assistant credential") f.source.assistantCredentialFile = "C:/rotated/reader";
    if (change === "peer credential") f.peer.projectsCredentialFile = "C:/rotated/reader";
    if (change === "peer identity") f.peer.projectsPrincipalId = "changed";
    if (change === "root removal") f.config.auth = { mode: "local", user: other };
    if (change === "source removal") f.config.sources = [f.peer];
    if (change === "source identity") f.source.assistantOwnerId = `sso-sub:${"b".repeat(64)}`;
    if (change === "peer removal") f.config.sources = [f.source];
    hold.release();
    await rejects(pending, change === "source removal" ? 404 : 403);
    assert.equal(f.authority.view(f.source, user).state, "forbidden");
  });
}

test("credential rotation invalidates cached capability status without changing durable identity", async t => {
  const f = fixture(); t.after(() => f.store.close());
  await f.authority.refresh(user);
  const before = sourceIdentity(f.source);
  f.source.assistantCredentialFile = "C:/rotated/reader";
  assert.equal(sourceIdentity(f.source), before);
  assert.equal(f.authority.view(f.source, user).state, "forbidden");
  await f.authority.refresh(user);
  assert.equal(f.options.at(-1)?.credentialFile, "C:/rotated/reader");
  assert.equal(f.authority.view(f.source, user).state, "connected");
});

for (const method of ["list", "detail", "events"] as const) {
  for (const moment of ["before", "during", "final refresh"] as const) {
    test(`${method} hides linked execution when Project revoked ${moment}`, async t => {
      const f = fixture(); t.after(() => f.store.close());
      if (moment === "before") f.catalog = [];
      if (moment === "during") f.taskHook = async () => { f.catalog = []; };
      if (moment === "final refresh") f.refreshHook = async () => { if (f.counts.refreshCalls === 2) f.catalog = []; };
      if (method === "list") {
        const result = await f.authority.list(user, "assistant");
        assert.equal(result.omitted, 1); assert.deepEqual(result.executions, []);
        assert.doesNotMatch(JSON.stringify(result), /private|11111111|33333333/);
      } else await rejects(f.authority[method](user, "assistant", id), 404);
    });
  }
}

for (const failure of ["missing peer", "wrong peer actor", "forbidden peer", "disconnected peer", "task forbidden", "task notfound", "task transport"] as const) {
  test(`linked authorization handles ${failure}`, async t => {
    const f = fixture(); t.after(() => f.store.close());
    if (failure === "missing peer") delete f.source.assistantProjectsSourceId;
    if (failure === "wrong peer actor") f.peer.projectsUser = other;
    if (failure === "forbidden peer") f.state = "forbidden";
    if (failure === "disconnected peer") f.state = "disconnected";
    if (failure.startsWith("task ")) f.taskHook = async () => {
      throw new ProjectsSourceError(failure === "task forbidden" ? 403 : failure === "task notfound" ? 404 : 502);
    };
    const unavailable = failure === "disconnected peer" || failure === "task transport";
    await rejects(f.authority.detail(user, "assistant", id), unavailable ? 503 : 404);
    if (unavailable) await rejects(f.authority.list(user, "assistant"), 503);
    else assert.equal((await f.authority.list(user, "assistant")).omitted, 1);
  });
}

test("list preserves source window, deduplicates task reads and counts only safe omissions", async t => {
  const f = fixture(); t.after(() => f.store.close());
  const denied = native("55555555-5555-4555-8555-555555555555");
  denied.task!.projectId = "66666666-6666-4666-8666-666666666666";
  f.page = { version: 1, observedAt: now, executions: [native(), native(id2), denied],
    cursor: "next-window", hasMore: true, omitted: 2, complete: false };
  const result = await f.authority.list(user, "assistant", "requested-window");
  assert.deepEqual(f.cursors, ["requested-window"]);
  assert.equal(result.executions.length, 2); assert.equal(result.omitted, 3);
  assert.equal(result.cursor, "next-window"); assert.equal(result.hasMore, true); assert.equal(result.complete, false);
  assert.equal(f.counts.taskCalls, 1);
  assert.doesNotMatch(JSON.stringify(result), /55555555|66666666/);
  await f.authority.list(user, "assistant");
  assert.equal(f.counts.taskCalls, 2, "dedupe must not become a cross-request cache");
});

for (const invalid of ["duplicate IDs", "cursor mismatch", "repeated cursor", "extra body"] as const) {
  test(`rejects native page ${invalid}`, async t => {
    const f = fixture(); t.after(() => f.store.close());
    const page: AssistantExecutionPage = { version: 1, observedAt: now, executions: [native()], cursor: null, hasMore: false, omitted: 0, complete: false };
    if (invalid === "duplicate IDs") page.executions.push(native());
    if (invalid === "cursor mismatch") page.hasMore = true;
    if (invalid === "repeated cursor") { page.cursor = "same"; page.hasMore = true; }
    if (invalid === "extra body") Object.assign(page.executions[0]!, { body: "private body" });
    f.page = page;
    await rejects(f.authority.list(user, "assistant", "same"), 503);
  });
}

test("events use latest native detail and exact execution/after scope", async t => {
  const f = fixture(); t.after(() => f.store.close());
  await f.authority.list(user, "assistant");
  const result = await f.authority.events(user, "assistant", id, "7");
  assert.deepEqual(f.eventArgs, [[id, "7"]]);
  assert.equal(result.page.cursor, "8");
  const changed = native(); changed.task!.projectId = id2; f.execution = changed;
  await rejects(f.authority.events(user, "assistant", id, "8"), 404);
  assert.equal(f.eventArgs.length, 1, "denied latest link stops before event read");
});

for (const invalid of ["scope", "sequence", "empty cursor", "body", "after"] as const) {
  test(`event ${invalid} violation fails closed`, async t => {
    const f = fixture(); t.after(() => f.store.close());
    const page: AssistantExecutionEventsPage = { version: 1, observedAt: now, executionId: id,
      events: [], cursor: "7", hasMore: false, complete: false };
    if (invalid === "scope") page.executionId = id2;
    if (invalid === "sequence") page.events = [{ executionId: id, sequence: "7", revision: "1", state: "running", errorCode: null, occurredAt: now }];
    if (invalid === "empty cursor") page.cursor = "8";
    if (invalid === "body") Object.assign(page, { toolArguments: "private" });
    f.eventPage = page;
    await rejects(f.authority.events(user, "assistant", id, invalid === "after" ? "01" : "7"), invalid === "after" ? 400 : 503);
  });
}

for (const failure of ["native401", "transport", "owner mismatch", "principal mismatch"] as const) {
  test(`${failure} suppresses prior metadata and keeps errors static`, async t => {
    const f = fixture(); t.after(() => f.store.close());
    await f.authority.detail(user, "assistant", id);
    if (failure === "native401") f.capsHook = async () => { throw new AssistantSourceError(401); };
    if (failure === "transport") f.detailHook = async () => { throw new Error("private body https://secret.example/token"); };
    if (failure === "owner mismatch") f.caps.ownerId = `sso-sub:${"b".repeat(64)}`;
    if (failure === "principal mismatch") f.caps.principalId = "other";
    await rejects(f.authority.detail(user, "assistant", id), failure === "transport" ? 503 : 403);
    const view = f.authority.view(f.source, user);
    assert.equal(view.state, failure === "transport" ? "disconnected" : "forbidden");
    assert.deepEqual(view.capabilities, []);
    assert.doesNotMatch(JSON.stringify(view), /private|33333333|44444444/);
  });
}

test("serialized checks prevent an older permit reopening a later denial", async t => {
  const f = fixture(); t.after(() => f.store.close());
  const hold = gate(); let active = 0; let maximum = 0; let calls = 0;
  f.capsHook = async () => {
    active++; maximum = Math.max(maximum, active); calls++;
    try { if (calls === 1) await hold.hold(); else throw new AssistantSourceError(403); }
    finally { active--; }
  };
  const earlier = f.authority.refresh(user);
  await hold.waiting;
  const later = f.authority.refresh(user);
  hold.release(); await Promise.all([earlier, later]);
  assert.equal(maximum, 1); assert.equal(calls, 2);
  assert.equal(f.authority.view(f.source, user).state, "forbidden");
});

test("revocation at final capability check cannot return a previously read execution", async t => {
  const f = fixture(); t.after(() => f.store.close());
  f.capsHook = async () => { if (f.counts.capsCalls === 2) throw new AssistantSourceError(401); };
  await rejects(f.authority.events(user, "assistant", id), 403);
  assert.equal(f.authority.view(f.source, user).state, "forbidden");
});

test("final Projects transport failure is not a successful all-omitted window", async t => {
  const f = fixture(); t.after(() => f.store.close());
  f.catalog = [];
  f.refreshHook = async () => { if (f.counts.refreshCalls === 2) f.state = "disconnected"; };
  await rejects(f.authority.list(user, "assistant"), 503);
});

for (const phase of ["task", "events", "final projects"] as const) {
  test(`credential rotation during ${phase} await rejects read`, async t => {
    const f = fixture(); t.after(() => f.store.close());
    const hold = gate();
    if (phase === "task") f.taskHook = hold.hold;
    if (phase === "events") f.eventsHook = hold.hold;
    if (phase === "final projects") f.refreshHook = async () => { if (f.counts.refreshCalls === 2) await hold.hold(); };
    const pending = f.authority.events(user, "assistant", id);
    await hold.waiting;
    f.peer.projectsCredentialFile = "C:/rotated/peer";
    hold.release(); await rejects(pending, 403);
  });
}

test("queued reads cannot adopt a newly rotated configuration", async t => {
  const f = fixture(); t.after(() => f.store.close());
  const hold = gate(); f.capsHook = hold.hold;
  const refreshing = f.authority.refresh(user);
  await hold.waiting;
  const pending = f.authority.detail(user, "assistant", id);
  f.source.assistantCredentialFile = "C:/rotated/reader";
  hold.release(); await refreshing;
  await rejects(pending, 403);
  assert.equal(f.options.length, 1);
});

test("busy reader permits only one waiting read and recovers after the queue drains", async t => {
  const f = fixture(); t.after(() => f.store.close());
  const hold = gate(); f.capsHook = hold.hold;
  const first = f.authority.detail(user, "assistant", id);
  await hold.waiting;
  const second = f.authority.detail(user, "assistant", id);
  await rejects(f.authority.detail(user, "assistant", id), 503);
  assert.equal(f.options.length, 1);
  hold.release(); await Promise.all([first, second]);
  await f.authority.detail(user, "assistant", id);
  assert.equal(f.options.length, 3);
});

test("overall deadline discards a late Task result and never continues to final grants", async t => {
  const f = fixture(100); t.after(() => f.store.close());
  const hold = gate(); f.taskHook = hold.hold;
  const pending = f.authority.detail(user, "assistant", id);
  await hold.waiting;
  await rejects(pending, 503);
  assert.equal(f.authority.view(f.source, user).state, "disconnected");
  hold.release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.counts.capsCalls, 1);
  assert.equal(f.counts.refreshCalls, 1);
  assert.equal(f.authority.view(f.source, user).state, "disconnected");
  f.taskHook = async () => {};
  await f.authority.detail(user, "assistant", id);
  assert.equal(f.authority.view(f.source, user).state, "connected");
});

test("a later denied task read never serves earlier successful metadata", async t => {
  const f = fixture(); t.after(() => f.store.close());
  await f.authority.detail(user, "assistant", id);
  f.taskHook = async () => { throw new ProjectsSourceError(403); };
  await rejects(f.authority.detail(user, "assistant", id), 404);
  assert.equal(f.counts.taskCalls, 2);
  assert.equal(f.authority.view(f.source, user).state, "connected");
});

test("a missing capability route clears a previously connected source grant", async t => {
  const f = fixture(); t.after(() => f.store.close());
  await f.authority.detail(user, "assistant", id);
  f.capsHook = async () => { throw new AssistantSourceError(404); };
  await rejects(f.authority.detail(user, "assistant", id), 404);
  assert.equal(f.authority.view(f.source, user).state, "disconnected");
});

test("task response must match both native Task UUID and Project", async t => {
  const f = fixture(); t.after(() => f.store.close());
  f.task.id = id2;
  await rejects(f.authority.detail(user, "assistant", id), 503);
  f.task.id = taskId; f.task.projectId = id2;
  await rejects(f.authority.detail(user, "assistant", id), 503);
});

test("event read held across Project revocation returns no page", async t => {
  const f = fixture(); t.after(() => f.store.close());
  const hold = gate(); f.eventsHook = hold.hold;
  const pending = f.authority.events(user, "assistant", id, "7");
  await hold.waiting; f.catalog = []; hold.release();
  await rejects(pending, 404);
});

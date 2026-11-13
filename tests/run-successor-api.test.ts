import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createTrackServer } from "../apps/api/server.ts";
import { RunSuccessors } from "../apps/api/run-successors.ts";
import { configSchema, type Config } from "../apps/api/config.ts";
import type { Sources } from "../apps/api/runner.ts";
import { externalKey, type SourceView } from "../packages/contracts/index.ts";
import { nativeCommandWriteSchema, type NativeCommandReceipt, type NativeCommandWrite } from "../packages/contracts/native-run-commands.ts";
import { successorPanelSchema, successorReceiptSchema, type SuccessorReviewInput } from "../packages/contracts/run-successors.ts";
import { Store } from "../packages/storage/store.ts";
import { missionFlow } from "../packages/projection/mission-flow.ts";
import { listenHttp } from "./helpers/http-listen.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = "owner@example.com", runId = id(1), sessionId = id(2), successorId = id(3), workspaceId = id(4);
const projectId = id(5), taskId = id(6), runKey = externalKey("native", runId);
async function listen(server: Server) {
  return listenHttp(server);
}
async function fixture(t: test.TestContext, bound = false) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "track-successor-api-")), proxyFile = join(root, "proxy");
  const secret = randomBytes(32).toString("base64url"); writeFileSync(proxyFile, secret);
  const store = new Store(join(root, "store.sqlite")); let nativePost = 0, lostAck = false, contractMissing = false, contextCalls = 0;
  let beforeContext = async () => {}, projectAllowed = true, taskRevision = "2", currentHead = "a".repeat(64);
  const receipts = new Map<string, NativeCommandReceipt>(), payloads: NativeCommandWrite[] = [];
  const now = new Date().toISOString();
  const native = createServer(async (request, response) => {
    const path = request.url!; response.setHeader("content-type", "application/json");
    if (path === `/api/v1/runs/${runId}/command-context`) {
      contextCalls++; await beforeContext();
      if (contractMissing) { response.writeHead(404).end("{}"); return; }
      response.end(JSON.stringify({ object: "demian.run_command_context", version: 1, source_run: { id: runId, session_id: sessionId, status: "failed" },
        session_head_sha256: currentHead, authority_sha256: "b".repeat(64), available_kinds: receipts.size ? [] : ["retry", "continue"], observed_at: now })); return;
    }
    if (path === `/api/v1/runs/${runId}/commands` && request.method === "POST") {
      const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
      const input = nativeCommandWriteSchema.parse(JSON.parse(Buffer.concat(parts).toString("utf8"))); payloads.push(input); nativePost++;
      const receipt: NativeCommandReceipt = { object: "demian.run_command_receipt", version: 1, command_id: input.command.commandId,
        session_id: sessionId, source_run_id: runId, kind: input.command.kind, outcome: "accepted", rejection_code: null,
        new_run_id: successorId, task_root_run_id: input.command.kind === "continue" ? successorId : runId,
        relation: input.command.kind === "retry" ? "retry_of" : "continues", created_at: now, expires_at: input.command.expiresAt };
      receipts.set(receipt.command_id, receipt); if (lostAck) { request.socket.destroy(); return; }
      response.writeHead(202).end(JSON.stringify(receipt)); return;
    }
    if (path.startsWith(`/api/v1/sessions/${sessionId}/commands/`)) {
      const receipt = receipts.get(path.split("/").at(-1)!);
      response.end(JSON.stringify({ object: "demian.run_command_status", version: 1, status: receipt ? "found" : "not_found", receipt: receipt ?? null })); return;
    }
    if (path === `/api/v1/sessions/${sessionId}`) { response.end(JSON.stringify({ id: sessionId, workspace_id: workspaceId, title: "Native test" })); return; }
    if (path === `/api/v1/runs/${runId}` || path === `/api/v1/runs/${successorId}` && receipts.size) {
      const successor = path.includes(successorId);
      response.end(JSON.stringify({ id: successor ? successorId : runId, session_id: sessionId, status: successor ? "queued" : "failed",
        created_at: now, started_at: successor ? null : now, completed_at: successor ? null : now })); return;
    }
    if (path === `/api/v1/runs/${successorId}/events?after=0` && receipts.size) {
      response.setHeader("content-type", "text/event-stream"); response.end(": authorized\n\n"); return;
    }
    response.writeHead(404).end("{}");
  });
  const baseUrl = await listen(native);
  const config: Config = configSchema.parse({ port: 14345, publicOrigin: "https://track.example", database: join(root, "store.sqlite"),
    auth: { mode: "proxy", secretFile: proxyFile, users: [actor] }, sources: [
      { id: "native", kind: "demian", label: "Native", device: "test", users: [actor], baseUrl, runCommandUsers: [actor] },
      { id: "projects", kind: "projects", label: "Projects", device: "test", users: [actor] },
    ] });
  const views = (): SourceView[] => [{ id: "native", kind: "demian", label: "Native", device: "test", state: "connected",
    detail: "Synthetic upstream", lastObservedAt: now, capabilities: ["run.read", ...(config.sources[0]!.runCommandUsers?.includes(actor) ? ["run.commands"] : [])] },
    { id: "projects", kind: "projects", label: "Projects", device: "test", state: "connected", detail: "", lastObservedAt: now,
      capabilities: [], authorizedProjectIds: projectAllowed ? [projectId] : [] }];
  const sources = { views, refreshProjectGrants: async () => {}, projects: { client: () => ({ task: async () => ({ id: taskId, projectId,
    revision: taskRevision, title: "Task", state: "in_progress", requiresTest: false }) }) } } as unknown as Sources;
  store.observeRun({ sourceId: "native", runId, sessionId, workspaceId, title: "Native test", status: "failed",
    createdAt: now, startedAt: now, completedAt: now, observedAt: now });
  store.ingest({ sourceId: "native", runId, sequence: "1", type: "run.failed", occurredAt: now, data: { status: "failed", redacted: true } });
  if (bound) store.bind({ sourceId: "native", runId, projectSourceId: "projects", projectId, taskId, taskRevision: "1",
    projectTitle: "Project", taskTitle: "Task", provenance: "operator" }, actor);
  const { server } = createTrackServer(store, () => config, root, sources), origin = await listen(server);
  const headers = { "x-track-proxy-key": secret, "x-forwarded-email": actor, "content-type": "application/json",
    origin: config.publicOrigin, "sec-fetch-site": "same-origin" };
  const path = `/api/runs/${runKey}/successor-commands`;
  const request = (suffix = "", method = "GET", body?: unknown, changedHeaders = {}) => fetch(origin + path + suffix,
    { method, headers: { ...headers, ...changedHeaders }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const review = (n = 10, kind: SuccessorReviewInput["kind"] = "retry"): SuccessorReviewInput => ({ id: id(n), runKey, kind,
    expiresAt: new Date(Date.now() + 90_000).toISOString(), ...(kind === "continue" ? { input: "PRIVATE_CONTINUE_BODY" } : {}) });
  t.after(async () => {
    for (const value of [server, native]) { value.closeAllConnections(); await new Promise<void>(resolve => value.close(() => resolve())); }
    store.close(); assert.equal(dirname(root), realpathSync(tmpdir())); rmSync(root, { recursive: true, force: true });
  });
  return { config, store, headers, request, review, receipts, payloads,
    snapshot: async () => { const response = await fetch(origin + "/api/snapshot", { headers }); assert.equal(response.status, 200); return response.json() as Promise<import("../packages/contracts/index.ts").Snapshot>; },
    ports: () => new RunSuccessors(store, () => config, sources, user => store.snapshot(user, views())).ports(actor, runKey, () => true),
    useToken: () => { const tokenFile = join(root, "native-token"); writeFileSync(tokenFile, randomBytes(32).toString("base64url")); config.sources[0]!.tokenFile = tokenFile; },
    get nativePost() { return nativePost; }, get contextCalls() { return contextCalls; },
    set lostAck(value: boolean) { lostAck = value; }, set contractMissing(value: boolean) { contractMissing = value; },
    set beforeContext(value: typeof beforeContext) { beforeContext = value; }, set projectAllowed(value: boolean) { projectAllowed = value; },
    set taskRevision(value: string) { taskRevision = value; }, set head(value: string) { currentHead = value; },
  };
}

test("real HTTP review/dispatch binds one Native receipt and successor while preserving original event journal and Task", async t => {
  const f = await fixture(t, true), before = JSON.stringify(f.store.events(runKey));
  const panel = successorPanelSchema.parse(await (await f.request()).json()); assert.deepEqual(panel.availability.availableKinds, ["retry", "continue"]);
  const input = f.review(), response = await f.request("/reviews", "POST", input); assert.equal(response.status, 200);
  const prepared = successorReceiptSchema.parse((await response.json()).receipt); assert.equal(prepared.state, "prepared"); assert.equal(f.nativePost, 0);
  const dispatch = await f.request(`/${input.id}/dispatch`, "POST", {}); assert.equal(dispatch.status, 200);
  const text = await dispatch.text(), accepted = successorReceiptSchema.parse(JSON.parse(text).receipt);
  assert.equal(accepted.state, "accepted"); assert.equal(accepted.observationState, "observed"); assert.equal(f.nativePost, 1);
  assert.doesNotMatch(text, /authority_sha256|expectedAuthority|expectedSessionHead|scopeIdentity|PRIVATE_CONTINUE_BODY/);
  const child = f.store.run(externalKey("native", successorId))!; assert.ok(child);
  assert.equal(JSON.parse(child.binding!).taskId, taskId); assert.equal(JSON.parse(child.binding!).taskRevision, "1");
  assert.equal(JSON.stringify(f.store.events(runKey)), before);
  const snapshot = await f.snapshot(), observed = snapshot.runs.find(run => run.runId === successorId)!;
  assert.equal(observed.nativeCommandLink?.state, "observed");
  const flow = missionFlow(observed, snapshot.runs, snapshot.relations, []);
  assert.equal(flow.edges.filter(edge => edge.kind === "native-command-retry").length, 1);
  assert.equal(f.store.events(runKey).events.length, 1);
  assert.equal((await f.request(`/${input.id}/dispatch`, "POST", {})).status, 200); assert.equal(f.nativePost, 1);
});

test("Native commit then ACK loss reconciles the same command ID with no second POST", async t => {
  const f = await fixture(t); f.lostAck = true;
  const input = f.review(); assert.equal((await f.request("/reviews", "POST", input)).status, 200);
  const first = await f.request(`/${input.id}/dispatch`, "POST", {}); assert.equal(first.status, 200);
  assert.equal((await first.json()).receipt.state, "unknown"); assert.equal(f.nativePost, 1);
  const recovered = successorReceiptSchema.parse((await (await f.request(`/${input.id}`)).json()).receipt);
  assert.equal(recovered.state, "accepted"); assert.equal(recovered.newRunId, successorId); assert.equal(f.nativePost, 1);
});

test("continue sends exact reviewed input, wipes staged plaintext and leaves the new Task root unbound", async t => {
  const f = await fixture(t, true), input = f.review(11, "continue");
  assert.equal((await f.request("/reviews", "POST", input)).status, 200);
  const result = await f.request(`/${input.id}/dispatch`, "POST", {}); assert.equal(result.status, 200);
  assert.equal((await result.json()).receipt.state, "accepted");
  assert.equal(f.payloads[0]!.input![0]!.text, input.input); assert.equal(f.store.run(externalKey("native", successorId))!.binding, null);
  assert.equal(f.store.db.prepare("SELECT input_json FROM successor_intents WHERE id=?").get(input.id)!.input_json, null);
});

test("origin, actor, route/body/query fences reject before any Native command transmission", async t => {
  const f = await fixture(t), input = f.review();
  assert.equal((await f.request("/reviews", "POST", input, { origin: "https://foreign.example" })).status, 403);
  assert.equal((await f.request("/reviews", "POST", input, { "x-forwarded-email": "other@example.com" })).status, 401);
  assert.equal((await f.request("?extra=1")).status, 400);
  assert.equal((await f.request("/reviews", "POST", { ...input, runKey: externalKey("native", id(99)) })).status, 400);
  assert.equal(f.nativePost, 0);
});

test("changed head, Task revision and command grant after review withhold dispatch", async t => {
  for (const change of ["head", "task", "grant"] as const) {
    const f = await fixture(t, true), input = f.review();
    assert.equal((await f.request("/reviews", "POST", input)).status, 200);
    if (change === "head") f.head = "c".repeat(64);
    if (change === "task") f.taskRevision = "3";
    if (change === "grant") f.config.sources[0]!.runCommandUsers = [];
    const result = await f.request(`/${input.id}/dispatch`, "POST", {});
    assert.ok([403, 409].includes(result.status), `${change}: ${result.status}`); assert.equal(f.nativePost, 0);
  }
});

test("Project withdrawal after review hides the receipt and keeps both Native and old event journal unchanged", async t => {
  const f = await fixture(t, true), input = f.review(), before = JSON.stringify(f.store.events(runKey));
  assert.equal((await f.request("/reviews", "POST", input)).status, 200); f.projectAllowed = false;
  assert.equal((await f.request(`/${input.id}`)).status, 404);
  assert.equal((await f.request(`/${input.id}/dispatch`, "POST", {})).status, 404);
  assert.equal(f.nativePost, 0); assert.equal(JSON.stringify(f.store.events(runKey)), before);
});

test("missing contract and unconfigured writer remain explicit and never borrow cancel authority", async t => {
  const f = await fixture(t); f.contractMissing = true;
  const absent = successorPanelSchema.parse(await (await f.request()).json()); assert.equal(absent.availability.detail, "native_contract_unavailable");
  f.config.sources[0]!.runCommandUsers = []; f.config.sources[0]!.cancelUsers = [actor];
  const disabled = successorPanelSchema.parse(await (await f.request()).json()); assert.equal(disabled.availability.detail, "not_enabled");
  assert.equal((await f.request("/reviews", "POST", f.review())).status, 403); assert.equal(f.nativePost, 0);
  const invalid = structuredClone(f.config); invalid.sources[0]!.assistantNativeSourceId = "assistant"; invalid.sources[0]!.runCommandUsers = [actor];
  assert.equal(configSchema.safeParse(invalid).success, false);
});

test("revocation while asynchronous credential I/O is pending prevents the Native POST", async t => {
  const f = await fixture(t); f.useToken();
  const ports = f.ports(), prepared = await ports.prepare(f.review());
  await ports.authorize(prepared, true);
  const dispatched = ports.dispatch(prepared);
  queueMicrotask(() => { f.config.sources[0]!.runCommandUsers = []; });
  await assert.rejects(dispatched);
  assert.equal(f.nativePost, 0);
});

test("non-Native log sources expose an explicit unsupported panel without attempting an executor read", async t => {
  const f = await fixture(t); f.config.sources[0]!.kind = "codex"; delete f.config.sources[0]!.runCommandUsers;
  assert.equal(configSchema.safeParse(f.config).success, true);
  const response = await f.request(); assert.equal(response.status, 200);
  const panel = successorPanelSchema.parse(await response.json());
  assert.equal(panel.availability.detail, "not_enabled"); assert.deepEqual(panel.receipts, []); assert.equal(f.contextCalls, 0);
});

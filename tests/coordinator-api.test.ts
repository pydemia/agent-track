import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Store } from "../packages/storage/store.ts";
import { externalKey, type SourceView } from "../packages/contracts/index.ts";
import { configSchema } from "../apps/api/config.ts";
import { createTrackServer } from "../apps/api/server.ts";
import type { Sources } from "../apps/api/runner.ts";
import type { AssistantExecutionView } from "../packages/contracts/assistant-view.ts";
import { coordinatorPanelSchema } from "../packages/contracts/coordinator-panel.ts";
import { assistantCommandInputSchema, type AssistantCommandReceipt } from "../packages/contracts/assistant-commands.ts";
import { listenHttp } from "./helpers/http-listen.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = "owner@example.test", ownerId = "sso-sub:" + "a".repeat(64);
const runId = id(1), sessionId = id(2), workspaceId = id(3), executionId = id(4), roleId = id(5), attemptId = id(6);
const runKey = externalKey("native", runId);
async function stop(server: Server) {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
async function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "track-coordinator-api-")), proxyFile = join(root, "proxy.key");
  const cleanup: Array<() => Promise<void>> = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
    assert.equal(dirname(root), realpathSync(tmpdir())); rmSync(root, { recursive: true, force: true });
  });
  const writerFile = join(root, "writer.json"), readerFile = join(root, "reader.json"), writerKey = join(root, "writer.key"), readerKey = join(root, "reader.key");
  const proxy = randomBytes(32).toString("base64url"), writer = randomBytes(32).toString("base64url");
  writeFileSync(proxyFile, proxy); writeFileSync(writerKey, writer); writeFileSync(readerKey, randomBytes(32).toString("base64url"));
  writeFileSync(readerFile, JSON.stringify({ secretFile: readerKey }));
  let posts = 0, caps = 0, reads = 0, lostAck = false, capHook = () => {}, readHook = (_count: number) => {};
  const receipts = new Map<string, AssistantCommandReceipt>();
  const upstream = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer " + writer);
    assert.equal(request.headers["x-agent-track-user"], actor);
    for (const key of ["cookie", "origin", "x-agent-track-principal", "x-forwarded-email", "x-track-proxy-key"]) assert.equal(request.headers[key], undefined);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/integrations/track-command/v1/capabilities") {
      caps++; capHook(); response.end(JSON.stringify({ version: 1, audience: "agent-track-command", ownerId,
        principalId: "writer", trackUser: actor, grantRevision: 1, commands: ["retry", "resume"], receiptRead: true })); return;
    }
    if (request.method === "POST") {
      const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
      const input = assistantCommandInputSchema.parse(JSON.parse(Buffer.concat(parts).toString("utf8")));
      assert.equal(input.expectedRevision, 2); posts++;
      const receipt: AssistantCommandReceipt = { version: 1, command: { operationId: input.operationId,
        executionId, roleId, kind: input.kind, attempt: 2, intentState: "saved", createdAt: new Date().toISOString() } };
      receipts.set(input.operationId, receipt);
      if (lostAck) { request.socket.destroy(); return; }
      response.writeHead(202); response.end(JSON.stringify(receipt)); return;
    }
    const receipt = receipts.get(request.url!.split("/").at(-1)!);
    response.writeHead(receipt ? 200 : 404); response.end(JSON.stringify(receipt ?? {}));
  });
  cleanup.push(() => stop(upstream));
  const nativeOrigin = await listenHttp(upstream);
  writeFileSync(writerFile, JSON.stringify({ version: 1, audience: "agent-track-command", sourceId: "assistant", user: actor,
    ownerId, principalId: "writer", revision: 1, notBefore: "2020-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", nativeOrigin, secretFile: writerKey }));
  const common = { users: [actor], label: "Fixture", device: "test" };
  const config = configSchema.parse({ port: 14345, database: join(root, "store.sqlite"), publicOrigin: "https://track.example.test",
    auth: { mode: "proxy", users: [actor], secretFile: proxyFile }, sources: [
      { ...common, id: "assistant", kind: "assistant", baseUrl: nativeOrigin, assistantProtocol: 2,
        assistantCredentialFile: readerFile, assistantUser: actor, assistantOwnerId: ownerId, assistantPrincipalId: "reader",
        assistantCommandCredentialFile: writerFile, assistantCommandPrincipalId: "writer", assistantCommandUsers: [actor],
        assistantProjectsSourceId: "projects", assistantDemianMappings: [{ origin: "https://native.example.test", organizationId: id(7), workspaceId, sourceId: "native" }] },
      { ...common, id: "projects", kind: "projects", baseUrl: "https://projects.example.test", projectsCredentialFile: join(root, "projects.json"),
        projectsUser: actor, projectsAccountId: id(8), projectsPrincipalId: "projects-reader" },
      { ...common, id: "native", kind: "demian", baseUrl: "https://native.example.test", organizationId: id(7), assistantNativeSourceId: "assistant" },
    ] });
  const time = new Date().toISOString();
  let store = new Store(config.database);
  cleanup.push(async () => store.close());
  store.observeRun({ sourceId: "native", runId, sessionId, workspaceId, title: "Failed role", status: "failed",
    createdAt: time, startedAt: time, completedAt: time, observedAt: time,
    assistantAttempt: { assistantSourceId: "assistant", executionId, roleId, attemptId, ordinal: 1, command: null } });
  store.ingest({ sourceId: "native", runId, sequence: "1", type: "run.failed", occurredAt: time, data: { status: "failed", redacted: true } });
  const execution: AssistantExecutionView = { sourceId: "assistant", sourceLabel: "Assistant", device: "test", currentTask: null,
    demianLinks: { state: "connected", omitted: 0, complete: false, detail: "Current role", links: [{ roleId, sourceId: "native",
      runKey, runId, sessionId, workspaceId, operationId: attemptId, status: "failed", observedAt: time }] },
    native: { id: executionId, instructionId: id(9), instructionRevision: "1", revision: "2", state: "failed", errorCode: null,
      task: null, createdAt: time, updatedAt: time, roles: [{ id: roleId, assignmentId: "one", workPackageId: "work", teamId: "team",
        membershipId: "member", membershipRevision: "1", label: "Role", teamLabel: "Team", agentLabel: "Agent", responsibility: "accountable",
        state: "failed", attempts: 1, runtime: { taskId: "runtime-one", threadId: null, turnId: null }, observation: {
          queuedAt: time, startedAt: time, endedAt: time, seconds: null, timingComplete: false, basis: "server_dispatch_to_terminal_including_sdk_preparation" } }] } };
  const views = (): SourceView[] => config.sources.map(source => ({ id: source.id, kind: source.kind, label: source.label,
    device: source.device, state: "connected", lastObservedAt: time, detail: "Fixture", capabilities: ["run.read", "events.read"] }));
  const sources = { refreshProjectGrants: async () => {}, views,
    assistant: { detail: async () => { reads++; readHook(reads); return structuredClone(execution); } } } as unknown as Sources;
  let app = createTrackServer(store, () => config, root, sources).server, origin = await listenHttp(app);
  cleanup.push(() => stop(app));
  const headers = { "x-track-proxy-key": proxy, "x-forwarded-email": actor };
  const path = `/api/runs/${runKey}/coordinator-commands`;
  const send = async (suffix: string, body: unknown) => {
    const response = await fetch(origin + path + suffix, { method: "POST", headers: { ...headers, origin: config.publicOrigin, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const get = async (suffix = "") => {
    const response = await fetch(origin + path + suffix, { headers }); return { status: response.status, body: await response.json() };
  };
  const input = () => ({ id: crypto.randomUUID(), runKey, kind: "retry", expiresAt: new Date(Date.now() + 90_000).toISOString() });
  return { config, execution, send, get, input, headers, path,
    counts: () => ({ posts, caps, reads }), setLostAck: () => { lostAck = true; }, setCapHook: (hook: () => void) => { capHook = hook; },
    setReadHook: (hook: (count: number) => void) => { readHook = hook; },
    journal: () => JSON.stringify(store.events(runKey)),
    rawFetch: (suffix: string, init: RequestInit) => fetch(origin + path + suffix, init),
    restart: async () => { await stop(app); store.close(); store = new Store(config.database); app = createTrackServer(store, () => config, root, sources).server; origin = await listenHttp(app); } };
}

test("protected HTTP review sends no command; explicit confirmation stores a coordinator intent and preserves source events", async t => {
  const f = await fixture(t), original = f.journal(), input = f.input();
  const available = await f.get(); assert.equal(available.status, 200);
  assert.deepEqual(coordinatorPanelSchema.parse(available.body).availability.availableKinds, ["retry"]);
  const review = await f.send("/reviews", input); assert.equal(review.status, 200); assert.equal(review.body.receipt.state, "prepared");
  assert.equal(f.counts().posts, 0);
  const sent = await f.send(`/${input.id}/dispatch`, {}); assert.equal(sent.status, 200); assert.equal(sent.body.receipt.state, "intent_saved");
  assert.equal(sent.body.receipt.coordinatorReceipt.command.intentState, "saved"); assert.equal(f.counts().posts, 1);
  assert.equal((await f.send(`/${input.id}/dispatch`, {})).body.receipt.state, "intent_saved"); assert.equal(f.counts().posts, 1);
  assert.equal(f.journal(), original);
});

test("ACK loss and API restart recover the exact saved intent after the role advances with one POST total", async t => {
  const f = await fixture(t), input = f.input(); f.setLostAck();
  assert.equal((await f.send("/reviews", input)).status, 200);
  assert.equal((await f.send(`/${input.id}/dispatch`, {})).body.receipt.state, "unknown");
  await f.restart(); f.execution.native.revision = "3"; f.execution.native.state = "queued";
  f.execution.native.roles[0]!.state = "queued";
  f.execution.demianLinks!.links[0]!.operationId = id(30); f.execution.demianLinks!.links[0]!.runId = id(31);
  const recovered = await f.get(`/${input.id}`);
  assert.equal(recovered.status, 200); assert.equal(recovered.body.receipt.state, "intent_saved");
  assert.equal(recovered.body.receipt.coordinatorReceipt.command.operationId, input.id); assert.equal(f.counts().posts, 1);
});

test("an archived Run cannot command the current role even when the execution and Session match", async t => {
  const f = await fixture(t); f.execution.demianLinks!.links[0]!.operationId = id(30);
  const page = await f.get(); assert.equal(page.status, 200); assert.deepEqual(page.body.availability.availableKinds, []);
  assert.notEqual((await f.send("/reviews", f.input())).status, 200); assert.equal(f.counts().posts, 0);
});

test("local writer withdrawal during the real credential/capability boundary withholds the command before POST", async t => {
  const f = await fixture(t), input = f.input(); await f.send("/reviews", input);
  f.setCapHook(() => { f.config.sources[0]!.assistantCommandUsers = []; });
  const response = await f.send(`/${input.id}/dispatch`, {});
  assert.equal(response.status, 200); assert.equal(response.body.receipt.state, "rejected"); assert.equal(f.counts().posts, 0);
});

test("HTTP rejects foreign Origin, query aliases, review path mismatch and changed same-ID content without sending", async t => {
  const f = await fixture(t), input = f.input();
  const badOrigin = await f.rawFetch("/reviews", { method: "POST", headers: { ...f.headers, origin: "https://foreign.example", "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(badOrigin.status, 403); await badOrigin.body?.cancel();
  assert.equal((await f.get("?alias=1")).status, 400);
  assert.equal((await f.send("/reviews", { ...input, runKey: "different" })).status, 400);
  assert.equal((await f.send("/reviews", input)).status, 200);
  assert.equal((await f.send("/reviews", { ...input, kind: "resume" })).status, 409); assert.equal(f.counts().posts, 0);
});

test("settled receipt listing shares a request-scoped read and finishes with fresh source authorization", async t => {
  const f = await fixture(t);
  for (let n = 0; n < 5; n++) {
    const input = f.input(); assert.equal((await f.send("/reviews", input)).status, 200);
    assert.equal((await f.send(`/${input.id}/discard`, {})).status, 200);
  }
  const before = f.counts().reads, response = await f.get();
  assert.equal(response.status, 200); assert.equal(response.body.receipts.length, 5);
  assert.equal(f.counts().reads - before, 3); // Availability, batch start, fresh final fence.
  assert.equal(f.counts().posts, 0);
});

test("the final batch read withholds settled receipts after owner-source authorization is withdrawn", async t => {
  const f = await fixture(t), input = f.input();
  await f.send("/reviews", input); await f.send(`/${input.id}/discard`, {});
  const start = f.counts().reads;
  f.setReadHook(count => { if (count === start + 3) throw new Error("Source withdrawn at final fence"); });
  const response = await f.get(); assert.equal(response.status, 403);
  assert.equal("receipts" in response.body, false); assert.equal(f.counts().posts, 0);
});

test("an owner can discard an unsent review after the role advances without sending a new command", async t => {
  const f = await fixture(t), input = f.input();
  await f.send("/reviews", input); f.execution.native.state = "queued"; f.execution.native.revision = "3";
  f.execution.native.roles[0]!.state = "queued";
  const result = await f.send(`/${input.id}/discard`, {});
  assert.equal(result.status, 200); assert.equal(result.body.receipt.state, "discarded"); assert.equal(f.counts().posts, 0);
});

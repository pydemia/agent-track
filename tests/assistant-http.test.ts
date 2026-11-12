import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { AssistantClient, AssistantSourceError } from "../packages/adapters/assistant/index.ts";
import { AssistantReadService, AssistantReadError } from "../packages/assistant-read/service.ts";

const instant = "2026-11-12T00:00:00.000Z";
const owner = "sso-sub:" + "a".repeat(64);
const id = "00000000-0000-4000-8000-000000000001";

async function listen(t: test.TestContext, handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

function files(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "track-assistant-http-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("track-assistant-http-"));
    rmSync(root, { recursive: true, force: true });
  });
  const secretFile = join(root, "reader.key");
  const credentialFile = join(root, "client.json");
  const configFile = join(root, "producer.json");
  const secret = randomBytes(32).toString("base64url");
  writeFileSync(secretFile, secret, { mode: 0o600 });
  const grant = { version: 1, audience: "agent-track", ownerId: owner, principalId: "track-reader",
    revision: 1, notBefore: "2026-11-11T00:00:00Z", expiresAt: "2026-12-12T00:00:00Z", secretFile };
  const producer = (enabled: boolean) => writeFileSync(configFile, JSON.stringify({ ...grant, enabled }));
  producer(true);
  const client = (origin: string) => {
    writeFileSync(credentialFile, JSON.stringify({ ...grant, sourceId: "assistant-native", user: "local-user", nativeOrigin: origin }));
    return new AssistantClient({ sourceId: "assistant-native", baseUrl: origin, credentialFile,
      user: "local-user", ownerId: owner, principalId: grant.principalId, now: () => Date.parse(instant) });
  };
  return { secret, configFile, producer, client };
}

test("real HTTP native metadata handshake, list, detail and event reads reject a freshly revoked grant", async t => {
  const f = files(t);
  const native = { id, instructionId: id, instructionRevision: 1, revision: 1, state: "completed",
    errorCode: null, taskRef: null, createdAt: instant, updatedAt: instant, body: "PRIVATE_BODY",
    roles: [{ id, assignmentId: "a", workPackageId: "w", membershipId: "m", membershipRevision: 1,
      teamId: "t", teamName: "Team", personaName: "Agent", role: "Writer", responsibility: "contributor",
      state: "completed", runtimeTaskId: "native-task", threadId: "native-thread", turnId: null, attempts: 1,
      observation: { basis: "server_dispatch_to_terminal_including_sdk_preparation", queuedAt: null,
        startedAt: null, endedAt: null, executionSeconds: null, timingComplete: false } }] };
  const service = new AssistantReadService({ configFile: f.configFile, configuredOwner: () => owner,
    now: () => Date.parse(instant), port: {
      scan: () => ({ rows: [{ id, ordinal: "9007199254740993" }], through: "9007199254740993", hasMore: false }),
      execution: () => native,
      events: (_owner, _id, after) => ({ events: after === "0" ? [{ executionId: id, sequence: 1,
        revision: 1, state: "completed", errorCode: null, occurredAt: instant }] : [], hasMore: false }),
    } });
  const requests: string[] = [];
  let revokeAfterDetail = false;
  const origin = await listen(t, async (req, res) => {
    requests.push(req.url!);
    try {
      assert.equal(req.method, "GET");
      assert.equal(req.headers.authorization, `Bearer ${f.secret}`);
      assert.equal(req.headers["x-agent-track-principal"], "track-reader");
      assert.equal(req.headers.cookie, undefined);
      const value = await service.handle({ method: req.method!, url: req.url!, headers: req.headers });
      if (revokeAfterDetail && req.url === `/api/integrations/track/v1/executions/${id}`) f.producer(false);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
    } catch (error) {
      res.writeHead(error instanceof AssistantReadError ? error.status : 500).end("PRIVATE_ERROR");
    }
  });
  const client = f.client(origin);
  assert.equal((await client.capabilities()).ownerId, owner);
  const list = await client.executions();
  assert.equal(list.executions.length, 1);
  assert.equal(list.complete, false);
  assert.equal(JSON.stringify(list).includes("PRIVATE_BODY"), false);
  const detail = await client.execution(id);
  assert.equal(detail.roles[0]!.runtime.taskId, "native-task");
  assert.equal("runId" in detail.roles[0]!.runtime, false);
  const events = await client.events(id);
  assert.equal(events.cursor, "1");
  assert.equal((await client.events(id, "1")).events.length, 0);
  assert.equal(requests.length, 13);
  revokeAfterDetail = true;
  await assert.rejects(client.execution(id), error => error instanceof AssistantSourceError && error.status === 401);
  assert.deepEqual(requests.slice(-3), ["/api/integrations/track/v1/capabilities",
    `/api/integrations/track/v1/executions/${id}`, "/api/integrations/track/v1/capabilities"]);
});

test("real HTTP redirect does not forward the dedicated credential to another listener", async t => {
  const f = files(t);
  let forwarded = 0;
  const other = await listen(t, (_req, res) => { forwarded++; res.end("PRIVATE"); });
  const origin = await listen(t, (_req, res) => res.writeHead(307, { location: other + "/collect" }).end());
  await assert.rejects(f.client(origin).executions(), error => {
    assert.ok(error instanceof AssistantSourceError);
    assert.equal(error.status, 502);
    assert.equal(error.message, "assistant_source_unavailable");
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(forwarded, 0);
});

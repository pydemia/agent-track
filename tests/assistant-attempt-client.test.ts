import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AssistantClient } from "../packages/adapters/assistant/index.ts";
import { assistantRoleAttemptsPageSchema, type AssistantRoleAttemptsPage } from "../packages/contracts/assistant-attempts.ts";
import type { NativeMetadataPage } from "../packages/contracts/native-metadata.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-14T00:00:00.000Z";
const history = (): AssistantRoleAttemptsPage => ({ version: 1, executionId: id(1), roleId: id(2), coverage: "coordinator-history", observedAt: at, total: 2,
  attempts: [0, 1].map(index => ({ id: id(10 + index), ordinal: index + 1, current: index === 1,
    state: index ? "completed" : "failed", runtimeTaskId: id(20 + index),
    demian: { origin: "https://native.example", organizationId: id(30), workspaceId: id(31), sessionId: id(32), runId: id(40 + index), operationId: id(10 + index) },
    command: index ? { id: id(11), kind: "retry", predecessorAttemptId: id(10), provenance: "coordinator-intent" } : null })) });

test("attempt page preserves explicit identity/intent and rejects ambiguous, incomplete or private history", () => {
  assert.deepEqual(assistantRoleAttemptsPageSchema.parse(history()), history());
  for (const invalid of [
    { ...history(), total: 3 }, { ...history(), coverage: "all-native-history" },
    { ...history(), attempts: [history().attempts[0], history().attempts[0]] },
    { ...history(), attempts: history().attempts.map(row => ({ ...row, current: true })) },
    { ...history(), attempts: history().attempts.map(row => ({ ...row, ordinal: 2 })) },
    { ...history(), attempts: history().attempts.map(row => ({ ...row, requestText: "PRIVATE" })) },
    { ...history(), attempts: [history().attempts[0], { ...history().attempts[1], command: { ...history().attempts[1]!.command, predecessorAttemptId: id(99) } }] },
    { ...history(), attempts: [history().attempts[0], { ...history().attempts[1], demian: { ...history().attempts[1]!.demian, operationId: id(99) } }] },
  ]) assert.equal(assistantRoleAttemptsPageSchema.safeParse(invalid).success, false);
});

function clientFixture(t: test.TestContext, fetch: typeof globalThis.fetch) {
  const root = mkdtempSync(join(tmpdir(), "track-attempt-client-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const credentialFile = join(root, "client.json"), secretFile = join(root, "secret");
  const ownerId = "sso-sub:" + "a".repeat(64), secret = "b".repeat(43);
  writeFileSync(secretFile, secret);
  writeFileSync(credentialFile, JSON.stringify({ version: 1, audience: "agent-track", sourceId: "assistant", user: "user",
    ownerId, principalId: "reader", revision: 1, notBefore: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
    nativeOrigin: "https://assistant.example", secretFile }));
  return { root, ownerId, secret, client: new AssistantClient({ sourceId: "assistant", user: "user", ownerId,
    principalId: "reader", credentialFile, baseUrl: "https://assistant.example", protocol: 2, fetch }) };
}

test("attempt client uses its fixed role path and rejects malformed or wrong-role responses", async t => {
  let response: unknown = history(), calls = 0;
  const f = clientFixture(t, async (url, init) => {
    calls++;
    assert.equal(init?.method, "GET"); assert.equal(init?.credentials, "omit");
    if (String(url).endsWith("/capabilities")) return Response.json({ version: 2, service: "assistant", audience: "agent-track",
      ownerId: "sso-sub:" + "a".repeat(64), principalId: "reader", revision: "1", executionsRead: true, eventsRead: true,
      controls: false, listLimit: 50, eventLimit: 100, demianReferencesSupported: true, roleAttemptsSupported: true });
    assert.equal(String(url), `https://assistant.example/api/integrations/track/v2/executions/${id(1)}/roles/${id(2)}/attempts`);
    return Response.json(response);
  });
  assert.deepEqual(await f.client.roleAttempts(id(1), id(2)), history());
  for (const patch of [{ roleId: id(3) }, { executionId: id(3) }, { total: 0 }, { context_sha256: "PRIVATE" }]) {
    response = { ...history(), ...patch }; await assert.rejects(f.client.roleAttempts(id(1), id(2)));
  }
  const before = calls; await assert.rejects(f.client.roleAttempts("../other", id(2))); assert.equal(calls, before);
});

const personaRoot = process.env.TEST_ASSISTANT_ATTEMPTS_ROOT;
test("actual Persona producer and Main client agree on attempt schemas and exact historical native selection", { skip: !personaRoot }, async t => {
  const producer = await import(pathToFileURL(join(personaRoot!, "apps/server/src/track-read/service.ts")).href);
  const schema = await import(pathToFileURL(join(personaRoot!, "apps/server/src/track-read/attempts.ts")).href);
  assert.deepEqual(schema.assistantRoleAttemptsPageSchema.parse(history()), assistantRoleAttemptsPageSchema.parse(history()));
  let service: { handle(input: unknown): Promise<unknown> };
  const calls: string[] = [];
  const f = clientFixture(t, async (url, init) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search; calls.push(path);
    try { return Response.json(await service.handle({ method: "GET", url: path, headers: Object.fromEntries(new Headers(init?.headers)) })); }
    catch (error) { return Response.json({ error: "source_unavailable" }, { status: error instanceof producer.AssistantReadError ? (error as { status: number }).status : 500 }); }
  });
  const configFile = join(f.root, "producer.json");
  writeFileSync(configFile, JSON.stringify({ version: 1, enabled: true, audience: "agent-track", ownerId: f.ownerId, principalId: "reader",
    revision: 1, notBefore: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", secretFile: join(f.root, "secret") }));
  let reads = 0;
  service = new producer.AssistantReadService({ protocol: 2, configFile, configuredOwner: () => f.ownerId, port: {
    scan: () => ({ rows: [], through: "0", hasMore: false }), execution: () => null, events: () => ({ events: [], hasMore: false }),
    roleAttempts: async (owner: string, executionId: string, roleId: string) => {
      assert.equal(owner, f.ownerId); assert.equal(executionId, id(1)); assert.equal(roleId, id(2)); return history();
    },
    nativeMetadata: async (_owner: string, _execution: string, _role: string, after: string, limit: number, attemptId: string) => {
      reads++; const attempt = history().attempts.find(row => row.id === attemptId)!; assert.ok(attempt); const ref = attempt.demian!;
      const page: NativeMetadataPage = { version: 1, object: "demian.work_runtime.metadata_page", api_version: "2026-09-01",
        run: { id: ref.runId, session_id: ref.sessionId, workspace_id: ref.workspaceId, organization_id: ref.organizationId,
          acting_user_id: id(60), service_principal_id: id(61), correlation_id: attemptId, status: "failed", created_at: at, started_at: at, completed_at: at,
          binding_sha256: "b".repeat(64), context_sha256: "c".repeat(64), request_sha256: "d".repeat(64) },
        events: { after, limit, through_sequence: after, next_after: after, has_more: false, data: [] } };
      return page;
    },
  } });
  const caps = await f.client.capabilities(); assert.equal("roleAttemptsSupported" in caps && caps.roleAttemptsSupported, true);
  assert.deepEqual(await f.client.roleAttempts(id(1), id(2)), history());
  const selected = await f.client.nativeMetadata(id(1), id(2), "0", 100, id(10));
  assert.equal(selected.page.run.id, id(40)); assert.equal(selected.page.run.correlation_id, id(10)); assert.equal(reads, 1);
  assert.ok(calls.some(path => path.includes(`/attempts/${id(10)}/native?`)));
});

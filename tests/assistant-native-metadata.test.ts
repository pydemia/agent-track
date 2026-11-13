import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { AssistantReadError, AssistantReadService, type AssistantReadPort } from "../packages/assistant-read/service.ts";
import { AssistantClient, AssistantSourceError } from "../packages/adapters/assistant/index.ts";
import { nativeMetadataPageSchema, type NativeMetadataPage } from "../packages/contracts/native-metadata.ts";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const owner = "sso-sub:" + "a".repeat(64);
const instant = "2026-11-14T00:00:00.000Z";
const nativeExecution = () => ({ id, instructionId: id, instructionRevision: 1, revision: 1, state: "completed",
  errorCode: null, taskRef: null, createdAt: instant, updatedAt: instant,
  trackDemianReferences: [{ roleId: id, origin: "https://demian.example", organizationId: id,
    workspaceId: id, sessionId: id, runId: id, operationId: "operation-1" }],
  roles: [{ id, assignmentId: "a", workPackageId: "w", membershipId: "m", membershipRevision: 1,
    teamId: "t", teamName: "Team", personaName: "Agent", role: "Writer", responsibility: "contributor",
    state: "completed", runtimeTaskId: "native-task", threadId: null, turnId: null, attempts: 1,
    observation: { basis: "external_run_wall_timestamps_unverified", queuedAt: null,
      startedAt: null, endedAt: null, executionSeconds: null, timingComplete: false } }] });
const page = (after = "0", limit = 100): NativeMetadataPage => ({
  version: 1, object: "demian.work_runtime.metadata_page", api_version: "2026-09-01",
  run: { id, organization_id: id, workspace_id: id, session_id: id, acting_user_id: id, service_principal_id: other,
    status: "succeeded", created_at: instant, started_at: instant, completed_at: instant,
    correlation_id: "operation-1", binding_sha256: "b".repeat(64), context_sha256: "c".repeat(64), request_sha256: "d".repeat(64) },
  events: { after, through_sequence: "9007199254740994", next_after: "9007199254740994", limit, has_more: false,
    data: [{ api_version: "2026-09-01", run_id: id, sequence_text: "9007199254740994", type: "future.metadata",
      created_at: instant, data: { provider: "openai", model: "reported-model", durationMs: 12.5 } }] },
});
function fixture(t: test.TestContext, overrides: Partial<AssistantReadPort> = {}, withoutNativeMetadata = false) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "track-native-metadata-"));
  t.after(() => { assert.equal(dirname(root), realpathSync(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const secretFile = join(root, "reader.key"), configFile = join(root, "producer.json"), credentialFile = join(root, "client.json");
  const secret = randomBytes(32).toString("base64url"); writeFileSync(secretFile, secret, { mode: 0o600 });
  const grant = { version: 1, audience: "agent-track", ownerId: owner, principalId: "track-reader", revision: 1,
    notBefore: "2026-11-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", secretFile };
  const update = (enabled: boolean) => writeFileSync(configFile, JSON.stringify({ ...grant, enabled })); update(true);
  writeFileSync(credentialFile, JSON.stringify({ ...grant, sourceId: "assistant", user: "local-user", nativeOrigin: "https://assistant.example" }));
  const requests: string[] = [], calls: string[] = [];
  const port: AssistantReadPort = { scan: () => ({ rows: [], through: "0", hasMore: false }), events: () => ({ events: [], hasMore: false }),
      execution: () => { calls.push("execution"); return nativeExecution(); },
      nativeMetadata: async (actor, executionId, roleId, after, limit) => {
        assert.equal(actor, owner); assert.equal(executionId, id); assert.equal(roleId, id); calls.push("native"); return page(after, limit);
      }, ...overrides };
  if (withoutNativeMetadata) delete port.nativeMetadata;
  const service = new AssistantReadService({ protocol: 2, configFile, configuredOwner: () => owner, now: () => Date.parse(instant), port });
  const request = (url = `/api/integrations/track/v2/executions/${id}/roles/${id}/native?after=0&limit=100`) =>
    service.handle({ method: "GET", url, headers: { authorization: `Bearer ${secret}`, "x-agent-track-principal": grant.principalId } });
  const client = new AssistantClient({ protocol: 2, sourceId: "assistant", baseUrl: "https://assistant.example", credentialFile,
    user: "local-user", ownerId: owner, principalId: grant.principalId, now: () => Date.parse(instant),
    fetch: async (url, input) => {
      const target = new URL(String(url)); requests.push(target.pathname + target.search);
      assert.equal(input?.method, "GET"); assert.equal(input?.credentials, "omit"); assert.equal(input?.redirect, "manual");
      assert.equal(new Headers(input?.headers).get("cookie"), null);
      try { return Response.json(await service.handle({ method: "GET", url: target.pathname + target.search,
        headers: { authorization: new Headers(input?.headers).get("authorization")!, "x-agent-track-principal": grant.principalId } })); }
      catch (error) { return Response.json({ error: "private_error" }, { status: error instanceof AssistantReadError ? error.status : 500 }); }
    } });
  return { request, client, update, calls, requests };
}
test("native metadata bridge keeps int64, current scope and original handshakes", async t => {
  const f = fixture(t); const result = await f.client.nativeMetadata(id, id, "9007199254740993", 1);
  assert.equal(result.page.events.next_after, "9007199254740994");
  assert.equal(result.page.events.data[0]!.type, "future.metadata");
  assert.deepEqual(f.calls, ["execution", "native", "execution"]);
  assert.deepEqual(f.requests, ["/api/integrations/track/v2/capabilities",
    `/api/integrations/track/v2/executions/${id}/roles/${id}/native?after=9007199254740993&limit=1`,
    "/api/integrations/track/v2/capabilities"]);
});
test("native page schema rejects wrong scope, private data, reversed order and false continuation", () => {
  const base = page(); assert.equal(nativeMetadataPageSchema.safeParse(base).success, true);
  const event = base.events.data[0]!;
  for (const bad of [
    { ...base, run: { ...base.run, output_text: "SECRET" } },
    { ...base, events: { ...base.events, data: [{ ...event, run_id: other }] } },
    { ...base, events: { ...base.events, data: [{ ...event, data: { input: "SECRET" } }] } },
    { ...base, events: { ...base.events, data: [event, event] } },
    { ...base, events: { ...base.events, data: [], next_after: "0" } },
    { ...base, events: { ...base.events, has_more: true } },
  ]) assert.equal(nativeMetadataPageSchema.safeParse(bad).success, false);
});
test("native metadata requires original Run and operation tuple", async t => {
  for (const change of [{ id: other }, { correlation_id: "other" }, { session_id: other }, { workspace_id: other }, { organization_id: other }]) {
    const f = fixture(t, { nativeMetadata: async () => ({ ...page(), run: { ...page().run, ...change } }) });
    await assert.rejects(f.request(), error => error instanceof AssistantReadError && error.status === 503);
  }
});
test("role withdrawal across native await hides the page", async t => {
  let visible = true;
  const f = fixture(t, { execution: () => visible ? nativeExecution() : null,
    nativeMetadata: async () => { visible = false; return page(); } });
  await assert.rejects(f.request(), error => error instanceof AssistantReadError && error.status === 404);
});
test("reader grant withdrawal across native await hides the page", async t => {
  const f = fixture(t, { nativeMetadata: async () => { f.update(false); return page(); } });
  await assert.rejects(f.request(), error => error instanceof AssistantReadError && error.status === 401);
});
test("v1/unsupported port, invalid aliases and out-of-range cursors never invoke native storage", async t => {
  const f = fixture(t);
  for (const suffix of ["?after=01", "?after=9223372036854775808", "?after=0&after=1", "?limit=251", "?unknown=1"])
    await assert.rejects(f.request(`/api/integrations/track/v2/executions/${id}/roles/${id}/native${suffix}`), AssistantReadError);
  await assert.rejects(f.request(`/api/integrations/track/v1/executions/${id}/roles/${id}/native`), AssistantReadError);
  assert.deepEqual(f.calls, []);
  const old = fixture(t, {}, true);
  await assert.rejects(old.client.nativeMetadata(id, id), error => error instanceof AssistantSourceError && error.status === 503);
  await assert.rejects(old.client.nativeMetadata(id, id, "9223372036854775808"), error => error instanceof AssistantSourceError && error.status === 400);
});

import assert from "node:assert/strict";
import test from "node:test";
import * as contract from "../packages/contracts/assistant.ts";
const id = "12345678-1234-4234-8234-123456789abc";
const otherId = "22345678-1234-4234-8234-123456789abc";
const roleId = "32345678-1234-4234-8234-123456789abc";
const instant = "2026-11-12T01:02:03.000Z";

function nativeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id,
    instructionId: otherId,
    instructionRevision: 4,
    revision: 5,
    state: "running",
    errorCode: null,
    taskRef: {
      sourceService: "projects",
      sourceId: "task-42",
      projectId: "project-7",
      revision: 3,
      state: "in_progress",
      url: "https://projects.pydemia.ai/?project=project-7&view=tasks&item=task-42",
      asOf: instant,
      privateData: "drop",
    },
    roles: [{
      id: roleId,
      assignmentId: "assignment-9",
      workPackageId: "package-2",
      membershipId: "membership-4",
      membershipRevision: 8,
      teamId: "team-3",
      teamName: "Core <img src=x onerror=alert(1)> Team",
      personaName: "Agent\u0000 <script>alert(1)</script>",
      role: "Reviewer <b>primary</b>",
      responsibility: "reviewer",
      state: "awaiting_runtime",
      runtimeTaskId: null,
      threadId: "thread-abc",
      turnId: null,
      attempts: 0,
      observation: {
        source: "runtime_monotonic",
        basis: "server_dispatch_to_terminal_including_sdk_preparation",
        queuedAt: instant,
        startedAt: null,
        endedAt: null,
        executionSeconds: null,
        timingComplete: false,
        privatePrompt: "do not leak",
      },
      requestedModel: "private-model",
      skillRefs: [{ body: "private skill" }],
    }],
    createdAt: instant,
    updatedAt: instant,
    instructionText: "private instruction",
    result: "private result",
    note: { url: "https://private.example", content: "private note" },
    ownerId: "private owner",
    providerIdentity: "private provider",
    ...overrides,
  };
}


const ref = { roleId, origin: "https://demian.example", organizationId: id, workspaceId: otherId,
  sessionId: id, runId: otherId, operationId: "operation-1" };
function external() {
  const value = nativeExecution();
  value.roles[0]!.observation.basis = "external_run_wall_timestamps_unverified";
  return { ...value, trackDemianReferences: [ref] };
}
test("v2 projects fresh observer references and unverified external timing without raw bodies", () => {
  const value = contract.projectAssistantExecutionV2(external());
  const { roleId: _, ...expected } = ref;
  assert.deepEqual(value.roles[0]!.runtime.demian, expected);
  assert.equal(value.roles[0]!.observation.seconds, null);
  assert.equal(value.roles[0]!.observation.timingComplete, false);
  assert.equal(JSON.stringify(value).includes("private"), false);
  assert.equal(contract.assistantExecutionMetadataSchema.safeParse(value).success, false);
  assert.equal(contract.isAssistantV1Unsupported(external()), true);
  assert.throws(() => contract.projectAssistantExecution(external()));
  assert.equal(contract.projectAssistantExecutionV2(nativeExecution()).roles[0]!.runtime.demian, null);
});
test("v2 accepts only canonical HTTPS observer identities tied to unique current roles", () => {
  for (const patch of [{ origin: "http://demian.example" }, { origin: "https://demian.example/" },
    { origin: "https://user:password@demian.example" }, { origin: "https://demian.example/path" },
    { roleId: otherId }, { runId: "bad" }, { claim: "private" }, { body: "private" }, { secret: "private" }]) {
    assert.throws(() => contract.projectAssistantExecutionV2({ ...external(), trackDemianReferences: [{ ...ref, ...patch }] }));
  }
  assert.throws(() => contract.projectAssistantExecutionV2({ ...external(), trackDemianReferences: [ref, ref] }));
  for (const patch of [{ executionSeconds: 10 }, { timingComplete: true }]) {
    const raw = external(); Object.assign(raw.roles[0]!.observation, patch);
    assert.throws(() => contract.projectAssistantExecutionV2(raw));
  }
  const raw = nativeExecution();
  Object.assign(raw.roles[0]!, { runtime: { demian: ref }, demian: ref, externalClaim: ref });
  assert.equal(contract.projectAssistantExecutionV2(raw).roles[0]!.runtime.demian, null);
});
test("v2 closed envelopes retain page and event ordering invariants and reject v1", () => {
  const metadata = contract.projectAssistantExecutionV2(external());
  const page = { version: 2, observedAt: instant, executions: [metadata], cursor: null, hasMore: false, omitted: 0, complete: false };
  assert.equal(contract.assistantExecutionPageV2Schema.safeParse(page).success, true);
  for (const patch of [{version: 1}, {body: "private"}, {hasMore: true}])
    assert.equal(contract.assistantExecutionPageV2Schema.safeParse({...page, ...patch}).success, false);
  const event = { executionId: id, sequence: "1", revision: "1", state: "completed", errorCode: null, occurredAt: instant };
  const events = { version: 2, observedAt: instant, executionId: id, events: [event], cursor: "1", hasMore: false, complete: false };
  assert.equal(contract.assistantExecutionEventsPageV2Schema.safeParse(events).success, true);
  for (const patch of [{version: 1}, {body: "private"}, {cursor: "0"}, {events: [event,event]}, {executionId: otherId}])
    assert.equal(contract.assistantExecutionEventsPageV2Schema.safeParse({...events, ...patch}).success, false);
  for (const patch of [{body: "private"}, {roles: [metadata.roles[0],metadata.roles[0]]},
    {roles: [{...metadata.roles[0],runtime: {...metadata.roles[0]!.runtime, claim: "private"}}]}])
    assert.equal(contract.assistantExecutionMetadataV2Schema.safeParse({...metadata,...patch}).success, false);
  const caps = { version: 2, service: "assistant", audience: "agent-track", ownerId: "sso-sub:"+"a".repeat(64), principalId: "reader", revision: "1", executionsRead: true, eventsRead: true, controls: false, listLimit: 50, eventLimit: 100, demianReferencesSupported: true };
  assert.equal(contract.assistantCapabilitiesV2Schema.safeParse(caps).success, true);
  for (const patch of [{version: 1}, {demianReferencesSupported: false}, {body: "private"}, {controls: true}])
    assert.equal(contract.assistantCapabilitiesV2Schema.safeParse({...caps,...patch}).success, false);
});

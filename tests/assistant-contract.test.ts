import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assistantCapabilitiesSchema,
  assistantExecutionEventsPageSchema,
  assistantExecutionMetadataSchema,
  assistantExecutionPageSchema,
  assistantExecutionEventSchema,
  projectAssistantEvent,
  projectAssistantExecution,
} from "../packages/contracts/assistant.ts";

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

describe("Assistant metadata contract", () => {
  it("projects only allowlisted fields and maps taskRef.sourceId as the Task ID", () => {
    const projected = projectAssistantExecution(nativeExecution());
    assert.deepEqual(projected.task, {
      projectId: "project-7",
      taskId: "task-42",
      revision: "3",
      state: "in_progress",
      observedAt: instant,
    });
    assert.equal(projected.instructionId, otherId);
    assert.equal(projected.roles[0]?.id, roleId);
    assert.notEqual(projected.id, projected.instructionId);
    assert.notEqual(projected.id, projected.roles[0]?.id);
    assert.notEqual(projected.instructionId, projected.roles[0]?.id);
    // Labels are plain JSON text. Preserve literal brackets rather than rewriting names.
    assert.equal(projected.roles[0]?.label, "Reviewer <b>primary</b>");
    assert.equal(projected.roles[0]?.teamLabel, "Core <img src=x onerror=alert(1)> Team");
    assert.equal(projected.roles[0]?.agentLabel, "Agent <script>alert(1)</script>");
    assert.equal(projected.roles[0]?.runtime.taskId, null);
    assert.equal(projected.roles[0]?.runtime.turnId, null);
    assert.equal(projected.roles[0]?.state, "awaiting_runtime");
    assert.deepEqual(projected.roles[0]?.observation, {
      queuedAt: instant,
      startedAt: null,
      endedAt: null,
      seconds: null,
      timingComplete: false,
      basis: "server_dispatch_to_terminal_including_sdk_preparation",
    });
    const json = JSON.stringify(projected);
    for (const privateValue of [
      "privatePrompt", "private-model", "private skill", "private instruction",
      "private result", "private note", "private owner", "private provider",
      "requestedModel", "skillRefs", "instructionText", "providerIdentity",
    ]) assert.equal(json.includes(privateValue), false);
  });

  it("preserves absent task references and validates Projects identity", () => {
    assert.equal(projectAssistantExecution(nativeExecution({ taskRef: null })).task, null);
    assert.throws(() => projectAssistantExecution(nativeExecution({
      taskRef: { ...nativeExecution().taskRef as object, sourceService: "demian" },
    })));
    assert.throws(() => projectAssistantExecution(nativeExecution({ taskRef: {
      sourceService: "projects", projectId: "project-7", revision: 3,
      state: "in_progress", asOf: instant,
    } })));
  });

  it("rejects unsafe, fractional, and string native revisions", () => {
    for (const value of [Number.MAX_SAFE_INTEGER + 1, 1.5, "9007199254740993"]) {
      assert.throws(() => projectAssistantExecution(nativeExecution({ revision: value })));
    }
    assert.throws(() => projectAssistantExecution(nativeExecution({
      instructionRevision: "4",
    })));
    assert.throws(() => projectAssistantExecution(nativeExecution({
      roles: [{ ...nativeExecution().roles[0], membershipRevision: 1.2 }],
    })));
  });

  it("accepts additive native fields, but keeps each wire schema strict", () => {
    const projected = projectAssistantExecution(nativeExecution({ futureNativeField: true }));
    assert.equal("futureNativeField" in projected, false);
    assert.equal(assistantExecutionMetadataSchema.safeParse({
      ...projected,
      privateField: true,
    }).success, false);
    assert.equal(assistantExecutionPageSchema.safeParse({
      version: 1, observedAt: instant, executions: [projected], cursor: null,
      hasMore: false, omitted: 0, complete: false, extra: true,
    }).success, false);
  });
});

describe("Assistant event contract", () => {
  const nativeEvent = {
    executionId: id,
    sequence: 7,
    revision: 8,
    state: "completed",
    errorCode: null,
    occurredAt: instant,
    payload: { prompt: "private" },
  };

  it("projects only event metadata using canonical decimal strings", () => {
    assert.deepEqual(projectAssistantEvent(nativeEvent), {
      executionId: id,
      sequence: "7",
      revision: "8",
      state: "completed",
      errorCode: null,
      occurredAt: instant,
    });
    assert.throws(() => projectAssistantEvent({ ...nativeEvent, sequence: 1.5 }));
    assert.throws(() => projectAssistantEvent({ ...nativeEvent, revision: "8" }));
  });

  it("bounds Assistant event cursors to safe decimal strings and matches ordered page scope", () => {
    const page = {
      version: 1,
      observedAt: instant,
      executionId: id,
      events: [projectAssistantEvent(nativeEvent)],
      cursor: "7",
      hasMore: false,
      complete: false,
    };
    assert.equal(assistantExecutionEventsPageSchema.safeParse(page).success, true);
    assert.equal(assistantExecutionEventsPageSchema.safeParse({ ...page, events: [], cursor: "9007199254740991" }).success, true);
    for (const cursor of ["9007199254740992", "9223372036854775807", "9223372036854775808", "01", "-1", 1, "6"]) {
      assert.equal(assistantExecutionEventsPageSchema.safeParse({ ...page, cursor }).success, false);
    }
    assert.equal(assistantExecutionEventsPageSchema.safeParse({ ...page, events: [], hasMore: true }).success, false);
    assert.equal(assistantExecutionEventsPageSchema.safeParse({ ...page, events: [page.events[0], page.events[0]] }).success, false);
    assert.equal(assistantExecutionEventsPageSchema.safeParse({
      ...page,
      events: [{ ...page.events[0], executionId: otherId }],
    }).success, false);
    assert.equal(assistantExecutionEventsPageSchema.safeParse({
      ...page,
      extra: "payload",
    }).success, false);
    assert.equal(assistantExecutionEventSchema.safeParse({
      ...page.events[0],
      payload: "private",
    }).success, false);
  });
});

describe("Assistant capabilities contract", () => {
  it("accepts the fixed read-only capability envelope and rejects extras", () => {
    const value = {
      version: 1,
      service: "assistant",
      audience: "agent-track",
      ownerId: `sso-sub:${"a".repeat(64)}`,
      principalId: "track-readonly",
      revision: "4",
      executionsRead: true,
      eventsRead: true,
      controls: false,
      listLimit: 50,
      eventLimit: 100,
      demianReferencesSupported: false,
    };
    assert.equal(assistantCapabilitiesSchema.safeParse(value).success, true);
    assert.equal(assistantCapabilitiesSchema.safeParse({ ...value, controls: true }).success, false);
    assert.equal(assistantCapabilitiesSchema.safeParse({ ...value, demianReferencesSupported: true }).success, false);
    assert.equal(assistantCapabilitiesSchema.safeParse({ ...value, private: true }).success, false);
  });
});

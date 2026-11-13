import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunView } from "../packages/contracts/index.ts";
import { parseToolEvidenceReply } from "../apps/web/src/tool-evidence-reply.ts";

const run: RunView = {
  key: "native:run-1", sourceId: "native", runId: "run-1", sessionId: "session-1", workspaceId: null,
  title: "Fixture", status: "running", createdAt: "2026-11-12T09:00:00Z", startedAt: null,
  completedAt: null, observedAt: "2026-11-12T09:00:00Z", cursor: "1", highWater: "1",
  incomplete: false, stale: false, binding: null, sourceLabel: "Fixture", device: "test",
  sourceState: "connected", sourceUrl: null, workspaceKey: null, projectKey: null, capabilities: ["session.link"],
};

function legacyReply() {
  return {
    state: "connected", runKey: run.key, observedAt: "2026-11-12T09:00:00Z", detail: "fixture",
    calls: [], scanned: 0, limit: 2000, targetSequence: "0", throughSequence: "0", targetReached: true,
    gaps: false, truncated: false, omittedCalls: 0, unidentifiedEvents: 0, complete: true,
  };
}

function observation() {
  return {
    id: "2", contextKey: "a".repeat(64), invocationId: null, provider: "provider-x", model: "model-x",
    phase: "ended", started: { sequence: "2", occurredAt: "2026-11-12T09:00:00Z" },
    ended: { sequence: "3", occurredAt: "2026-11-12T09:00:01Z" }, reportedDurationMs: 1000, sequences: ["2", "3"],
  };
}

function modelReply() {
  return { ...legacyReply(), scanned: 3, targetSequence: "3", throughSequence: "3",
    modelRequestCoverage: "native-model-lifecycle", modelRequests: [observation()] };
}

test("accepts the historical tool reply without inventing model lifecycle coverage", () => {
  const reply = parseToolEvidenceReply(legacyReply(), run);
  assert.equal(reply.modelRequestCoverage, undefined);
  assert.equal(reply.modelRequests, undefined);
  assert.equal(reply.calls.length, 0);
});

test("validates and preserves optional native model lifecycle metadata", () => {
  const reply = parseToolEvidenceReply({ ...modelReply(), complete: false,
    unidentifiedModelEvents: 2, omittedModelRequests: 1 }, run);
  assert.equal(reply.modelRequestCoverage, "native-model-lifecycle");
  assert.equal(reply.modelRequests?.[0]?.phase, "ended");
  assert.equal(reply.unidentifiedModelEvents, 2);
  assert.equal(reply.omittedModelRequests, 1);
});

test("rejects malformed model lifecycle metadata and sensitive uncontracted fields", () => {
  const invalid: unknown[] = [
    { ...modelReply(), modelRequests: [{ ...observation(), provider: "unsafe provider" }] },
    { ...modelReply(), modelRequests: [{ ...observation(), phase: "success" }] },
    { ...modelReply(), modelRequests: [{ ...observation(), contextKey: "native-session-id" }] },
    { ...modelReply(), modelRequests: [{ ...observation(), prompt: "PRIVATE_PROMPT" }] },
    { ...modelReply(), modelRequests: [{ ...observation(), id: "3" }] },
    { ...modelReply(), modelRequests: [{ ...observation(), phase: "started" }] },
    { ...modelReply(), modelRequests: [observation(), observation()] },
    { ...modelReply(), throughSequence: "1" },
    { ...modelReply(), unidentifiedModelEvents: 1 },
    { ...legacyReply(), unidentifiedModelEvents: -1 },
    { ...legacyReply(), modelRequestCoverage: "native-model-lifecycle", prompt: "PRIVATE_PROMPT" },
  ];
  for (const value of invalid) assert.throws(() => parseToolEvidenceReply(value, run));
});

test("rejects replies bound to a different Run", () => {
  assert.throws(() => parseToolEvidenceReply({ ...legacyReply(), runKey: "native:other-run" }, run), /Run mismatch/);
});

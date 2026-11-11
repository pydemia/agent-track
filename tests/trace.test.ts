import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventView } from "../packages/contracts/index.ts";
import { projectTrace } from "../packages/projection/trace.ts";

const run = { sourceId: "src", runId: "run" };
const at = "2026-11-11T12:00:00.000Z";
function event(sequence: string, type: string, data: EventView["data"] = { redacted: true }, options: Partial<EventView> = {}): EventView {
  return { sourceId: run.sourceId, runId: run.runId, sequence, type, occurredAt: at, data,
    key: `local-${sequence}`, receivedAt: at, ...options };
}

test("pairs tool lifecycle events by invocation and call ID, and reports observed completion", () => {
  const result = projectTrace(run, [
    event("3", "tool.completed", { redacted: true, invocationId: "inv", callId: "c", tool: "search" }, { occurredAt: "2026-11-11T12:00:02.000Z" }),
    event("1", "agent.invocation.started", { redacted: true, invocationId: "inv", parentInvocationId: "parent" }),
    event("2", "tool.started", { redacted: true, invocationId: "inv", callId: "c", tool: "search" }, { occurredAt: "2026-11-11T12:00:01.000Z" }),
  ]);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0]?.id, "inv");
  assert.equal(result.steps[0]?.parentId, "parent");
  assert.equal(result.steps[0]?.tools[0]?.phase, "completed");
  assert.equal(result.steps[0]?.tools[0]?.observedIntervalMs, 1000);
  assert.deepEqual(result.steps[0]?.tools[0]?.sequences, ["2", "3"]);
  assert.equal(result.unassigned.length, 0);
});

test("never merges reused call IDs across invocation tuples and leaves missing invocation references unassigned", () => {
  const result = projectTrace(run, [
    event("1", "tool.started", { redacted: true, invocationId: "one", callId: "same", tool: "a" }),
    event("2", "tool.started", { redacted: true, invocationId: "two", callId: "same", tool: "b" }),
    event("3", "tool.failed", { redacted: true, invocationId: "ghost", callId: "same", tool: "c" }),
    event("4", "tool.completed", { redacted: true, callId: "root-call", tool: "d" }),
    event("5", "agent.invocation.started", { redacted: true, invocationId: "one" }),
  ]);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0]?.tools.length, 1);
  assert.equal(result.steps[0]?.tools[0]?.invocationId, "one");
  assert.equal(result.unassigned.length, 3);
  assert.ok(result.unassigned.some((tool) => tool.invocationId === "ghost" && tool.phase === "failed"));
  assert.ok(result.unassigned.some((tool) => tool.invocationId === null && tool.callId === "root-call"));
});

test("sorts int64 sequences as decimal strings, deduplicates identical sequence evidence and keeps source/run scope", () => {
  const duplicate = event("9007199254740993", "agent.invocation.started", { redacted: true, invocationId: "large" });
  const result = projectTrace(run, [
    event("9007199254740994", "tool.started", { redacted: true, callId: "later" }),
    { ...duplicate, key: "another-local-key", receivedAt: "2026-11-11T13:00:00.000Z" },
    event("2", "agent.invocation.started", { redacted: true, invocationId: "first" }),
    event("9007199254740995", "agent.invocation.started", { redacted: true, invocationId: "foreign-source" }, { sourceId: "other" }),
    event("9007199254740996", "agent.invocation.started", { redacted: true, invocationId: "foreign-run" }, { runId: "other" }),
  ]);
  assert.deepEqual(result.steps.map((step) => step.id), ["first", "large"]);
  assert.equal(result.eventCount, 3);
  assert.equal(result.unassigned[0]?.sequences[0], "9007199254740994");
});

test("preserves unfinished and unknown events; missing call IDs count as unidentified", () => {
  const result = projectTrace(run, [
    event("1", "agent.invocation.started", { redacted: true, invocationId: "open" }),
    event("2", "agent.invocation.waiting", { redacted: true, invocationId: "mystery" }),
    event("3", "tool.started", { redacted: true, invocationId: "open", tool: "no-id" }),
  ]);
  assert.equal(result.steps.find((step) => step.id === "open")?.phase, "started");
  assert.equal(result.steps.find((step) => step.id === "mystery")?.phase, "unknown");
  assert.equal(result.steps.find((step) => step.id === "open")?.tools.length, 0);
  assert.equal(result.unidentifiedEvents, 1);
});

test("marks duplicate starts, conflicting sequence evidence and duplicate ends ambiguous", () => {
  const result = projectTrace(run, [
    event("1", "agent.invocation.started", { redacted: true, invocationId: "amb" }),
    event("2", "agent.invocation.started", { redacted: true, invocationId: "amb" }),
    event("3", "agent.invocation.completed", { redacted: true, invocationId: "amb" }),
    event("4", "agent.invocation.failed", { redacted: true, invocationId: "amb" }),
    event("5", "tool.started", { redacted: true, invocationId: "amb", callId: "conflict" }),
    event("5", "tool.completed", { redacted: true, invocationId: "amb", callId: "conflict" }),
  ]);
  assert.equal(result.steps[0]?.phase, "ambiguous");
  assert.equal(result.steps[0]?.startedAt, null);
  assert.equal(result.steps[0]?.completedAt, null);
  assert.equal(result.steps[0]?.tools[0]?.phase, "ambiguous");
  assert.equal(result.steps[0]?.tools[0]?.observedIntervalMs, null);
});

test("does not derive intervals from negative or cross-clock timestamp pairs", () => {
  const negative = projectTrace(run, [
    event("1", "tool.started", { redacted: true, callId: "negative" }, { occurredAt: "2026-11-11T12:00:02.000Z" }),
    event("2", "tool.completed", { redacted: true, callId: "negative" }, { occurredAt: "2026-11-11T12:00:01.000Z" }),
  ]).unassigned[0];
  const crossClock = projectTrace(run, [
    event("3", "tool.started", { redacted: true, callId: "cross" }, { occurredAt: "2026-11-11T12:00:00.000Z" }),
    event("4", "tool.completed", { redacted: true, callId: "cross" }, { occurredAt: "2026-11-11T13:00:01.000+01:00" }),
  ]).unassigned[0];
  assert.equal(negative?.observedIntervalMs, null);
  assert.equal(crossClock?.observedIntervalMs, null);
});

test("does not mutate normalized metadata events", () => {
  const input = [
    event("2", "tool.completed", { redacted: true, invocationId: "inv", callId: "call", tool: "safe" }),
    event("1", "agent.invocation.started", { redacted: true, invocationId: "inv" }),
  ];
  const before = structuredClone(input);
  projectTrace(run, input);
  assert.deepEqual(input, before);
});

test("contradictory invocation parents stay ambiguous rather than choosing a hierarchy", () => {
  const result = projectTrace(run, [
    event("1", "agent.invocation.started", { redacted: true, invocationId: "child", parentInvocationId: "parent-a" }),
    event("2", "agent.invocation.completed", { redacted: true, invocationId: "child", parentInvocationId: "parent-b" }),
  ]);
  assert.equal(result.steps[0]!.parentId, null);
  assert.equal(result.steps[0]!.phase, "ambiguous");
});

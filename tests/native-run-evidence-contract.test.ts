import assert from "node:assert/strict";
import test from "node:test";
import { nativeRunEvidencePageSchema, nativeUsageObservationSchema, publicNativeRunEvidence, publicNativeRunEvidencePageSchema, nativeRunEvidenceViewSchema } from "../packages/contracts/native-run-evidence.ts";
import { nativeEvidenceFixture, evidenceOtherId } from "./fixtures/native-run-evidence.ts";

test("separate native evidence preserves lifecycle, partial usage and opaque lineage without invocation fabrication", () => {
  const page = nativeRunEvidencePageSchema.parse(nativeEvidenceFixture());
  assert.equal(page.events.data.length, 8);
  assert.equal(page.events.data.filter(record => record.type.startsWith("agent.invocation.")).length, 0);
  assert.equal(page.events.data[3]!.lineage!.phase, "turn_started");
  assert.deepEqual(page.events.data[5]!.usageObservations.map(row => [row.scope, row.coverage]),
    [["latest-model-request", "partial"], ["native-session", "unknown"]]);
});
test("positive evidence rejects private data and raw SDK identity at every container", () => {
  const page = nativeEvidenceFixture(), record = page.events.data[3]!;
  for (const bad of [
    { ...page, output: "private response" }, { ...page, run: { ...page.run, input: "private request" } },
    { ...page, events: { ...page.events, data: [{ ...record, data: { prompt: "private" } }] } },
    { ...page, events: { ...page.events, data: [{ ...record, lineage: { ...record.lineage, native_thread_id: "private-sdk-id" } }] } },
    { ...page, artifacts: [{ ...page.artifacts[0], bytes: "private bytes" }] },
  ]) assert.equal(nativeRunEvidencePageSchema.safeParse(bad).success, false);
});
test("event, artifact and timing evidence cannot borrow another Run or override its clocks", () => {
  for (const mutate of [
    (page: ReturnType<typeof nativeEvidenceFixture>) => { page.events.data[0]!.runId = evidenceOtherId; },
    (page: ReturnType<typeof nativeEvidenceFixture>) => { page.artifacts[0]!.sourceRunId = evidenceOtherId; },
    (page: ReturnType<typeof nativeEvidenceFixture>) => { page.timings[0]!.startedAt = page.run.started_at!; },
    (page: ReturnType<typeof nativeEvidenceFixture>) => { page.timings[1]!.endedAt = page.run.created_at; },
    (page: ReturnType<typeof nativeEvidenceFixture>) => { page.events.data[0]!.selectedModel = "foreign-model"; },
    (page: ReturnType<typeof nativeEvidenceFixture>) => { page.events.data[0]!.issues = ["usage-unavailable"]; },
  ]) { const page = nativeEvidenceFixture(); mutate(page); assert.equal(nativeRunEvidencePageSchema.safeParse(page).success, false); }
});
test("evidence int64 continuation retains a coherent ordered prefix and detects forged completion", () => {
  assert(nativeRunEvidencePageSchema.safeParse(nativeEvidenceFixture("0", 2)).success);
  assert(nativeRunEvidencePageSchema.safeParse(nativeEvidenceFixture("8", 1)).success);
  const first = nativeEvidenceFixture("0", 2);
  for (const patch of [{ has_more: false }, { next_after: "8" }, { next_after: "02" }, { through_sequence: "9223372036854775808" }])
    assert.equal(nativeRunEvidencePageSchema.safeParse({ ...first, events: { ...first.events, ...patch } }).success, false);
  const page = nativeEvidenceFixture(); page.events.data = [page.events.data[1]!, page.events.data[0]!];
  assert.equal(nativeRunEvidencePageSchema.safeParse(page).success, false);
});
test("usage refuses unsafe counts or unsupported complete coverage rather than inventing a run total", () => {
  const valid = nativeEvidenceFixture().events.data[5]!.usageObservations[0]!;
  for (const totalTokens of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity])
    assert.equal(nativeUsageObservationSchema.safeParse({ ...valid, usage: { totalTokens } }).success, false);
  assert.equal(nativeUsageObservationSchema.safeParse({ ...valid, coverage: "complete" }).success, false);
  assert.equal(nativeUsageObservationSchema.safeParse({ ...valid, usage: {} }).success, false);
  assert(nativeUsageObservationSchema.safeParse({ ...valid, usage: { totalTokens: 0 } }).success);
});

test("browser projection strips authority tuples and refuses private fields or a stale disconnected page", () => {
  const page = publicNativeRunEvidence(nativeEvidenceFixture());
  assert.doesNotMatch(JSON.stringify(page), /organization_id|acting_user_id|service_principal_id|correlation_id|binding_sha256|context_sha256|request_sha256/);
  assert(publicNativeRunEvidencePageSchema.safeParse(page).success);
  assert.equal(publicNativeRunEvidencePageSchema.safeParse(nativeEvidenceFixture()).success, false);
  const view = { state: "connected", runKey: "run", sourceId: "protected", observedAt: page.observedAt, detail: "observed", page,
    executionRef: { sourceId: "assistant", executionId: page.run.id, roleId: page.run.id } };
  assert(nativeRunEvidenceViewSchema.safeParse(view).success);
  assert.equal(nativeRunEvidenceViewSchema.safeParse({ ...view, state: "disconnected" }).success, false);
  assert.equal(nativeRunEvidenceViewSchema.safeParse({ ...view, page: null }).success, false);
});

test("untrusted non-numeric sequence is validation failure rather than an exception", () => {
  for (const field of ["after", "through_sequence", "next_after"]) {
    const page = nativeEvidenceFixture();
    assert.equal(nativeRunEvidencePageSchema.safeParse({ ...page, events: { ...page.events, [field]: "private-error" } }).success, false);
  }
  const page = nativeEvidenceFixture(); page.events.data[0]!.sequence = "not-an-int64";
  assert.equal(nativeRunEvidencePageSchema.safeParse(page).success, false);
});

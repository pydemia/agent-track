import assert from "node:assert/strict";
import test from "node:test";
import { fileChangeSignal, projectFileChanges, type FileSignal } from "../packages/projection/file-changes.ts";

const runId = "run-α";
const time = "2026-11-12T01:02:03.456Z";

function proposal(sequence: string, changes: unknown = [{ path: "src/한글.ts", kind: { type: "update" }, diff: "PRIVATE DIFF" }], extra: Record<string, unknown> = {}) {
  return {
    api_version: "2026-09-01", run_id: runId, sequence_text: sequence, type: "tool.requested", created_at: time,
    data: { executor: "codex-app-server", name: "fileChange", callId: "call-1", invocationId: "invoke-1", input: { changes }, ...extra },
  };
}

function completion(sequence: string, ok: unknown = true, extra: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { executor: "codex-app-server", name: "fileChange", callId: "call-1", invocationId: "invoke-1", ...extra };
  if (ok !== undefined) data.ok = ok;
  return {
    api_version: "2026-09-01", run_id: runId, sequence_text: sequence, type: "tool.completed", created_at: time,
    data,
  };
}

function signal(raw: unknown): FileSignal {
  const result = fileChangeSignal(raw, runId);
  assert.ok(result);
  return result;
}

test("accepts only the exact native executor, tool, and event pair", () => {
  assert.equal(fileChangeSignal(proposal("1"), runId)?.kind, "proposal");
  assert.equal(fileChangeSignal(completion("2"), runId)?.kind, "completion");
  for (const raw of [
    { ...proposal("1"), data: { ...(proposal("1").data), executor: "other" } },
    { ...proposal("1"), data: { ...(proposal("1").data), name: "other" } },
    { ...proposal("1"), type: "prompt.output" },
  ]) assert.equal(fileChangeSignal(raw, runId), null);
});

test("pairs success and denial and keeps a proposal pending without completion", () => {
  const success = projectFileChanges([signal(proposal("4")), signal(completion("5", true))]);
  assert.equal(success[0]?.state, "reported");
  assert.equal(success[0]?.completedSequence, "5");
  const denied = projectFileChanges([signal(proposal("4")), signal(completion("5", false))]);
  assert.equal(denied[0]?.state, "failed");
  assert.equal(projectFileChanges([signal(proposal("4"))])[0]?.state, "pending");
});

test("maximal safe paths and call IDs still produce bounded metadata keys", () => {
  const path = "a".repeat(2048); const callId = "c".repeat(512);
  const rows = projectFileChanges([signal(proposal("1", [{ path, kind: { type: "add" } }], { callId })), signal(completion("2", true, { callId }))]);
  assert.equal(rows[0]!.state, "reported"); assert.equal(rows[0]!.path, path); assert.match(rows[0]!.key, /^[0-9a-f]{64}$/);
  assert.throws(() => signal(proposal("3", [{ path: "   ", kind: { type: "add" } }])));
  assert.throws(() => signal({ ...proposal("4"), created_at: "2026-02-31T00:00:00Z" }));
});

test("missing identifiers, missing outcome, and reverse ordering stay non-successful", () => {
  const noId = signal(proposal("1", undefined, { callId: undefined }));
  assert.equal(projectFileChanges([noId])[0]?.state, "ambiguous");
  assert.equal(projectFileChanges([signal(proposal("2")), signal(completion("3", null))])[0]?.state, "ambiguous");
  assert.equal(projectFileChanges([signal(completion("1")), signal(proposal("2"))])[0]?.state, "ambiguous");
});

test("duplicate starts, duplicate completions, and reused tuple identities are ambiguous", () => {
  const start = signal(proposal("1"));
  const end = signal(completion("2"));
  assert.equal(projectFileChanges([start, signal(proposal("3")), end])[0]?.state, "ambiguous");
  assert.equal(projectFileChanges([start, end, signal(completion("3", true))])[0]?.state, "ambiguous");
  assert.equal(projectFileChanges([start, end, signal(proposal("4")), signal(completion("5"))])[0]?.state, "ambiguous");
});

test("deduplicates identical sequence evidence and marks changed evidence at that sequence ambiguous", () => {
  const start = proposal("7");
  const exactDuplicate = structuredClone(start);
  assert.equal(projectFileChanges([signal(start), signal(exactDuplicate), signal(completion("8"))])[0]?.state, "reported");
  const changedAtSameSequence = proposal("7", [{ path: "other.ts", kind: { type: "add" }, diff: "changed" }]);
  const rows = projectFileChanges([signal(start), signal(changedAtSameSequence), signal(completion("8"))]);
  assert.deepEqual(rows.map((row) => [row.path, row.state]), [["src/한글.ts", "ambiguous"], ["other.ts", "ambiguous"]]);
});

test("orders int64 sequences without converting to unsafe JavaScript numbers", () => {
  const rows = projectFileChanges([signal(proposal("9007199254740993")), signal(completion("9223372036854775807"))]);
  assert.equal(rows[0]?.state, "reported");
  assert.equal(rows[0]?.requestedSequence, "9007199254740993");
  assert.throws(() => fileChangeSignal(proposal("9223372036854775808"), runId),
    { message: "Invalid native file-change metadata" });
});

test("strips arguments, diff text, previews, and secret fields from every output row", () => {
  const raw = proposal("1", [{ path: "secret.txt", kind: { type: "update" }, diff: "UNIQUE_PRIVATE_DIFF" }], {
    preview: "UNIQUE_PREVIEW", arguments: "UNIQUE_ARGUMENTS", providerId: "UNIQUE_PROVIDER_ID",
  });
  const projected = projectFileChanges([signal(raw)]);
  const serialized = JSON.stringify(projected);
  for (const secret of ["UNIQUE_PRIVATE_DIFF", "UNIQUE_PREVIEW", "UNIQUE_ARGUMENTS", "UNIQUE_PROVIDER_ID"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal("evidenceDigest" in projected[0]!, false);
  assert.equal("input" in projected[0]!, false);
});

test("validates Unicode display paths and rejects URI, controls, empty, and oversized paths", () => {
  assert.equal(signal(proposal("1", [{ path: "C:\\work\\파일.ts", kind: { type: "add" } }])).kind, "proposal");
  for (const path of ["", "https://host/path", "file:///tmp/x", "bad\npath", "x".repeat(2049)]) {
    assert.throws(() => fileChangeSignal(proposal("1", [{ path, kind: { type: "add" } }]), runId),
      { message: "Invalid native file-change metadata" });
  }
});

test("projects direct workspace diff paths without claiming content validation", () => {
  const raw = {
    api_version: "2026-09-01", run_id: runId, sequence_text: "9", type: "workspace.diff.updated", created_at: time,
    data: { change: { path: "src/new.ts", diff: "DO NOT COPY", preview: "DO NOT COPY" } },
  };
  const projected = projectFileChanges([signal(raw)]);
  assert.deepEqual(projected.map(({ path, operation, state, mechanism }) => ({ path, operation, state, mechanism })), [
    { path: "src/new.ts", operation: "unknown", state: "reported", mechanism: "workspace-diff" },
  ]);
  assert.equal(JSON.stringify(projected).includes("DO NOT COPY"), false);
});

test("ignores unrelated tool output and prompt fields that merely resemble file changes", () => {
  const raw = { ...proposal("1"), data: { executor: "other", name: "fileChange", input: { changes: [{ path: "x" }] } } };
  assert.equal(fileChangeSignal(raw, runId), null);
});

test("does not mutate input events or signal arrays", () => {
  const raw = proposal("1");
  const before = structuredClone(raw);
  const item = signal(raw);
  const list = [item, signal(completion("2"))] as const;
  const listBefore = [...list];
  projectFileChanges(list);
  assert.deepEqual(raw, before);
  assert.deepEqual(list, listBefore);
});

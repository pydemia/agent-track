import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { externalKey, type RunBinding, type RunObservation } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";
import { BindingConflictError, BindingRepository } from "../packages/bindings/repository.ts";

const timestamp = "2026-11-11T10:00:00.000Z";
const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const digest1 = "a".repeat(64);
const digest2 = "b".repeat(64);

function observe(store: Store, runId = "run-1", sourceId = "source-1"): string {
  const run: RunObservation = {
    sourceId, runId, sessionId: `session-${runId}`, workspaceId: null, title: "Run",
    status: "running", createdAt: timestamp, startedAt: timestamp, completedAt: null, observedAt: timestamp,
  };
  return store.observeRun(run);
}

function binding(runId = "run-1", sourceId = "source-1", taskId = "task-1"): RunBinding {
  return {
    sourceId, runId, projectSourceId: "projects", projectId: "project-1", taskId,
    taskRevision: "revision-1", projectTitle: "Project", taskTitle: "Task", provenance: "operator",
  };
}

function apply(repo: BindingRepository, options: {
  actor?: string; id?: string; requestDigest?: string; expectedVersion?: string; binding?: RunBinding;
} = {}) {
  return repo.apply({
    actor: options.actor ?? "owner",
    id: options.id ?? id1,
    requestDigest: options.requestDigest ?? digest1,
    expectedVersion: options.expectedVersion ?? "0",
    binding: options.binding ?? binding(),
  });
}

test("binding history appends per Run and versions remain isolated by Run key", () => {
  const store = new Store(":memory:");
  try {
    const repo = new BindingRepository(store);
    const firstKey = observe(store);
    const secondKey = observe(store, "run-2");
    const first = apply(repo);
    const second = apply(repo, { id: id2, expectedVersion: "0", binding: binding("run-2") });
    const rebound = apply(repo, { id: "33333333-3333-4333-8333-333333333333", expectedVersion: first.version, binding: binding("run-1", "source-1", "task-2") });

    assert.equal(first.runKey, firstKey);
    assert.equal(repo.currentVersion(firstKey), rebound.version);
    assert.equal(repo.currentVersion(secondKey), second.version);
    assert.deepEqual(repo.history(firstKey).map((item) => item.binding.taskId), ["task-1", "task-2"]);
    assert.deepEqual(repo.history(secondKey).map((item) => item.binding.taskId), ["task-1"]);
  } finally { store.close(); }
});

test("stale versions fail with a typed binding conflict", () => {
  const store = new Store(":memory:");
  try {
    const repo = new BindingRepository(store);
    observe(store);
    apply(repo);
    assert.throws(() => apply(repo, { id: id2 }), (error: unknown) =>
      error instanceof BindingConflictError && error.code === "binding_conflict");
  } finally { store.close(); }
});

test("binding ordinal versions preserve int64 precision through append and history", () => {
  const store = new Store(":memory:");
  try {
    const repo = new BindingRepository(store); const key = observe(store);
    store.db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('bindings',?)").run(9007199254740992n);
    const receipt = apply(repo);
    assert.equal(receipt.version, "9007199254740993");
    assert.equal(repo.currentVersion(key), receipt.version);
    assert.equal(repo.history(key)[0]!.version, receipt.version);
  } finally { store.close(); }
});

test("same actor and id replay returns its original receipt after a later bind", () => {
  const store = new Store(":memory:");
  try {
    const repo = new BindingRepository(store);
    observe(store);
    const original = apply(repo);
    apply(repo, { id: id2, expectedVersion: original.version, binding: binding("run-1", "source-1", "task-2") });
    assert.deepEqual(apply(repo), original);
    assert.deepEqual(repo.receipt("owner", id1), original);
    assert.equal(repo.history(original.runKey).length, 2);
  } finally { store.close(); }
});

test("same actor and id cannot be reused for another digest or Run", () => {
  const store = new Store(":memory:");
  try {
    const repo = new BindingRepository(store);
    observe(store); observe(store, "run-2");
    apply(repo);
    assert.throws(() => apply(repo, { requestDigest: digest2 }), (error: unknown) =>
      error instanceof BindingConflictError && error.code === "idempotency_conflict");
    assert.throws(() => apply(repo, { binding: binding("run-2") }), (error: unknown) =>
      error instanceof BindingConflictError && error.code === "idempotency_conflict");
  } finally { store.close(); }
});

test("receipts are scoped by actor", () => {
  const store = new Store(":memory:");
  try {
    const repo = new BindingRepository(store);
    observe(store);
    const ownerReceipt = apply(repo);
    const otherReceipt = apply(repo, { actor: "other", expectedVersion: ownerReceipt.version });
    assert.notDeepEqual(otherReceipt, ownerReceipt);
    assert.equal(repo.receipt("owner", id1)?.version, ownerReceipt.version);
    assert.equal(repo.receipt("other", id1)?.version, otherReceipt.version);
    assert.equal(repo.receipt("missing", id1), undefined);
  } finally { store.close(); }
});

test("binding history and receipts survive a file-backed Store restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "track-binding-repository-"));
  const path = join(dir, "store.sqlite");
  try {
    let store = new Store(path);
    const key = observe(store);
    const firstRepo = new BindingRepository(store);
    const receipt = apply(firstRepo);
    store.close();

    store = new Store(path);
    const restartedRepo = new BindingRepository(store);
    assert.deepEqual(restartedRepo.receipt("owner", id1), receipt);
    assert.equal(restartedRepo.currentVersion(key), receipt.version);
    assert.deepEqual(restartedRepo.history(key)[0], {
      version: receipt.version, binding: receipt.binding, actor: "owner", recordedAt: receipt.recordedAt,
    });
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("receipt write failure rolls back binding append and current Run binding", () => {
  const store = new Store(":memory:");
  try {
    const repo = new BindingRepository(store);
    const key = observe(store);
    store.db.exec(`CREATE TRIGGER fail_binding_receipt BEFORE INSERT ON binding_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END;`);
    assert.throws(() => apply(repo), /injected receipt failure/);
    assert.equal(repo.currentVersion(key), "0");
    assert.deepEqual(repo.history(key), []);
    assert.equal((store.run(key)?.binding ?? null), null);
    assert.equal(repo.receipt("owner", id1), undefined);
  } finally { store.close(); }
});

test("missing Runs are rejected with a typed error", () => {
  const store = new Store(":memory:");
  try {
    const repo = new BindingRepository(store);
    assert.throws(() => apply(repo), (error: unknown) =>
      error instanceof BindingConflictError && error.code === "run_not_found");
    assert.equal(externalKey("source-1", "run-1"), externalKey(binding().sourceId, binding().runId));
  } finally { store.close(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { backup } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexCollector, readCodexFile } from "../packages/adapters/codex/index.ts";
import { Store } from "../packages/storage/store.ts";
import { BindingRepository } from "../packages/bindings/repository.ts";

test("collector indexes actual turn metadata only under allowed repositories and replays idempotently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "track-collector-"));
  const file = join(dir, "rollout.jsonl");
  const t = new Date().toISOString();
  const rows = [
    { type: "session_meta", payload: { id: "session", cwd: join(dir, "repo"), base_instructions: "SECRET" } },
    { timestamp: t, type: "event_msg", payload: { type: "task_started", turn_id: "turn" } },
    { timestamp: t, type: "response_item", payload: { type: "custom_tool_call", call_id: "call", name: "shell", input: "SECRET" } },
    { timestamp: t, type: "response_item", payload: { type: "custom_tool_call_output", call_id: "call", output: "SECRET" } },
    { timestamp: t, type: "event_msg", payload: { type: "task_complete", turn_id: "turn", last_agent_message: "SECRET" } },
  ];
  const options = { sourceId: "codex", logRoot: dir, repositoryRoots: [dir], maxFiles: 10, sinceDays: 7 };
  const db = new Store(":memory:");
  try {
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const parsed = await readCodexFile(file, options);
    assert.equal(parsed[0]?.run.status, "succeeded"); assert.equal(parsed[0]?.events.length, 4);
    assert.doesNotMatch(JSON.stringify(parsed), /SECRET|input|output|instructions|last_agent_message/);
    assert.equal((await readCodexFile(file, { ...options, repositoryRoots: [join(dir, "other")] })).length, 0);
    const collector = new CodexCollector(db);
    await collector.collect(options); await collector.collect(options);
    assert.equal(db.db.prepare("SELECT count(*) AS total FROM events").get()?.total, 4);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("online backup restores journal, bindings, source cursors and pending command receipts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "track-backup-"));
  const db = new Store(join(dir, "source.sqlite"));
  try {
    const now = new Date().toISOString();
    const key = db.observeRun({ sourceId: "demian", runId: "run", sessionId: "session", workspaceId: null,
      title: "backup", status: "running", createdAt: now, startedAt: now, completedAt: null, observedAt: now });
    db.ingest({ sourceId: "demian", runId: "run", sequence: "1", type: "run.started", occurredAt: now, data: { redacted: true } });
    db.db.prepare("INSERT INTO receipts VALUES (?,?,?,?,?,?,?,?)").run("command", "actor", key, "digest", "unknown", null, now, now);
    const bindings = new BindingRepository(db);
    const bindingReceipt = bindings.apply({ actor: "actor", id: "11111111-1111-4111-8111-111111111111", requestDigest: "a".repeat(64), expectedVersion: "0",
      binding: { sourceId: "demian", runId: "run", projectSourceId: "projects", projectId: "project", taskId: "task", taskRevision: "1", projectTitle: "Project", taskTitle: "Task", provenance: "operator" } });
    await backup(db.db, join(dir, "backup.sqlite"));
    const restored = new Store(join(dir, "backup.sqlite"));
    try {
      assert.equal(restored.integrity(), "ok"); assert.equal(restored.cursor("demian", "run"), "1");
      assert.equal(restored.db.prepare("SELECT state FROM receipts WHERE key='command'").get()?.state, "unknown");
      assert.equal(restored.events(key).events.length, 1);
      const restoredBindings = new BindingRepository(restored);
      assert.deepEqual(restoredBindings.receipt("actor", bindingReceipt.id), bindingReceipt);
      assert.equal(restoredBindings.history(key).length, 1);
      assert.equal(JSON.parse(restored.run(key)!.binding!).taskRevision, "1");
    } finally { restored.close(); }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("retention preserves dedupe tombstones and cursor while marking archived history incomplete", () => {
  const db = new Store(":memory:");
  const now = "2026-10-01T00:00:00.000Z";
  const key = db.observeRun({ sourceId: "demian", runId: "run", sessionId: "session", workspaceId: null,
    title: "archive", status: "succeeded", createdAt: now, startedAt: now, completedAt: now, observedAt: now });
  const event = { sourceId: "demian", runId: "run", sequence: "1", type: "run.started", occurredAt: now, data: { redacted: true } };
  try {
    db.ingest(event);
    assert.equal(db.pruneBefore("2026-11-01T00:00:00.000Z").events, 1);
    assert.equal(db.events(key).events.length, 0);
    assert.equal(db.cursor("demian", "run"), "1");
    assert.equal(db.ingest(event), "duplicate");
    assert.throws(() => db.ingest({ ...event, type: "run.finished" }), /Conflicting/);
    const source = { id: "demian", kind: "demian" as const, label: "test", device: "test", state: "connected" as const, lastObservedAt: now, detail: "", capabilities: [] };
    assert.equal(db.snapshot("owner", [source]).runs[0]?.incomplete, true);
  } finally { db.close(); }
});

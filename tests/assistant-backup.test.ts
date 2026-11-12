import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, linkSync, lstatSync, mkdtempSync, openSync, readSync, realpathSync, rmSync, symlinkSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BackupError, measureDatabase, snapshotDatabase, sha256File, sealSnapshot, restoreSealedSnapshot } from "../packages/assistant-read/backup.ts";

const posix = { skip: typeof process.getuid !== "function" ? "POSIX UID/mode enforcement; Windows explicitly unsupported" : false };
const secret = "PRIVATE_BODY_한글_😀";
const maxBytes = 16 * 1024 ** 2;
function safeError(code?: string) {
  return (error: unknown) => {
    assert.ok(error instanceof BackupError);
    assert.match(error.message, /^(INVALID|PATH|BOUND|TIMEOUT|INTEGRITY|MISMATCH|IO|UNSUPPORTED)$/);
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes(secret));
    if (code) assert.equal(error.code, code);
    return true;
  };
}
function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "assistant-backup-test-"));
  chmodSync(root, 0o700);
  const identity = lstatSync(root);
  t.after(() => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("assistant-backup-test-"));
    assert.equal(realpathSync(target), target);
    const current = lstatSync(target);
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.ino, identity.ino); assert.equal(current.dev, identity.dev);
    rmSync(target, { recursive: true, force: true });
  });
  const source = join(root, "source.sqlite");
  const db = new DatabaseSync(source);
  db.exec('CREATE TABLE "odd""table" (id INTEGER PRIMARY KEY AUTOINCREMENT, i INTEGER, r REAL, b BLOB, n, s TEXT); CREATE TABLE duplicates (value TEXT);');
  const insert = db.prepare('INSERT INTO "odd""table" (i,r,b,n,s) VALUES (?,?,?,?,?)');
  insert.run(9223372036854775807n, 1.25, new Uint8Array([0, 255, 128]), null, secret);
  insert.run(-9223372036854775808n, -2.5, new Uint8Array(0), null, "é\u0000tail");
  db.prepare("INSERT INTO duplicates VALUES (?), (?)").run("same", "same");
  db.close(); chmodSync(source, 0o600);
  return { root, source, path: (name: string) => join(root, name) };
}

test("invalid input errors are static and native TS module imports without applications", async () => {
  assert.throws(() => measureDatabase("unused", { maxBytes: 8 * 1024 ** 3 + 1 }), safeError("BOUND"));
  await assert.rejects(sha256File("unused", -1), safeError("BOUND"));
  await assert.rejects(snapshotDatabase("unused", "unused", { maxBytes: 0 }), safeError("BOUND"));
  await assert.rejects(sealSnapshot("unused", "unused", new Uint8Array(31), { nonce: "a".repeat(32), database: "work" }), safeError("INVALID"));
  await assert.rejects(sealSnapshot("unused", "unused", new Uint8Array(32), { nonce: secret, database: "work" }), safeError("INVALID"));
});

test("Windows fails closed without POSIX ownership verification", { skip: typeof process.getuid === "function" }, () => {
  assert.throws(() => measureDatabase("unused"), safeError("UNSUPPORTED"));
});

test("snapshot preserves typed data, schema, duplicates, sqlite_sequence and source bytes", posix, async t => {
  const f = fixture(t); const before = await sha256File(f.source, maxBytes); const st = lstatSync(f.source);
  const measurement = measureDatabase(f.source);
  assert.equal(measurement.tables.find(table => table.name === "duplicates")?.rows, 2);
  assert.ok(measurement.tables.some(table => table.name === "sqlite_sequence"));
  assert.ok(!JSON.stringify(measurement).includes(secret));
  assert.deepEqual(measurement.integrity, { integrityCheck: true, foreignKeyCheck: true });
  const result = await snapshotDatabase(f.source, f.path("copy.sqlite"), { maxBytes });
  assert.equal(result.bytes, result.pages * result.pageSize);
  assert.equal(result.backup.backupCalls, 1); assert.equal(result.backup.heldReadTransaction, true);
  assert.equal(result.backup.sourceWrites, 0);
  assert.deepEqual(result.measurement, measurement);
  assert.equal(result.sha256, await sha256File(f.path("copy.sqlite"), maxBytes));
  assert.equal(await sha256File(f.source, maxBytes), before);
  assert.equal(lstatSync(f.source).ino, st.ino); assert.equal(lstatSync(f.source).mtimeMs, st.mtimeMs);
  assert.equal(lstatSync(f.path("copy.sqlite")).mode & 0o777, 0o600);
  const copy = new DatabaseSync(f.path("copy.sqlite"), { readOnly: true });
  try {
    const statement = copy.prepare('SELECT i,r,b,n,s FROM "odd""table" ORDER BY id');
    statement.setReadBigInts(true); statement.setReturnArrays(true);
    const values = statement.all();
    assert.deepEqual(values[0], [9223372036854775807n, 1.25, new Uint8Array([0, 255, 128]), null, secret]);
    assert.deepEqual(values[1], [-9223372036854775808n, -2.5, new Uint8Array(0), null, "é\u0000tail"]);
  } finally { copy.close(); }
});

test("row hashes ignore row order but retain duplicates and SQLite types", posix, t => {
  const f = fixture(t);
  const db = new DatabaseSync(f.source);
  db.exec("CREATE TABLE unordered (value); INSERT INTO unordered VALUES (1),(1.0),('1'),(x'31'),(NULL),(1)");
  db.close();
  const before = measureDatabase(f.source).tables.find(table => table.name === "unordered");
  const edit = new DatabaseSync(f.source);
  edit.exec("DELETE FROM unordered; INSERT INTO unordered VALUES (NULL),(x'31'),(1),('1'),(1.0),(1)");
  edit.close();
  assert.deepEqual(measureDatabase(f.source).tables.find(table => table.name === "unordered"), before);
  const remove = new DatabaseSync(f.source); remove.exec("DELETE FROM unordered WHERE rowid = 6"); remove.close();
  assert.notEqual(measureDatabase(f.source).tables.find(table => table.name === "unordered")?.sha256, before?.sha256);
});

test("virtual FTS and every shadow table are measured and copied", posix, async t => {
  const f = fixture(t); const db = new DatabaseSync(f.source);
  db.exec("CREATE VIRTUAL TABLE search USING fts5(body)"); db.prepare("INSERT INTO search VALUES (?)").run(secret); db.close();
  const before = measureDatabase(f.source);
  for (const name of ["search", "search_data", "search_idx", "search_content", "search_docsize", "search_config"]) {
    assert.ok(before.tables.some(table => table.name === name), name);
  }
  const result = await snapshotDatabase(f.source, f.path("fts.sqlite"), { maxBytes });
  assert.deepEqual(result.measurement, before);
});

test("exclusive destinations and source/destination link and private-parent safeguards", posix, async t => {
  const f = fixture(t);
  await assert.rejects(snapshotDatabase(f.source, f.source, { maxBytes }), safeError());
  linkSync(f.source, f.path("hard.sqlite"));
  assert.throws(() => measureDatabase(f.source), safeError("PATH"));
  // A separate fixture keeps the intentionally hardlinked source quarantined.
  const g = fixture(t); symlinkSync(g.source, g.path("link.sqlite"));
  assert.throws(() => measureDatabase(g.path("link.sqlite")), safeError("PATH"));
  await assert.rejects(snapshotDatabase(g.source, g.path("link.sqlite"), { maxBytes }), safeError());
  symlinkSync(g.root, g.path("parent-link"), "dir");
  await assert.rejects(snapshotDatabase(g.source, join(g.path("parent-link"), "dest.sqlite"), { maxBytes }), safeError("PATH"));
  chmodSync(g.root, 0o755);
  assert.throws(() => measureDatabase(g.source), safeError("PATH"));
  chmodSync(g.root, 0o700);
});

test("byte, row and dbstat payload preflights reject before destination creation", posix, async t => {
  const f = fixture(t);
  await assert.rejects(snapshotDatabase(f.source, f.path("small.sqlite"), { maxBytes: 1024 }), safeError("BOUND"));
  assert.equal(existsSync(f.path("small.sqlite")), false);
  await assert.rejects(snapshotDatabase(f.source, f.path("rows.sqlite"), { maxBytes, maxRowsPerTable: 1 }), safeError("BOUND"));
  assert.equal(existsSync(f.path("rows.sqlite")), false);
  const db = new DatabaseSync(f.source); db.exec("CREATE TABLE large (body BLOB); INSERT INTO large VALUES (zeroblob(1048576))"); db.close();
  await assert.rejects(snapshotDatabase(f.source, f.path("payload.sqlite"), { maxBytes, maxRowBytes: 1024 }), safeError("BOUND"));
  assert.equal(existsSync(f.path("payload.sqlite")), false);
  assert.throws(() => measureDatabase(f.source, { maxRowsPerTable: 5_000_001 }), safeError("BOUND"));
  assert.throws(() => measureDatabase(f.source, { maxRowBytes: 32 * 1024 ** 2 + 1 }), safeError("BOUND"));
});

test("streamed encryption roundtrip and authenticated metadata reject tampering", posix, async t => {
  const f = fixture(t); const key = randomBytes(32);
  await snapshotDatabase(f.source, f.path("plain.sqlite"), { maxBytes });
  const envelope = await sealSnapshot(f.path("plain.sqlite"), f.path("cipher"), key, { nonce: "b".repeat(32), database: "runtime" });
  assert.ok(!JSON.stringify(envelope).includes(secret));
  assert.ok(!JSON.stringify(envelope).includes(key.toString("hex")));
  assert.equal(envelope.cipherSha256, await sha256File(f.path("cipher"), maxBytes));
  assert.deepEqual(await restoreSealedSnapshot(f.path("cipher"), f.path("restored.sqlite"), key, envelope), envelope.measurement);
  assert.equal(await sha256File(f.path("restored.sqlite"), maxBytes), envelope.plainSha256);
  const second = await sealSnapshot(f.path("plain.sqlite"), f.path("cipher2"), key, { nonce: envelope.nonce, database: "runtime" });
  assert.notEqual(second.iv, envelope.iv);
  await assert.rejects(restoreSealedSnapshot(f.path("cipher"), f.path("restored.sqlite"), key, envelope), safeError());
  await assert.rejects(restoreSealedSnapshot(f.path("cipher"), f.path("wrong-key"), randomBytes(32), envelope), safeError());
  let index = 0;
  for (const patch of [
    { tag: "0".repeat(32) }, { nonce: "a".repeat(32) }, { database: "work" as const },
    { plainSha256: "0".repeat(64) }, { plainBytes: envelope.plainBytes - 1 },
    { cipherBytes: envelope.cipherBytes - 1 }, { cipherSha256: "0".repeat(64) },
    { measurementSha256: "0".repeat(64) }, { extra: secret },
  ]) {
    await assert.rejects(restoreSealedSnapshot(f.path("cipher"), f.path(`tamper-${index++}`), key, { ...envelope, ...patch }), safeError());
  }
  const changed = structuredClone(envelope); changed.measurement.tables[0]!.rows++;
  changed.measurementSha256 = createHash("sha256").update(JSON.stringify(changed.measurement)).digest("hex");
  await assert.rejects(restoreSealedSnapshot(f.path("cipher"), f.path("measurement-tamper"), key, changed), safeError());
  const fd = openSync(f.path("cipher"), "r+");
  try { const byte = Buffer.alloc(1); readSync(fd, byte, 0, 1, 0); byte[0] = byte[0]! ^ 1; writeSync(fd, byte, 0, 1, 0); }
  finally { closeSync(fd); }
  await assert.rejects(restoreSealedSnapshot(f.path("cipher"), f.path("cipher-tamper"), key, envelope), safeError("MISMATCH"));
  const rehashed = { ...envelope, cipherSha256: await sha256File(f.path("cipher"), maxBytes) };
  await assert.rejects(restoreSealedSnapshot(f.path("cipher"), f.path("cipher-tag-tamper"), key, rehashed), safeError());
});

test("multi-step backup reports bounded progress", posix, async t => {
  const f = fixture(t); const db = new DatabaseSync(f.source);
  db.exec("CREATE TABLE pages (value BLOB)");
  const insert = db.prepare("INSERT INTO pages VALUES (?)");
  for (let i = 0; i < 100; i++) insert.run(randomBytes(32 * 1024));
  db.close();
  const result = await snapshotDatabase(f.source, f.path("many-pages.sqlite"), { maxBytes });
  assert.ok(result.pages > 256); assert.ok(result.backup.progressSteps >= 1);
  assert.ok(result.backup.progressSteps <= Math.ceil(result.pages / 256) + 1);
});

test("held WAL read transaction preserves its snapshot across a concurrent writer commit", posix, async t => {
  const f = fixture(t);
  const writer = new DatabaseSync(f.source);
  try {
    writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE concurrent (value TEXT); INSERT INTO concurrent VALUES ('before')");
    const before = measureDatabase(f.source);
    // snapshotDatabase measures and pins its read transaction synchronously
    // before yielding to the native asynchronous backup call.
    const pending = snapshotDatabase(f.source, f.path("wal-copy.sqlite"), { maxBytes });
    writer.exec("UPDATE concurrent SET value='after'; INSERT INTO concurrent VALUES ('new')");
    const snapshot = await pending;
    assert.deepEqual(snapshot.measurement, before);
    assert.notDeepEqual(measureDatabase(f.source), before);
    const restored = new DatabaseSync(f.path("wal-copy.sqlite"), { readOnly: true });
    try {
      const rows = restored.prepare("SELECT value FROM concurrent").all();
      assert.equal(rows.length, 1); assert.equal(rows[0]!.value, "before");
    }
    finally { restored.close(); }
  } finally { writer.close(); }
});

test("envelope name and aggregate metadata limits reject before file access", async () => {
  const base = {
    version: 1 as const, purpose: "assistant-sqlite-backup" as const,
    nonce: "a".repeat(32), database: "work" as const, iv: "a".repeat(24), tag: "a".repeat(32),
    cipherBytes: 1, cipherSha256: "a".repeat(64), plainBytes: 4096, plainSha256: "a".repeat(64),
    measurementSha256: "a".repeat(64), measurement: { schemaSha256: "a".repeat(64),
      tables: [{ name: "한".repeat(342), rows: 0, sha256: "a".repeat(64) }],
      integrity: { integrityCheck: true as const, foreignKeyCheck: true as const } },
  };
  await assert.rejects(restoreSealedSnapshot("unused", "unused", new Uint8Array(32), base), safeError("INVALID"));
  // Less than 4 MiB of names, with JSON framing taking the envelope over budget.
  base.measurement.tables = Array.from({ length: 3800 }, (_, i) => ({
    name: String(i).padStart(4, "0") + "x".repeat(1020), rows: 0, sha256: "a".repeat(64),
  }));
  await assert.rejects(restoreSealedSnapshot("unused", "unused", new Uint8Array(32), base), safeError("BOUND"));
});

test("producer rejects oversized table names and generated row payloads", posix, t => {
  const f = fixture(t); const db = new DatabaseSync(f.source);
  db.exec(`CREATE TABLE "${"x".repeat(1025)}" (value)`); db.close();
  assert.throws(() => measureDatabase(f.source), safeError("BOUND"));
  const g = fixture(t); const generated = new DatabaseSync(g.source);
  generated.exec("CREATE TABLE generated (value TEXT, expanded TEXT GENERATED ALWAYS AS (value || value || value || value)); INSERT INTO generated(value) VALUES (printf('%01000d',1))");
  generated.close();
  assert.throws(() => measureDatabase(g.source, { maxRowBytes: 3000 }), safeError("BOUND"));
});

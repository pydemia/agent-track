import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync,
  linkSync, symlinkSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupTrackDatabase, trackDatabaseFingerprint } from '../deploy/track/sqlite-preservation.mjs';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'track-preservation-test-'));
  const source = join(directory, 'source.sqlite');
  const destination = join(directory, 'snapshot.sqlite');
  const db = new DatabaseSync(source);
  t.after(() => {
    if (db.isOpen) db.close();
    assert.equal(join(tmpdir(), directory.split(/[\\/]/).at(-1)!), directory);
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE "odd"" table" (id INTEGER PRIMARY KEY AUTOINCREMENT, value, payload BLOB);
    CREATE INDEX value_index ON "odd"" table"(value);
    CREATE VIEW sample_view AS SELECT value FROM "odd"" table";
    CREATE TRIGGER sample_trigger AFTER UPDATE ON "odd"" table" BEGIN SELECT 1; END;
    CREATE TABLE duplicates (value COLLATE NOCASE, second);
    CREATE TABLE keyed (key TEXT PRIMARY KEY, value INTEGER,
      calculated INTEGER GENERATED ALWAYS AS (value * 2) STORED) WITHOUT ROWID;
    INSERT INTO keyed(key,value) VALUES ('z', 4), ('a', 2);
    CREATE TABLE empty_table(value);
    INSERT INTO duplicates VALUES ('a', 1), ('A', 1), ('a', 1), (1, NULL), (1.0, NULL);
  `);
  const insert = db.prepare('INSERT INTO "odd"" table"(value,payload) VALUES (?,?)');
  insert.run(9223372036854775807n, Buffer.from([0, 255, 128, 0]));
  insert.run(-9223372036854775808n, Buffer.alloc(0));
  insert.run('embedded\0text', null);
  db.exec(`INSERT INTO "odd"" table"(id,value) VALUES (100,'deleted');
    DELETE FROM "odd"" table" WHERE id=100;`);
  return { directory, source, destination, db };
}

test('WAL backup preserves schema, sequence, duplicate rows and exact typed values', async (t) => {
  const { directory, source, destination, db } = fixture(t);
  const before = trackDatabaseFingerprint(db);
  assert.equal(before.tables.find((table) => table.name === 'duplicates')?.count, 5);
  assert.equal(before.tables.find((table) => table.name === 'empty_table')?.count, 0);
  const sourceBytes = readFileSync(source);
  const walBytes = readFileSync(`${source}-wal`);
  const result = await backupTrackDatabase(source, destination);
  assert.deepEqual(result.fingerprint, before);
  assert.equal(result.integrityVerified, true);
  assert.equal(result.backupBytes, statSync(destination).size);
  assert.deepEqual(readFileSync(source), sourceBytes);
  assert.deepEqual(readFileSync(`${source}-wal`), walBytes);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.deepEqual(trackDatabaseFingerprint(copy), before);
    const query = copy.prepare('SELECT value,payload FROM "odd"" table" ORDER BY id');
    query.setReadBigInts(true);
    const rows = query.all();
    assert.equal(rows[0]?.value, 9223372036854775807n);
    assert.deepEqual(rows[0]?.payload, new Uint8Array([0, 255, 128, 0]));
    assert.equal(rows[1]?.value, -9223372036854775808n);
    assert.equal(copy.prepare('SELECT seq FROM sqlite_sequence').get()?.seq, 100);
  } finally { copy.close(); }
  assert.equal(readdirSync(directory).some((name) => name.startsWith('.track-sqlite-')), false);
});

test('sequence-only and duplicate multiplicity changes alter the logical fingerprint', (t) => {
  const { db } = fixture(t);
  const before = trackDatabaseFingerprint(db);
  db.exec('UPDATE sqlite_sequence SET seq=101');
  const sequenceChanged = trackDatabaseFingerprint(db);
  assert.equal(sequenceChanged.schemaSha256, before.schemaSha256);
  assert.notEqual(sequenceChanged.sha256, before.sha256);
  assert.notEqual(sequenceChanged.tables.find((table) => table.name === 'sqlite_sequence')?.sha256,
    before.tables.find((table) => table.name === 'sqlite_sequence')?.sha256);
  db.exec("INSERT INTO duplicates VALUES ('a',1)");
  const duplicatesChanged = trackDatabaseFingerprint(db);
  assert.equal(duplicatesChanged.tables.find((table) => table.name === 'duplicates')?.count, 6);
  assert.notEqual(duplicatesChanged.sha256, sequenceChanged.sha256);
});

test('fingerprint is deterministic across insertion order, ignores rootpage, detects types and schema', () => {
  const a = new DatabaseSync(':memory:');
  const b = new DatabaseSync(':memory:');
  try {
    a.exec('CREATE TABLE x(v COLLATE NOCASE);');
    b.exec('CREATE TABLE padding(v); CREATE TABLE x(v COLLATE NOCASE); DROP TABLE padding;');
    a.exec("INSERT INTO x VALUES ('a'),('A'),('a'),(1),(1.0),(x'00ff'),(NULL);");
    b.exec("INSERT INTO x VALUES (NULL),(x'00ff'),(1.0),(1),('a'),('A'),('a');");
    assert.notEqual(a.prepare("SELECT rootpage FROM sqlite_schema WHERE name='x'").get()?.rootpage,
      b.prepare("SELECT rootpage FROM sqlite_schema WHERE name='x'").get()?.rootpage);
    assert.deepEqual(trackDatabaseFingerprint(a), trackDatabaseFingerprint(b));
    const before = trackDatabaseFingerprint(a);
    a.exec("DELETE FROM x WHERE rowid=(SELECT min(rowid) FROM x WHERE typeof(v)='integer'); INSERT INTO x VALUES (1.0);");
    assert.notEqual(trackDatabaseFingerprint(a).sha256, before.sha256);
    assert.equal(trackDatabaseFingerprint(a).schemaSha256, before.schemaSha256);
    b.exec('CREATE INDEX ix ON x(v)');
    assert.notEqual(trackDatabaseFingerprint(b).schemaSha256, before.schemaSha256);
    b.exec("INSERT INTO x VALUES (CAST(x'80' AS TEXT)),(CAST(x'81' AS TEXT));");
    const malformed = trackDatabaseFingerprint(b);
    b.exec("UPDATE x SET v=CAST(x'82' AS TEXT) WHERE CAST(v AS BLOB)=x'81';");
    assert.notEqual(trackDatabaseFingerprint(b).sha256, malformed.sha256);
  } finally { a.close(); b.close(); }
});

test('concurrent WAL writes cannot produce partial or newer snapshot success', async (t) => {
  const { source, destination, db } = fixture(t);
  db.exec('CREATE TABLE large(v BLOB); BEGIN;');
  const insert = db.prepare('INSERT INTO large VALUES (?)');
  for (let i = 0; i < 500; i++) insert.run(Buffer.alloc(8192, i % 256));
  db.exec('COMMIT');
  const before = trackDatabaseFingerprint(db);
  const pending = backupTrackDatabase(source, destination);
  // The async helper has already pinned and fingerprinted its snapshot here.
  db.exec("BEGIN; UPDATE large SET v=x'01'; CREATE TABLE after_snapshot(v); COMMIT;");
  assert.notEqual(trackDatabaseFingerprint(db).sha256, before.sha256);
  const result = await pending;
  assert.deepEqual(result.fingerprint, before);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try { assert.deepEqual(trackDatabaseFingerprint(copy), before); }
  finally { copy.close(); }
});

test('existing target, same path and source hardlink are preserved', async (t) => {
  const { source, destination, db } = fixture(t);
  const before = trackDatabaseFingerprint(db);
  writeFileSync(destination, 'foreign data');
  await assert.rejects(backupTrackDatabase(source, destination), /absent/);
  assert.equal(readFileSync(destination, 'utf8'), 'foreign data');
  await assert.rejects(backupTrackDatabase(source, source), /absent/);
  const alias = `${source}.alias`;
  linkSync(source, alias);
  await assert.rejects(backupTrackDatabase(source, alias), /absent/);
  assert.deepEqual(trackDatabaseFingerprint(db), before);
});

test('symlink parent and destination are rejected without touching foreign files', async (t) => {
  const { directory, source, destination } = fixture(t);
  const foreign = join(directory, 'foreign');
  mkdirSync(foreign);
  writeFileSync(join(foreign, 'keep'), 'preserve');
  const alias = join(directory, 'alias');
  // Windows junctions require no symlink privilege and are reported as links.
  symlinkSync(foreign, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(backupTrackDatabase(source, join(alias, 'new.sqlite')), /links/);
  symlinkSync(foreign, destination, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(backupTrackDatabase(source, destination), /absent/);
  assert.deepEqual(readdirSync(foreign), ['keep']);
  assert.equal(readFileSync(join(foreign, 'keep'), 'utf8'), 'preserve');
});

test('readonly source stays byte-identical; invalid database cleans staging', async (t) => {
  const { directory, source, destination, db } = fixture(t);
  db.close();
  const before = readFileSync(source);
  chmodSync(source, 0o444);
  try {
    await backupTrackDatabase(source, destination);
    assert.deepEqual(readFileSync(source), before);
  } finally { chmodSync(source, 0o600); }
  const invalid = join(directory, 'invalid.sqlite');
  writeFileSync(invalid, 'not a database');
  const files = readdirSync(directory).sort();
  await assert.rejects(backupTrackDatabase(invalid, join(directory, 'failed.sqlite')));
  assert.deepEqual(readdirSync(directory).sort(), files);
  assert.equal(readFileSync(invalid, 'utf8'), 'not a database');
  await assert.rejects(backupTrackDatabase(directory, join(directory, 'failed.sqlite')), /regular file/);
});

test('a foreign destination appearing during backup is never overwritten or cleaned', async (t) => {
  const { directory, source, destination } = fixture(t);
  const pending = backupTrackDatabase(source, destination);
  writeFileSync(destination, 'racing foreign owner', { flag: 'wx' });
  await assert.rejects(pending);
  assert.equal(readFileSync(destination, 'utf8'), 'racing foreign owner');
  assert.equal(readdirSync(directory).some((name) => name.startsWith('.track-sqlite-')), false);
});

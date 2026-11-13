import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../packages/storage/store.ts';
import { FlowViewRepository } from '../packages/storage/flow-views.ts';
import { backupTrackDatabase } from '../deploy/track/sqlite-preservation.mjs';
import { assertTrackHistoryPreserved, trackPendingCommands, trackRuntimeOperationSources, validateTrackRuntimePlan } from '../deploy/track/runtime-operation.mjs';

const sha = 'a'.repeat(64);
function plan() {
  const state = join(realpathSync(tmpdir()), 'track-state');
  const repository = join(realpathSync(tmpdir()), 'track-repo');
  const operationId = '00000000-0000-0000-0000-000000000001';
  const operationDir = join(state, 'operations', operationId);
  return { version: 1, operationId, scope: 'track-product-14345', state, repository, operationDir,
    baselineFile: join(operationDir, 'baseline.json'), baselineSha256: sha,
    releasesFile: join(repository, '.runtime/source-availability/track-frozen-runtimes.json'), releasesSha256: sha,
    qaFile: join(repository, '.runtime/source-availability/track-runtime-cold-qa.json'), qaSha256: sha,
    sources: Object.fromEntries(trackRuntimeOperationSources.map(path => [path, sha])) };
}
test('activation plan binds exactly the known source, evidence, scope and private roots', () => {
  const good = plan();
  assert.equal(validateTrackRuntimePlan(good, good), good);
  const invalid = [
    { ...good, extra: true }, { ...good, scope: 'native-demian' }, { ...good, version: 2 },
    { ...good, state: join(good.state, 'other') }, { ...good, repository: '.' },
    { ...good, operationId: '../escape' }, { ...good, operationDir: join(good.state, 'other') },
    { ...good, baselineFile: good.releasesFile }, { ...good, releasesFile: good.qaFile },
    { ...good, qaSha256: sha + '\n' }, { ...good, baselineSha256: sha.toUpperCase() },
    { ...good, sources: { ...good.sources, '../unexpected': sha } },
    { ...good, sources: {} }, { ...good, sources: { ...good.sources, [trackRuntimeOperationSources[0]!]: 'bad' } },
  ];
  for (const bad of invalid) assert.throws(() => validateTrackRuntimePlan(bad, good));
});

async function history(t: TestContext) {
  const root = realpathSync(tmpdir());
  const dir = mkdtempSync(join(root, 'track-runtime-history-'));
  const path = join(dir, 'current.sqlite');
  const backup = join(dir, 'baseline.sqlite');
  const store = new Store(path);
  const db = store.db;
  t.after(() => { if (db.isOpen) store.close(); assert(!relative(root, dir).startsWith('..')); rmSync(dir, { recursive: true, force: true }); });
  db.prepare('INSERT INTO runs(key,source_id,run_id,observation,cursor,high_water) VALUES(?,?,?,?,?,?)')
    .run('run-key', 'source', 'run', JSON.stringify({ sessionId: 'session', status: 'running' }), '9', '10');
  db.exec("INSERT INTO events(run_key,sequence,digest,payload,received_at) VALUES('run-key','9','digest','immutable event','time');");
  db.exec("INSERT INTO receipts VALUES('receipt','owner','run-key','digest','succeeded','result','time','time');");
  db.exec("INSERT INTO metadata VALUES('message_cursor:source/session','9'),('source_identity:source','fingerprint');");
  db.exec("INSERT INTO bindings(run_key,payload,actor,bound_at) VALUES('run-key','baseline binding','owner','time'); UPDATE runs SET binding='baseline binding';");
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => String(row.name));
  await backupTrackDatabase(path, backup);
  return { db, path, backup, tables, check: (allowSaved = false) => assertTrackHistoryPreserved(path, backup, tables, allowSaved) };
}
test('preservation accepts new observations and events while preserving the snapshot history', async t => {
  const f = await history(t);
  f.check();
  f.db.exec("UPDATE runs SET cursor='10', high_water='11', observation='{\"sessionId\":\"session\",\"status\":\"succeeded\"}';");
  f.db.exec("INSERT INTO events(run_key,sequence,digest,payload,received_at) VALUES('run-key','10','next','new event','time');");
  f.db.exec("UPDATE metadata SET value='10' WHERE key='message_cursor:source/session'");
  f.db.exec("INSERT INTO bindings(run_key,payload,actor,bound_at) VALUES('run-key','new binding','owner','later'); UPDATE runs SET binding='new binding';");
  f.check();
  new FlowViewRepository(f.db);
  assert.throws(() => f.check());
  f.check(true);
});
for (const [name, sql] of [
  ['deleted event', 'DELETE FROM events'],
  ['changed event', "UPDATE events SET payload='rewritten'"],
  ['changed terminal command receipt', "UPDATE receipts SET result='changed'"],
  ['session identity missing', "UPDATE runs SET observation='{}'"],
  ['session identity changed', "UPDATE runs SET observation='{\"sessionId\":\"other\"}'"],
  ['run source changed', "UPDATE runs SET source_id='other'"],
  ['cursor regressed across decimal width', "UPDATE runs SET cursor='8'"],
  ['high-water regressed', "UPDATE runs SET high_water='9'"],
  ['cursor malformed', "UPDATE runs SET cursor='x'"],
  ['cursor noncanonical', "UPDATE runs SET cursor='010'"],
  ['cursor outside int64', "UPDATE runs SET cursor='9223372036854775808'"],
  ['discovery cursor regressed', "UPDATE metadata SET value='8' WHERE key='message_cursor:source/session'"],
  ['discovery cursor malformed', "UPDATE metadata SET value='x' WHERE key='message_cursor:source/session'"],
  ['source identity changed', "UPDATE metadata SET value='changed' WHERE key='source_identity:source'"],
  ['effective binding cleared', 'UPDATE runs SET binding=NULL'],
  ['effective binding changed without history', "UPDATE runs SET binding='unrecorded'"],
  ['retention state changed', 'UPDATE runs SET history_pruned=1'],
  ['sequence regressed', "UPDATE sqlite_sequence SET seq=0 WHERE name='events'"],
  ['unexpected table', 'CREATE TABLE unexpected(id TEXT PRIMARY KEY)'],
  ['existing schema changed', 'DROP INDEX events_run'],
] as const) test(`preservation rejects ${name}`, async t => {
  const f = await history(t); f.db.exec(sql); assert.throws(() => f.check(true));
});
test('preservation compares exact bytes and SQLite types for immutable rows', async t => {
  const f = await history(t);
  f.db.exec("UPDATE events SET payload=CAST('immutable event' AS BLOB)");
  assert.throws(() => f.check());
});
test('accepted task assignments are delivered, accepted cancellation receipts remain pending', t => {
  const root = realpathSync(tmpdir()), dir = mkdtempSync(join(root, 'track-pending-'));
  const path = join(dir, 'commands.sqlite'); const db = new DatabaseSync(path);
  t.after(() => { db.close(); assert(!relative(root, dir).startsWith('..')); rmSync(dir, { recursive: true, force: true }); });
  db.exec(`CREATE TABLE receipts(state TEXT); CREATE TABLE task_creation_receipts(state TEXT);
    CREATE TABLE task_assignment_receipts(state TEXT); CREATE TABLE approval_receipts(payload TEXT);
    INSERT INTO receipts VALUES('accepted'),('succeeded');
    INSERT INTO task_creation_receipts VALUES('dispatching'),('created');
    INSERT INTO task_assignment_receipts VALUES('accepted'),('requested');
    INSERT INTO approval_receipts VALUES('{"receipt":{"state":"accepted"}}'),('{"receipt":{"state":"dispatching"}}');`);
  assert.deepEqual(trackPendingCommands(path), { receipts: 1, task_creation_receipts: 1, task_assignment_receipts: 1, approval_receipts: 1 });
  db.exec("DELETE FROM receipts WHERE state='accepted'; DELETE FROM task_creation_receipts WHERE state='dispatching'; DELETE FROM task_assignment_receipts WHERE state='requested'; DELETE FROM approval_receipts WHERE json_extract(payload,'$.receipt.state')='dispatching'");
  assert.deepEqual(trackPendingCommands(path), { receipts: 0, task_creation_receipts: 0, task_assignment_receipts: 0, approval_receipts: 0 });
});

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile, open, realpath, lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve, dirname, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {promisify, isDeepStrictEqual} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {verifyRuntimeRelease} from './runtime-release.mjs';
import {trackDatabaseFingerprint} from './sqlite-preservation.mjs';
import {inspectApiProcess, apiListeners} from '../demian/windows-api-process.mjs';
import {inspectOwnedWeb, stopOwnedWeb} from '../demian/windows-web-process.mjs';
import {nativeWebDatabaseState,assertNativeWebDatabasePreserved} from '../demian/native-web-database.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const state = join(homedir(), '.local/share/agent-track');
const exec = promisify(execFile), hash = b => createHash('sha256').update(b).digest('hex');
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && isAbsolute(a) && isAbsolute(b) && relative(resolve(a), resolve(b)) === '';
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && value.length === 64;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value) && value.length === 36;
// Explicit, additive command-journal policy. A pinned v2 cold proof must opt in.
export const trackCommandSchemaObjects = Object.freeze([
  {type: 'table', name: 'coordinator_command_intents', tbl_name: 'coordinator_command_intents', sql: `CREATE TABLE coordinator_command_intents (
      actor TEXT NOT NULL, id TEXT NOT NULL, run_key TEXT NOT NULL, digest TEXT NOT NULL,
      assistant_source TEXT NOT NULL, execution_id TEXT NOT NULL, role_id TEXT NOT NULL,
      private_json TEXT NOT NULL, receipt_json TEXT, state TEXT NOT NULL, detail TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(actor,id))`},
  {type: 'index', name: 'coordinator_command_unresolved', tbl_name: 'coordinator_command_intents', sql: `CREATE UNIQUE INDEX coordinator_command_unresolved
      ON coordinator_command_intents(actor,assistant_source,execution_id,role_id)
      WHERE state IN ('prepared','dispatching','unknown')`},
  {type: 'index', name: 'sqlite_autoindex_coordinator_command_intents_1', tbl_name: 'coordinator_command_intents', sql: null},
  {type: 'index', name: 'sqlite_autoindex_successor_intents_1', tbl_name: 'successor_intents', sql: null},
  {type: 'table', name: 'successor_intents', tbl_name: 'successor_intents', sql: `CREATE TABLE successor_intents (
      actor TEXT NOT NULL, id TEXT NOT NULL, run_key TEXT NOT NULL, digest TEXT NOT NULL,
      state TEXT NOT NULL, detail TEXT NOT NULL, private_json TEXT NOT NULL, input_json TEXT,
      receipt_json TEXT, observed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(actor,id))`},
  {type: 'index', name: 'successor_unresolved', tbl_name: 'successor_intents', sql: `CREATE UNIQUE INDEX successor_unresolved ON successor_intents(actor,run_key)
      WHERE state IN ('prepared','dispatching','unknown')`},
].map(Object.freeze));
export const trackRuntimeOperationSources = Object.freeze([
  'scripts/Start-Track.ps1', 'scripts/Restart-Track.ps1', 'deploy/track/runtime-release.mjs',
  'deploy/track/runtime-operation.mjs', 'deploy/track/activate-runtime.ps1', 'deploy/track/sqlite-preservation.mjs',
  'deploy/demian/windows-api-process.mjs', 'deploy/demian/windows-web-process.mjs',
  'deploy/demian/write-exclusive.ps1', 'deploy/demian/native-web-database.mjs',
]);
export function validateTrackRuntimePlan(value, {state: expectedState, repository: expectedRepository}) {
  assert(value && Object.keys(value).sort().join() === ['version','operationId','scope','state','repository','operationDir','baselineFile','baselineSha256','releasesFile','releasesSha256','qaFile','qaSha256','sources'].sort().join());
  assert(value && [1, 2].includes(value.version) && uuid(value.operationId) && value.scope === 'track-product-14345');
  assert(samePath(value.state, expectedState) && samePath(value.repository, expectedRepository));
  const operation = join(expectedState, 'operations', value.operationId);
  assert(samePath(value.operationDir, operation) && samePath(value.baselineFile, join(operation, 'baseline.json')) && sha(value.baselineSha256));
  assert(samePath(value.releasesFile, value.version === 2 ? join(operation, 'releases.json') : join(expectedRepository, '.runtime/source-availability/track-frozen-runtimes.json')) && sha(value.releasesSha256));
  assert(samePath(value.qaFile, value.version === 2 ? join(operation, 'cold-qa.json') : join(expectedRepository, '.runtime/source-availability/track-runtime-cold-qa.json')) && sha(value.qaSha256));
  assert(value.sources && Object.keys(value.sources).sort().join() === [...trackRuntimeOperationSources].sort().join() && Object.values(value.sources).every(sha));
  return value;
}
export function trackRuntimePointerPrecondition(baseline) {
  assert([1, 2].includes(baseline.version));
  if (baseline.version === 1) { assert(!Object.hasOwn(baseline, 'pointerBeforeSha256')); return null; }
  assert(sha(baseline.pointerBeforeSha256)); return baseline.pointerBeforeSha256;
}
export function validateTrackUpgradeBaseline(baseline, pointerBytes, receiptBytes, rollback) {
  assert(baseline.version === 2 && sha(baseline.pointerBeforeSha256) && sha(baseline.receiptBeforeSha256));
  assert.equal(hash(pointerBytes), baseline.pointerBeforeSha256); assert.equal(hash(receiptBytes), baseline.receiptBeforeSha256);
  const before = JSON.parse(pointerBytes.toString('utf8')), receipt = JSON.parse(receiptBytes.toString('utf8'));
  assert.deepEqual(Object.keys(before).sort(), ['manifestSha256', 'releaseDir', 'version']);
  assert(before.version === 1 && samePath(before.releaseDir, rollback.releaseDir) && sha(before.manifestSha256) && before.manifestSha256 === rollback.manifestSha256);
  assert(receipt.runtime.mode === 'frozen' && samePath(receipt.runtime.cwd, rollback.releaseDir) &&
    samePath(receipt.runtime.entry, join(rollback.releaseDir, 'apps/api/main.ts')) && receipt.runtime.manifestSha256 === rollback.manifestSha256);
  // Current frozen receipts pin the closed manifest rather than repeating its revisions.
  for (const key of ['apiRevision', 'webRevision']) {
    if (Object.hasOwn(receipt.runtime, key)) assert.equal(receipt.runtime[key], rollback[key]);
    if (Object.hasOwn(receipt, key)) assert.equal(receipt[key], rollback[key]);
  }
  assert.deepEqual(Object.fromEntries(['pid', 'name', 'executable', 'created', 'command'].map(key => [key, receipt[key]])), baseline.roles.track);
  return true;
}
export function assertTrackColdProof(qa, name, version, webFileCount, expectedManifestSha256) {
  assert([1, 2].includes(version) && ['candidate', 'rollback'].includes(name));
  assert(Number.isSafeInteger(webFileCount) && webFileCount > 0 && webFileCount <= 20000);
  assert(qa.fixtureOnly === true && qa.sourceDatabaseRestored === false && qa.originalApiRestarted === false && qa.sourceOrModelRequests === 0);
  const q = qa.releases[name];
  assert(q.verified === true && q.childStopped === true && q.portReleased === true && q.allLegacyTablesAndSchemaPreserved === true && q.webFilesBytesAndMimeMatched === webFileCount);
  assert.equal(q.savedViewStatus, version === 2 || name === 'candidate' ? 200 : 404);
  if (version === 2) assert(sha(expectedManifestSha256) && q.manifestSha256 === expectedManifestSha256);
  if (Object.hasOwn(qa, 'commandSchemaVersion') || Object.hasOwn(qa, 'commandSchemaObjects')) {
    assert(version === 2 && qa.commandSchemaVersion === 1);
    assert.deepEqual(qa.commandSchemaObjects, trackCommandSchemaObjects);
    assert(q.commandSchemaExact === true && q.commandTablesEmpty === true);
    if (name === 'rollback') assert(q.retainedCandidateSchema === true);
  }
  return true;
}
async function bytes(path, limit = 4 * 1024 * 1024) {
  const stat = await lstat(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= limit);
  assert(samePath(await realpath(path), path)); return readFile(path);
}
async function digest(path) { try { return hash(await bytes(path, 128 * 1024 * 1024)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
const load = async path => JSON.parse((await bytes(path)).toString('utf8'));
async function saveNew(path, value) { const handle = await open(path, 'wx'); try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); } }
async function journal(p, stage, details) { const file = await open(join(p.operationDir, 'journal.jsonl'), 'a'); try { await file.writeFile(JSON.stringify({at: new Date().toISOString(), stage, ...(details ? {details} : {})}) + '\n'); await file.sync(); } finally { await file.close(); } }
export function trackPendingCommands(database) {
  const db = new DatabaseSync(database, {readOnly: true});
  try {
    const result = {};
    for (const name of ['receipts', 'task_creation_receipts', 'task_assignment_receipts']) {
      const states = name === 'receipts' ? ['requested', 'dispatching', 'accepted'] : ['requested', 'dispatching'];
      result[name] = db.prepare(`SELECT count(*) AS n FROM ${name} WHERE state IN (${states.map(() => '?').join(',')})`).get(...states).n;
    }
    result.approval_receipts = db.prepare('SELECT payload FROM approval_receipts').all().filter(row => ['requested', 'dispatching'].includes(JSON.parse(row.payload).receipt?.state)).length;
    for (const name of ['successor_intents', 'coordinator_command_intents']) {
      if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)) {
        // Prepared reviews have no remote effect; maintenance revokes dispatch.
        // Unknown rows retain same-ID recovery across restart and never resend.
        result[name] = db.prepare(`SELECT count(*) AS n FROM ${name} WHERE state='dispatching'`).get().n;
      }
    }
    return result;
  } finally { db.close(); }
}
const pending = trackPendingCommands;
async function inputs(inputFile, inputSha, recovery = false) {
  assert(sha(inputSha)); const raw = await bytes(inputFile); assert.equal(hash(raw), inputSha);
  const p = validateTrackRuntimePlan(JSON.parse(raw.toString('utf8')), {state, repository});
  assert(samePath(await realpath(state), state) && samePath(await realpath(p.operationDir), p.operationDir));
  assert.equal((await bytes(join(p.operationDir, 'purpose'))).toString(), `agent-track-frozen-runtime-operation-v${p.version}\n`);
  for (const [path, expected] of Object.entries(p.sources)) assert.equal(await digest(join(repository, path)), expected);
  for (const [file, expected] of [[p.baselineFile, p.baselineSha256], [p.releasesFile, p.releasesSha256], [p.qaFile, p.qaSha256]]) assert.equal(await digest(file), expected);
  const baseline = await load(p.baselineFile), releases = await load(p.releasesFile), qa = await load(p.qaFile);
  assert(baseline.version === p.version && baseline.operationId === p.operationId && samePath(baseline.operationDir, p.operationDir) && samePath(baseline.state, state) && samePath(baseline.repository, repository));
  assert(samePath(baseline.configFile, join(state, 'track-product.config.json')) && samePath(baseline.pointerFile, join(state, 'track-runtime.json')) && samePath(baseline.receiptFile, join(state, 'track-product-process.json')));
  assert(samePath(baseline.backup.file, join(p.operationDir, 'backup.sqlite')) && sha(baseline.backup.sha256));
  assert.equal(await digest(join(p.operationDir, 'config.before.json')), baseline.configBeforeSha256);
  assert.equal(await digest(join(p.operationDir, 'config.maintenance.json')), baseline.configMaintenanceSha256);
  const original = await load(join(p.operationDir, 'config.before.json')), maintenance = await load(join(p.operationDir, 'config.maintenance.json'));
  assert(original.auth.mode === 'proxy' && original.auth.users.length === 1 && original.port === 14345);
  const expected = structuredClone(original);
  for (const source of expected.sources) for (const key of ['cancelUsers', 'approvalUsers', 'assignmentUsers', 'taskCreateUsers', 'runCommandUsers', 'assistantCommandUsers']) if (Object.hasOwn(source, key)) source[key] = [];
  assert.deepEqual(maintenance, expected);
  if (p.version === 2) {
    assert(releases.operationId === p.operationId && qa.operationId === p.operationId && qa.backupSha256 === baseline.backup.sha256);
    validateTrackUpgradeBaseline(baseline, await bytes(join(p.operationDir, 'pointer.before.json')), await bytes(join(p.operationDir, 'receipt.before.json')), releases.releases.rollback);
  }
  for (const name of ['candidate', 'rollback']) {
    const r = releases.releases[name];
    assert(samePath(dirname(r.releaseDir), join(state, 'releases')) && sha(r.manifestSha256));
    const webFileCount = recovery ? qa.releases[name].webFilesBytesAndMimeMatched :
      Object.keys((await verifyRuntimeRelease(r.releaseDir, r.manifestSha256)).manifest.files).filter(path => path.startsWith('dist/web/')).length;
    assertTrackColdProof(qa, name, p.version, webFileCount, r.manifestSha256);
  }
  return {p, b: baseline, releases: releases.releases, original, maintenance, inputSha,
    allowCommandTables: qa.commandSchemaVersion === 1};
}
async function driver(c) {
  const owner = await load(join(c.p.operationDir, 'driver.json'));
  assert(owner.pid === process.ppid && isDeepStrictEqual(await inspectApiProcess(process.ppid), owner));
}
async function guardedWrite(c, kind, data, before) {
  const target = kind === 'config' ? c.b.configFile : kind === 'pointer' ? c.b.pointerFile : undefined; assert(target);
  const current = await digest(target), after = hash(data); if (current === after) return;
  assert(before.includes(current)); const payload = join(c.p.operationDir, 'payload-' + randomUUID()); await saveNew(payload, data);
  await journal(c.p, 'write-intent', {kind, before: current, after});
  const writer = join(repository, 'deploy/demian/write-exclusive.ps1'); assert.equal(await digest(writer), c.p.sources['deploy/demian/write-exclusive.ps1']);
  try { await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', writer, '-Target', target, '-Payload', payload, ...(current === null ? ['-ExpectedMissing'] : ['-ExpectedSha256', current])], {windowsHide: true, maxBuffer: 1048576}); }
  catch { if (await digest(target) !== after) throw new Error('Conditional metadata write failed'); }
  assert.equal(await digest(target), after); await journal(c.p, 'write-confirmed', {kind, sha256: after});
}
async function pointer(c, name) {
  if (c.b.version === 2 && name === 'rollback') return bytes(join(c.p.operationDir, 'pointer.before.json'));
  const r = c.releases[name]; return Buffer.from(JSON.stringify({version: 1, releaseDir: r.releaseDir, manifestSha256: r.manifestSha256}, null, 2) + '\n');
}
export function assertTrackRecoveryState(baseline, pointerSha256, configSha256, candidatePointerSha256) {
  assert(sha(candidatePointerSha256) && sha(baseline.configBeforeSha256) && sha(baseline.configMaintenanceSha256));
  assert([trackRuntimePointerPrecondition(baseline), candidatePointerSha256].includes(pointerSha256));
  assert([baseline.configBeforeSha256, baseline.configMaintenanceSha256].includes(configSha256));
  return true;
}
async function recoveryState(c) {
  assertTrackRecoveryState(c.b, await digest(c.b.pointerFile), await digest(c.b.configFile), hash(await pointer(c, 'candidate')));
}
async function filesPreserved(c) {
  for (const [path, expected] of Object.entries(c.b.files)) {
    if (samePath(path, c.b.configFile) || samePath(path, join(state, 'track-product.pid'))) continue;
    if (c.b.version === 2 && (samePath(path, c.b.pointerFile) || samePath(path, c.b.receiptFile))) continue;
    assert.equal(await digest(path), expected);
  }
}
async function rolesPreserved(c) { for (const [name, identity] of Object.entries(c.b.roles)) if (name !== 'track') assert(isDeepStrictEqual(await inspectApiProcess(identity.pid), identity)); }
async function nativePreserved(c) {
  const native = join(homedir(), '.demian/service'), service = await load(join(native, 'service.json')), secrets = await load(join(native, 'secrets.json'));
  const {Client} = createRequire(join(service.repository, 'package.json'))('pg');
  const pg = new Client({host: '127.0.0.1', port: service.databasePort, user: 'demian', database: 'demian', password: secrets.databasePassword, options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: 'track-runtime-preservation'});
  try { await pg.connect(); const actual = await nativeWebDatabaseState(pg,{workerFreshness:c.b.nativeDatabase.data.workerFreshness?.version===1,delegationNonces:c.b.nativeDatabase.data.delegationNonces?.version===1}); assertNativeWebDatabasePreserved(c.b.nativeDatabase,actual); } finally { await pg.end(); }
  const format = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"started":{{json .State.StartedAt}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}';
  const actual = JSON.parse((await exec('docker.exe', ['inspect', '--format', format, service.containerId], {windowsHide: true, timeout: 15000, maxBuffer: 1048576})).stdout); assert.deepEqual(actual, c.b.container);
}
const quote = value => '"' + value.replaceAll('"', '""') + '"';
export function assertTrackHistoryPreserved(database, backupFile, tableNames, allowSaved, allowCommandTables = false) {
  const db = new DatabaseSync(database, {readOnly: true});
  try {
    db.exec('PRAGMA query_only=ON'); db.prepare('ATTACH DATABASE ? AS baseline').run(backupFile); db.exec('BEGIN');
    const schema = db.prepare('SELECT type,name,tbl_name,sql FROM baseline.sqlite_schema ORDER BY name').all().map(row => ({...row}));
    const current = db.prepare('SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name').all().map(row => ({...row}));
    for (const row of schema) assert(current.some(other => isDeepStrictEqual(row, other)));
    const added = current.filter(row => !schema.some(old => old.name === row.name));
    const saved = added.filter(row => ['saved_flow_views', 'sqlite_autoindex_saved_flow_views_1'].includes(row.name));
    assert(saved.length === 0 || allowSaved && isDeepStrictEqual(saved.map(row => row.name).sort(), ['saved_flow_views', 'sqlite_autoindex_saved_flow_views_1']));
    for (const row of added.filter(row => !saved.includes(row))) {
      assert(allowCommandTables && trackCommandSchemaObjects.some(expected => isDeepStrictEqual(expected, row)));
    }
    if (allowCommandTables) for (const table of ['successor_intents', 'coordinator_command_intents']) {
      if (!added.some(row => row.tbl_name === table)) continue;
      assert.deepEqual(current.filter(row => row.tbl_name === table), trackCommandSchemaObjects.filter(row => row.tbl_name === table));
    }
    for (const name of tableNames) {
      if (['runs', 'metadata', 'sqlite_sequence'].includes(name)) continue;
      const cols = db.prepare("SELECT name,pk FROM pragma_table_info(?, 'baseline') ORDER BY cid").all(name); assert(cols.some(col => col.pk > 0));
      // Preserve SQLite storage types and byte values, independent of collation.
      const columns = cols.flatMap(col => [`typeof(${quote(col.name)})`, `CAST(${quote(col.name)} AS BLOB)`]).join(',');
      assert.equal(db.prepare(`SELECT count(*) AS n FROM (SELECT ${columns} FROM baseline.${quote(name)} EXCEPT SELECT ${columns} FROM main.${quote(name)})`).get().n, 0);
    }
    const cursor = value => { assert(typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value)); const n = BigInt(value); assert(n <= 9223372036854775807n); return n; };
    for (const old of db.prepare('SELECT key,value FROM baseline.metadata').all()) {
      const row = db.prepare('SELECT value FROM main.metadata WHERE key=?').get(old.key); assert(row);
      if (old.key.startsWith('message_cursor:')) assert(cursor(row.value) >= cursor(old.value));
      else assert.equal(row.value, old.value);
    }
    const runs = db.prepare('SELECT key,source_id,run_id,observation,cursor,high_water,history_pruned,binding FROM baseline.runs').all();
    const currentRun = db.prepare('SELECT source_id,run_id,observation,cursor,high_water,history_pruned,binding FROM main.runs WHERE key=?');
    for (const old of runs) {
      const row = currentRun.get(old.key); assert(row);
      assert.equal(row.source_id, old.source_id); assert.equal(row.run_id, old.run_id);
      assert.equal(JSON.parse(row.observation).sessionId, JSON.parse(old.observation).sessionId);
      assert.equal(row.history_pruned, old.history_pruned);
      for (const name of ['cursor', 'high_water']) assert(cursor(row[name]) >= cursor(old[name]));
      if (row.binding !== old.binding) {
        const before = db.prepare('SELECT max(ordinal) AS n FROM baseline.bindings WHERE run_key=?').get(old.key).n ?? 0;
        const latest = db.prepare('SELECT ordinal,payload FROM main.bindings WHERE run_key=? ORDER BY ordinal DESC LIMIT 1').get(old.key);
        assert(latest && latest.ordinal > before && row.binding === latest.payload);
      }
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM baseline.sqlite_sequence b LEFT JOIN main.sqlite_sequence r ON r.name=b.name WHERE r.name IS NULL OR r.seq<b.seq').get().n, 0);
  } finally { db.close(); }
}
const historyPreserved = (c, allowSaved) => assertTrackHistoryPreserved(c.original.database, c.b.backup.file, c.b.backup.result.fingerprint.tables.map(table => table.name), allowSaved, c.allowCommandTables === true);
async function activeIdentity(c, name) {
  const record = await load(c.b.receiptFile), release = c.releases[name];
  assert(record.runtime.mode === 'frozen' && samePath(record.runtime.cwd, release.releaseDir) && record.runtime.manifestSha256 === release.manifestSha256 && samePath(record.runtime.entry, join(release.releaseDir, 'apps/api/main.ts')));
  const identity = Object.fromEntries(['pid', 'name', 'executable', 'created', 'command'].map(key => [key, record[key]]));
  assert(identity.executable === process.execPath && identity.command.includes(record.runtime.entry));
  if (identity.pid === c.b.roles.track.pid) { assert(name === 'rollback' && c.b.version === 2); assert.deepEqual(identity, c.b.roles.track); }
  assert(isDeepStrictEqual(await inspectApiProcess(identity.pid), identity)); assert.equal((await inspectOwnedWeb(identity, 14345)).state, 'owned-live');
  assert.equal(Number((await bytes(join(state, 'track-product.pid'))).toString().trim()), identity.pid); return identity;
}
async function request(c, path, options = {}) {
  assert(path.startsWith('/') && !path.startsWith('//'));
  const key = (await bytes(c.original.auth.secretFile)).toString().trim();
  return fetch('http://127.0.0.1:14345' + path, {...options, headers: {'x-track-proxy-key': key, 'x-forwarded-email': c.original.auth.users[0], Origin: c.original.publicOrigin, ...(options.headers ?? {})}, redirect: 'error', signal: AbortSignal.timeout(15000)});
}
async function webReady(c, name) {
  await activeIdentity(c, name); const release = c.releases[name];
  const {manifest} = await verifyRuntimeRelease(release.releaseDir, release.manifestSha256); let count = 0;
  const types = {js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', html: 'text/html'};
  for (const [path, expected] of Object.entries(manifest.files).filter(([path]) => path.startsWith('dist/web/'))) {
    const response = await request(c, '/' + path.slice(9)); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type').split(';')[0], types[path.split('.').at(-1)]); assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected); count++;
  }
  assert.equal(count, Object.keys(manifest.files).filter(path => path.startsWith('dist/web/')).length);
  const view = await request(c, '/api/flow-views?contextId=' + 'a'.repeat(64)); assert.equal(view.status, c.b.version === 2 || name === 'candidate' ? 200 : 404); await view.body?.cancel(); return count;
}
async function ownerProbe(c) {
  let snapshot;
  for (let i = 0; i < 30; i++) { const r = await request(c, '/api/snapshot'); assert.equal(r.status, 200); snapshot = await r.json(); if (snapshot.sources.some(s => s.kind === 'projects' && s.state === 'connected') && snapshot.sources.some(s => s.kind === 'demian' && s.state === 'connected')) break; await new Promise(resolve => setTimeout(resolve, 1000)); }
  assert.equal(snapshot.user, c.original.auth.users[0]);
  let scope;
  for (const source of c.original.sources.filter(s => s.kind === 'projects')) for (const projectId of source.assignmentProjectIds ?? []) {
    if (!snapshot.sources.some(s => s.id === source.id && s.state === 'connected' && s.authorizedProjectIds?.includes(projectId))) continue;
    const r = await request(c, `/api/projects/${source.id}/${projectId}/tasks`); if (r.status !== 200) { await r.body?.cancel(); continue; }
    const page = await r.json(); if (page.tasks?.length >= 2) { scope = {sourceId: source.id, projectId, tasks: page.tasks.slice(0, 2)}; break; }
  }
  assert(scope); const actor = c.original.auth.users[0], id = randomUUID(), key = JSON.stringify(['flow-container', 'view-task-bundle', randomUUID()]);
  const contextId = hash(Buffer.from(JSON.stringify([actor, `${scope.sourceId}:${scope.projectId}`])));
  const content = {version: 1, contextId, name: '[QA] 저장 보기 운영 연동 확인', anchors: {tasks: scope.tasks.map(t => ({sourceId: scope.sourceId, projectId: scope.projectId, taskId: t.id})), runs: [], assistants: []}, state: {by: 'project', depth: 'structure', bundles: [{key, label: '[QA] 실제 업무 묶음', taskKeys: scope.tasks.map(t => JSON.stringify([scope.sourceId, 'task', t.id]))}], overrides: [[key, true]], focus: key}};
  const body = JSON.stringify({id, expectedRevision: 0, content}); await saveNew(join(c.p.operationDir, 'owner-probe.json'), JSON.stringify({id, contextId, operationId: c.p.operationId}) + '\n');
  const saved = await request(c, '/api/flow-views', {method: 'POST', headers: {'Content-Type': 'application/json'}, body}); assert.equal(saved.status, 200); const value = await saved.json(); assert.equal(value.actor, actor); assert.equal(value.view.id, id); assert.equal(value.view.revision, 1); assert.deepEqual(value.view.content, content);
  const listed = await (await request(c, '/api/flow-views?contextId=' + contextId)).json(); assert.equal(listed.actor, actor); assert(listed.views.some(v => v.id === id && isDeepStrictEqual(v.content, content)));
  const conflict = await request(c, '/api/flow-views', {method: 'POST', headers: {'Content-Type': 'application/json'}, body}); assert.equal(conflict.status, 409); await conflict.body?.cancel();
  const removed = await request(c, '/api/flow-views/' + id, {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expectedRevision: 1})}); assert.equal(removed.status, 200); assert.deepEqual(await removed.json(), {actor, deleted: true});
  const final = await (await request(c, '/api/flow-views?contextId=' + contextId)).json(); assert(!final.views.some(v => v.id === id));
  return {actualPermittedTasks: 2, createdAndRead: true, staleRevisionDenied: true, ownedProbeRemoved: true, nativeWorkCreated: false};
}
export async function runTrackRuntimePhase(phase, inputFile, inputSha) {
  assert(['preflight', 'maintenance', 'drain', 'stop', 'candidate', 'candidate-start', 'verify', 'restore-config', 'finalize', 'rollback', 'rollback-start', 'rollback-ready', 'report-failure'].includes(phase));
  const c = await inputs(inputFile, inputSha, ['rollback', 'rollback-start', 'rollback-ready', 'restore-config', 'report-failure'].includes(phase));
  if (phase !== 'preflight') await driver(c);
  if (phase === 'preflight') {
    assert.equal(await digest(c.b.configFile), c.b.configBeforeSha256); assert.equal(await digest(c.b.pointerFile), trackRuntimePointerPrecondition(c.b)); assert.equal(await digest(c.b.receiptFile), c.b.receiptBeforeSha256);
    assert.equal(await digest(c.b.backup.file), c.b.backup.sha256); const db = new DatabaseSync(c.b.backup.file, {readOnly: true}); try { assert.deepEqual(trackDatabaseFingerprint(db), c.b.backup.result.fingerprint); } finally { db.close(); }
    for (const r of Object.values(c.releases)) await verifyRuntimeRelease(r.releaseDir, r.manifestSha256);
    assert.equal((await inspectOwnedWeb(c.b.roles.track, 14345)).state, 'owned-live'); assert(Object.values(pending(c.original.database)).every(n => n === 0));
    await filesPreserved(c); await rolesPreserved(c); await nativePreserved(c); historyPreserved(c, false);
    return {ready: true, operationId: c.p.operationId, writes: 0};
  }
  await journal(c.p, 'phase-' + phase);
  if (phase === 'maintenance') await guardedWrite(c, 'config', await bytes(join(c.p.operationDir, 'config.maintenance.json')), [c.b.configBeforeSha256]);
  else if (phase === 'drain') {
    assert.equal(await digest(c.b.configFile), c.b.configMaintenanceSha256); let stable = 0;
    for (let i = 0; i < 100 && stable < 2; i++) { stable = Object.values(pending(c.original.database)).every(n => n === 0) ? stable + 1 : 0; if (stable < 2) await new Promise(r => setTimeout(r, 100)); } assert.equal(stable, 2);
    await filesPreserved(c); await rolesPreserved(c); await nativePreserved(c); historyPreserved(c, false);
  } else if (phase === 'stop') {
    assert.equal(await digest(c.b.configFile), c.b.configMaintenanceSha256); assert(Object.values(pending(c.original.database)).every(n => n === 0));
    await journal(c.p, 'stop-intent', c.b.roles.track); await stopOwnedWeb(c.b.roles.track, 14345); assert.equal((await inspectOwnedWeb(c.b.roles.track, 14345)).state, 'exited-free');
  } else if (phase === 'candidate') await guardedWrite(c, 'pointer', await pointer(c, 'candidate'), [trackRuntimePointerPrecondition(c.b)]);
  else if (phase === 'candidate-start') {
    assert.equal(await digest(c.b.configFile), c.b.configMaintenanceSha256);
    assert.equal(await digest(c.b.pointerFile), hash(await pointer(c, 'candidate')));
    assert.deepEqual(await apiListeners(14345), []);
  }
  else if (phase === 'verify') { assert.equal(await digest(c.b.configFile), c.b.configMaintenanceSha256); await webReady(c, 'candidate'); await filesPreserved(c); await rolesPreserved(c); await nativePreserved(c); historyPreserved(c, true); }
  else if (phase === 'restore-config') await guardedWrite(c, 'config', await bytes(join(c.p.operationDir, 'config.before.json')), [c.b.configMaintenanceSha256]);
  else if (phase === 'rollback') {
    await recoveryState(c);
    await verifyRuntimeRelease(c.releases.rollback.releaseDir, c.releases.rollback.manifestSha256);
    const listeners = await apiListeners(14345);
    if (listeners.length) {
      if (listeners[0].pid === c.b.roles.track.pid && (await inspectOwnedWeb(c.b.roles.track, 14345)).state === 'owned-live') { await guardedWrite(c, 'pointer', await pointer(c, 'rollback'), [trackRuntimePointerPrecondition(c.b), hash(await pointer(c, 'candidate'))]); return {retainedOriginal: true}; }
      const owned = await activeIdentity(c, 'candidate'); await recoveryState(c); await journal(c.p, 'rollback-stop-intent', owned); await stopOwnedWeb(owned, 14345);
    }
    assert.deepEqual(await apiListeners(14345), []); await guardedWrite(c, 'pointer', await pointer(c, 'rollback'), [trackRuntimePointerPrecondition(c.b), hash(await pointer(c, 'candidate'))]);
  } else if (phase === 'rollback-start') {
    assert([c.b.configBeforeSha256, c.b.configMaintenanceSha256].includes(await digest(c.b.configFile)));
    assert.equal(await digest(c.b.pointerFile), hash(await pointer(c, 'rollback')));
    await verifyRuntimeRelease(c.releases.rollback.releaseDir, c.releases.rollback.manifestSha256);
    const listeners = await apiListeners(14345);
    if (listeners.length) { assert(listeners.length === 1 && listeners[0].pid === c.b.roles.track.pid); assert.equal((await inspectOwnedWeb(c.b.roles.track, 14345)).state, 'owned-live'); }
  } else if (phase === 'rollback-ready') {
    if (c.b.version === 2) { assert.equal(await digest(c.b.pointerFile), hash(await pointer(c, 'rollback'))); await webReady(c, 'rollback'); }
    else if ((await inspectApiProcess(c.b.roles.track.pid))?.created === c.b.roles.track.created) assert.equal((await inspectOwnedWeb(c.b.roles.track, 14345)).state, 'owned-live'); else await webReady(c, 'rollback');
    historyPreserved(c, true);
  } else if (phase === 'finalize') {
    assert.equal(await digest(c.b.configFile), c.b.configBeforeSha256); assert.equal(await digest(c.b.pointerFile), hash(await pointer(c, 'candidate'))); const identity = await activeIdentity(c, 'candidate');
    const probe = await ownerProbe(c); await filesPreserved(c); await rolesPreserved(c); await nativePreserved(c); historyPreserved(c, true);
    const result = {committed: true, operationId: c.p.operationId, inputSha256: inputSha, identity, runtime: c.releases.candidate, probe, originalConfigRestored: true, nativeDatabaseAndProcessesPreserved: true, existingHistoryPreserved: true, anonymousAndGuiPending: true};
    await saveNew(join(c.p.operationDir, 'committed.json'), JSON.stringify(result, null, 2) + '\n'); await journal(c.p, 'committed'); return {committed: true, operationId: c.p.operationId, pid: identity.pid, probe};
  } else if (phase === 'report-failure') await journal(c.p, 'operator-failed');
  return {ok: true, phase};
}
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2), phase = args[args.indexOf('--phase') + 1];
  try {
    assert(args.length === 6 && args[0] === '--phase' && args[2] === '--input' && args[4] === '--input-sha256');
    console.log(JSON.stringify(await runTrackRuntimePhase(phase, resolve(args[3]), args[5])));
  } catch { console.error(JSON.stringify({ok: false, phase, reason: 'Track runtime operation refused; inspect its owned journal'})); process.exitCode = 1; }
}

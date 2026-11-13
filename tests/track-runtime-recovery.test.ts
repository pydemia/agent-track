import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { assertTrackColdProof, assertTrackRecoveryState, trackRuntimePointerPrecondition } from '../deploy/track/runtime-operation.mjs';

const source = await readFile(new URL('../deploy/track/runtime-operation.mjs', import.meta.url), 'utf8');
// Exercise the actual phase control flow with memory ports. No deployment I/O is permitted.
const phaseBody = source.slice(source.indexOf('export async function runTrackRuntimePhase'), source.indexOf('\nif (process.argv[1]')).replace('export ', '');
const recoveryBody = source.slice(source.indexOf('async function recoveryState('), source.indexOf('\nasync function filesPreserved('));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function fixture(version: 1 | 2, options: {foreignPointer?: boolean; changedConfig?: boolean; foreignListener?: boolean; damagedCandidate?: boolean} = {}) {
  const candidate = Buffer.from('candidate'), old = Buffer.from('original-pointer'), rollback = version === 2 ? old : Buffer.from('legacy-rollback');
  const maintenance = Buffer.from('maintenance'), original = Buffer.from('original-config');
  const c = {p: {operationDir: 'memory'}, b: {version, roles: {track: {pid: 101}}, pointerFile: 'pointer', configFile: 'config',
    configBeforeSha256: hash(original), configMaintenanceSha256: hash(maintenance), ...(version === 2 ? {pointerBeforeSha256: hash(old)} : {})},
    releases: {rollback: {releaseDir: 'rollback', manifestSha256: 'a'.repeat(64)}}};
  const files = new Map<string, Buffer>([['pointer', options.foreignPointer ? Buffer.from('foreign-pointer') : candidate], ['config', options.changedConfig ? Buffer.from('foreign-config') : maintenance]]);
  const events: string[] = []; let live = true;
  const deps = {assert, inputs: async (_file: string, _sha: string, recovery: boolean) => {
    if (options.damagedCandidate && !recovery) throw Error('candidate closure mismatch'); return c;
  }, driver: async () => {}, journal: async () => {}, verifyRuntimeRelease: async (root: string) => { assert.equal(root, 'rollback'); },
  apiListeners: async () => live ? [{pid: options.foreignListener ? 303 : 202}] : [], inspectOwnedWeb: async () => ({state: 'owned-live'}),
  activeIdentity: async () => { if (options.foreignListener) throw Error('foreign identity'); return {pid: 202}; },
  stopOwnedWeb: async () => { events.push('stop-candidate'); live = false; }, pointer: async (_context: unknown, name: string) => name === 'candidate' ? candidate : rollback,
  trackRuntimePointerPrecondition, assertTrackRecoveryState, hash, digest: async (path: string) => hash(files.get(path)!),
  bytes: async (path: string) => path.endsWith('config.before.json') ? original : files.get(path), join,
  guardedWrite: async (_context: unknown, kind: string, data: Buffer, before: string[]) => {
    const current = hash(files.get(kind)!); if (current === hash(data)) return;
    assert(before.includes(current)); events.push('write-' + kind); files.set(kind, data);
  }};
  const phase = new Function(...Object.keys(deps), recoveryBody + '\n' + phaseBody + ';return runTrackRuntimePhase;')(...Object.values(deps));
  return {phase, events, files, live: () => live};
}
for (const version of [1, 2] as const) {
  test(`v${version} foreign pointer is rejected before stopping the healthy candidate`, async () => {
    const f = fixture(version, {foreignPointer: true}); await assert.rejects(f.phase('rollback', 'memory', 'memory'));
    assert.deepEqual(f.events, []); assert.equal(f.live(), true); assert.equal(f.files.get('pointer')!.toString(), 'foreign-pointer');
  });
  test(`v${version} changed config is not used for rollback startup or overwritten`, async () => {
    const f = fixture(version, {changedConfig: true});
    await assert.rejects(f.phase('rollback', 'memory', 'memory')); await assert.rejects(f.phase('rollback-start', 'memory', 'memory'));
    await assert.rejects(f.phase('restore-config', 'memory', 'memory'));
    assert.deepEqual(f.events, []); assert.equal(f.live(), true); assert.equal(f.files.get('config')!.toString(), 'foreign-config');
  });
  test(`v${version} damaged candidate does not block rollback or config restoration`, async () => {
    const f = fixture(version, {damagedCandidate: true});
    await f.phase('rollback', 'memory', 'memory'); await f.phase('rollback-start', 'memory', 'memory'); await f.phase('restore-config', 'memory', 'memory');
    assert.deepEqual(f.events, ['stop-candidate', 'write-pointer', 'write-config']); assert.equal(f.live(), false);
  });
  test(`v${version} foreign listener is preserved`, async () => {
    const f = fixture(version, {foreignListener: true}); await assert.rejects(f.phase('rollback', 'memory', 'memory'), /foreign identity/);
    assert.deepEqual(f.events, []); assert.equal(f.live(), true);
  });
}

test('actual input validation admits recovery evidence without loading the damaged candidate closure', async () => {
  const body = source.slice(source.indexOf('async function inputs('), source.indexOf('\nasync function driver('));
  const root = resolve('memory-fixture'), state = join(root, 'state'), repository = join(root, 'repo'), op = join(state, 'operations', 'operation'), pin = 'a'.repeat(64);
  const plan = {version: 1, operationId: 'operation', operationDir: op, baselineFile: join(op, 'baseline.json'), releasesFile: join(op, 'releases.json'), qaFile: join(op, 'qa.json'), sources: {}, baselineSha256: pin, releasesSha256: pin, qaSha256: pin};
  const baseline = {version: 1, operationId: 'operation', operationDir: op, state, repository, configFile: join(state, 'track-product.config.json'), pointerFile: join(state, 'track-runtime.json'), receiptFile: join(state, 'track-product-process.json'), backup: {file: join(op, 'backup.sqlite'), sha256: pin}, configBeforeSha256: pin, configMaintenanceSha256: pin};
  const config = {auth: {mode: 'proxy', users: ['fixture']}, port: 14345, sources: []};
  const releases = {releases: {candidate: {releaseDir: join(state, 'releases', 'candidate'), manifestSha256: pin}, rollback: {releaseDir: join(state, 'releases', 'rollback'), manifestSha256: pin}}};
  const cold = (status: number) => ({verified: true, childStopped: true, portReleased: true, allLegacyTablesAndSchemaPreserved: true, webFilesBytesAndMimeMatched: 1, savedViewStatus: status});
  const qa = {fixtureOnly: true, sourceDatabaseRestored: false, originalApiRestarted: false, sourceOrModelRequests: 0, releases: {candidate: cold(200), rollback: cold(404)}};
  const data = new Map<string, unknown>([[plan.baselineFile, baseline], [plan.releasesFile, releases], [plan.qaFile, qa], [join(op, 'config.before.json'), config], [join(op, 'config.maintenance.json'), config]]);
  const visited: string[] = [];
  const deps = {assert, sha: () => true, bytes: async (path: string) => Buffer.from(path === 'input' ? JSON.stringify(plan) : 'agent-track-frozen-runtime-operation-v1\n'), hash: () => pin,
    validateTrackRuntimePlan: (value: unknown) => value, state, repository, samePath: (a: string, b: string) => a === b, realpath: async (p: string) => p,
    join, digest: async () => pin, load: async (p: string) => data.get(p), structuredClone, dirname, assertTrackColdProof,
    verifyRuntimeRelease: async (path: string) => { visited.push(path); throw Error('candidate closure mismatch'); }};
  const inputs = new Function(...Object.keys(deps), body + ';return inputs;')(...Object.values(deps));
  await assert.rejects(inputs('input', pin, false), /candidate closure mismatch/); assert.equal(visited.length, 1); visited.length = 0;
  await inputs('input', pin, true); assert.deepEqual(visited, []);
});

test('Windows startup config read lock permits Node readers while preventing write and replacement', {skip: process.platform !== 'win32'}, async () => {
  const root = await realpath(tmpdir()), dir = await mkdtemp(join(root, 'track-config-guard-'));
  try {
    assert.equal(dirname(dir), root); await writeFile(join(dir, 'config.json'), 'original', {flag: 'wx'});
    const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
      fileURLToPath(new URL('./fixtures/track-config-read-lock.ps1', import.meta.url)), '-Root', dir, '-Node', process.execPath], {windowsHide: true, timeout: 15000});
    assert.deepEqual(JSON.parse(result.stdout.trim()), {nodeReaderAllowed: true, writeDenied: true, replaceDenied: true, guardReleased: true});
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), 'after guard');
  } finally { assert.equal(dirname(dir), root); await rm(dir, {recursive: true, force: true}); }
});

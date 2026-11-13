import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import {
  assertTrackColdProof,
  trackRuntimeOperationSources,
  trackRuntimePointerPrecondition,
  validateTrackRuntimePlan,
  validateTrackUpgradeBaseline,
} from '../deploy/track/runtime-operation.mjs';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const pin = 'a'.repeat(64);

function temporaryRoot(prefix: string, fn: (root: string) => void) {
  const root = realpathSync(tmpdir());
  const dir = mkdtempSync(join(root, prefix));
  try {
    fn(dir);
  } finally {
    assert(!relative(root, dir).startsWith('..'));
    rmSync(dir, { recursive: true, force: true });
  }
}

function upgradePlan(dir: string) {
  const state = join(dir, 'private-state');
  const repository = join(dir, 'checkout');
  const operationId = '00000000-0000-0000-0000-000000000002';
  const operationDir = join(state, 'operations', operationId);
  return {
    version: 2,
    operationId,
    scope: 'track-product-14345',
    state,
    repository,
    operationDir,
    baselineFile: join(operationDir, 'baseline.json'),
    baselineSha256: pin,
    releasesFile: join(operationDir, 'releases.json'),
    releasesSha256: pin,
    qaFile: join(operationDir, 'cold-qa.json'),
    qaSha256: pin,
    sources: Object.fromEntries(trackRuntimeOperationSources.map(path => [path, pin])),
  };
}

test('v2 upgrade plan retains the exact v1 key set and pins its private evidence and source scope', () => {
  temporaryRoot('track-upgrade-plan-', dir => {
    const good = upgradePlan(dir);
    assert.equal(validateTrackRuntimePlan(good, { state: good.state, repository: good.repository }), good);

    const invalid = [
      { ...good, extra: true },
      { ...good, scope: 'native-demian' },
      { ...good, version: 3 },
      { ...good, state: join(dir, 'other-state') },
      { ...good, repository: join(dir, 'other-checkout') },
      { ...good, operationId: '../escape' },
      { ...good, operationDir: join(good.state, 'operations', 'other') },
      { ...good, baselineFile: join(dir, 'baseline.json') },
      { ...good, releasesFile: join(good.repository, 'releases.json') },
      { ...good, qaFile: join(good.operationDir, 'qa.json') },
      { ...good, releasesSha256: 'A'.repeat(64) },
      { ...good, qaSha256: pin + '\n' },
      { ...good, sources: { ...good.sources, '../unexpected': pin } },
      { ...good, sources: {} },
      { ...good, sources: { ...good.sources, [trackRuntimeOperationSources[0]!]: 'bad' } },
    ];
    for (const bad of invalid) {
      assert.throws(() => validateTrackRuntimePlan(bad, { state: good.state, repository: good.repository }));
    }
  });
});

function baselineFixture() {
  const releaseDir = join(realpathSync(tmpdir()), 'track-upgrade-release');
  const rollback = {
    releaseDir,
    manifestSha256: 'b'.repeat(64),
    apiRevision: 'api-revision-17',
    webRevision: 'web-revision-23',
  };
  const role = {
    pid: 4217,
    name: 'agent-track-api',
    executable: 'C:\\Program Files\\nodejs\\node.exe',
    created: '2026-11-12T03:04:05.000Z',
    command: ['node', join(releaseDir, 'apps/api/main.ts'), '--port', '14345'],
  };
  const pointerBytes = Buffer.from(JSON.stringify({
    version: 1,
    releaseDir,
    manifestSha256: rollback.manifestSha256,
  }) + '\n');
  const receiptBytes = Buffer.from(JSON.stringify({
    runtime: {
      mode: 'frozen',
      cwd: releaseDir,
      entry: join(releaseDir, 'apps/api/main.ts'),
      manifestSha256: rollback.manifestSha256,
    },
    apiRevision: rollback.apiRevision,
    webRevision: rollback.webRevision,
    ...role,
  }) + '\n');
  const baseline = {
    version: 2,
    pointerBeforeSha256: sha(pointerBytes),
    receiptBeforeSha256: sha(receiptBytes),
    roles: { track: role },
  };
  return { baseline, pointerBytes, receiptBytes, rollback };
}

test('v2 baseline binds exact old pointer bytes, frozen receipt generation, rollback release and original process identity', () => {
  const f = baselineFixture();
  assert.equal(validateTrackUpgradeBaseline(f.baseline, f.pointerBytes, f.receiptBytes, f.rollback), true);

  const pointer = JSON.parse(f.pointerBytes.toString('utf8'));
  const receipt = JSON.parse(f.receiptBytes.toString('utf8'));
  const wrongPointer = Buffer.from(JSON.stringify({ ...pointer, manifestSha256: 'c'.repeat(64) }));
  const wrongHash = Buffer.from(f.pointerBytes.toString('utf8') + ' ');
  const wrongRuntime = Buffer.from(JSON.stringify({
    ...receipt,
    runtime: { ...receipt.runtime, cwd: join(f.rollback.releaseDir, 'other-generation') },
  }));
  const wrongEntry = Buffer.from(JSON.stringify({
    ...receipt,
    runtime: { ...receipt.runtime, entry: join(f.rollback.releaseDir, 'other.ts') },
  }));
  const wrongManifest = Buffer.from(JSON.stringify({
    ...receipt,
    runtime: { ...receipt.runtime, manifestSha256: 'd'.repeat(64) },
  }));
  const wrongRevision = Buffer.from(JSON.stringify({ ...receipt, apiRevision: 'new-generation' }));
  const wrongIdentity = Buffer.from(JSON.stringify({ ...receipt, pid: receipt.pid + 1 }));

  assert.throws(() => validateTrackUpgradeBaseline(f.baseline, wrongPointer, f.receiptBytes, f.rollback));
  assert.throws(() => validateTrackUpgradeBaseline(f.baseline, wrongHash, f.receiptBytes, f.rollback));
  const repinnedPointer = { ...f.baseline, pointerBeforeSha256: sha(wrongPointer) };
  assert.throws(() => validateTrackUpgradeBaseline(repinnedPointer, wrongPointer, f.receiptBytes, f.rollback));
  for (const changedReceipt of [wrongRuntime, wrongEntry, wrongManifest, wrongRevision, wrongIdentity]) {
    assert.throws(() => validateTrackUpgradeBaseline(
      { ...f.baseline, receiptBeforeSha256: sha(changedReceipt) }, f.pointerBytes, changedReceipt, f.rollback,
    ));
  }
  assert.throws(() => validateTrackUpgradeBaseline(f.baseline, f.pointerBytes, f.receiptBytes, {
    ...f.rollback,
    releaseDir: join(f.rollback.releaseDir, 'other'),
  }));
  assert.throws(() => validateTrackUpgradeBaseline({ ...f.baseline, receiptBeforeSha256: 'not-a-hash' }, f.pointerBytes, f.receiptBytes, f.rollback));
});

test('pointer precondition preserves the v1 null-pointer case and requires a canonical v2 digest', () => {
  assert.equal(trackRuntimePointerPrecondition({ version: 1 }), null);
  assert.equal(trackRuntimePointerPrecondition({ version: 2, pointerBeforeSha256: pin }), pin);
  for (const baseline of [
    { version: 2 },
    { version: 2, pointerBeforeSha256: 'A'.repeat(64) },
    { version: 2, pointerBeforeSha256: 'f'.repeat(63) },
    { version: 3, pointerBeforeSha256: pin },
    { version: 1, pointerBeforeSha256: 'invalid' },
  ]) assert.throws(() => trackRuntimePointerPrecondition(baseline));
});

type ColdRelease = {
  verified: boolean;
  childStopped: boolean;
  portReleased: boolean;
  allLegacyTablesAndSchemaPreserved: boolean;
  webFilesBytesAndMimeMatched: number;
  savedViewStatus: number;
  manifestSha256?: string;
};
type ColdQa = {
  fixtureOnly: boolean;
  sourceDatabaseRestored: boolean;
  originalApiRestarted: boolean;
  sourceOrModelRequests: number;
  releases: Record<string, ColdRelease>;
};

function coldProof<Name extends string>(name: Name, version: 1 | 2, manifestSha256 = pin): ColdQa & {releases: Record<Name, ColdRelease>} {
  return {
    fixtureOnly: true,
    sourceDatabaseRestored: false,
    originalApiRestarted: false,
    sourceOrModelRequests: 0,
    releases: {
      [name]: {
        verified: true,
        childStopped: true,
        portReleased: true,
        allLegacyTablesAndSchemaPreserved: true,
        webFilesBytesAndMimeMatched: 18,
        savedViewStatus: name === 'candidate' || version === 2 ? 200 : 404,
        ...(version === 2 ? { manifestSha256 } : {}),
      },
    },
  } as ColdQa & {releases: Record<Name, ColdRelease>};
}

test('cold proof accepts isolated candidate and both rollback generations with their saved-view behavior', () => {
  assert.equal(assertTrackColdProof(coldProof('candidate', 2), 'candidate', 2, 18, pin), true);
  assert.equal(assertTrackColdProof(coldProof('rollback', 1), 'rollback', 1, 18, pin), true);
  assert.equal(assertTrackColdProof(coldProof('rollback', 2), 'rollback', 2, 18, pin), true);
});

test('cold proof rejects incomplete safety evidence, incorrect legacy rollback and unpinned v2 release evidence', () => {
  const badProofs: ColdQa[] = [
    { ...coldProof('candidate', 2), fixtureOnly: false },
    { ...coldProof('candidate', 2), sourceDatabaseRestored: true },
    { ...coldProof('candidate', 2), originalApiRestarted: true },
    { ...coldProof('candidate', 2), sourceOrModelRequests: 1 },
    { ...coldProof('candidate', 2), sourceOrModelRequests: -1 },
    { ...coldProof('candidate', 2), releases: { candidate: { ...coldProof('candidate', 2).releases.candidate, verified: false } } },
    { ...coldProof('candidate', 2), releases: { candidate: { ...coldProof('candidate', 2).releases.candidate, childStopped: false } } },
    { ...coldProof('candidate', 2), releases: { candidate: { ...coldProof('candidate', 2).releases.candidate, portReleased: false } } },
    { ...coldProof('candidate', 2), releases: { candidate: { ...coldProof('candidate', 2).releases.candidate, allLegacyTablesAndSchemaPreserved: false } } },
    { ...coldProof('candidate', 2), releases: { candidate: { ...coldProof('candidate', 2).releases.candidate, webFilesBytesAndMimeMatched: 0 } } },
    { ...coldProof('candidate', 2), releases: { candidate: { ...coldProof('candidate', 2).releases.candidate, savedViewStatus: 404 } } },
    { ...coldProof('rollback', 2), releases: { rollback: { ...coldProof('rollback', 2).releases.rollback, savedViewStatus: 404 } } },
    { ...coldProof('rollback', 2), releases: { rollback: { ...coldProof('rollback', 2).releases.rollback, manifestSha256: 'E'.repeat(64) } } },
  ];
  for (const qa of badProofs) {
    const name = Object.keys(qa.releases)[0]!;
    assert.throws(() => assertTrackColdProof(qa, name, 2, 18, pin));
  }
  const legacy = coldProof('rollback', 1); legacy.releases.rollback.savedViewStatus = 200;
  assert.throws(() => assertTrackColdProof(legacy, 'rollback', 1, 18, pin));
  assert.throws(() => assertTrackColdProof(coldProof('candidate', 2), 'candidate', 2, 0, pin));
  assert.throws(() => assertTrackColdProof(coldProof('candidate', 2), 'candidate', 2, 1.5, pin));
  assert.throws(() => assertTrackColdProof(coldProof('candidate', 2, 'bad'), 'candidate', 2, 18, pin));
});

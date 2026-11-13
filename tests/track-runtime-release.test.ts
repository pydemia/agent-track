import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { resolveTrackRuntime, verifyRuntimeRelease,
  type RuntimeReleaseManifest } from '../deploy/track/runtime-release.mjs';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function fixture(t: TestContext) {
  const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'track-release-'));
  t.after(async () => {
    assert.equal(path.dirname(temporary), await realpath(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('track-release-'));
    await rm(temporary, { recursive: true, force: true });
  });
  const state = path.join(temporary, 'state');
  const root = path.join(state, 'releases', 'one');
  await mkdir(root, { recursive: true });
  const executable = path.join(temporary, 'fake-node');
  await writeFile(executable, 'fake node bytes');
  const options = { executable, version: 'v24.13.0' };
  const manifest: RuntimeReleaseManifest = {
    version: 1, kind: 'agent-track-runtime-release', apiRevision: 'a'.repeat(40),
    webRevision: 'b'.repeat(40), node: { version: options.version, sha256: digest('fake node bytes') },
    packages: {}, files: {},
  };
  async function put(name: string, content: string) {
    const filename = path.join(root, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
    manifest.files[name] = digest(content);
  }
  for (const name of ['apps/api/main.ts', 'apps/api/server.ts', 'apps/api/config.ts',
    'packages/storage/store.ts', 'dist/web/index.html', 'package.json']) await put(name, '{}');
  for (const name of ['tsx', 'zod', 'esbuild', 'get-tsconfig', 'resolve-pkg-maps', '@esbuild/win32-x64']) {
    manifest.packages[name] = '1.0.0';
    await put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0' }));
  }
  async function seal() {
    const bytes = JSON.stringify(manifest);
    await writeFile(path.join(root, 'release.json'), bytes);
    return digest(bytes);
  }
  async function pointer(value: unknown) {
    await writeFile(path.join(state, 'track-runtime.json'), JSON.stringify(value));
  }
  return { root, state, temporary, executable, options, manifest, put, seal, pointer };
}

test('verifies exact release bytes and resolves frozen runtime', async (t) => {
  const f = await fixture(t);
  const sha = await f.seal();
  const result = await verifyRuntimeRelease(f.root, sha, f.options);
  assert.deepEqual(result.manifest, f.manifest);
  assert.equal(result.entry, path.join(f.root, 'apps/api/main.ts'));
  await f.pointer({ version: 1, releaseDir: f.root, manifestSha256: sha });
  assert.deepEqual(await resolveTrackRuntime(f.state, f.temporary, f.options), {
    mode: 'frozen', cwd: f.root, entry: result.entry, executable: f.executable, manifestSha256: sha,
  });
});

test('absent pointer selects legacy and default Node', async (t) => {
  const f = await fixture(t);
  for (const state of [f.state, path.join(f.temporary, 'absent')]) {
    assert.deepEqual(await resolveTrackRuntime(state, f.temporary), {
      mode: 'legacy', cwd: f.temporary, entry: path.join(f.temporary, 'apps/api/main.ts'),
      executable: process.execPath, manifestSha256: null,
    });
  }
});

test('uses declared package dependencies rather than an obsolete tsx package chain', async (t) => {
  const f = await fixture(t);
  await f.put('node_modules/tsx/package.json', JSON.stringify({ name: 'tsx', version: '1.0.0', dependencies: { esbuild: '~1.0.0' } }));
  for (const name of ['get-tsconfig', 'resolve-pkg-maps']) {
    delete f.manifest.packages[name]; delete f.manifest.files[`node_modules/${name}/package.json`];
    await rm(path.join(f.root, 'node_modules', name), { recursive: true });
  }
  await verifyRuntimeRelease(f.root, await f.seal(), f.options);
  await f.put('node_modules/tsx/package.json', JSON.stringify({ name: 'tsx', version: '1.0.0', dependencies: { 'missing-package': '1' } }));
  await assert.rejects(verifyRuntimeRelease(f.root, await f.seal(), f.options));
});

for (const scenario of ['manifest bytes', 'file bytes', 'missing', 'extra', 'node bytes',
  'node version', 'package version', 'package name', 'package key', 'missing package',
  'unknown field', 'revision', 'mandatory', 'oversized', 'too many files']) {
  test(`rejects ${scenario}`, async (t) => {
    const f = await fixture(t);
    let sha = await f.seal();
    if (scenario === 'manifest bytes') await writeFile(path.join(f.root, 'release.json'), JSON.stringify(f.manifest) + ' ');
    if (scenario === 'file bytes') await writeFile(path.join(f.root, 'apps/api/main.ts'), 'changed');
    if (scenario === 'missing') await rm(path.join(f.root, 'apps/api/main.ts'));
    if (scenario === 'extra') await writeFile(path.join(f.root, 'apps/api/extra.ts'), 'extra');
    if (scenario === 'node bytes') await writeFile(f.executable, 'other node');
    if (scenario === 'node version') f.options.version = 'v0.0.0';
    if (scenario === 'package version' || scenario === 'package name') {
      await f.put('node_modules/tsx/package.json', JSON.stringify({
        name: scenario === 'package name' ? 'other' : 'tsx',
        version: scenario === 'package version' ? '2.0.0' : '1.0.0',
      }));
      sha = await f.seal();
    }
    if (scenario === 'package key') { f.manifest.packages['../bad'] = '1'; sha = await f.seal(); }
    if (scenario === 'missing package') { delete f.manifest.packages.esbuild; sha = await f.seal(); }
    if (scenario === 'unknown field') {
      Object.assign(f.manifest, { extra: true }); sha = await f.seal();
    }
    if (scenario === 'revision') { f.manifest.apiRevision = 'A'.repeat(40); sha = await f.seal(); }
    if (scenario === 'mandatory') {
      delete f.manifest.files['apps/api/main.ts'];
      await rm(path.join(f.root, 'apps/api/main.ts')); sha = await f.seal();
    }
    if (scenario === 'oversized') {
      const bytes = ' '.repeat(4 * 1024 * 1024 + 1);
      await writeFile(path.join(f.root, 'release.json'), bytes); sha = digest(bytes);
    }
    if (scenario === 'too many files') {
      for (let i = 0; i < 20001; i++) f.manifest.files[`apps/api/${i}.ts`] = digest('');
      sha = await f.seal();
    }
    await assert.rejects(verifyRuntimeRelease(f.root, sha, f.options));
  });
}

for (const name of ['../escape', '/absolute', 'apps/api/../escape', 'apps/api/./main.ts',
  'apps\\api\\main.ts', 'apps/api/\0bad', 'apps/api//main.ts', 'C:/outside', 'secret.txt',
  'apps/api/main.ts:stream', 'release.json']) {
  test(`rejects noncanonical or forbidden path ${JSON.stringify(name)}`, async (t) => {
    const f = await fixture(t);
    f.manifest.files[name] = digest('');
    await assert.rejects(verifyRuntimeRelease(f.root, await f.seal(), f.options));
  });
}

test('rejects hardlinked payload, manifest and executable', async (t) => {
  for (const target of ['apps/api/main.ts', 'release.json', 'node']) {
    const f = await fixture(t);
    const sha = await f.seal();
    await link(target === 'node' ? f.executable : path.join(f.root, target), path.join(f.temporary, 'hardlink'));
    await assert.rejects(verifyRuntimeRelease(f.root, sha, f.options));
  }
});

test('rejects redirected roots, internal directories and pointer links', async (t) => {
  const f = await fixture(t);
  const sha = await f.seal();
  const alias = path.join(f.temporary, 'alias');
  await symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyRuntimeRelease(alias, sha, f.options));
  await symlink(f.root, path.join(f.root, 'packages/redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyRuntimeRelease(f.root, sha, f.options));
  await symlink(f.root, path.join(f.state, 'track-runtime.json'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveTrackRuntime(f.state, f.temporary, f.options));
});

test('invalid existing pointer never falls back', async (t) => {
  const f = await fixture(t);
  const sha = await f.seal();
  for (const pointer of [null, {}, { version: 2, releaseDir: f.root, manifestSha256: sha },
    { version: 1, releaseDir: f.root, manifestSha256: '0'.repeat(64) },
    { version: 1, releaseDir: f.temporary, manifestSha256: sha },
    { version: 1, releaseDir: 'releases/one', manifestSha256: sha },
    { version: 1, releaseDir: f.root, manifestSha256: sha, override: true }]) {
    await f.pointer(pointer);
    await assert.rejects(resolveTrackRuntime(f.state, f.temporary, f.options));
  }
  await writeFile(path.join(f.state, 'track-runtime.json'), '{');
  await assert.rejects(resolveTrackRuntime(f.state, f.temporary, f.options));
});

test('rejects absent pointer under redirected state ancestry', async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.temporary, 'state-alias');
  await symlink(f.state, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveTrackRuntime(path.join(alias, 'missing'), f.temporary));
});

test('rejects malformed manifest digest and hardlinked pointer', async (t) => {
  const f = await fixture(t);
  const sha = await f.seal();
  for (const value of ['', sha.toUpperCase(), '0'.repeat(64), 'a'.repeat(63)]) {
    await assert.rejects(verifyRuntimeRelease(f.root, value, f.options));
  }
  await f.pointer({ version: 1, releaseDir: f.root, manifestSha256: sha });
  await link(path.join(f.state, 'track-runtime.json'), path.join(f.temporary, 'pointer-link'));
  await assert.rejects(resolveTrackRuntime(f.state, f.temporary, f.options));
});

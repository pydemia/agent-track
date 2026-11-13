import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const LIMIT = 4 * 1024 * 1024;
const REQUIRED = ['apps/api/main.ts', 'apps/api/server.ts', 'apps/api/config.ts',
  'packages/storage/store.ts', 'node_modules/tsx/package.json',
  'node_modules/zod/package.json', 'dist/web/index.html'];

function insist(condition) {
  if (!condition) throw new Error('Invalid Track runtime release');
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value, expected) {
  insist(record(value) && Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key)));
}

// Reject redirected ancestors as well as a redirected final component.
async function canonical(directory) {
  const absolute = path.resolve(directory);
  let current = absolute;
  for (;;) {
    const stat = await lstat(current);
    insist(stat.isDirectory() && !stat.isSymbolicLink());
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const resolved = await realpath(absolute);
  insist(path.relative(absolute, resolved) === '');
  return resolved;
}

function validFile(name) {
  return typeof name === 'string' && !/[\\\0:]/.test(name) &&
    name.split('/').every((part) => part && part !== '.' && part !== '..' &&
      !/[. ]$/.test(part)) &&
    (/^(apps\/api|packages|node_modules|dist\/web)\/.+/.test(name) ||
      ['package.json', 'package-lock.json', 'tsconfig.json'].includes(name));
}

async function readFileChecked(filename, limit = Infinity) {
  const before = await lstat(filename);
  insist(before.isFile() && before.nlink === 1 && before.size <= limit);
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    insist(stat.isFile() && stat.nlink === 1 && stat.dev === before.dev &&
      stat.ino === before.ino && stat.size <= limit);
    const hash = createHash('sha256');
    const chunks = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      insist(size <= limit);
      hash.update(chunk);
      if (limit !== Infinity) chunks.push(chunk);
    }
    const after = await handle.stat();
    insist(after.size === stat.size && after.mtimeMs === stat.mtimeMs &&
      after.ctimeMs === stat.ctimeMs && after.nlink === 1 && size === stat.size);
    return { hash: hash.digest('hex'), bytes: Buffer.concat(chunks) };
  } finally {
    await handle.close();
  }
}

async function inventory(root) {
  const files = [];
  let count = 0;
  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      insist(++count <= 60000);
      const relative = prefix + entry.name;
      const filename = path.join(directory, entry.name);
      const stat = await lstat(filename);
      insist(!stat.isSymbolicLink());
      if (stat.isDirectory()) {
        insist(validFile(relative + '/placeholder') || ['apps', 'dist'].includes(relative));
        insist(path.relative(filename, await realpath(filename)) === '');
        await walk(filename, relative + '/');
      } else {
        insist(stat.isFile() && stat.nlink === 1);
        insist(relative === 'release.json' || validFile(relative));
        files.push(relative);
        insist(files.length <= 20001);
      }
    }
  }
  await walk(root, '');
  return files;
}

export async function verifyRuntimeRelease(directory, expectedManifestSha256,
  { executable = process.execPath, version = process.version } = {}) {
  insist(typeof expectedManifestSha256 === 'string' && SHA256.test(expectedManifestSha256));
  const root = await canonical(directory);
  const source = await readFileChecked(path.join(root, 'release.json'), LIMIT);
  insist(source.hash === expectedManifestSha256);
  const manifest = JSON.parse(source.bytes.toString('utf8'));
  keys(manifest, ['version', 'kind', 'apiRevision', 'webRevision', 'node', 'packages', 'files']);
  insist(manifest.version === 1 && manifest.kind === 'agent-track-runtime-release');
  insist(typeof manifest.apiRevision === 'string' && REVISION.test(manifest.apiRevision));
  insist(typeof manifest.webRevision === 'string' && REVISION.test(manifest.webRevision));
  keys(manifest.node, ['version', 'sha256']);
  insist(manifest.node.version === version && typeof manifest.node.sha256 === 'string' &&
    SHA256.test(manifest.node.sha256));
  insist(record(manifest.files) && record(manifest.packages));
  const declared = Object.keys(manifest.files);
  insist(declared.length <= 20000 && REQUIRED.every((name) => Object.hasOwn(manifest.files, name)));
  insist(declared.every((name) => validFile(name) && typeof manifest.files[name] === 'string' &&
    SHA256.test(manifest.files[name])));
  const packages = Object.keys(manifest.packages);
  insist(packages.every((name) => PACKAGE.test(name) && name.length <= 214 &&
    typeof manifest.packages[name] === 'string' && manifest.packages[name].length > 0));
  insist(['tsx', 'zod']
    .every((name) => Object.hasOwn(manifest.packages, name)));
  const actual = await inventory(root);
  insist(actual.length === declared.length + 1 && actual.every((name) =>
    name === 'release.json' || Object.hasOwn(manifest.files, name)));
  const installed = new Set();
  for (const name of declared) {
    const packageMatch = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\/package.json$/.exec(name);
    const content = await readFileChecked(path.join(root, name), packageMatch ? LIMIT : Infinity);
    insist(content.hash === manifest.files[name]);
    if (packageMatch) {
      const packageName = packageMatch[1];
      const metadata = JSON.parse(content.bytes.toString('utf8'));
      insist(Object.hasOwn(manifest.packages, packageName) && metadata.name === packageName &&
        metadata.version === manifest.packages[packageName]);
      // Follow the installed version's declared requirements. Newer tsx does
      // not require the get-tsconfig/resolve-pkg-maps chain used by older builds.
      if (metadata.dependencies !== undefined) {
        insist(record(metadata.dependencies) && Object.keys(metadata.dependencies).every(name =>
          PACKAGE.test(name) && Object.hasOwn(manifest.packages, name)));
      }
      installed.add(packageName);
    }
  }
  insist(packages.every((name) => installed.has(name)));
  await canonical(path.dirname(path.resolve(executable)));
  insist((await readFileChecked(executable)).hash === manifest.node.sha256);
  return { root, entry: path.join(root, 'apps/api/main.ts'), manifest, manifestSha256: source.hash };
}

export async function resolveTrackRuntime(stateDir, repository,
  { executable = process.execPath, version = process.version } = {}) {
  const pointerPath = path.join(stateDir, 'track-runtime.json');
  try {
    await lstat(pointerPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A dangling state-directory link is not an absent pointer.
    try { await lstat(stateDir); } catch (stateError) {
      if (stateError.code !== 'ENOENT') throw stateError;
      let ancestor = path.dirname(path.resolve(stateDir));
      for (;;) {
        try { await lstat(ancestor); break; } catch (ancestorError) {
          if (ancestorError.code !== 'ENOENT') throw ancestorError;
          const parent = path.dirname(ancestor);
          insist(parent !== ancestor);
          ancestor = parent;
        }
      }
      await canonical(ancestor);
      return { mode: 'legacy', cwd: path.resolve(repository),
        entry: path.resolve(repository, 'apps/api/main.ts'), executable, manifestSha256: null };
    }
    await canonical(stateDir);
    return { mode: 'legacy', cwd: path.resolve(repository),
      entry: path.resolve(repository, 'apps/api/main.ts'), executable, manifestSha256: null };
  }
  const state = await canonical(stateDir);
  const pointer = JSON.parse((await readFileChecked(pointerPath, LIMIT)).bytes.toString('utf8'));
  keys(pointer, ['version', 'releaseDir', 'manifestSha256']);
  insist(pointer.version === 1 && typeof pointer.releaseDir === 'string' &&
    path.isAbsolute(pointer.releaseDir));
  const releases = await canonical(path.join(state, 'releases'));
  const release = await canonical(pointer.releaseDir);
  insist(path.dirname(release) === releases && path.resolve(pointer.releaseDir) === release);
  const verified = await verifyRuntimeRelease(release, pointer.manifestSha256, { executable, version });
  return { mode: 'frozen', cwd: verified.root, entry: verified.entry,
    executable, manifestSha256: verified.manifestSha256 };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    const selected = await resolveTrackRuntime(path.join(homedir(), '.local/share/agent-track'),
      path.resolve(path.dirname(modulePath), '../..'));
    process.stdout.write(JSON.stringify(selected) + '\n');
  } catch {
    process.stderr.write('Track runtime verification failed\n');
    process.exitCode = 1;
  }
}

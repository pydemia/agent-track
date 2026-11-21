import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, '../../..');
const output = resolve(root, '.runtime/flow-reading-v2/preview');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [resolve(source, 'preview.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  outfile: resolve(output, 'preview.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});
await copyFile(resolve(source, 'index.html'), resolve(output, 'index.html'));
await copyFile(resolve(root, 'apps/web/public/favicon.ico'), resolve(output, 'favicon.ico'));
process.stdout.write(JSON.stringify({ built: true, path: output, operatingFilesChanged: false }) + '\n');

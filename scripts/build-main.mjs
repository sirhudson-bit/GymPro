import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';

const outDir = path.join('apps', 'desktop', 'dist');
fs.mkdirSync(outDir, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  external: ['electron'],
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['apps/desktop/src/main.ts'],
  outfile: path.join(outDir, 'main.cjs'),
});

await build({
  ...common,
  entryPoints: ['apps/desktop/src/preload.ts'],
  outfile: path.join(outDir, 'preload.cjs'),
});

console.log('main + preload bundled →', outDir);

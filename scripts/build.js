/* TableTap — `npm run build`.
   The site is a static folder of ES modules (no bundling), so "build" is a
   verification gate run locally and by the host before deploying:
     1. syntax-check every JS file the browser or the API loads (node --check),
     2. type-check neon.ts (the Neon infrastructure config).
   Exits non-zero on the first failing step. */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', '.vercel', '.neon']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(m?js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(root);
let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    process.stderr.write(`✗ ${path.relative(root, file)}\n${r.stderr}\n`);
  }
}
if (failed) {
  console.error(`Syntax check failed: ${failed} of ${files.length} files.`);
  process.exit(1);
}
console.log(`✓ syntax: ${files.length} JS files`);

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const t = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.json')], { encoding: 'utf8' });
if (t.status !== 0) {
  process.stderr.write(t.stdout + t.stderr);
  console.error('Type check failed.');
  process.exit(1);
}
console.log('✓ types: neon.ts');
console.log('Build OK.');

/* TableTap — `npm run build`.
   The site is a static folder of ES modules (no bundling), so "build" is:
     1. syntax-check every JS file the browser or the API loads (node --check),
     2. type-check neon.ts (the Neon infrastructure config),
     3. copy the static site into public/, the folder Vercel serves for a
        project without a framework. Only browser files go in (HTML pages,
        assets, manifest, service worker); server code, migrations, scripts,
        docs (incl. LOGINS.md) and env files stay out. The API is deployed
        separately by Vercel from api/.
   Exits non-zero on the first failing step. */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', '.vercel', '.neon', 'public']);

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

// 3. Static output.
const OUT = path.join(root, 'public');
const SERVER_ONLY_DIRS = new Set(['api', 'db', 'scripts', 'functions', 'node_modules', 'public']);
const ROOT_FILE = /\.(html|webmanifest|ico|png|svg|txt|xml)$/i;
const ROOT_EXTRA = new Set(['manifest.json', 'sw.js']);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
let copied = 0;
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  const { name } = entry;
  if (name.startsWith('.')) continue;
  const from = path.join(root, name);
  if (entry.isDirectory()) {
    if (SERVER_ONLY_DIRS.has(name)) continue;
    fs.cpSync(from, path.join(OUT, name), { recursive: true, filter: (src) => !path.basename(src).startsWith('.') });
    copied += 1;
  } else if (ROOT_FILE.test(name) || ROOT_EXTRA.has(name)) {
    fs.copyFileSync(from, path.join(OUT, name));
    copied += 1;
  }
}
if (!fs.existsSync(path.join(OUT, 'index.html'))) {
  console.error('Static output is missing index.html.');
  process.exit(1);
}
console.log(`✓ static: ${copied} entries → public/`);
console.log('Build OK.');

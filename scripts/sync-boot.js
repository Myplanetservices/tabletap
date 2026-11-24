/* TableTap — scripts/sync-boot.js
   The shell boot snippet (assets/js/shell-boot.js) has to run *inline*: an external
   script makes the browser fetch it first and paint an empty sidebar in the meantime,
   which is the flicker it exists to remove. So the snippet is pasted into every page
   that has the app shell, and this script keeps those copies identical to the source.
   Run by `npm run build` (and by hand: `node scripts/sync-boot.js`).
   Pages are found by their `<div id="app-topbar">`; the copy sits right after it. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'assets/js/shell-boot.js'), 'utf8');

// Drop comments and indentation; the snippet has no strings containing "//" or "/*".
const minified = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"])\/\/.*$/gm, '$1')
  .split('\n').map((line) => line.trim()).filter(Boolean).join('');
const TAG = `<script data-shell-boot>${minified}</script>`;

const EXTERNAL = /<script src="[^"]*shell-boot\.js"><\/script>/;
const INLINE = /<script data-shell-boot>[\s\S]*?<\/script>/;

let changed = 0;
let total = 0;
for (const dir of ['admin', 'owner', 'waiter']) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.html'))) {
    const p = path.join(full, file);
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.includes('id="app-topbar"')) continue;
    total += 1;
    const crlf = raw.includes('\r\n');
    let html = raw.replace(/\r\n/g, '\n');
    const before = html;
    if (EXTERNAL.test(html)) html = html.replace(EXTERNAL, () => TAG);
    else if (INLINE.test(html)) html = html.replace(INLINE, () => TAG);
    else html = html.replace('<div id="app-topbar"></div>', () => `<div id="app-topbar"></div>\n    ${TAG}`);
    if (html !== before) {
      fs.writeFileSync(p, crlf ? html.replace(/\n/g, '\r\n') : html);
      changed += 1;
    }
  }
}
console.log(`✓ shell boot: ${total} pages, ${changed} updated`);

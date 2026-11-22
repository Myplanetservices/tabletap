/* TableTap — load the app's seed data into Neon Postgres.
     npm run db:seed              insert seed records that are missing (never overwrites)
     npm run db:seed -- --reset   mark every existing record deleted, then write the full seed
   The data comes from seedData() in assets/js/store.js, the same function the
   app used to build its local demo database, so Neon gets exactly that set. */

import '../api/_lib/env.js';
import { sql, pool, isCollectionName, applyChanges } from '../api/_lib/pg.js';

const reset = process.argv.includes('--reset');

// store.js is a browser module; in Node it skips its cloud sync and its
// kitchen-code timer, and seedData() is pure.
const { seedData } = await import('../assets/js/store.js');
const data = seedData();

const upserts = [];
const skipped = {};
for (const [collection, list] of Object.entries(data)) {
  if (!Array.isArray(list)) continue;
  if (!isCollectionName(collection)) { skipped[collection] = list.length; continue; }
  for (const record of list) {
    if (record && record.id !== undefined && record.id !== null) upserts.push({ collection, record });
    else skipped[collection] = (skipped[collection] || 0) + 1;
  }
}

try {
  if (reset) {
    const { rowCount } = await sql(`UPDATE tt_docs SET deleted_at = now(), updated_at = now() WHERE deleted_at IS NULL`);
    console.log(`reset: marked ${rowCount} existing record(s) deleted`);
    const result = await applyChanges({ upserts });
    console.log(`seeded: ${result.upserted} record(s) written`);
  } else {
    const rows = upserts.map((u) => ({ c: u.collection, i: String(u.record.id), d: u.record }));
    const { rowCount } = await sql(
      `INSERT INTO tt_docs (collection, id, data)
       SELECT x->>'c', x->>'i', x->'d' FROM jsonb_array_elements($1::jsonb) AS x
       ON CONFLICT (collection, id) DO NOTHING`,
      [JSON.stringify(rows)],
    );
    console.log(`seeded: ${rowCount} missing record(s) inserted, ${upserts.length - rowCount} already present`);
  }

  if (Object.keys(skipped).length) console.warn('skipped (no id or bad collection name):', skipped);

  const { rows } = await sql(
    `SELECT collection, count(*)::int AS records FROM tt_docs WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 1`,
  );
  console.table(rows);
} finally {
  await pool().end();
}

/* TableTap — apply SQL migrations in db/migrations to Neon Postgres.
   Uses the DIRECT connection (DATABASE_URL_UNPOOLED): migrations must not go
   through the transaction-mode pooler. Each file runs once, in name order,
   inside its own transaction, and is recorded in tt_migrations. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL_UNPOOLED is not set. Run `neon env pull` first.');
  process.exit(1);
}

const dir = path.join(root, 'db', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS tt_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await client.query('SELECT name FROM tt_migrations')).rows.map((r) => r.name));

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO tt_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
      applied += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${file}: ${err.message}`);
    }
  }
  console.log(applied ? `${applied} migration(s) applied.` : 'Database is up to date.');
} finally {
  await client.end();
}

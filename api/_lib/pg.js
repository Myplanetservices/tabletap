/* TableTap — Neon Postgres access for the API handlers.
   node-postgres over the POOLED DATABASE_URL, which suits both the local Node
   server and Vercel Fluid compute (attachDatabasePool lets the platform drain
   idle clients before an instance is suspended). The pool lives on globalThis
   because server.js re-imports handler modules per request.

   Data model: every app record is one row of tt_docs keyed by (collection, id),
   with the record itself in `data` (jsonb). Deletes are tombstones
   (deleted_at) so polling browsers learn about them. */

import './env.js';
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

const KEY = Symbol.for('tabletap.pgPool');

export function hasPostgres() {
  return Boolean(process.env.DATABASE_URL);
}

export function pool() {
  if (!hasPostgres()) return null;
  if (!globalThis[KEY]) {
    const p = new pg.Pool({
      // Neon URLs say sslmode=require; verify-full keeps the same checks without pg's warning.
      connectionString: process.env.DATABASE_URL.replace('sslmode=require', 'sslmode=verify-full'),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    // An idle client dropping (e.g. compute scaled to zero) must not crash the process.
    p.on('error', (err) => console.error('Postgres pool error:', err.message));
    try { attachDatabasePool(p); } catch (_) { /* not on Vercel */ }
    globalThis[KEY] = p;
  }
  return globalThis[KEY];
}

export async function sql(text, params = []) {
  const p = pool();
  if (!p) throw new Error('DATABASE_URL is not set. Run `neon env pull` or set it in the host environment.');
  return p.query(text, params);
}

/* ------------------------------------------------------------ validation -- */

const COLLECTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const MAX_ID_LENGTH = 128;

export function isCollectionName(name) {
  return typeof name === 'string' && COLLECTION_NAME.test(name);
}

function recordId(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const id = record.id ?? record._id;
  if (id === undefined || id === null) return null;
  const s = String(id);
  return s && s.length <= MAX_ID_LENGTH ? s : null;
}

/* ------------------------------------------------------- whole-store sync -- */

/** Every live record grouped by collection, plus the cursor to poll from. */
export async function loadAll() {
  const [{ rows }, now] = await Promise.all([
    sql(`SELECT collection, data FROM tt_docs WHERE deleted_at IS NULL ORDER BY collection, id`),
    sql(`SELECT now() AS cursor`),
  ]);
  const db = {};
  for (const r of rows) (db[r.collection] ||= []).push(r.data);
  return { db, cursor: now.rows[0].cursor.toISOString() };
}

/**
 * Records changed since `since` (ISO time). The window overlaps by 10 seconds
 * so a transaction that committed late is never missed; clients merge
 * idempotently. Deleted records come back with deleted: true.
 */
export async function changesSince(since) {
  const from = new Date(since);
  if (Number.isNaN(from.getTime())) throw Object.assign(new Error('since must be an ISO timestamp'), { status: 400 });
  const { rows } = await sql(
    `SELECT collection, id, data, deleted_at IS NOT NULL AS deleted, now() AS cursor
     FROM tt_docs
     WHERE updated_at > $1::timestamptz - interval '10 seconds'
     ORDER BY updated_at
     LIMIT 5000`,
    [from.toISOString()],
  );
  const cursor = rows.length
    ? rows[0].cursor.toISOString()
    : (await sql('SELECT now() AS cursor')).rows[0].cursor.toISOString();
  return {
    cursor,
    changes: rows.map((r) => ({ collection: r.collection, id: r.id, deleted: r.deleted, data: r.deleted ? null : r.data })),
  };
}

/**
 * Applies a browser's batch: upserts = [{ collection, record }],
 * deletes = [{ collection, id }]. Unchanged records are not rewritten, so they
 * don't reappear in other devices' change feeds.
 */
export async function applyChanges({ upserts = [], deletes = [] } = {}) {
  const rows = new Map();
  for (const u of upserts) {
    const id = recordId(u && u.record);
    if (!u || !isCollectionName(u.collection) || !id) continue;
    const { _id, ...data } = u.record;
    rows.set(`${u.collection}\u0000${id}`, { c: u.collection, i: id, d: { ...data, id: data.id ?? id } });
  }
  const gone = new Map();
  for (const d of deletes) {
    if (!d || !isCollectionName(d.collection) || d.id === undefined || d.id === null) continue;
    const id = String(d.id);
    if (id.length > MAX_ID_LENGTH) continue;
    const key = `${d.collection}\u0000${id}`;
    if (!rows.has(key)) gone.set(key, { c: d.collection, i: id });
  }

  let upserted = 0;
  let deleted = 0;
  if (rows.size) {
    const r = await sql(
      `INSERT INTO tt_docs (collection, id, data, updated_at, deleted_at)
       SELECT x->>'c', x->>'i', x->'d', now(), NULL FROM jsonb_array_elements($1::jsonb) AS x
       ON CONFLICT (collection, id) DO UPDATE
         SET data = EXCLUDED.data, updated_at = now(), deleted_at = NULL
         WHERE tt_docs.data IS DISTINCT FROM EXCLUDED.data OR tt_docs.deleted_at IS NOT NULL`,
      [JSON.stringify([...rows.values()])],
    );
    upserted = r.rowCount;
  }
  if (gone.size) {
    const r = await sql(
      `UPDATE tt_docs t SET deleted_at = now(), updated_at = now()
       FROM jsonb_array_elements($1::jsonb) AS x
       WHERE t.collection = x->>'c' AND t.id = x->>'i' AND t.deleted_at IS NULL`,
      [JSON.stringify([...gone.values()])],
    );
    deleted = r.rowCount;
  }
  return { upserted, deleted, received: { upserts: rows.size, deletes: gone.size } };
}

/* ------------------------------------------------------ per-record helpers -- */

export async function listDocs(collection, { clientId, limit = 1000 } = {}) {
  const params = [collection];
  let where = 'collection = $1 AND deleted_at IS NULL';
  if (clientId) { params.push(clientId); where += ` AND client_id = $${params.length}`; }
  params.push(Math.min(Number(limit) || 1000, 5000));
  const { rows } = await sql(
    `SELECT data FROM tt_docs WHERE ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => r.data);
}

/** Upserts many records of one collection. */
export async function upsertDocs(collection, records) {
  return applyChanges({ upserts: records.map((record) => ({ collection, record })) });
}

/** Merges a partial patch into one live record. Returns null when it is missing. */
export async function patchDoc(collection, id, patch) {
  const { rows } = await sql(
    `UPDATE tt_docs SET data = data || $3::jsonb, updated_at = now()
     WHERE collection = $1 AND id = $2 AND deleted_at IS NULL
     RETURNING data`,
    [collection, String(id), JSON.stringify(patch)],
  );
  return rows[0] ? rows[0].data : null;
}

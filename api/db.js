import { hasPostgres, loadAll, changesSince, applyChanges } from './_lib/pg.js';
import { cors, preflight, jsonBody } from './_lib/http.js';
import { onOrderChanges, flushDue } from './_lib/push.js';

/* The app's data API. Neon Postgres is the source of truth; every page's
   store.js talks to it:
     GET  /api/db                → { db: { <collection>: [records] }, cursor }
     GET  /api/db?since=<cursor> → { changes: [{ collection, id, deleted, data }], cursor }
     POST /api/db { upserts: [{ collection, record }], deletes: [{ collection, id }] }
   NOTE: there is no server-side login (by request), so anyone who can reach
   this URL can read and change every restaurant's records. */

const MAX_BATCH = 2000;

export default async function handler(req, res) {
  cors(res);
  if (preflight(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!hasPostgres()) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    if (req.method === 'GET') {
      const since = (req.query || {}).since;
      // Screens poll every few seconds, which is when due review reminders go out.
      if (since) await flushDue().catch((err) => console.error('push flush:', err.message));
      return res.status(200).json(since ? await changesSince(since) : await loadAll());
    }

    if (req.method === 'POST') {
      const body = jsonBody(req);
      const upserts = Array.isArray(body.upserts) ? body.upserts : [];
      const deletes = Array.isArray(body.deletes) ? body.deletes : [];
      if (upserts.length + deletes.length > MAX_BATCH) {
        return res.status(413).json({ error: `At most ${MAX_BATCH} changes per request.` });
      }
      const result = await applyChanges({ upserts, deletes });
      // Guest notifications must never make a save fail.
      await onOrderChanges(upserts).catch((err) => console.error('push on order:', err.message));
      return res.status(200).json({ success: true, ...result });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('/api/db error:', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

import { hasPostgres, listDocs, upsertDocs } from './_lib/pg.js';
import { cors, preflight, jsonBody } from './_lib/http.js';

/* Menu REST API on Neon Postgres, for integrations outside the browser app.
     GET  /api/menu?clientId=           → { categories, items }
     POST /api/menu { type: 'item' | 'category', data: { id, ... } } */

export default async function handler(req, res) {
  cors(res);
  if (preflight(req, res)) return;
  if (!hasPostgres()) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    if (req.method === 'GET') {
      const { clientId } = req.query || {};
      const items = await listDocs('items', { clientId });
      const categories = (await listDocs('categories', { clientId }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      return res.status(200).json({ categories, items });
    }

    if (req.method === 'POST') {
      const { type, data } = jsonBody(req);
      if (!data || !data.id) return res.status(400).json({ error: 'data with id is required' });
      const record = { ...data, updatedAt: new Date().toISOString() };
      await upsertDocs(type === 'category' ? 'categories' : 'items', [record]);
      return res.status(200).json({ success: true, data: record });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

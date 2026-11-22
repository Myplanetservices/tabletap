import { hasPostgres, sql, listDocs, patchDoc } from './_lib/pg.js';
import { cors, preflight, jsonBody } from './_lib/http.js';

/* Orders REST API on Neon Postgres, for integrations outside the browser app
   (the app itself syncs through /api/db).
     GET   /api/orders?clientId=&status=&limit=
     POST  /api/orders { id, clientId, tableId?, ... }  create only, never overwrites
     PATCH /api/orders { id, ...fields } */

export default async function handler(req, res) {
  cors(res, 'GET,POST,PATCH,OPTIONS');
  if (preflight(req, res)) return;
  if (!hasPostgres()) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  try {
    if (req.method === 'GET') {
      const { clientId, status, limit = 100 } = req.query || {};
      let orders = await listDocs('orders', { clientId, limit });
      if (status) orders = orders.filter((o) => o.status === status);
      return res.status(200).json({ orders });
    }

    if (req.method === 'POST') {
      const order = jsonBody(req);
      if (!order || !order.id || !order.clientId) {
        return res.status(400).json({ error: 'Order object with id and clientId is required' });
      }
      if (order.tableId) {
        const { rows } = await sql(
          `SELECT count(*)::int AS n FROM tt_docs
           WHERE collection = 'orders' AND client_id = $1 AND data->>'tableId' = $2
             AND updated_at > now() - interval '1 minute'`,
          [order.clientId, order.tableId],
        );
        if (rows[0].n >= 5) return res.status(429).json({ error: 'Too many orders at once - please wait a moment.' });
      }
      const { rowCount } = await sql(
        `INSERT INTO tt_docs (collection, id, data) VALUES ('orders', $1, $2::jsonb)
         ON CONFLICT (collection, id) DO NOTHING`,
        [String(order.id), JSON.stringify(order)],
      );
      return res.status(rowCount ? 201 : 409).json(rowCount ? { success: true, order } : { error: 'An order with this id already exists.' });
    }

    if (req.method === 'PATCH') {
      const { id, ...updates } = jsonBody(req);
      if (!id) return res.status(400).json({ error: 'Order id is required' });
      const order = await patchDoc('orders', id, { ...updates, updatedAt: new Date().toISOString() });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      return res.status(200).json({ success: true, order });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

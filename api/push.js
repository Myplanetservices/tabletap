import { hasPostgres, sql } from './_lib/pg.js';
import { cors, preflight, jsonBody } from './_lib/http.js';
import { hasPush, isPushEndpoint, processOrder, flushDue } from './_lib/push.js';

/* Guest notifications.
   GET  /api/push → { configured, publicKey }
   POST /api/push { action: 'subscribe', orderId, subscription, returnPath }
   POST /api/push { action: 'flush' }   sends reminders that are due (safe to call
                                        from an outside scheduler) */

const MAX_PER_IP_HOUR = 30;
const KEY = /^[A-Za-z0-9_\-+/=]{10,200}$/;

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  cors(res, 'GET,POST,OPTIONS');
  if (preflight(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ configured: hasPush() && hasPostgres(), publicKey: process.env.VAPID_PUBLIC_KEY || '' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!hasPostgres() || !hasPush()) return res.status(503).json({ error: 'Notifications are not set up.' });

  const body = jsonBody(req);
  try {
    if (body.action === 'flush') return res.status(200).json({ sent: await flushDue() });
    if (body.action !== 'subscribe') return res.status(400).json({ error: 'Unknown action.' });

    const orderId = String(body.orderId || '').slice(0, 128);
    const sub = body.subscription || {};
    const endpoint = String(sub.endpoint || '');
    const p256dh = String(sub.keys?.p256dh || '');
    const auth = String(sub.keys?.auth || '');
    const returnPath = String(body.returnPath || '');
    if (!isPushEndpoint(endpoint) || endpoint.length > 1000 || !KEY.test(p256dh) || !KEY.test(auth)) {
      return res.status(400).json({ error: 'This browser sent an unusable subscription.' });
    }
    if (!/^\/menu\/order-status\.html\?[^\s]{0,400}$/.test(returnPath)) {
      return res.status(400).json({ error: 'Bad return path.' });
    }
    // Only a real, recent order can be subscribed to.
    const { rows: found } = await sql(
      `SELECT 1 FROM tt_docs WHERE collection = 'orders' AND id = $1 AND deleted_at IS NULL
       AND (data->>'createdAt')::timestamptz > now() - interval '12 hours'`,
      [orderId],
    );
    if (!found.length) return res.status(404).json({ error: 'Order not found.' });

    const ip = clientIp(req);
    const { rows: recent } = await sql(
      `SELECT count(*)::int AS n FROM tt_push WHERE ip = $1 AND created_at > now() - interval '1 hour'`,
      [ip],
    );
    if (recent[0].n >= MAX_PER_IP_HOUR) return res.status(429).json({ error: 'Too many requests.' });

    await sql(
      `INSERT INTO tt_push (order_id, endpoint, p256dh, auth, return_path, ip)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (order_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, return_path = EXCLUDED.return_path`,
      [orderId, endpoint, p256dh, auth, returnPath, ip],
    );
    await processOrder(orderId); // the food may be ready already
    return res.status(200).json({ status: 'subscribed' });
  } catch (err) {
    console.error('/api/push error:', err.message);
    return res.status(500).json({ error: 'Could not save the notification request.' });
  }
}

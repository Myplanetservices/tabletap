import { hasPostgres } from './_lib/pg.js';
import { verifyWebhookSignature } from './_lib/razorpay.js';
import { fulfilOrder } from './_lib/fulfil.js';

/* Razorpay webhook: a safety net for buyers who pay and then close the tab
   before the browser confirms. In the Razorpay dashboard add a webhook to
     https://<your-site>/api/razorpay-webhook
   for the "payment.captured" and "order.paid" events, and put its secret in
   RAZORPAY_WEBHOOK_SECRET. Needs the raw body for the signature. */

export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;   // local server.js
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!hasPostgres()) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const raw = await rawBody(req);
  if (!verifyWebhookSignature(raw, req.headers['x-razorpay-signature'])) {
    return res.status(400).json({ error: 'Bad signature.' });
  }

  let event;
  try { event = JSON.parse(raw); } catch (_) { return res.status(400).json({ error: 'Bad JSON.' }); }

  const payment = event?.payload?.payment?.entity;
  if (!['payment.captured', 'order.paid'].includes(event?.event) || !payment?.order_id || !payment?.id) {
    return res.status(200).json({ ignored: true });
  }

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https';
  try {
    await fulfilOrder({ orderId: payment.order_id, paymentId: payment.id, siteUrl: `${proto}://${host}` });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('webhook fulfil failed:', err.message);
    return res.status(500).json({ error: err.message });   // Razorpay retries on 5xx
  }
}

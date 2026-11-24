import { hasPostgres, sql } from './_lib/pg.js';
import { cors, preflight, jsonBody } from './_lib/http.js';
import { CURRENCY, PLANS, hasRazorpay, publicKeyId, createOrder, verifyPaymentSignature } from './_lib/razorpay.js';
import { fulfilOrder } from './_lib/fulfil.js';

/* Plan checkout (Razorpay).
   GET  /api/pay
     → { configured, keyId, currency, plans: { id: { name, usd, inr } } }
   POST /api/pay { action: 'order', planId, restaurant, ownerName, email, country, city, phone? }
     → { orderId, amount, currency, keyId }       price comes from PLANS, not the page
   POST /api/pay { action: 'verify', razorpay_order_id, razorpay_payment_id, razorpay_signature }
     → { status: 'paid', emailStatus, email }     creates the owner invite and emails it */

const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,24}$/;
const MAX_ORDERS_PER_IP_HOUR = 10;

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}

/** The public origin of this deployment, for the access link in the email. */
function siteUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = local ? 'http' : 'https';
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  cors(res, 'GET,POST,OPTIONS');
  if (preflight(req, res)) return;

  if (req.method === 'GET') {
    return res.status(200).json({ configured: hasRazorpay(), keyId: publicKeyId(), currency: CURRENCY, plans: PLANS });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!hasPostgres()) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  if (!hasRazorpay()) return res.status(503).json({ error: 'Payments are not set up yet. Please email hello@tabletap.app.' });

  const body = jsonBody(req);

  try {
    if (body.action === 'order') {
      const plan = PLANS[body.planId];
      const restaurant = clean(body.restaurant, 80);
      const ownerName = clean(body.ownerName, 80);
      const email = clean(body.email, 254).toLowerCase();
      const country = clean(body.country, 60);
      const city = clean(body.city, 60);
      const phone = clean(body.phone, 24);
      if (!plan) return res.status(400).json({ error: 'Choose a plan.' });
      if (!restaurant || !ownerName || !country || !city) return res.status(400).json({ error: 'Fill in every required field.' });
      if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

      const ip = clientIp(req);
      const { rows: recent } = await sql(
        `SELECT count(*)::int AS n FROM tt_payments WHERE ip = $1 AND created_at > now() - interval '1 hour'`,
        [ip],
      );
      if (recent[0].n >= MAX_ORDERS_PER_IP_HOUR) {
        return res.status(429).json({ error: 'Too many attempts. Please try again in a while.' });
      }

      const amount = plan.inr * 100;
      const order = await createOrder({
        amount,
        receipt: `tt_${Date.now().toString(36)}`,
        notes: { plan: body.planId, restaurant, email },
      });
      await sql(
        `INSERT INTO tt_payments (order_id, plan_id, amount, currency, restaurant, owner_name, email, country, city, phone, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [order.id, body.planId, amount, CURRENCY, restaurant, ownerName, email, country, city, phone || null, ip],
      );
      return res.status(200).json({ orderId: order.id, amount, currency: CURRENCY, keyId: publicKeyId() });
    }

    if (body.action === 'verify') {
      const orderId = String(body.razorpay_order_id || '');
      const paymentId = String(body.razorpay_payment_id || '');
      const signature = String(body.razorpay_signature || '');
      if (!orderId || !paymentId || !signature || !verifyPaymentSignature(orderId, paymentId, signature)) {
        return res.status(400).json({ error: 'Payment could not be verified.' });
      }
      const result = await fulfilOrder({ orderId, paymentId, siteUrl: siteUrl(req) });
      if (!result.purchase) return res.status(404).json({ error: 'Order not found.' });
      return res.status(200).json({ status: 'paid', emailStatus: result.emailStatus, email: result.purchase.email });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('pay failed:', err.message);
    return res.status(502).json({ error: err.message });
  }
}

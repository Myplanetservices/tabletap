/* TableTap — Razorpay helpers for the plan checkout.
     RAZORPAY_KEY_ID           rzp_live_... / rzp_test_... (also sent to the browser)
     RAZORPAY_KEY_SECRET       server only, never sent anywhere
     RAZORPAY_WEBHOOK_SECRET   optional; the secret set on the Razorpay webhook
   Prices live here, never in the browser: the amount charged always comes from
   this table, whatever the page sends. */

import './env.js';
import crypto from 'crypto';

export const CURRENCY = 'INR';

/** Lifetime plans. `inr` is in rupees; the USD price is the one shown on the site. */
export const PLANS = {
  starter: { name: 'Lifetime Starter', usd: 29, inr: 2499 },
  pro: { name: 'Lifetime Pro', usd: 49, inr: 4199 },
};

export function hasRazorpay() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function publicKeyId() {
  return process.env.RAZORPAY_KEY_ID || '';
}

function authHeader() {
  const token = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  return `Basic ${token}`;
}

/** Creates a Razorpay order. `amount` is in paise. */
export async function createOrder({ amount, receipt, notes }) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, currency: CURRENCY, receipt, notes }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.description || `Razorpay responded ${res.status}`);
  return body;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Checks the signature Razorpay Checkout returns after a payment. */
export function verifyPaymentSignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
}

/** Checks a webhook body against the X-Razorpay-Signature header. */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

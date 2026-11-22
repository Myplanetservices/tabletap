/* TableTap — transactional email through Resend (https://resend.com).
   Configure in the environment (never in browser code):
     RESEND_API_KEY   re_... key from the Resend dashboard
     EMAIL_FROM       verified sender, e.g. "TableTap <invites@yourdomain.com>"
     EMAIL_REPLY_TO   optional reply-to address
   Until both required values are set, sends are logged as not_configured. */

import './env.js';

export function hasResend() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Sends one email. Resolves { id } from Resend, or throws with the provider's
 * message. `idempotencyKey` makes a retried request send only once.
 */
export async function sendWithResend({ to, subject, html, type, idempotencyKey }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject,
      html,
      ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
      tags: [{ name: 'type', value: type }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || body.error || `Resend responded ${res.status}`);
  }
  return { id: body.id || null };
}

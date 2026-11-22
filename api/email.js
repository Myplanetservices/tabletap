import { hasPostgres, sql } from './_lib/pg.js';
import { hasResend, sendWithResend } from './_lib/email.js';
import { cors, preflight, jsonBody } from './_lib/http.js';

/* Sends the app's transactional emails (invites, welcome, account notices)
   through Resend. POST { to, subject, html, type, id? }
     → 200 { status: 'sent', id }            delivered to Resend
     → 202 { status: 'not_configured' }      RESEND_API_KEY / EMAIL_FROM unset
     → 429 { status: 'rate_limited' }
   Every attempt is written to tt_email_log.

   Abuse guard: with no server-side login this endpoint is reachable by anyone,
   so it only sends the app's own email types, caps volume per caller and per
   recipient, and refuses obviously foreign content. Add real auth before
   opening the product to the public. */

const TYPES = new Set(['invite', 'welcome', 'notice', 'reset', 'general']);
const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,24}$/;
const LIMITS = { perIpHour: 30, perRecipientHour: 5 };
const MAX_HTML = 100 * 1024;

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}

async function log(entry) {
  try {
    await sql(
      `INSERT INTO tt_email_log (type, recipient, subject, status, provider_id, error, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.type, entry.to, entry.subject, entry.status, entry.providerId || null, entry.error || null, entry.ip],
    );
  } catch (err) {
    console.error('email log failed:', err.message);
  }
}

export default async function handler(req, res) {
  cors(res, 'POST,OPTIONS');
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!hasPostgres()) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const { to, subject, html, type = 'general', id } = jsonBody(req);
  const recipient = String(to || '').trim();
  const title = String(subject || '').trim().slice(0, 200);
  const kind = String(type);
  const body = String(html || '');
  const ip = clientIp(req);

  if (!EMAIL.test(recipient)) return res.status(400).json({ error: 'A valid recipient email is required.' });
  if (!title) return res.status(400).json({ error: 'Subject is required.' });
  if (!TYPES.has(kind)) return res.status(400).json({ error: `Unknown email type "${kind}".` });
  if (!body || body.length > MAX_HTML) return res.status(400).json({ error: 'Email body is empty or larger than 100 KB.' });
  if (/<script[\s>]|<iframe[\s>]|javascript:/i.test(body)) {
    return res.status(400).json({ error: 'Email body contains disallowed content.' });
  }

  const entry = { type: kind, to: recipient, subject: title, ip };

  try {
    const { rows } = await sql(
      `SELECT
         count(*) FILTER (WHERE ip = $1)::int AS by_ip,
         count(*) FILTER (WHERE lower(recipient) = lower($2))::int AS by_recipient
       FROM tt_email_log
       WHERE created_at > now() - interval '1 hour' AND status IN ('sent', 'failed')`,
      [ip, recipient],
    );
    if (rows[0].by_ip >= LIMITS.perIpHour || rows[0].by_recipient >= LIMITS.perRecipientHour) {
      await log({ ...entry, status: 'rate_limited' });
      return res.status(429).json({ status: 'rate_limited', error: 'Too many emails. Please try again later.' });
    }

    if (!hasResend()) {
      await log({ ...entry, status: 'not_configured' });
      return res.status(202).json({ status: 'not_configured', message: 'Email is not configured yet (RESEND_API_KEY / EMAIL_FROM).' });
    }

    const sent = await sendWithResend({
      to: recipient,
      subject: title,
      html: body,
      type: kind,
      idempotencyKey: id ? `tabletap-${String(id).slice(0, 200)}` : undefined,
    });
    await log({ ...entry, status: 'sent', providerId: sent.id });
    return res.status(200).json({ status: 'sent', id: sent.id });
  } catch (err) {
    await log({ ...entry, status: 'failed', error: err.message });
    return res.status(502).json({ status: 'failed', error: err.message });
  }
}

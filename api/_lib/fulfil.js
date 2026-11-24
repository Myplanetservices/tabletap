/* TableTap — what happens after a plan is paid.
   One paid order creates one owner invite (the same record the admin's invite
   screen makes) and emails its access link to the buyer. Safe to call twice
   for the same order (browser verify and webhook both do): only the call that
   flips the order from "created" to "paid" does the work. */

import crypto from 'crypto';
import { sql, upsertDocs } from './pg.js';
import { hasResend, sendWithResend } from './email.js';
import { PLANS } from './razorpay.js';

const INVITE_DAYS = 7;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The site's themed email shell (same look as assets/js/mailer.js). */
function emailHtml({ heading, preheader, bodyHtml, actionText, actionUrl, footnote }) {
  const C = { chalk: '#F4F2ED', paper: '#FFFFFF', ink: '#111318', ink2: '#3E434B', muted: '#5E636B', line: '#DBD6CB', cobalt: '#1B3FD8', cobaltWash: '#E8ECFB', graphite: '#15171C' };
  const display = "'Anton','Archivo Narrow','Arial Narrow',Impact,sans-serif";
  const body = "'Archivo',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${heading}</title><link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background-color:${C.chalk};font-family:${body};color:${C.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.chalk};padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${C.paper};border:1px solid ${C.line};border-radius:16px;overflow:hidden;">
<tr><td style="padding:20px 32px;background-color:${C.graphite};"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="width:34px;height:34px;background-color:${C.cobalt};border-radius:9px;color:#FFFFFF;font-family:${display};font-size:19px;line-height:34px;text-align:center;vertical-align:middle;">T</td>
<td style="padding-left:11px;font-family:${display};font-size:20px;letter-spacing:0.04em;text-transform:uppercase;color:#F3F1EC;">TableTap</td></tr></table></td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background-color:${C.cobalt};">&nbsp;</td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 14px;"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${C.cobaltWash};color:${C.cobalt};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Payment received</span></p>
<h1 style="margin:0 0 18px;font-family:${display};font-size:30px;line-height:1.15;font-weight:400;letter-spacing:0.01em;text-transform:uppercase;color:${C.ink};">${heading}</h1>
<div style="font-size:15px;line-height:1.65;color:${C.ink2};">${bodyHtml}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;"><tr><td style="background-color:${C.cobalt};border-radius:12px;"><a href="${actionUrl}" style="display:inline-block;padding:14px 30px;font-family:${body};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">${actionText}</a></td></tr></table>
<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:${C.muted};">If the button does not work, copy this link into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${actionUrl}" style="color:${C.cobalt};text-decoration:underline;">${actionUrl}</a></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};margin-top:24px;"><tr><td style="padding-top:16px;font-size:13px;line-height:1.6;color:${C.muted};">${footnote}</td></tr></table>
</td></tr>
<tr><td style="padding:22px 32px;border-top:1px solid ${C.line};background-color:${C.chalk};"><p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${C.muted};">TableTap by MyPlanetServices · Automated notification · Do not reply directly to this email.</p><p style="margin:0;font-size:12px;line-height:1.6;color:${C.muted};">14 Turner Road, Bengaluru 560001, India</p></td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Marks an order paid and grants access. `siteUrl` is the public origin the
 * access link points at. Resolves { first, purchase, emailStatus }.
 */
export async function fulfilOrder({ orderId, paymentId, siteUrl }) {
  const { rows } = await sql(
    `UPDATE tt_payments SET status = 'paid', payment_id = $2, paid_at = now()
     WHERE order_id = $1 AND status = 'created' RETURNING *`,
    [orderId, paymentId],
  );
  if (!rows[0]) {
    const existing = (await sql('SELECT * FROM tt_payments WHERE order_id = $1', [orderId])).rows[0];
    return { first: false, purchase: existing || null, emailStatus: existing?.email_status || null };
  }
  const p = rows[0];
  const plan = PLANS[p.plan_id];
  const now = Date.now();
  const invite = {
    id: 'inv_' + crypto.randomBytes(5).toString('hex'),
    token: 'tok_' + crypto.randomBytes(9).toString('hex'),
    clientName: p.restaurant,
    ownerName: p.owner_name,
    email: p.email,
    country: p.country,
    city: p.city,
    phone: p.phone || '',
    planId: p.plan_id,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_DAYS * 86400000).toISOString(),
    sentBy: 'Razorpay checkout',
    paymentId,
    orderId,
  };
  await upsertDocs('invites', [invite]);
  await upsertDocs('activity', [{
    id: 'act_' + crypto.randomBytes(5).toString('hex'),
    actor: 'Razorpay',
    clientId: null,
    type: 'Payment',
    details: `${plan ? plan.name : p.plan_id} paid by ${p.owner_name} for ${p.restaurant} (${paymentId}). Access link sent to ${p.email}.`,
    at: new Date(now).toISOString(),
  }]);

  const accessUrl = `${siteUrl}/auth/accept-invite.html?token=${invite.token}`;
  const money = `₹${(p.amount / 100).toLocaleString('en-IN')}`;
  const html = emailHtml({
    heading: 'Your TableTap access is ready',
    preheader: `Thanks for your payment. Set your password to open ${p.restaurant}'s dashboard.`,
    bodyHtml:
      `<p style="margin:0 0 16px;">Hi ${esc(p.owner_name)},</p>` +
      `<p style="margin:0 0 16px;">We received your payment of <strong>${esc(money)}</strong> for the <strong>${esc(plan ? plan.name : p.plan_id)}</strong> plan. <strong>${esc(p.restaurant)}</strong> (${esc(p.city)}, ${esc(p.country)}) is set up and waiting for you.</p>` +
      `<p style="margin:0 0 16px;">Choose your password to open the dashboard, add your menu and print your table QR codes.</p>`,
    actionText: 'Set password and open dashboard',
    actionUrl: accessUrl,
    footnote: `This access link is for <strong style="color:#111318;">${esc(p.email)}</strong> and expires in ${INVITE_DAYS} days. Payment ${esc(paymentId)} · order ${esc(orderId)}. Keep this email as your receipt, or write to hello@tabletap.app for a GST invoice.`,
  });

  let emailStatus = 'not_configured';
  const subject = `Your TableTap access is ready, ${p.owner_name.split(' ')[0]}`;
  try {
    if (hasResend()) {
      await sendWithResend({ to: p.email, subject, html, type: 'invite', idempotencyKey: `tabletap-pay-${orderId}` });
      emailStatus = 'sent';
    }
  } catch (err) {
    console.error('access email failed:', err.message);
    emailStatus = 'failed';
  }
  await sql(`UPDATE tt_payments SET invite_id = $2, email_status = $3 WHERE order_id = $1`, [orderId, invite.id, emailStatus]);
  // The admin's Payments page reads this record (no card data; Razorpay holds that).
  await upsertDocs('payments', [{
    id: orderId, orderId, paymentId, planId: p.plan_id, planName: plan ? plan.name : p.plan_id,
    amount: p.amount / 100, currency: p.currency, restaurant: p.restaurant, ownerName: p.owner_name,
    email: p.email, country: p.country, city: p.city, phone: p.phone || '',
    paidAt: new Date(now).toISOString(), inviteId: invite.id, emailStatus,
  }]);
  try {
    await sql(
      `INSERT INTO tt_email_log (type, recipient, subject, status, error, ip) VALUES ('invite', $1, $2, $3, NULL, $4)`,
      [p.email, subject, emailStatus === 'sent' ? 'sent' : emailStatus, p.ip || null],
    );
  } catch (_) { /* log only */ }
  return { first: true, purchase: { ...p, invite_id: invite.id }, emailStatus };
}

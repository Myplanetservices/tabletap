/* ==========================================================================
   TableTap — mailer.js
   Central email sender. Every email is recorded in the "outbox" collection
   (the dev mailbox at dev/mailbox.html) and sent through the server's
   /api/email endpoint, which delivers it with Resend. The outbox record gets
   the delivery result: deliveryStatus = sent | not_configured | rate_limited | failed.
   ========================================================================== */

import { insert, update, getAll, logActivity } from './store.js';
import { toast, esc } from './helpers.js';

const API_EMAIL = new URL('../../api/email', import.meta.url).href;

const MESSAGES = {
  sent: ['Email sent to ', 'success'],
  not_configured: ['Email service is not set up yet. Saved to the outbox for ', 'warning'],
  rate_limited: ['Too many emails right now. Saved to the outbox for ', 'warning'],
  failed: ['Email could not be sent. Saved to the outbox for ', 'error'],
};

function notify(status, to) {
  const [text, tone] = MESSAGES[status] || MESSAGES.failed;
  try { toast(text + to + '.', tone); } catch (e) { /* toast DOM unavailable */ }
}

async function deliver(record) {
  let status = 'failed';
  let detail = '';
  try {
    const payload = JSON.stringify({ id: record.id, to: record.to, subject: record.subject, html: record.html, type: record.type });
    const res = await fetch(API_EMAIL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      // Some flows navigate away right after sending; keepalive lets the request finish.
      keepalive: payload.length < 60000,
    });
    const body = await res.json().catch(() => ({}));
    status = body.status || (res.ok ? 'sent' : 'failed');
    detail = body.id || body.error || body.message || '';
  } catch (err) {
    detail = err.message;
  }
  update('outbox', record.id, { deliveryStatus: status, deliveryDetail: detail, deliveredAt: new Date().toISOString() });
  notify(status, record.to);
  try { window.dispatchEvent(new CustomEvent('tt:email-status', { detail: { status, to: record.to } })); } catch (e) { /* no window */ }
  return status;
}

/**
 * Send an email. Records it in the outbox immediately and delivers it in the
 * background; the caller does not wait.
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Subject line
 * @param {string} options.html - Full HTML email content
 * @param {string} [options.type] - 'invite' | 'welcome' | 'notice' | 'reset' | 'general'
 * @returns {Object} Saved outbox record (deliveryStatus starts as 'sending')
 */
export function sendEmail({ to, subject, html, type = 'general' }) {
  const emailRecord = insert('outbox', {
    to: String(to || '').trim(),
    subject: String(subject || '').trim(),
    html: String(html || ''),
    type: String(type || 'general'),
    read: false,
    deliveryStatus: 'sending',
    createdAt: new Date().toISOString(),
  });
  deliver(emailRecord);
  return emailRecord;
}

/**
 * Helper to build an email HTML document matching email/invite.html design.
 * @param {Object} opts
 * @param {string} opts.title - Small header pill / label
 * @param {string} opts.heading - H1 text
 * @param {string} [opts.preheader] - Preview text
 * @param {string} opts.bodyHtml - Paragraphs / content HTML
 * @param {string} [opts.actionText] - Call to action button text
 * @param {string} [opts.actionUrl] - Call to action URL
 * @param {string} [opts.footnote] - Optional extra note or footer text
 * @returns {string} Complete HTML string
 */
export function renderEmailTemplate({ title, heading, preheader = '', bodyHtml, actionText = '', actionUrl = '', footnote = '' }) {
  // Colours mirror assets/css/style.css: chalk ground, graphite chrome, signage cobalt.
  const C = {
    chalk: '#F4F2ED', paper: '#FFFFFF', ink: '#111318', ink2: '#3E434B', muted: '#5E636B',
    line: '#DBD6CB', cobalt: '#1B3FD8', cobaltWash: '#E8ECFB', graphite: '#15171C',
  };
  const display = "'Anton','Archivo Narrow','Arial Narrow',Impact,sans-serif";
  const body = "'Archivo',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${heading}</title>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:${C.chalk};font-family:${body};color:${C.ink};">

  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>` : ''}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.chalk};padding:32px 16px;">
    <tr>
      <td align="center">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${C.paper};border:1px solid ${C.line};border-radius:16px;overflow:hidden;">

          <!-- Header: graphite chrome with the cobalt mark -->
          <tr>
            <td style="padding:20px 32px;background-color:${C.graphite};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:34px;height:34px;background-color:${C.cobalt};border-radius:9px;color:#FFFFFF;font-family:${display};font-size:19px;line-height:34px;text-align:center;vertical-align:middle;">T</td>
                  <td style="padding-left:11px;font-family:${display};font-size:20px;letter-spacing:0.04em;text-transform:uppercase;color:#F3F1EC;">TableTap</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="height:4px;line-height:4px;font-size:0;background-color:${C.cobalt};">&nbsp;</td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${title ? `<p style="margin:0 0 14px;"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${C.cobaltWash};color:${C.cobalt};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${title}</span></p>` : ''}

              <h1 style="margin:0 0 18px;font-family:${display};font-size:30px;line-height:1.15;font-weight:400;letter-spacing:0.01em;text-transform:uppercase;color:${C.ink};">${heading}</h1>

              <div style="font-size:15px;line-height:1.65;color:${C.ink2};">
                ${bodyHtml}
              </div>

              ${actionText && actionUrl ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">
                <tr>
                  <td style="background-color:${C.cobalt};border-radius:12px;">
                    <a href="${actionUrl}" style="display:inline-block;padding:14px 30px;font-family:${body};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">${actionText}</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:${C.muted};">If the button does not work, copy this link into your browser:</p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${actionUrl}" style="color:${C.cobalt};text-decoration:underline;">${actionUrl}</a></p>
              ` : ''}

              ${footnote ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};margin-top:24px;">
                <tr><td style="padding-top:16px;font-size:13px;line-height:1.6;color:${C.muted};">${footnote}</td></tr>
              </table>` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:22px 32px;border-top:1px solid ${C.line};background-color:${C.chalk};">
              <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${C.muted};">
                TableTap by MyPlanetServices · Automated notification · Do not reply directly to this email.
              </p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:${C.muted};">
                14 Turner Road, Bengaluru 560001, India
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

/**
 * Create a 30-minute, single-use reset token and email the account its reset link.
 * Used by "Forgot password" and by the admin "Reset password" button.
 * @param {{id:string,email:string,name?:string,clientId?:string}} account owner or admin record
 * @param {'owner'|'admin'} userType
 * @param {string} [requestedBy] who asked for it, for the activity log
 */
export function sendPasswordResetLink(account, userType, requestedBy = '') {
  const token = 'rst_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  insert('reset_tokens', {
    token,
    email: account.email,
    userType,
    userId: account.id,
    used: false,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });

  const resetUrl = new URL('../../auth/reset-password.html?token=' + token, import.meta.url).href;
  const html = renderEmailTemplate({
    title: 'Security',
    heading: 'Reset your TableTap password',
    preheader: 'Use this link to set a new password. It expires in 30 minutes.',
    bodyHtml: `
      <p style="margin:0 0 16px;">Hi ${account.name || 'there'},</p>
      <p style="margin:0 0 16px;">${requestedBy ? 'An administrator asked' : 'We received a request'} to reset the password for your TableTap account (${account.email}).</p>
      <p style="margin:0 0 16px;">Use the button below to set a new password. The link is valid for <strong>30 minutes</strong> and works once.</p>
    `,
    actionText: 'Reset password',
    actionUrl: resetUrl,
    footnote: 'If you did not expect this email, you can ignore it. Your password stays the same until you use the link.',
  });
  sendEmail({ to: account.email, subject: 'Reset your TableTap password', html, type: 'reset' });
  logActivity({
    actor: requestedBy || account.name || 'System',
    clientId: account.clientId || null,
    type: 'Password',
    details: 'Password reset link emailed to ' + account.email,
  });
  return token;
}

/**
 * Security notice sent after a password changed (by the owner, by a reset link, or by an admin).
 */
export function sendPasswordChangedEmail({ to, name = '', via = '' }) {
  if (!to) return null;
  const when = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const html = renderEmailTemplate({
    title: 'Security',
    heading: 'Your password was changed',
    preheader: 'The password for your TableTap account was just changed.',
    bodyHtml: `
      <p style="margin:0 0 16px;">Hi ${name || 'there'},</p>
      <p style="margin:0 0 16px;">The password for your TableTap account (${to}) was changed on <strong>${when}</strong>${via ? ' ' + via : ''}.</p>
      <p style="margin:0 0 16px;">If this was you, nothing more to do. If it was not, reset your password right away and contact us.</p>
    `,
    actionText: 'Reset password',
    actionUrl: new URL('../../auth/forgot-password.html', import.meta.url).href,
    footnote: 'You get this email every time a TableTap password changes, so a change you did not make never goes unnoticed.',
  });
  return sendEmail({ to, subject: 'Your TableTap password was changed', html, type: 'notice' });
}

/**
 * Fill {{variables}} in an admin-editable template (Admin → Settings → Invite template).
 * Values are HTML-escaped. Known variables: owner_name, restaurant_name, plan_name,
 * invite_link, expiry_days, sender_name.
 */
export function fillTemplate(text, vars) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    (key in vars ? esc(String(vars[key] ?? '')) : match));
}

/**
 * Invite email built from the platform's invite template, so the restaurant, owner,
 * plan, link, expiry and sender always come from the invite being sent.
 * @returns {{subject:string, html:string}}
 */
export function buildInviteEmail({ settings = {}, ownerName, restaurantName, planName, inviteUrl, expiryDays, senderName }) {
  const vars = {
    owner_name: ownerName,
    restaurant_name: restaurantName,
    plan_name: planName,
    invite_link: inviteUrl,
    expiry_days: expiryDays,
    sender_name: senderName,
  };
  const subject = fillTemplate(settings.inviteSubject || 'You are invited to TableTap, {{owner_name}}', vars)
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  // The button carries the link, so drop the raw "{{invite_link}}" from the text.
  const bodyText = String(settings.inviteBody || 'Hi {{owner_name}},\n\n{{restaurant_name}} is ready on TableTap.\n\nThis link expires in {{expiry_days}} days.')
    .replace(/\s*[:\-–—]?\s*\{\{\s*invite_link\s*\}\}/g, '.')
    .replace(/\.{2,}/g, '.').replace(/:\./g, '.');
  const paragraphs = fillTemplate(bodyText, vars).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const bodyHtml = paragraphs
    .map((p) => `<p style="margin:0 0 16px;">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const html = renderEmailTemplate({
    title: 'Your invite',
    heading: "You're invited to TableTap",
    preheader: `${esc(restaurantName)} is ready on TableTap. Set your password to open your dashboard.`,
    bodyHtml,
    actionText: 'Accept invite',
    actionUrl: inviteUrl,
    footnote: `This invite is for <strong style="color:#111318;">${esc(restaurantName)}</strong> and expires in ${esc(String(expiryDays))} days. If you did not expect it, you can ignore this email.`,
  });
  return { subject, html };
}

/* ---- Delivery problems: shown to admin and owner until they acknowledge them ---- */
const PROBLEM_STATUSES = ['failed', 'rate_limited', 'not_configured'];
const PROBLEM_WINDOW_MS = 7 * 24 * 3600 * 1000;

/**
 * Emails that were not delivered and nobody has acknowledged yet (last 7 days).
 * @param {string} [onlyTo] when set, only emails addressed to this address (the owner's view)
 */
export function emailProblems(onlyTo = '') {
  const since = Date.now() - PROBLEM_WINDOW_MS;
  const want = String(onlyTo || '').trim().toLowerCase();
  return getAll('outbox').filter((m) =>
    PROBLEM_STATUSES.includes(m.deliveryStatus) &&
    !m.ackAt &&
    new Date(m.createdAt).getTime() >= since &&
    (!want || String(m.to || '').toLowerCase() === want));
}

/** Mark problems as seen by a person. Keeps the email in the mailbox. */
export function acknowledgeEmailProblems(ids, by = '') {
  ids.forEach((id) => update('outbox', id, { ackAt: new Date().toISOString(), ackBy: by }));
  try { window.dispatchEvent(new CustomEvent('tt:email-status', { detail: { status: 'ack' } })); } catch (e) { /* no window */ }
}

/** Send an undelivered email again. */
export function retryEmail(id) {
  const record = getAll('outbox').find((m) => m.id === id);
  if (!record) return Promise.resolve('failed');
  update('outbox', id, { deliveryStatus: 'sending', deliveryDetail: '', ackAt: null });
  return deliver(record);
}

// TODO: replace with server call to Resend/Postmark when backend is ready.
/* ==========================================================================
   TableTap — mailer.js
   Central demo email sender. Saves outgoing emails to store collection "outbox".
   ========================================================================== */

import { insert } from './store.js';
import { toast } from './helpers.js';

/**
 * Send an email in demo mode.
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Subject line
 * @param {string} options.html - Full HTML email content
 * @param {string} [options.type] - Category / type of email (e.g. 'invite', 'welcome', 'reset', 'notice')
 * @returns {Object} Saved outbox record
 */
export function sendEmail({ to, subject, html, type = 'general' }) {
  const emailRecord = insert('outbox', {
    to: String(to || '').trim(),
    subject: String(subject || '').trim(),
    html: String(html || ''),
    type: String(type || 'general'),
    read: false,
    createdAt: new Date().toISOString(),
  });

  try {
    toast('Email saved to demo mailbox (email service not connected yet)', 'warning');
  } catch (e) {
    // In case toast DOM is unavailable
  }

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
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1C1917;">

  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>` : ''}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;padding:32px 16px;">
    <tr>
      <td align="center">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E7E5E4;border-radius:12px;">

          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #E7E5E4;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:32px;height:32px;background-color:#1F4D3A;border-radius:8px;color:#FFFFFF;font-size:15px;font-weight:600;text-align:center;vertical-align:middle;">T</td>
                  <td style="padding-left:10px;font-size:17px;font-weight:600;letter-spacing:-0.02em;color:#1C1917;">TableTap</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${title ? `<p style="margin:0 0 16px;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#1F4D3A;">${title}</p>` : ''}

              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:#1C1917;">${heading}</h1>

              <div style="font-size:15px;line-height:1.6;color:#1C1917;">
                ${bodyHtml}
              </div>

              ${actionText && actionUrl ? `
              <!-- Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
                <tr>
                  <td style="background-color:#1F4D3A;border-radius:12px;">
                    <a href="${actionUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${actionText}</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#78716C;">If the button does not work, copy this link into your browser:</p>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#1F4D3A;word-break:break-all;"><a href="${actionUrl}" style="color:#1F4D3A;text-decoration:underline;">${actionUrl}</a></p>
              ` : ''}

              ${footnote ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E7E5E4;margin-top:24px;padding-top:16px;">
                <tr><td style="font-size:13px;line-height:1.6;color:#78716C;">${footnote}</td></tr>
              </table>` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #E7E5E4;background-color:#FAFAF9;border-radius:0 0 12px 12px;">
              <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#78716C;">
                TableTap by MyPlanetServices · Automated notification · Do not reply directly to this email.
              </p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#78716C;">
                14 Turner Road, Bengaluru 560001, India · <a href="mailto:hello@tabletap.demo" style="color:#78716C;text-decoration:underline;">hello@tabletap.demo</a>
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

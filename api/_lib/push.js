/* TableTap — guest web push.
     VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   `npx web-push generate-vapid-keys`
     VAPID_SUBJECT                          optional contact (mailto: or https:)

   A guest who allows notifications gets at most two for an order: "your food
   is ready", and later a reminder to review the restaurant on Google.

   There is no job scheduler, so reminders that have come due are sent while
   serving the app's own data requests (staff screens poll every few seconds
   during service). A reminder more than 3 hours late is dropped. */

import './env.js';
import webpush from 'web-push';
import { sql } from './pg.js';
import { reviewSettings } from '../../assets/js/review-link.js';

const LATE_LIMIT = "interval '3 hours'";
const FLUSH_EVERY_MS = 20_000;
// Only the browsers' own push services; the endpoint comes from the guest's phone.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function hasPush() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function isPushEndpoint(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch (_) {
    return false;
  }
}

async function doc(collection, id) {
  const { rows } = await sql(
    'SELECT data FROM tt_docs WHERE collection = $1 AND id = $2 AND deleted_at IS NULL',
    [collection, String(id)],
  );
  return rows[0] ? rows[0].data : null;
}

const drop = (row) => sql('DELETE FROM tt_push WHERE order_id = $1 AND endpoint = $2', [row.order_id, row.endpoint]);

async function send(row, payload) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hello@tabletap.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload),
      { TTL: 3600, urgency: 'high', timeout: 8000 },
    );
    return true;
  } catch (err) {
    console.error('push failed:', err.statusCode || err.message);
    if (err.statusCode === 404 || err.statusCode === 410) await drop(row); // subscription is gone
    return false;
  }
}

/** Reacts to the stored state of one order. Safe to call any number of times. */
export async function processOrder(orderId) {
  const { rows: subs } = await sql('SELECT order_id FROM tt_push WHERE order_id = $1 LIMIT 1', [orderId]);
  if (!subs.length) return;
  const order = await doc('orders', orderId);
  if (!order || order.status === 'rejected' || order.status === 'voided') {
    await sql('DELETE FROM tt_push WHERE order_id = $1', [orderId]);
    return;
  }
  if (order.status !== 'ready' && order.status !== 'served') return;
  const client = await doc('clients', order.clientId);
  const name = (client && client.name) || 'The restaurant';

  if (order.status === 'ready') {
    // The UPDATE claims the rows, so two requests never send the same alert.
    const { rows } = await sql(
      'UPDATE tt_push SET ready_sent_at = now() WHERE order_id = $1 AND ready_sent_at IS NULL RETURNING *',
      [orderId],
    );
    await Promise.all(rows.map((row) => send(row, {
      title: `Your food is ready · ${name}`,
      body: `Order #${order.number} is on its way to your table.`,
      url: row.return_path,
      tag: `ready-${orderId}`,
    })));
    return;
  }

  const reviews = reviewSettings(client);
  if (!reviews.url) {
    await sql('DELETE FROM tt_push WHERE order_id = $1', [orderId]);
    return;
  }
  await sql(
    `UPDATE tt_push SET review_due_at = now() + make_interval(mins => $2)
     WHERE order_id = $1 AND review_due_at IS NULL`,
    [orderId, reviews.delayMinutes],
  );
}

/** Called after the app saves changes: handles any orders among them. */
export async function onOrderChanges(upserts) {
  if (!hasPush()) return;
  const ids = [...new Set(upserts
    .filter((u) => u && u.collection === 'orders' && u.record && ['ready', 'served', 'rejected', 'voided'].includes(u.record.status))
    .map((u) => String(u.record.id)))];
  if (!ids.length) return;
  const { rows } = await sql('SELECT DISTINCT order_id FROM tt_push WHERE order_id = ANY($1)', [ids]);
  for (const r of rows) await processOrder(r.order_id);
}

let lastFlush = 0;

/** Sends the review reminders that are due. `force` skips the per-instance throttle. */
export async function flushDue({ force = false } = {}) {
  if (!hasPush() || (!force && Date.now() - lastFlush < FLUSH_EVERY_MS)) return 0;
  lastFlush = Date.now();
  await sql(`DELETE FROM tt_push WHERE review_due_at < now() - ${LATE_LIMIT} OR created_at < now() - interval '24 hours'`);
  // DELETE ... RETURNING claims each reminder once and forgets the phone's subscription.
  const { rows } = await sql('DELETE FROM tt_push WHERE review_due_at <= now() RETURNING *');
  let sent = 0;
  for (const row of rows) {
    const order = await doc('orders', row.order_id);
    const client = order && await doc('clients', order.clientId);
    const reviews = reviewSettings(client);
    if (!reviews.url) continue;
    if (await send(row, {
      title: `How was your meal at ${client.name}?`,
      body: 'Tap to leave a review on Google.',
      url: reviews.url,
      tag: `review-${row.order_id}`,
    })) sent += 1;
  }
  return sent;
}

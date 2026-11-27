/* TableTap — guest side of the Google review feature: the review button and the
   "notify me" opt-in on the order status and bill pages.
   Web push needs a service worker and PushManager. iPhone Safari tabs have no
   PushManager, so iPhone guests see only the on-page review button. */

import { esc } from './helpers.js';
import { reviewSettings } from './review-link.js';

const API = new URL('../../api/push', import.meta.url).href;
const SW_URL = new URL('../../sw.js', import.meta.url).href;
const DONE_KEY = 'tt_push_orders';

let publicKey = '';
let busy = false;
let failed = '';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function subscribedOrders() {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); } catch (_) { return []; }
}

function remember(orderId) {
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...subscribedOrders(), orderId].slice(-20))); } catch (_) { /* private mode */ }
}

/** Loads the push key, then calls `redraw` if the opt-in card can now show. */
export async function initGuestPush(redraw) {
  if (!supported()) return;
  try {
    const info = await (await fetch(API)).json();
    if (info.configured && info.publicKey) { publicKey = info.publicKey; redraw(); }
  } catch (_) { /* offline: no opt-in card */ }
}

/** "Review us on Google", shown to every guest alike (never filtered by rating). */
export function reviewCardHtml(client) {
  const { url } = reviewSettings(client);
  if (!url) return '';
  return '<div class="status-card guest-card"><p class="guest-card__title">How was your visit?</p>' +
    '<p class="guest-card__text">A short Google review helps ' + esc(client.name) + '.</p>' +
    '<a class="btn btn--secondary btn--block" href="' + esc(url) + '" target="_blank" rel="noopener"><i data-lucide="star"></i> Review us on Google</a></div>';
}

/** A one-line "please leave a review" link, for the menu and a fresh order. */
export function reviewLinkHtml(client) {
  const { url } = reviewSettings(client);
  if (!url) return '';
  return '<a class="review-link" href="' + esc(url) + '" target="_blank" rel="noopener"><i data-lucide="star"></i> Please leave us a review on Google</a>';
}

/** The opt-in card for an order that is still on its way, or '' when it cannot work. */
export function notifyCardHtml(client, order) {
  if (!publicKey || !supported() || ['served', 'rejected', 'voided'].includes(order.status)) return '';
  const review = reviewSettings(client).url;
  if (subscribedOrders().includes(order.id) && Notification.permission === 'granted') {
    return '<div class="status-card guest-card"><p class="guest-card__text"><i data-lucide="bell-ring"></i> Notifications are on. You can close this page.</p></div>';
  }
  if (Notification.permission === 'denied') return '';
  return '<div class="status-card guest-card"><p class="guest-card__title">Tell me when my food is ready</p>' +
    '<p class="guest-card__text">We will notify this phone, even if you close the page.' +
    (review ? ' After your meal we send one reminder to review us on Google.' : '') + '</p>' +
    (failed ? '<p class="guest-card__error" role="alert">' + esc(failed) + '</p>' : '') +
    '<button class="btn btn--primary btn--block" type="button" data-notify-me' + (busy ? ' disabled' : '') + '><i data-lucide="bell"></i> ' +
    (busy ? 'Turning on…' : 'Notify me') + '</button></div>';
}

function keyBytes(base64) {
  const text = atob((base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** Asks for permission (from the tap), subscribes this phone and tells the server. */
export async function enableNotifications(orderId, redraw) {
  if (busy) return;
  busy = true;
  failed = '';
  try {
    if ((await Notification.requestPermission()) !== 'granted') return;
    redraw();
    await navigator.serviceWorker.register(SW_URL);
    const registration = await navigator.serviceWorker.ready;
    const subscription = (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'subscribe', orderId, subscription: subscription.toJSON(), returnPath: location.pathname + location.search }),
    });
    if (!res.ok) throw new Error('save failed');
    remember(orderId);
  } catch (_) {
    failed = 'Notifications could not be turned on. Your order is not affected.';
  } finally {
    busy = false;
    redraw();
  }
}

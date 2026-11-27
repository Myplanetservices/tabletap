/* ==========================================================================
   TableTap — customer.js
   Guest menu, cart and live order status. Reads ?r=<slug>&t=<table token>.
   ========================================================================== */

import {
  getAll, query, getById, insert, update, logActivity, resolveTaxOverride,
  openSessionForTable, sessionForTable, sessionOrders, sessionLines, addOrderToSession,
} from './store.js';
import { computeBill } from './billing.js';
import { emit, on } from './realtime.js';
import {
  formatMoney, formatTime, timeAgo, toast, qs, esc, el, openDrawer, closeDrawer,
  debounce, initials, statusBadge, formatElapsed,
} from './helpers.js';
import { ONLINE_PAYMENTS_ENABLED } from './features.js';
import { bestFix, judge, siteOf, formatDistance, GUEST_MAX_ACCURACY } from './geo.js';
import { initGuestPush, reviewCardHtml, reviewLinkHtml, notifyCardHtml, enableNotifications } from './guest-push.js';

const params = new URLSearchParams(location.search);
const CART_KEY = 'tqr_cart';

// Device testing helper (?device=<name>)
const testDevice = qs('device');
const DEVICE_ORDER_KEY = testDevice ? `tqr_device_${testDevice}_last_order` : 'tqr_device_last_order';

if (testDevice) {
  window.addEventListener('DOMContentLoaded', () => {
    const topbar = document.querySelector('.menu-topbar') || document.querySelector('.menu-header');
    if (topbar && !document.getElementById('device-test-badge')) {
      const badge = document.createElement('span');
      badge.id = 'device-test-badge';
      badge.className = 'badge badge--neutral';
      badge.style.cssText = 'font-size:11px;font-weight:700;margin-left:auto;background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;';
      badge.textContent = `Test device: ${testDevice}`;
      topbar.appendChild(badge);
    }
  });
}

/* ------------------------------------------------------------- resolve ---- */
function resolveContext() {
  const slug = qs('r');
  const token = qs('t');

  const client = slug
    ? query('clients', (c) => c.slug === slug)[0]
    : query('clients', (c) => c.slug === 'olive-table')[0];

  if (!client) return { error: 'invalid' };

  const tables = query('tables', (t) => t.clientId === client.id);
  const table = token
    ? tables.find((t) => t.token === token)
    : (tables.find((t) => t.token === 'oli-7') || tables.find((t) => t.name === 'Table 7') || tables[0]);
  if (!table) return { error: 'invalid' };

  if (client.status === 'suspended' || !client.restrictions.ordering || !client.settings.acceptOrders) {
    return { error: 'paused', client, table };
  }

  if (!isOpenNow(client)) return { error: 'closed', client, table };

  return { client, table };
}

function isOpenNow(client) {
  const hours = (client.settings && client.settings.hours) || {};
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = hours[days[new Date().getDay()]];
  if (!today || !today[0] || !today[1]) return false;
  const [openH, openM] = today[0].split(':').map(Number);
  const [closeH, closeM] = today[1].split(':').map(Number);
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  const open = openH * 60 + openM;
  const close = closeH * 60 + closeM;
  if (close < open) return now >= open || now < close;
  return now >= open && now < close;
}

function goUnavailable(reason, ctx = {}) {
  const search = new URLSearchParams({ reason });
  if (ctx.client) search.set('r', ctx.client.slug);
  location.replace('unavailable.html?' + search.toString());
}

/* ---------------------------------------------------------------- cart ---- */
function readCart() {
  try {
    return JSON.parse(sessionStorage.getItem(CART_KEY) || 'null');
  } catch (err) {
    return null;
  }
}

function writeCart(cart) {
  sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function cartFor(clientId, tableId) {
  const cart = readCart();
  if (!cart || cart.clientId !== clientId || cart.tableId !== tableId) {
    return { clientId, tableId, items: [] };
  }
  return cart;
}

function cartTotals(cart, settings) {
  const totals = computeBill({
    lines: cart.items.map((row) => ({ amount: row.price * row.qty, taxOverride: row.taxOverride || 'default' })),
    settings,
  });
  totals.count = cart.items.reduce((sum, row) => sum + row.qty, 0);
  return totals;
}

/* ------------------------------------------------------------- session & qr -- */
function renderVisitEnded() {
  const host = document.querySelector('.menu-app') || document.querySelector('.cart-app') || document.querySelector('.bill-app') || document.body;
  host.innerHTML = `
    <div class="empty" style="min-height: 80vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2rem;">
      <span class="empty__icon" style="width: 64px; height: 64px; margin-bottom: 1.5rem; display: inline-flex; align-items: center; justify-content: center; background: var(--surface-2); border-radius: 50%; color: var(--danger);">
        <i data-lucide="alert-circle" style="width: 32px; height: 32px;"></i>
      </span>
      <h1 class="empty__title" style="font-size: 1.5rem; font-weight: 700; color: var(--ink); margin-bottom: 0.5rem;">
        This visit has ended. Please ask staff.
      </h1>
      <p class="empty__text" style="color: var(--muted); max-width: 380px;">
        This table session has ended or the visit link has expired.
      </p>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

export function isDeviceTrusted(tableId, session) {
  if (!session || session.status !== 'open') return false;
  // The printed table QR is permanent: anyone who scans it joins the open visit.
  // No per-visit QR or PIN from staff is needed.
  try {
    localStorage.setItem('tqr_trusted_' + tableId, JSON.stringify({
      sessionId: session.id,
      joinSecret: session.joinSecret,
    }));
  } catch (e) { /* storage blocked: still allow */ }
  return true;
}

export function createWaiterCall(clientId, table, type) {
  const session = sessionForTable(clientId, table.id);
  if (!session || session.status !== 'open' || !isDeviceTrusted(table.id, session) || session.tableId !== table.id) {
    toast('Please ask staff to seat you', 'warning');
    return null;
  }
  const key = 'tqr_call_' + type;
  const last = Number(localStorage.getItem(key) || 0);
  const waitLeft = Math.ceil((120000 - (Date.now() - last)) / 1000);
  if (Date.now() - last < 120000) {
    toast('Please wait ' + waitLeft + 's before calling again.', 'warning');
    return null;
  }
  const call = insert('waiterCalls', {
    clientId,
    tableName: table.name,
    tableId: table.id,
    sessionId: session.id,
    type,
    status: 'open',
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(key, String(Date.now()));
  emit('call:new', { clientId, type, tableId: table.id });
  logActivity({
    actor: 'Guest · ' + table.name,
    clientId,
    type: 'Waiter call',
    details: type === 'bill' ? 'Bill requested' : 'Waiter called',
  });
  toast(type === 'bill' ? 'Waiter has been notified — bill on the way' : 'Waiter has been notified · ' + table.name);
  return call;
}

export function createBillRequest(clientId, table, methodId) {
  const session = sessionForTable(clientId, table.id);
  if (!session || session.status !== 'open' || !isDeviceTrusted(table.id, session) || session.tableId !== table.id) {
    toast('Please ask staff to seat you', 'warning');
    return null;
  }
  const method = ((table.settings || {}).paymentMethods || []).find((m) => m.id === methodId) || { name: methodId };
  const key = 'tqr_call_bill';
  const last = Number(localStorage.getItem(key) || 0);
  const cooling = Date.now() - last < 120000;
  if (!cooling) {
    const call = insert('waiterCalls', {
      clientId,
      tableName: table.name,
      tableId: table.id,
      sessionId: session.id,
      type: 'bill',
      status: 'open',
      paymentMethod: methodId,
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem(key, String(Date.now()));
    emit('call:new', { clientId, type: 'bill', tableId: table.id });
    logActivity({
      actor: 'Guest · ' + table.name,
      clientId,
      type: 'Bill',
      details: 'Bill requested · pays by ' + (method.name || methodId),
    });
    toast('Your waiter has been told · ' + table.name);
    return call;
  } else {
    toast('Your waiter already knows — ' + (method.name || methodId) + ' noted.', 'warning');
    return null;
  }
}

export function placeOrder({ client, table, cart, payment, note, guestName }) {
  const isPayFirst = ONLINE_PAYMENTS_ENABLED && client.settings?.payments?.policy === 'pay_first';
  const session = sessionForTable(client.id, table.id);
  if (!isPayFirst) {
    if (!session || session.status !== 'open' || !isDeviceTrusted(table.id, session) || session.tableId !== table.id) {
      toast('Please ask staff to seat you', 'warning');
      return null;
    }
  }

  const totals = cartTotals(cart, client.settings);
  const approval = !!client.settings.approval;
  const isPaid = payment && payment.method !== 'counter';
  const activeSessionId = session ? session.id : null;

  const order = insert('orders', {
    clientId: client.id,
    number: nextNumber(client.id),
    tableId: table.id,
    tableName: table.name,
    sessionId: activeSessionId,
    items: cart.items.map((row) => ({
      name: row.name,
      qty: row.qty,
      price: row.price,
      size: row.size,
      addons: row.addons,
      note: row.note,
      taxOverride: row.taxOverride || 'default',
      done: false,
    })),
    note: (note || '').trim(),
    guestName: (guestName || '').trim(),
    subtotal: totals.subtotal,
    tax: totals.taxTotal,
    service: totals.chargeTotal,
    total: totals.total,
    breakdown: totals,
    paid: isPaid,
    paymentMethod: payment ? payment.method : 'apple_pay',
    paymentTxnId: payment ? payment.txnId : null,
    paidAt: isPaid ? new Date().toISOString() : null,
    tableWasVacant: table.status === 'free',
    staffConfirmed: table.status !== 'free',
    status: approval ? 'pending_approval' : 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (session) {
    addOrderToSession(session.id, order.id);
  }
  return order;
}

function promptTableKeySheet(ctx, session, onSuccess) {
  const { client, table } = ctx;
  const existing = document.getElementById('table-key-modal');
  if (existing) existing.remove();

  const tableNameDisplay = /^table/i.test(table.name) ? table.name : `Table ${table.name}`;
  const rateKey = 'tqr_key_rate_' + table.id;
  function getRate() {
    try {
      return JSON.parse(localStorage.getItem(rateKey) || '{}');
    } catch (e) {
      return {};
    }
  }
  function saveRate(obj) {
    localStorage.setItem(rateKey, JSON.stringify(obj));
  }

  const modal = document.createElement('div');
  modal.className = 'modal is-open';
  modal.id = 'table-key-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="modal__dialog" style="max-width: 440px; text-align: center; position: relative;">
      <button class="btn btn--icon btn--sm" type="button" id="close-table-key-modal" aria-label="Close" style="position: absolute; top: 14px; right: 14px; border: none; background: transparent; cursor: pointer; font-size: 1.25rem; color: var(--muted);"><i data-lucide="x"></i></button>
      <div class="modal__header" style="justify-content: center; flex-direction: column; gap: 4px; padding-top: 0.5rem;">
        <h2 class="modal__title" style="font-size: 1.25rem;">${esc(tableNameDisplay)}</h2>
        <p class="muted text-sm" id="key-prompt-label">Enter the 4-digit key for this table to order</p>
      </div>
      <div class="modal__body" style="padding-top: 1rem;">
        <form id="key-sheet-form" onsubmit="return false;">
          <div class="key-boxes" style="display: flex; justify-content: center; gap: 10px; margin: 16px 0;">
            <input class="input" type="text" pattern="[0-9]*" inputmode="numeric" maxlength="1" data-pin-idx="0" style="width: 52px; height: 58px; text-align: center; font-size: 24px; font-family: var(--font-mono); font-weight: 700; border-radius: 10px;" autocomplete="off" autofocus>
            <input class="input" type="text" pattern="[0-9]*" inputmode="numeric" maxlength="1" data-pin-idx="1" style="width: 52px; height: 58px; text-align: center; font-size: 24px; font-family: var(--font-mono); font-weight: 700; border-radius: 10px;" autocomplete="off">
            <input class="input" type="text" pattern="[0-9]*" inputmode="numeric" maxlength="1" data-pin-idx="2" style="width: 52px; height: 58px; text-align: center; font-size: 24px; font-family: var(--font-mono); font-weight: 700; border-radius: 10px;" autocomplete="off">
            <input class="input" type="text" pattern="[0-9]*" inputmode="numeric" maxlength="1" data-pin-idx="3" style="width: 52px; height: 58px; text-align: center; font-size: 24px; font-family: var(--font-mono); font-weight: 700; border-radius: 10px;" autocomplete="off">
          </div>
          <p class="hint" id="key-error" style="color: var(--danger); display: none; margin-bottom: 0.75rem; font-weight: 500;"></p>
          <div id="key-countdown" style="display: none; margin-bottom: 0.75rem; color: var(--danger); font-size: 0.875rem; font-weight: 600;"></div>
          <button class="btn btn--primary btn--block btn--lg" type="submit" id="submit-table-key-btn">Confirm key</button>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) window.lucide.createIcons();

  const inputs = Array.from(modal.querySelectorAll('[data-pin-idx]'));
  const errorEl = modal.querySelector('#key-error');
  const countdownEl = modal.querySelector('#key-countdown');
  const submitBtn = modal.querySelector('#submit-table-key-btn');
  const closeBtn = modal.querySelector('#close-table-key-modal');
  let countdownTimer = null;

  function showError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
    }
  }

  function hideError() {
    if (errorEl) errorEl.style.display = 'none';
  }

  function checkCooldown() {
    const rate = getRate();
    const now = Date.now();
    if (rate.lockUntil && rate.lockUntil > now) {
      inputs.forEach((i) => { i.disabled = true; });
      submitBtn.disabled = true;
      hideError();
      countdownEl.style.display = 'block';

      if (countdownTimer) clearInterval(countdownTimer);
      const updateCd = () => {
        const left = Math.ceil((rate.lockUntil - Date.now()) / 1000);
        if (left <= 0) {
          clearInterval(countdownTimer);
          countdownEl.style.display = 'none';
          inputs.forEach((i) => { i.disabled = false; });
          submitBtn.disabled = false;
          inputs[0].focus();
        } else {
          countdownEl.textContent = 'Too many attempts. Please wait ' + left + 's before trying again.';
        }
      };
      updateCd();
      countdownTimer = setInterval(updateCd, 1000);
      return true;
    }
    return false;
  }

  function attemptSubmit() {
    if (checkCooldown()) return;
    const pin = inputs.map((i) => i.value).join('');
    if (pin.length < 4) return;

    const currentSession = sessionForTable(client.id, table.id);
    if (!currentSession || currentSession.status !== 'open') {
      if (countdownTimer) clearInterval(countdownTimer);
      modal.remove();
      toast('Please ask staff to seat you', 'warning');
      return;
    }

    if (pin === String(currentSession.tableKey)) {
      if (countdownTimer) clearInterval(countdownTimer);
      localStorage.removeItem(rateKey);
      localStorage.setItem('tqr_trusted_' + table.id, JSON.stringify({
        sessionId: currentSession.id,
        joinSecret: currentSession.joinSecret,
      }));
      modal.remove();
      toast("You're connected to " + table.name);
      if (onSuccess) onSuccess(currentSession);
    } else {
      const currentTable = getById('tables', table.id) || table;
      const fails = (currentTable.failedKeyAttempts || 0) + 1;
      update('tables', table.id, { failedKeyAttempts: fails });
      emit('table:update', { clientId: client.id, tableId: table.id });

      const rate = getRate();
      rate.fails = (rate.fails || 0) + 1;
      if (rate.fails >= 3) {
        const wait = rate.delay || 30;
        rate.lockUntil = Date.now() + wait * 1000;
        rate.delay = Math.min(600, wait * 2);
        saveRate(rate);
        checkCooldown();
      } else {
        saveRate(rate);
        inputs.forEach((i) => { i.value = ''; });
        inputs[0].focus();
        showError('Incorrect table key. Please ask staff.');
      }
    }
  }

  inputs.forEach((inp, idx) => {
    inp.addEventListener('input', () => {
      const v = inp.value.replace(/\D/g, '').slice(-1);
      inp.value = v;
      if (v && idx < 3) {
        inputs[idx + 1].focus();
      }
      if (inputs.every((i) => i.value.length === 1)) {
        attemptSubmit();
      }
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && idx > 0) {
        inputs[idx - 1].focus();
      }
    });

    inp.addEventListener('paste', (e) => {
      e.preventDefault();
      const clip = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 4);
      clip.split('').forEach((c, ci) => {
        if (inputs[ci]) inputs[ci].value = c;
      });
      if (clip.length === 4) {
        attemptSubmit();
      } else if (inputs[clip.length]) {
        inputs[clip.length].focus();
      }
    });
  });

  modal.querySelector('#key-sheet-form').addEventListener('submit', (e) => {
    e.preventDefault();
    attemptSubmit();
  });

  closeBtn.addEventListener('click', () => {
    if (countdownTimer) clearInterval(countdownTimer);
    modal.remove();
  });

  if (!checkCooldown()) {
    setTimeout(() => inputs[0].focus(), 100);
  }
}

function showShareQrModal(client, table, session) {
  const existing = document.getElementById('share-qr-modal');
  if (existing) existing.remove();

  const url = new URL(location.pathname, location.href);
  url.searchParams.set('r', client.slug);
  url.searchParams.set('t', table.token);
  url.searchParams.set('s', session.id);
  url.searchParams.set('j', session.joinSecret);
  const fullUrl = url.href;

  const modal = document.createElement('div');
  modal.className = 'modal is-open';
  modal.id = 'share-qr-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="modal__dialog" style="max-width: 360px; text-align: center;">
      <div class="modal__header" style="justify-content: space-between;">
        <h2 class="modal__title" style="font-size: 1.25rem;">Join ${esc(table.name)}</h2>
        <button class="btn btn--icon btn--sm" type="button" id="close-share-modal-btn" aria-label="Close"><i data-lucide="x"></i></button>
      </div>
      <div class="modal__body" style="padding: 1rem;">
        <p class="muted text-sm mb-4">Have a friend scan this code to join and order with you:</p>
        <div id="friend-qr-target" style="display: flex; justify-content: center; padding: 12px; background: #fff; border-radius: var(--radius-md); box-shadow: var(--shadow-lift); width: fit-content; margin: 0 auto;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) window.lucide.createIcons();

  if (window.QRCode) {
    new window.QRCode(modal.querySelector('#friend-qr-target'), {
      text: fullUrl,
      width: 200,
      height: 200,
      colorDark: '#0B0F0E',
      colorLight: '#FFFFFF',
      correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0,
    });
  }

  modal.querySelector('#close-share-modal-btn').addEventListener('click', () => modal.remove());
}

/* ------------------------------------------------------------- location ---- */
/* Orders are only taken from guests at the restaurant. The restaurant's point and
   radius are set by the owner (Settings → Security). Precision lives in geo.js:
   the guest's phone is read for a few seconds and the best reading is used. */
const GEO_CACHE_KEY = 'tqr_geo_last';
const GEO_CACHE_MS = 45000; // a good reading this fresh is reused, so ordering twice in a row does not wait again

function readGeoCache(clientId) {
  try {
    const c = JSON.parse(sessionStorage.getItem(GEO_CACHE_KEY) || 'null');
    if (c && c.clientId === clientId && Date.now() - c.at < GEO_CACHE_MS && c.fix && c.fix.accuracy <= 60) return c.fix;
  } catch (e) { /* ignore */ }
  return null;
}

function writeGeoCache(clientId, fix) {
  try { sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ clientId, at: Date.now(), fix })); } catch (e) { /* ignore */ }
}

/**
 * Where is this guest relative to the restaurant?
 * Resolves { state, distance?, accuracy?, radius, site } with state one of:
 *   'off' (check disabled or no location registered yet: nobody is blocked),
 *   'inside', 'outside', 'imprecise', 'blocked' (location refused), 'failed' (no reading).
 */
async function checkGuestLocation(client, { fresh = false, onProgress } = {}) {
  const site = siteOf(client);
  if (!site.enabled || !site.set) return { state: 'off', site, radius: site.radius };

  try {
    let fix = fresh ? null : readGeoCache(client.id);
    if (!fix) {
      fix = await bestFix({ target: 25, maxWaitMs: 10000, onProgress });
      if (fix.accuracy <= GUEST_MAX_ACCURACY) writeGeoCache(client.id, fix);
    }
    const verdict = judge(fix, site);
    return { state: verdict.status, distance: verdict.distance, accuracy: verdict.accuracy, radius: site.radius, site };
  } catch (err) {
    return { state: err.code === 'denied' || err.code === 'insecure' || err.code === 'unsupported' ? 'blocked' : 'failed', radius: site.radius, site, code: err.code };
  }
}

function locationMessage(result, restaurantName) {
  const name = esc(restaurantName);
  const radius = result.radius;
  switch (result.state) {
    case 'outside':
      return '<strong>You are ' + formatDistance(result.distance) + ' from ' + name + '.</strong> Orders can only be placed from inside the restaurant (within ' + radius + ' m). If you are at your table, tap Check again.';
    case 'imprecise':
      return '<strong>Your phone\'s location is too vague (about ±' + Math.round(result.accuracy) + ' m).</strong> Move near a window or the door, make sure Wi-Fi and GPS are on, then tap Check again.';
    case 'blocked':
      return '<strong>Location is needed to order at ' + name + '.</strong> ' + (result.code === 'insecure'
        ? 'This page must be opened over https.'
        : 'Allow location for this site in your browser, then tap Check again. Or ask a staff member to take your order.');
    default:
      return '<strong>We could not read your location.</strong> Check that GPS is on, then tap Check again. Or ask a staff member to take your order.';
  }
}

function renderLocationBanner(container, result, client, onRecheck) {
  if (!container) return;
  if (result.state === 'inside' || result.state === 'off') { container.innerHTML = ''; return; }
  container.innerHTML =
    '<div class="geofence-alert" role="alert" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:10px 14px;margin:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:0.82rem;color:#92400E;">' +
    '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:1.25rem;" aria-hidden="true">📍</span><div>' + locationMessage(result, client.name) + '</div></div>' +
    '<button type="button" class="btn btn--sm" data-geo-recheck style="background:#D97706;color:#fff;border:none;font-size:0.75rem;font-weight:700;padding:6px 12px;border-radius:6px;cursor:pointer;white-space:nowrap;">Check again</button></div>';
  const btn = container.querySelector('[data-geo-recheck]');
  if (btn) btn.addEventListener('click', () => onRecheck());
}

function markOnPremise() {
  const tableBadge = document.getElementById('menu-table') || document.getElementById('cart-table');
  if (tableBadge && !tableBadge.querySelector('.geo-verified-pill')) {
    const span = document.createElement('span');
    span.className = 'geo-verified-pill';
    span.style.cssText = 'background:#10B981;color:#fff;font-size:0.68rem;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px;display:inline-flex;align-items:center;gap:3px;vertical-align:middle;';
    span.textContent = '✓ 📍 On-premise';
    tableBadge.appendChild(span);
  }
}

function initGeofenceBanner(client, table, bannerContainerId) {
  const container = document.getElementById(bannerContainerId);
  if (!container) return;
  try { localStorage.removeItem('tqr_geo_override'); } catch (e) { /* the old demo bypass no longer exists */ }

  async function run(fresh) {
    const site = siteOf(client);
    if (!site.enabled || !site.set) return;
    container.innerHTML = '<div style="margin:10px 16px;font-size:0.8rem;color:#5E636B;">📍 Checking your location…</div>';
    const result = await checkGuestLocation(client, {
      fresh,
      onProgress: (f) => {
        container.innerHTML = '<div style="margin:10px 16px;font-size:0.8rem;color:#5E636B;">📍 Checking your location… ±' + f.accuracy + ' m</div>';
      },
    });
    if (result.state === 'inside') markOnPremise();
    renderLocationBanner(container, result, client, () => run(true));
  }
  run(false);
}

/**
 * Gate for the Place order button. Returns true when the guest may order.
 * Shows the reason in the cart banner when they may not.
 */
async function guestMayOrder(client, button) {
  const site = siteOf(client);
  if (!site.enabled || !site.set) return true;

  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Checking your location…';
  try {
    // A fresh reading at the moment of ordering, unless a good one was taken seconds ago.
    const result = await checkGuestLocation(client, { fresh: false });
    if (result.state === 'inside') return true;
    renderLocationBanner(document.getElementById('cart-geofence-banner'), result, client, () => initGeofenceBanner(client, null, 'cart-geofence-banner'));
    toast(result.state === 'outside' ? 'You need to be at the restaurant to place an order.' : 'We could not confirm you are at the restaurant.', 'warning');
    const banner = document.getElementById('cart-geofence-banner');
    if (banner && banner.scrollIntoView) banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  } finally {
    button.innerHTML = label;
    button.disabled = false;
  }
}

/* -------------------------------------------------------- pay at order ---- */
function showPaymentModal(method, totals, settings, table, onConfirm) {
  const existing = document.getElementById('pay-modal-sheet');
  if (existing) existing.remove();

  const money = (val) => formatMoney(val, settings.currency);
  const modal = document.createElement('div');
  modal.className = 'modal is-open';
  modal.id = 'pay-modal-sheet';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  let bodyHtml = '';
  if (method === 'apple_pay') {
    bodyHtml = `
      <div style="text-align: center; padding: 0.5rem 0 1rem 0;">
        <div style="font-size: 2rem; margin-bottom: 0.25rem;"> Pay</div>
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.25rem;">The Olive Table</h3>
        <p class="muted text-xs" style="margin-bottom: 1.25rem;">Dine-in Order · ${esc(table.name)}</p>

        <div style="background: var(--surface-2, #F8F6F1); border-radius: 12px; padding: 12px 16px; margin-bottom: 1.25rem; text-align: left; font-size: 0.85rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span class="muted">Card</span>
            <span style="font-weight: 600;">Apple Card (•••• 1092)</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span class="muted">Items & Taxes</span>
            <span style="font-weight: 600;">${money(totals.total)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border, rgba(0,0,0,0.08)); padding-top: 6px; font-weight: 700; font-size: 0.95rem;">
            <span>Total to Pay</span>
            <span style="color: var(--primary, #8C3A27);">${money(totals.total)}</span>
          </div>
        </div>

        <button class="btn btn--block btn--lg" id="confirm-apple-pay-btn" type="button" style="background: #000; color: #fff; border-radius: 12px; height: 52px; font-size: 1.05rem; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span> Pay with Passcode / Face ID</span>
        </button>
        <p class="hint mt-2 text-xs muted">Click to simulate biometric Face ID confirmation</p>
      </div>
    `;
  } else if (method === 'google_pay') {
    bodyHtml = `
      <div style="text-align: center; padding: 0.5rem 0 1rem 0;">
        <div style="font-size: 1.8rem; margin-bottom: 0.25rem;">🌐 <strong style="font-size: 1.35rem; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">GPay</strong></div>
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.25rem;">Google Pay</h3>
        <p class="muted text-xs" style="margin-bottom: 1.25rem;">The Olive Table · ${esc(table.name)}</p>

        <div style="background: var(--surface-2, #F8F6F1); border-radius: 12px; padding: 12px 16px; margin-bottom: 1.25rem; text-align: left; font-size: 0.85rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span class="muted">Google Account</span>
            <span style="font-weight: 600;">alex.diner@gmail.com</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span class="muted">Payment Card</span>
            <span style="font-weight: 600;">Chase Sapphire (•••• 8821)</span>
          </div>
          <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border, rgba(0,0,0,0.08)); padding-top: 6px; font-weight: 700; font-size: 0.95rem;">
            <span>Total to Pay</span>
            <span style="color: var(--primary, #8C3A27);">${money(totals.total)}</span>
          </div>
        </div>

        <button class="btn btn--block btn--lg" id="confirm-gpay-btn" type="button" style="background: #1F2937; color: #fff; border-radius: 12px; height: 52px; font-size: 1.05rem; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span>Pay ${money(totals.total)} with Google Pay</span>
        </button>
        <p class="hint mt-2 text-xs muted">Click to simulate Google Pay 1-tap confirmation</p>
      </div>
    `;
  } else if (method === 'paypal') {
    bodyHtml = `
      <div style="text-align: center; padding: 0.5rem 0 1rem 0;">
        <div style="font-size: 1.8rem; margin-bottom: 0.25rem;">🅿️</div>
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.25rem;">PayPal &amp; Venmo</h3>
        <p class="muted text-xs" style="margin-bottom: 1.25rem;">The Olive Table · ${esc(table.name)}</p>

        <div style="background: var(--surface-2, #F8F6F1); border-radius: 12px; padding: 12px 16px; margin-bottom: 1.25rem; text-align: left; font-size: 0.85rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span class="muted">PayPal Diner</span>
            <span style="font-weight: 600;">alex.diner@gmail.com</span>
          </div>
          <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border, rgba(0,0,0,0.08)); padding-top: 6px; font-weight: 700; font-size: 0.95rem;">
            <span>Total to Pay</span>
            <span style="color: var(--primary, #8C3A27);">${money(totals.total)}</span>
          </div>
        </div>

        <button class="btn btn--block btn--lg" id="confirm-paypal-btn" type="button" style="background: #003087; color: #fff; border-radius: 12px; height: 52px; font-size: 1.05rem; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span>Pay ${money(totals.total)} with PayPal</span>
        </button>
        <p class="hint mt-2 text-xs muted">Click to simulate PayPal 1-tap confirmation</p>
      </div>
    `;
  } else if (method === 'upi') {
    bodyHtml = `
      <div style="text-align: center; padding: 0.5rem 0 1rem 0;">
        <div style="font-size: 1.8rem; margin-bottom: 0.25rem;">📱</div>
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.25rem;">UPI Instant Pay</h3>
        <p class="muted text-xs" style="margin-bottom: 1rem;">The Olive Table (${esc(settings.payments?.razorpay?.vpa || 'olivetable@icici')})</p>

        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 1rem;">
          <button type="button" class="btn btn--secondary btn--sm is-active" style="padding: 8px 4px; font-size: 0.72rem; font-weight: 700;">GPay</button>
          <button type="button" class="btn btn--secondary btn--sm" style="padding: 8px 4px; font-size: 0.72rem; font-weight: 700;">PhonePe</button>
          <button type="button" class="btn btn--secondary btn--sm" style="padding: 8px 4px; font-size: 0.72rem; font-weight: 700;">Paytm</button>
          <button type="button" class="btn btn--secondary btn--sm" style="padding: 8px 4px; font-size: 0.72rem; font-weight: 700;">BHIM</button>
        </div>

        <button class="btn btn--primary btn--block btn--lg" id="confirm-upi-pay-btn" type="button" style="height: 50px; font-size: 1rem; font-weight: 700; background: #059669; border-color: #059669;">
          Pay ${money(totals.total)} via UPI
        </button>
      </div>
    `;
  } else {
    bodyHtml = `
      <div style="text-align: center; padding: 0.5rem 0 1rem 0;">
        <div style="font-size: 1.8rem; margin-bottom: 0.25rem;">💳</div>
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.25rem;">Credit / Debit Card</h3>
        <p class="muted text-xs" style="margin-bottom: 1rem;">Visa · Mastercard · American Express</p>

        <div style="background: var(--surface-2, #F8F6F1); border-radius: 10px; padding: 12px; margin-bottom: 1rem; text-align: left; font-family: var(--font-mono); font-size: 0.85rem;">
          <div style="color: var(--text-muted); font-size: 0.72rem; margin-bottom: 2px;">CARD NUMBER</div>
          <div style="font-weight: 700; letter-spacing: 2px; margin-bottom: 8px;">•••• •••• •••• 4242</div>
          <div style="display: flex; justify-content: space-between;">
            <div><span class="muted" style="font-size: 0.7rem;">EXP: </span>12/28</div>
            <div><span class="muted" style="font-size: 0.7rem;">CVV: </span>•••</div>
          </div>
        </div>

        <button class="btn btn--primary btn--block btn--lg" id="confirm-card-pay-btn" type="button" style="height: 50px; font-size: 1rem; font-weight: 700;">
          Pay ${money(totals.total)}
        </button>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="modal__dialog" style="max-width: 380px; position: relative;">
      <button class="btn btn--icon btn--sm" id="close-pay-sheet-btn" type="button" aria-label="Close" style="position: absolute; top: 12px; right: 12px; border: none; background: transparent; cursor: pointer; font-size: 1.2rem; color: var(--text-muted);">&times;</button>
      ${bodyHtml}
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#close-pay-sheet-btn').addEventListener('click', () => modal.remove());

  const btn = modal.querySelector('#confirm-apple-pay-btn') || modal.querySelector('#confirm-gpay-btn') || modal.querySelector('#confirm-card-pay-btn') || modal.querySelector('#confirm-paypal-btn') || modal.querySelector('#confirm-upi-pay-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.innerHTML = `<span style="display: inline-flex; align-items: center; gap: 8px;"><span class="dot" style="background: #fff; width: 8px; height: 8px; border-radius: 50%; animation: pulse 0.6s infinite alternate;"></span> Authorizing ${method === 'apple_pay' ? 'Face ID' : 'Payment'}…</span>`;
      
      setTimeout(() => {
        btn.innerHTML = `<span style="color: #10B981; font-weight: 700;">✓ Payment Approved!</span>`;
        setTimeout(() => {
          modal.remove();
          onConfirm({
            method,
            txnId: (method === 'apple_pay' ? 'APL_' : method === 'google_pay' ? 'GPY_' : method === 'paypal' ? 'PYP_' : method === 'upi' ? 'UPI_' : 'CRD_') + Math.random().toString(36).slice(2, 8).toUpperCase(),
          });
        }, 500);
      }, 700);
    });
  }
}

/* ---------------------------------------------------------------- menu ---- */
function initMenu(ctx) {
  const { client, table } = ctx;
  const settings = client.settings;
  const money = (value) => formatMoney(value, settings.currency);

  const sParam = qs('s');
  const jParam = qs('j');
  const visitParams = sParam ? '&s=' + encodeURIComponent(sParam) + '&j=' + encodeURIComponent(jParam) : '';

  if (sParam) {
    const session = getById('sessions', sParam);
    if (!session || session.clientId !== client.id || session.tableId !== table.id || session.status !== 'open' || (jParam && session.joinSecret !== jParam) || (!jParam && session.joinSecret)) {
      renderVisitEnded();
      return;
    }
    localStorage.setItem('tqr_trusted_' + table.id, JSON.stringify({
      sessionId: session.id,
      joinSecret: session.joinSecret,
    }));
    toast("You're connected to " + table.name);
  } else {
    // Plain table QR: open a visit automatically if the table has none, then join it
    const open = sessionForTable(client.id, table.id) || openSessionForTable(client.id, table);
    isDeviceTrusted(table.id, open);
  }

  on('session:close', (payload) => {
    if (payload && payload.tableId === table.id) renderVisitEnded();
  });
  on('session:paid', (payload) => {
    if (sParam && payload && payload.sessionId === sParam) renderVisitEnded();
  });

  document.documentElement.style.setProperty('--accent', settings.accent);
  document.title = client.name + ' — ' + table.name + ' menu';

  document.getElementById('menu-cover').src = settings.cover || '';
  document.getElementById('menu-cover').alt = client.name + ' dining room';
  document.getElementById('menu-logo').src = settings.logo || '';
  document.getElementById('menu-logo').alt = client.name + ' logo';
  document.getElementById('menu-name').textContent = client.name;
  document.getElementById('menu-tagline').textContent = settings.tagline || '';
  document.getElementById('menu-table').innerHTML =
    '<i data-lucide="utensils"></i> ' + esc(table.name);

  const priceLine = document.getElementById('menu-priceline');
  if (priceLine) {
    const taxNames = (settings.taxes || []).filter((t) => t.enabled).map((t) => t.name);
    priceLine.textContent = settings.pricesIncludeTax
      ? 'Prices include ' + (taxNames.join(' & ') || 'tax')
      : 'Taxes extra';
  }
  if (window.lucide) window.lucide.createIcons();
  initGeofenceBanner(client, table, 'menu-geofence-banner');

  const categories = query('categories', (c) => c.clientId === client.id).sort((a, b) => a.position - b.position);
  let items = query('items', (i) => i.clientId === client.id);

  on('menu:update', (payload) => {
    if (payload && payload.clientId && payload.clientId !== client.id) return;
    items = query('items', (i) => i.clientId === client.id);
    render();
  });

  const sectionsHost = document.getElementById('menu-sections');
  const chipsHost = document.getElementById('menu-chips');
  const searchInput = document.getElementById('menu-search-input');
  const filterHost = document.getElementById('menu-filters');
  const cartBar = document.getElementById('cart-bar');
  const sheet = document.getElementById('item-sheet');

  let activeFilters = new Set();
  let term = '';
  let currentItem = null;
  let sheetQty = 1;

  function render() {
    const visible = items.filter((item) => {
      const matchesTerm = !term
        || item.name.toLowerCase().includes(term)
        || (item.description || '').toLowerCase().includes(term);
      const matchesDiet = activeFilters.size === 0
        || Array.from(activeFilters).every((tag) => (item.tags || []).includes(tag));
      return matchesTerm && matchesDiet;
    });

    if (!visible.length) {
      sectionsHost.innerHTML =
        '<div class="empty"><span class="empty__icon"><i data-lucide="search"></i></span>' +
        '<p class="empty__title">Nothing matches that</p>' +
        '<p class="empty__text">Try a different dish, or clear the filters above.</p>' +
        '<div class="empty__action"><button class="btn btn--secondary btn--sm mt-2" type="button" data-clear-menu-filters><i data-lucide="rotate-ccw"></i> Clear filters</button></div></div>';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    sectionsHost.innerHTML = categories.map((cat) => {
      const rows = visible.filter((item) => item.categoryId === cat.id);
      if (!rows.length) return '';
      const catTitle = window.TableTapI18n ? window.TableTapI18n.translateDish(cat.name) : cat.name;
      const countLabel = window.TableTapI18n ? window.TableTapI18n.t('menu.items_count', 'items') : 'items';
      return '<section class="menu-section" id="cat-' + cat.id + '">' +
        '<div class="menu-section__head"><h2 class="menu-section__title">' + esc(catTitle) + '</h2>' +
        '<span class="menu-section__count">' + rows.length + ' ' + countLabel + '</span></div>' +
        '<div class="item-list">' + rows.map(itemCard).join('') + '</div></section>';
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  function getTagLabel(tag) {
    if (window.TableTapI18n) {
      if (tag === 'veg') return window.TableTapI18n.t('dish.tag_veg', 'Veg');
      if (tag === 'vegan') return window.TableTapI18n.t('dish.tag_vegan', 'Vegan');
      if (tag === 'gf') return window.TableTapI18n.t('dish.tag_gf', 'Gluten-free');
      if (tag === 'spicy') return window.TableTapI18n.t('dish.tag_spicy', 'Spicy');
    }
    const fallback = { veg: 'Veg', vegan: 'Vegan', gf: 'Gluten-free', spicy: 'Spicy' };
    return fallback[tag] || tag;
  }

  function itemCard(item) {
    const displayName = window.TableTapI18n ? window.TableTapI18n.translateDish(item.name) : item.name;
    const soldOutText = window.TableTapI18n ? window.TableTapI18n.t('preview.sold_out', 'Sold out') : 'Sold out';
    const tags = (item.tags || []).map((tag) =>
      '<span class="tag tag--' + tag + '">' + getTagLabel(tag) + '</span>').join('');
    const soldOut = !item.available;
    return '<button class="item-card' + (soldOut ? ' item-card--sold-out' : '') + '" type="button" ' +
      (soldOut ? 'disabled' : 'data-item="' + item.id + '"') + '>' +
      '<img class="item-card__img" src="' + esc(item.image) + '" alt="' + esc(displayName) + '">' +
      '<span class="item-card__body">' +
      '<span class="item-card__name">' + esc(displayName) + '</span>' +
      '<span class="item-card__desc">' + esc(item.description) + '</span>' +
      '<span class="item-card__meta"><span class="item-card__price">' + money(item.price) + '</span>' +
      (soldOut ? '<span class="sold-out-flag">' + soldOutText + '</span>' : tags) +
      '</span></span>' +
      '<span class="item-card__add" aria-hidden="true"><i data-lucide="plus"></i></span></button>';
  }

  function renderChips() {
    chipsHost.innerHTML = categories.map((cat, index) => {
      const catTitle = window.TableTapI18n ? window.TableTapI18n.translateDish(cat.name) : cat.name;
      return '<a class="chip' + (index === 0 ? ' chip--active' : '') + '" href="#cat-' + cat.id + '">' + esc(catTitle) + '</a>';
    }).join('');
  }
  renderChips();

  const dietOptions = [['veg', 'Veg'], ['vegan', 'Vegan'], ['gf', 'Gluten-free'], ['spicy', 'Spicy']];
  function resetMenuFilters() {
    activeFilters.clear();
    term = '';
    if (searchInput) searchInput.value = '';
    renderDietFilters();
    render();
  }

  function renderDietFilters() {
    const chipsHtml = dietOptions.map(([key, label]) =>
      '<button class="chip chip--filter" type="button" data-filter="' + key + '" aria-pressed="' + (activeFilters.has(key) ? 'true' : 'false') + '">' + getTagLabel(key) + '</button>'
    ).join('');
    const clearBtnHtml = (activeFilters.size > 0 || term)
      ? '<button class="chip chip--filter" type="button" data-clear-menu-filters style="color:var(--danger);font-weight:600;"><i data-lucide="x" style="width:12px;height:12px;vertical-align:-1px;margin-right:2px;"></i> Clear</button>'
      : '';
    filterHost.innerHTML = chipsHtml + clearBtnHtml;
    if (window.lucide) window.lucide.createIcons();
  }
  renderDietFilters();

  filterHost.addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-menu-filters]')) {
      resetMenuFilters();
      return;
    }
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    const key = button.getAttribute('data-filter');
    if (activeFilters.has(key)) activeFilters.delete(key);
    else activeFilters.add(key);
    renderDietFilters();
    render();
  });

  sectionsHost.addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-menu-filters]')) {
      resetMenuFilters();
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      term = searchInput.value.trim().toLowerCase();
      renderDietFilters();
      render();
    }, 200));
  }

  chipsHost.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    chipsHost.querySelectorAll('.chip').forEach((c) => c.classList.remove('chip--active'));
    chip.classList.add('chip--active');
  });

  render();

  /* ---------------------------------------------------------- item sheet -- */
  sectionsHost.addEventListener('click', (event) => {
    const card = event.target.closest('[data-item]');
    if (!card) return;
    const item = getById('items', card.getAttribute('data-item'));
    if (!item) return;
    if (item.available === false) {
      toast('“' + item.name + '” is currently sold out', 'warning');
      return;
    }
    currentItem = item;
    sheetQty = 1;
    openItemSheet(item);
  });

  function openItemSheet(item) {
    const displayName = window.TableTapI18n ? window.TableTapI18n.translateDish(item.name) : item.name;
    document.getElementById('sheet-img').src = item.image;
    document.getElementById('sheet-img').alt = displayName;
    document.getElementById('sheet-title').textContent = displayName;
    document.getElementById('sheet-desc').textContent = item.description;
    document.getElementById('sheet-note').value = '';

    const sizeHost = document.getElementById('sheet-sizes');
    const sizes = item.sizes && item.sizes.length ? item.sizes : [{ id: 'base', name: 'Regular', price: item.price }];
    sizeHost.innerHTML = sizes.map((size, index) =>
      '<label class="check"><input type="radio" name="sheet-size" value="' + size.id + '"' + (index === 0 ? ' checked' : '') + '>' +
      '<span class="check__text">' + esc(size.name) + ' <span class="muted">' + money(size.price) + '</span></span></label>'
    ).join('');

    const addonHost = document.getElementById('sheet-addons');
    const groups = item.addons || [];
    if (!groups.length) {
      addonHost.innerHTML = '<p class="hint">No extras for this dish.</p>';
    } else {
      addonHost.innerHTML = groups.map((group) =>
        '<p class="sheet-group__label">' + esc(group.name) +
        (group.max ? ' <span class="muted">(up to ' + group.max + ')</span>' : '') + '</p>' +
        group.options.map((option, index) =>
          '<label class="check"><input type="checkbox" data-addon="' + group.id + '" data-price="' + option.price + '" data-name="' + esc(option.name) + '">' +
          '<span class="check__text">' + esc(option.name) + ' <span class="muted">+' + money(option.price) + '</span></span></label>'
        ).join('')
      ).join('');
    }

    document.getElementById('sheet-qty').textContent = '1';
    updateSheetPrice();
    openDrawer('item-sheet');
    if (window.lucide) window.lucide.createIcons();
  }

  function sheetUnitPrice() {
    if (!currentItem) return 0;
    const selected = sheet.querySelector('input[name="sheet-size"]:checked');
    const sizes = currentItem.sizes && currentItem.sizes.length ? currentItem.sizes : [{ id: 'base', price: currentItem.price }];
    const size = sizes.find((s) => s.id === selected?.value) || sizes[0];
    const addons = Array.from(sheet.querySelectorAll('[data-addon]:checked'))
      .reduce((sum, box) => sum + Number(box.getAttribute('data-price')), 0);
    return size.price + addons;
  }

  function updateSheetPrice() {
    const button = document.getElementById('sheet-add');
    button.textContent = 'Add to order · ' + money(sheetUnitPrice() * sheetQty);
  }

  document.getElementById('sheet-qty-minus').addEventListener('click', () => {
    sheetQty = Math.max(1, sheetQty - 1);
    document.getElementById('sheet-qty').textContent = String(sheetQty);
    updateSheetPrice();
  });
  document.getElementById('sheet-qty-plus').addEventListener('click', () => {
    sheetQty = Math.min(20, sheetQty + 1);
    document.getElementById('sheet-qty').textContent = String(sheetQty);
    updateSheetPrice();
  });
  sheet.addEventListener('change', updateSheetPrice);

  document.getElementById('sheet-add').addEventListener('click', () => {
    if (!currentItem) return;
    const freshItem = getById('items', currentItem.id);
    if (freshItem && freshItem.available === false) {
      toast('“' + currentItem.name + '” just sold out in the kitchen.', 'warning');
      closeDrawer('item-sheet');
      return;
    }
    const selected = sheet.querySelector('input[name="sheet-size"]:checked');
    const sizes = currentItem.sizes && currentItem.sizes.length ? currentItem.sizes : [{ id: 'base', name: 'Regular', price: currentItem.price }];
    const size = sizes.find((s) => s.id === selected?.value) || sizes[0];
    const addons = Array.from(sheet.querySelectorAll('[data-addon]:checked'))
      .map((box) => box.getAttribute('data-name'));

    const cart = cartFor(client.id, table.id);
    const category = categories.find((c) => c.id === currentItem.categoryId);
    const taxOverride = resolveTaxOverride(currentItem, category);
    const signature = currentItem.id + '|' + size.name + '|' + addons.join(',') + '|' + taxOverride;
    const existing = cart.items.find((row) => row.signature === signature);
    if (existing) existing.qty += sheetQty;
    else {
      cart.items.push({
        signature,
        itemId: currentItem.id,
        name: currentItem.name,
        size: size.name,
        addons,
        note: document.getElementById('sheet-note').value.trim(),
        price: sheetUnitPrice(),
        qty: sheetQty,
        taxOverride,
      });
    }
    writeCart(cart);
    closeDrawer('item-sheet');
    renderCartBar();
    toast(currentItem.name + ' added to your order');
  });

  /* --------------------------------------------------------------- cart -- */
  function renderCartBar() {
    const cart = cartFor(client.id, table.id);
    const totals = cartTotals(cart, settings);
    if (!totals.count) {
      cartBar.hidden = true;
      return;
    }
    cartBar.hidden = false;
    cartBar.setAttribute('href', 'cart.html?r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token) + visitParams);
    const itemLabel = window.TableTapI18n ? window.TableTapI18n.t('menu.items_count', 'items') : 'items';
    document.getElementById('cart-count').textContent = totals.count + ' ' + itemLabel;
    document.getElementById('cart-total').textContent = money(totals.total);
  }

  renderCartBar();

  // Listen to global i18n language changes
  window.addEventListener('tabletap:langchange', () => {
    render();
    renderChips();
    renderDietFilters();
    renderCartBar();
    if (window.TableTapI18n) window.TableTapI18n.applyTranslations();
  });

  const billLink = document.getElementById('ask-bill-link');
  if (billLink) {
    billLink.setAttribute('href', 'bill.html?r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token) + visitParams);
    billLink.addEventListener('click', (e) => {
      const s = sessionForTable(client.id, table.id);
      if (!s || s.status !== 'open' || !isDeviceTrusted(table.id, s)) {
        e.preventDefault();
        toast('Please ask staff to seat you', 'warning');
      }
    });
  }

  const menuTablePill = document.getElementById('menu-table');
  if (menuTablePill) {
    menuTablePill.style.cursor = 'pointer';
    menuTablePill.title = 'Scan to join ' + table.name;
    menuTablePill.addEventListener('click', () => {
      const s = sessionForTable(client.id, table.id);
      if (s) showShareQrModal(client, table, s);
    });
  }

  /* ------------------------------------------------- waiter / bill calls -- */
  document.querySelectorAll('[data-call]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.getAttribute('data-call');
      createWaiterCall(client.id, table, type);
    });
  });

  /* ------------------------------------------- active order banner & timer -- */
  const bannerHost = document.getElementById('menu-active-order-banner');
  function updateActiveOrderBanner() {
    if (!bannerHost) return;
    const session = sessionForTable(client.id, table.id);
    let myOrderIds = [];
    try {
      myOrderIds = JSON.parse(localStorage.getItem('tqr_my_orders') || '[]');
    } catch (e) {}

    const activeOrders = query('orders', (o) => {
      const isForTable = o.tableId === table.id || (session && (session.orderIds || []).includes(o.id)) || myOrderIds.includes(o.id);
      return isForTable && ['new', 'pending_approval', 'preparing', 'ready'].includes(o.status);
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const latest = activeOrders[0];
    if (!latest) {
      bannerHost.innerHTML = '';
      return;
    }

    const timeStr = formatElapsed(Date.now() - new Date(latest.createdAt).getTime());
    const statusLabel = latest.status === 'ready' ? 'Ready for pickup' : latest.status === 'preparing' ? 'Preparing' : 'In kitchen';
    const isReady = latest.status === 'ready';

    bannerHost.innerHTML = `
      <a href="order-status.html?id=${latest.id}&r=${encodeURIComponent(client.slug)}&t=${encodeURIComponent(table.token)}${visitParams}" style="display:flex;align-items:center;justify-content:space-between;background:${isReady ? '#ECFDF5' : '#FEF3C7'};color:${isReady ? '#065F46' : '#92400E'};border:1px solid ${isReady ? '#A7F3D0' : '#FCD34D'};border-radius:8px;padding:10px 14px;margin:12px 16px 0;text-decoration:none;font-weight:600;font-size:0.875rem;">
        <div style="display:flex;align-items:center;gap:8px;">
          <i data-lucide="${isReady ? 'check-circle' : 'timer'}" style="width:16px;height:16px;"></i>
          <span>Order #${latest.number} · <strong>${statusLabel}</strong> (⏱ ${timeStr})</span>
        </div>
        <span style="font-size:0.8rem;text-decoration:underline;">Track order &rarr;</span>
      </a>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  updateActiveOrderBanner();
  setInterval(updateActiveOrderBanner, 1000);
  on('order:new', () => updateActiveOrderBanner());
  on('order:update', () => updateActiveOrderBanner());
  on('order:picked_up', () => updateActiveOrderBanner());
  on('order:served', () => updateActiveOrderBanner());
}

/* ---------------------------------------------------------------- cart ---- */
function initCart(ctx) {
  const { client, table } = ctx;
  const settings = client.settings;
  const money = (value) => formatMoney(value, settings.currency);
  const cart = cartFor(client.id, table.id);

  const sParam = qs('s');
  const jParam = qs('j');
  const visitParams = sParam ? '&s=' + encodeURIComponent(sParam) + '&j=' + encodeURIComponent(jParam) : '';

  if (sParam) {
    const session = getById('sessions', sParam);
    if (!session || session.status !== 'open' || (jParam && session.joinSecret !== jParam)) {
      renderVisitEnded();
      return;
    }
  }

  on('session:close', (payload) => {
    if (payload && payload.tableId === table.id) renderVisitEnded();
  });
  on('session:paid', (payload) => {
    if (sParam && payload && payload.sessionId === sParam) renderVisitEnded();
  });
  on('menu:update', (payload) => {
    if (payload && payload.clientId && payload.clientId !== client.id) return;
    render();
  });

  const backLink = document.querySelector('.menu-bar__back, [data-back], .cart-head__back');
  if (backLink) {
    backLink.setAttribute('href', 'index.html?r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token) + visitParams);
  }

  document.getElementById('cart-table').textContent = table.name + ' · ' + client.name;

  const list = document.getElementById('cart-list');
  const emptyBlock = document.getElementById('cart-empty');
  const filled = document.getElementById('cart-filled');
  const sticky = document.getElementById('cart-sticky');

  if (!cart.items.length) {
    filled.hidden = true;
    sticky.hidden = true;
    emptyBlock.hidden = false;
    return;
  }

  emptyBlock.hidden = true;

  function render() {
    list.innerHTML = cart.items.map((row, index) => {
      const dbItem = row.itemId ? getById('items', row.itemId) : null;
      const isSoldOut = dbItem && dbItem.available === false;
      return '<div class="cart-item' + (isSoldOut ? ' cart-item--sold-out' : '') + '"><div class="cart-item__body">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<p class="cart-item__name"' + (isSoldOut ? ' style="color:var(--danger);"' : '') + '>' + esc(row.name) + '</p>' +
        (isSoldOut ? '<span class="sold-out-flag">Sold out</span>' : '') +
        '</div>' +
        '<p class="cart-item__opts">' + esc(row.size) + (row.addons.length ? ' · ' + esc(row.addons.join(', ')) : '') + '</p>' +
        (row.note ? '<p class="cart-item__opts">Note: ' + esc(row.note) + '</p>' : '') +
        (isSoldOut ? '<p class="text-xs" style="color:var(--danger);margin-top:4px;">This dish just sold out in the kitchen. Please remove it before placing your order.</p>' : '') +
        '<div class="cart-item__row"><div class="qty">' +
        '<button class="qty__btn" type="button" data-dec="' + index + '" aria-label="Decrease quantity">−</button>' +
        '<span class="qty__val">' + row.qty + '</span>' +
        '<button class="qty__btn" type="button" data-inc="' + index + '" aria-label="Increase quantity">+</button>' +
        '</div><span class="cart-item__price">' + money(row.price * row.qty) + '</span></div></div>' +
        '<button class="cart-item__remove" type="button" data-remove="' + index + '">' +
        '<i data-lucide="trash-2"></i> Remove</button></div>';
    }).join('');

    const totals = cartTotals(cart, settings);
    const lines = [];

    lines.push('<div class="summary__row"><span>Subtotal</span><span>' + money(totals.subtotal) + '</span></div>');

    if (!totals.pricesIncludeTax) {
      totals.taxes.forEach((tax) => {
        if (!tax.amount) return;
        lines.push('<div class="summary__row"><span>' + esc(tax.name) + ' ' + tax.rate + '%</span><span>' + money(tax.amount) + '</span></div>');
      });
    }

    totals.charges.forEach((charge) => {
      if (!charge.amount) return;
      const label = charge.type === 'percent' ? charge.value + '%' : 'fixed';
      lines.push('<div class="summary__row"><span>' + esc(charge.name) + ' <span class="muted">' + label + '</span></span><span>' + money(charge.amount) + '</span></div>');
    });

    lines.push('<div class="summary__row summary__row--total"><span>Total</span><span>' + money(totals.total) + '</span></div>');

    if (totals.pricesIncludeTax) {
      totals.includedTaxes.forEach((tax) => {
        if (!tax.amount) return;
        lines.push('<p class="summary__note">Includes ' + esc(tax.name) + ' ' + tax.rate + '%: ' + money(tax.amount) + '</p>');
      });
    }

    document.getElementById('sum-lines').innerHTML = lines.join('');
    document.getElementById('place-total').textContent = money(totals.total);
    if (window.lucide) window.lucide.createIcons();
  }

  list.addEventListener('click', (event) => {
    const inc = event.target.closest('[data-inc]');
    const dec = event.target.closest('[data-dec]');
    const removeBtn = event.target.closest('[data-remove]');

    if (inc) cart.items[Number(inc.getAttribute('data-inc'))].qty += 1;
    if (dec) {
      const row = cart.items[Number(dec.getAttribute('data-dec'))];
      row.qty -= 1;
      if (row.qty < 1) cart.items = cart.items.filter((r) => r !== row);
    }
    if (removeBtn) cart.items.splice(Number(removeBtn.getAttribute('data-remove')), 1);

    writeCart(cart);
    if (!cart.items.length) {
      filled.hidden = true;
      sticky.hidden = true;
      emptyBlock.hidden = false;
      return;
    }
    render();
  });

  render();
  initGeofenceBanner(client, table, 'cart-geofence-banner');

  const placeButton = document.getElementById('place-order');

  const payGrid = document.getElementById('pay-methods-grid');
  const payDesc = document.getElementById('pay-method-desc');
  const paymentsConf = settings.payments || {};
  const payPolicy = !ONLINE_PAYMENTS_ENABLED
    ? 'post_pay'
    : (paymentsConf.policy || (settings.payAtOrder?.enabled !== false ? 'pay_at_order' : 'flexible'));
  const stripe = paymentsConf.stripe || {};
  const paypal = paymentsConf.paypal || {};
  const inPerson = paymentsConf.inPerson || { cash: true, cardMachine: true };

  const methodsList = [];
  if (payPolicy === 'post_pay') {
    methodsList.push({ id: 'counter', name: 'Pay at end', icon: '🧾', desc: 'Order freely. Settle your bill at the end of your visit.' });
  } else {
    if (stripe.connected !== false && stripe.applePay !== false) {
      methodsList.push({ id: 'apple_pay', name: 'Apple Pay', icon: '🍏', desc: 'Instant 1-tap checkout via Apple Pay. Order is verified and fired straight to the chef.' });
    }
    if (stripe.connected !== false && stripe.googlePay !== false) {
      methodsList.push({ id: 'google_pay', name: 'Google Pay', icon: '🌐', desc: 'Fast 1-tap Google Pay. Seamless payment using cards saved in your Google Account.' });
    }
    if (stripe.connected !== false && stripe.cards !== false) {
      methodsList.push({ id: 'card', name: 'Credit Card', icon: '💳', desc: 'Secure 256-bit encrypted Visa, Mastercard, or American Express payment.' });
    }
    if (paypal.connected !== false && paypal.paypalWallet !== false) {
      methodsList.push({ id: 'paypal', name: 'PayPal / Venmo', icon: '🅿️', desc: 'Checkout with your PayPal balance, linked bank, or Venmo.' });
    }
    if (settings.currency === '₹' || paymentsConf.razorpay?.connected) {
      methodsList.push({ id: 'upi', name: 'UPI Pay', icon: '📱', desc: 'Instant UPI via GPay, PhonePe, Paytm, or BHIM.' });
    }
    if (payPolicy !== 'pay_at_order' && inPerson.cash !== false) {
      methodsList.push({ id: 'counter', name: 'Pay Server', icon: '💵', desc: 'Pay server in person at your table (cash or portable card reader).' });
    }
    if (!methodsList.length) {
      methodsList.push({ id: 'apple_pay', name: 'Apple Pay', icon: '🍏', desc: 'Instant 1-tap checkout via Apple Pay.' });
      methodsList.push({ id: 'card', name: 'Credit Card', icon: '💳', desc: 'Secure credit/debit card payment.' });
      if (payPolicy !== 'pay_at_order') {
        methodsList.push({ id: 'counter', name: 'Pay Server', icon: '💵', desc: 'Pay server in person at your table.' });
      }
    }
  }

  if (payGrid) {
    if (payPolicy === 'post_pay') {
      payGrid.style.display = 'none';
      if (payDesc) payDesc.textContent = 'Traditional bill at end: Order freely now, settle your bill at the end of your visit.';
    } else {
      payGrid.innerHTML = methodsList.map((m, idx) => `
        <label class="pay-method-btn ${idx === 0 ? 'is-selected' : ''}" data-method="${m.id}" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #fff; border: ${idx === 0 ? '2px solid var(--primary, #8C3A27)' : '1px solid var(--border, rgba(0,0,0,0.12))'}; border-radius: 10px; cursor: pointer;">
          <input type="radio" name="pay-method" value="${m.id}" ${idx === 0 ? 'checked' : ''} style="accent-color: var(--primary, #8C3A27);">
          <span style="font-size: 1.1rem;">${m.icon}</span>
          <span style="font-size: 0.85rem; font-weight: 700; color: var(--text, #1A1A1A);">${esc(m.name)}</span>
        </label>
      `).join('');
    }
  }

  let selectedMethod = methodsList[0]?.id || (payPolicy === 'post_pay' ? 'counter' : 'apple_pay');
  let methodBtns = document.querySelectorAll('.pay-method-btn');
  let payRadios = document.querySelectorAll('input[name="pay-method"]');

  function updatePaymentUi(method) {
    selectedMethod = method;
    methodBtns.forEach((btn) => {
      const isSel = btn.getAttribute('data-method') === method;
      btn.style.borderColor = isSel ? 'var(--primary, #8C3A27)' : 'var(--border, rgba(0,0,0,0.12))';
      btn.style.borderWidth = isSel ? '2px' : '1px';
    });
    const matched = methodsList.find((m) => m.id === method);
    if (payDesc && matched) {
      payDesc.textContent = matched.desc;
    }
    const totSpan = document.getElementById('place-total');
    const totVal = totSpan ? totSpan.textContent : '';
    if (placeButton) {
      if (payPolicy === 'post_pay') {
        placeButton.innerHTML = `Place order · <span id="place-total">${totVal}</span>`;
      } else if (method === 'apple_pay') placeButton.innerHTML = `🍏 Pay with Apple Pay · <span id="place-total">${totVal}</span>`;
      else if (method === 'google_pay') placeButton.innerHTML = `🌐 Pay with Google Pay · <span id="place-total">${totVal}</span>`;
      else if (method === 'card') placeButton.innerHTML = `💳 Pay with Credit Card · <span id="place-total">${totVal}</span>`;
      else if (method === 'paypal') placeButton.innerHTML = `🅿️ Pay with PayPal · <span id="place-total">${totVal}</span>`;
      else if (method === 'upi') placeButton.innerHTML = `📱 Pay via UPI · <span id="place-total">${totVal}</span>`;
      else placeButton.innerHTML = `Place order (Pay Server) · <span id="place-total">${totVal}</span>`;
    }
  }

  payRadios.forEach((r) => r.addEventListener('change', (e) => updatePaymentUi(e.target.value)));
  methodBtns.forEach((btn) => btn.addEventListener('click', () => {
    const r = btn.querySelector('input[type="radio"]');
    if (r) { r.checked = true; updatePaymentUi(r.value); }
  }));

  updatePaymentUi(selectedMethod);

  placeButton.addEventListener('click', async () => {
    if (placeButton.disabled) return;
    if (!(await guestMayOrder(client, placeButton))) return;

    const totals = cartTotals(cart, settings);

    // Per-device limit
    const lastDeviceOrder = Number(localStorage.getItem(DEVICE_ORDER_KEY) || 0);
    if (Date.now() - lastDeviceOrder < 5000) {
      toast('Please wait a moment before ordering again.', 'warning');
      return;
    }

    // Per-table limit: max 5 orders per table per minute (all devices together)
    const oneMinuteAgo = Date.now() - 60000;
    const recentTableOrders = query('orders', (o) => o.tableId === table.id && new Date(o.createdAt).getTime() >= oneMinuteAgo);
    if (recentTableOrders.length >= 5) {
      toast('Too many orders at once - please wait a moment.', 'warning');
      return;
    }

    // Check if any items in cart were marked unavailable / sold out
    const unavailableInCart = cart.items.find((row) => {
      const dbItem = row.itemId ? getById('items', row.itemId) : null;
      return dbItem && dbItem.available === false;
    });
    if (unavailableInCart) {
      toast('“' + unavailableInCart.name + '” is sold out. Please remove it from your cart.', 'error');
      render();
      return;
    }

    const isPayFirst = ONLINE_PAYMENTS_ENABLED && settings.payments?.policy === 'pay_first';
    const currentSession = sessionForTable(client.id, table.id);

    if (!isPayFirst) {
      if (!currentSession || currentSession.status !== 'open') {
        toast('Please ask staff to seat you', 'warning');
        return;
      }
      if (!isDeviceTrusted(table.id, currentSession)) {
        promptTableKeySheet(ctx, currentSession, () => {
          proceedOrder();
        });
        return;
      }
    }

    proceedOrder();

    function proceedOrder() {
      function executeOrder(payment) {
        placeButton.disabled = true;
        placeButton.textContent = 'Placing order…';

        const order = placeOrder({
          client,
          table,
          cart,
          payment,
          note: document.getElementById('kitchen-note').value.trim(),
          guestName: document.getElementById('guest-name').value.trim(),
        });

        if (!order) {
          placeButton.disabled = false;
          updatePaymentUi(selectedMethod);
          return;
        }

        localStorage.setItem(DEVICE_ORDER_KEY, String(Date.now()));
        try {
          const myOrders = JSON.parse(localStorage.getItem('tqr_my_orders') || '[]');
          if (!myOrders.includes(order.id)) {
            myOrders.push(order.id);
            localStorage.setItem('tqr_my_orders', JSON.stringify(myOrders));
          }
        } catch (e) {}
        emit('order:new', { orderId: order.id, clientId: client.id });
        logActivity({
          actor: 'Guest · ' + table.name,
          clientId: client.id,
          type: 'Order',
          details: 'Order #' + order.number + ' placed (' + totals.count + ' items' + (order.paid ? ' · Paid via ' + (payment.method || '').toUpperCase() : '') + ')',
        });

        sessionStorage.removeItem(CART_KEY);
        location.href = 'order-status.html?id=' + order.id + '&r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token) + visitParams;
      }

      if (selectedMethod === 'counter') {
        executeOrder({ method: 'counter', txnId: null });
      } else {
        showPaymentModal(selectedMethod, totals, settings, table, (paymentResult) => {
          executeOrder(paymentResult);
        });
      }
    }
  });
}

function nextNumber(clientId) {
  const numbers = query('orders', (o) => o.clientId === clientId).map((o) => Number(o.number) || 0);
  return (numbers.length ? Math.max(...numbers) : 1040) + 1;
}

/* -------------------------------------------------------------- status ---- */
function formatOrderTimer(order) {
  const elapsed = Math.max(0, Date.now() - new Date(order.createdAt).getTime());
  const m = Math.floor(elapsed / 60000);
  const etaMinutes = 15;
  // Past the estimate there is nothing useful to count down; just show how long it has been.
  const tail = m < etaMinutes ? ' (Est. ~' + Math.max(1, etaMinutes - m) + ' min remaining)' : '';
  return 'In the kitchen · ' + formatElapsed(elapsed) + ' elapsed' + tail;
}

function initStatus(ctx) {
  const { client, table } = ctx;
  const settings = client.settings;
  const money = (value) => formatMoney(value, settings.currency);
  const id = qs('id');
  let order = id ? getById('orders', id) : null;

  const host = document.getElementById('status-body');
  if (!order) {
    host.innerHTML = '<div class="empty"><span class="empty__icon"><i data-lucide="receipt"></i></span>' +
      '<p class="empty__title">We could not find that order</p>' +
      '<p class="empty__text">It may belong to another table, or the demo data was reset.</p>' +
      '<div class="empty__action"><a class="btn btn--primary" href="index.html">Back to the menu</a></div></div>';
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  function render() {
    order = getById('orders', order.id) || order;
    const steps = ['Received', 'Preparing', 'Ready', 'On its way', 'Served'];
    const isPickedUp = order.pickedUp || order.status === 'picked_up';
    let index = 0;
    if (order.status === 'new' || order.status === 'pending_approval') index = 0;
    else if (order.status === 'preparing') index = 1;
    else if (order.status === 'ready' && !isPickedUp) index = 2;
    else if (order.status === 'ready' && isPickedUp) index = 3;
    else if (order.status === 'served') index = 4;

    const isRejected = order.status === 'rejected';
    const isVoided = order.status === 'voided';

    const payStatusBadge = order.paid
      ? '<div style="display:inline-flex;align-items:center;gap:4px;background:#ECFDF5;color:#047857;border:1px solid #A7F3D0;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:700;margin-top:6px;"><i data-lucide="shield-check" style="width:14px;height:14px;"></i> Paid with ' + esc((order.paymentMethod || 'apple_pay').toUpperCase()) + ' · Ref #' + esc(order.paymentTxnId || 'VERIFIED') + '</div>'
      : '<div style="display:inline-flex;align-items:center;gap:4px;background:#FFFBEB;color:#B45309;border:1px solid #FDE68A;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:600;margin-top:6px;"><i data-lucide="clock" style="width:14px;height:14px;"></i> Pay Waiter at Table</div>';

    // Check if there is an active call for this table with on_my_way
    const activeCalls = query('waiterCalls', (c) => c.clientId === client.id && c.tableName === order.tableName && c.status === 'on_my_way');
    const waiterNotice = activeCalls.length
      ? '<div style="margin:12px 0;padding:10px 14px;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:8px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;"><i data-lucide="user-check" style="width:18px;height:18px;"></i> A waiter is coming to your table</div>'
      : '';

    const progressPercent = index === 0 ? 0 : index === 1 ? 25 : index === 2 ? 50 : index === 3 ? 75 : 100;

    host.innerHTML =
      '<div class="status-hero">' +
      (isVoided
        ? '<span class="status-tick" style="background:#FDECEC;color:#B91C1C"><i data-lucide="x"></i></span>' +
          '<h1 class="status-title">' + (isVoided ? 'Ghost Order Rejected' : 'Order not accepted') + '</h1>' +
          '<p class="status-meta">Order #' + order.number + ' · ' + esc(order.tableName) + '</p>'
        : isRejected
        ? '<span class="status-tick" style="background:#FDECEC;color:#B91C1C"><i data-lucide="x"></i></span>' +
          '<h1 class="status-title">Order not accepted</h1>' +
          '<p class="status-meta">Order #' + order.number + ' · ' + esc(order.tableName) + '</p>'
        : '<span class="status-tick"><i data-lucide="check"></i></span>' +
          '<h1 class="status-title">Order placed</h1>' +
          '<p class="status-meta">Order #' + order.number + ' · ' + esc(order.tableName) + ' · ' + formatTime(order.createdAt) + '</p>' +
          payStatusBadge) +
      waiterNotice +
      '</div>' +
      (isVoided
        ? '<div class="status-card" style="border:1px solid #EF4444;background:#FEF2F2;"><p class="text-sm font-semibold" style="color:#B91C1C;">Ghost Order Rejected by Kitchen</p><p class="text-xs" style="color:#7F1D1D;margin-top:4px;">This order was voided by restaurant staff because Table ' + esc(order.tableName) + ' was not seated on the Floor Plan.</p></div>'
        : isRejected
        ? '<div class="status-card"><p class="text-sm">The kitchen could not take this order — an item sold out. Nothing was charged. Please order again or call a waiter.</p></div>'
        : '<div class="progress"><div class="progress__track"><div class="progress__fill" style="width:' +
            progressPercent + '%"></div></div>' +
          '<div class="progress__steps">' + steps.map((label, i) =>
            '<div class="progress__step' + (i < index ? ' progress__step--done' : i === index ? ' progress__step--active' : '') + '">' +
            '<span class="progress__dot">' + (i < index ? '<i data-lucide="check"></i>' : '<i data-lucide="dot"></i>') + '</span>' +
            '<span class="progress__label">' + label + '</span></div>').join('') +
          '</div></div>') +
      '<div class="status-card"><div class="status-items">' +
      order.items.map((item) =>
        '<div class="status-item"><span><span class="status-item__qty">' + item.qty + '×</span> ' + esc(item.name) +
        (item.size && item.size !== 'Regular' ? ' <span class="muted">(' + esc(item.size) + ')</span>' : '') + '</span>' +
        '<span class="status-item__price">' + money(item.price * item.qty) + '</span></div>').join('') +
      '<div class="status-item" style="border-top:1px solid var(--line); margin-top:6px; padding-top:10px; font-weight:600;">' +
      '<span>Total</span><span class="status-item__price">' + money(order.total) + '</span></div>' +
      '</div>' +
      '<div class="status-eta"><i data-lucide="timer"></i><span id="order-eta-text">' +
      (order.status === 'served' ? 'Served — enjoy your meal.' :
        isPickedUp ? 'On its way — a waiter is bringing your order.' :
        order.status === 'ready' ? 'Ready — waiting for waiter pickup.' :
          order.status === 'pending_approval' ? 'Waiting for the restaurant to accept your order.' :
            formatOrderTimer(order)) + '</span></div></div>' +
      notifyCardHtml(client, order) +
      (order.status === 'served' ? reviewCardHtml(getById('clients', client.id) || client)
        : isRejected || isVoided ? '' : reviewLinkHtml(getById('clients', client.id) || client)) +
      '<div class="status-actions">' +
      '<a class="btn btn--secondary" href="index.html?r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token) + '">Order more</a>' +
      '<button class="btn btn--primary" type="button" data-call="waiter"><i data-lucide="bell"></i> Call waiter</button></div>';

    if (window.lucide) window.lucide.createIcons();

    const notifyBtn = host.querySelector('[data-notify-me]');
    if (notifyBtn) notifyBtn.addEventListener('click', () => enableNotifications(order.id, render));

    const callBtn = host.querySelector('[data-call]');
    if (callBtn) {
      callBtn.addEventListener('click', () => {
        insert('waiterCalls', {
          clientId: client.id, tableName: order.tableName, type: 'waiter', status: 'open',
          createdAt: new Date().toISOString(),
        });
        emit('call:new', { clientId: client.id });
        toast('Waiter has been notified · ' + order.tableName);
      });
    }
  }

  render();
  initGuestPush(render);
  on('order:update', (payload) => {
    if (!payload || payload.orderId === order.id) render();
  });
  on('order:picked_up', (payload) => {
    if (!payload || payload.orderId === order.id) render();
  });
  on('order:served', (payload) => {
    if (!payload || payload.orderId === order.id) render();
  });
  on('call:on_my_way', () => render());
  on('call:done', () => render());
  on('call:update', () => render());
  setInterval(() => {
    const freshOrder = getById('orders', order.id);
    if (!freshOrder) return;
    if (freshOrder.status !== order.status) {
      render();
      return;
    }
    const etaSpan = document.getElementById('order-eta-text');
    if (etaSpan && (freshOrder.status === 'new' || freshOrder.status === 'preparing')) {
      etaSpan.textContent = formatOrderTimer(freshOrder);
    }
  }, 1000);
}

/* --------------------------------------------------------------- bill ----- */
function initBill(ctx) {
  // The review button sits under the bill, outside the part that redraws.
  const billReview = reviewCardHtml(ctx.client);
  if (billReview) {
    document.getElementById('bill-body').insertAdjacentHTML('afterend', billReview);
    if (window.lucide) window.lucide.createIcons();
  }
  const { client, table } = ctx;
  const settings = client.settings;
  const money = (value) => formatMoney(value, settings.currency);
  const taxNumber = settings.taxNumber || {};
  const tipsOn = !!(settings.tips && settings.tips.enabled);
  const presets = (settings.tips && settings.tips.presets) || [10, 15, 20];
  const allowCustom = !settings.tips || settings.tips.allowCustom !== false;

  const sParam = qs('s');
  const jParam = qs('j');
  const visitParams = sParam ? '&s=' + encodeURIComponent(sParam) + '&j=' + encodeURIComponent(jParam) : '';

  if (sParam) {
    const s = getById('sessions', sParam);
    if (!s || s.status !== 'open' || (jParam && s.joinSecret !== jParam)) {
      renderVisitEnded();
      return;
    }
  }

  on('session:close', (payload) => {
    if (payload && payload.tableId === table.id) renderVisitEnded();
  });
  on('session:paid', (payload) => {
    if (sParam && payload && payload.sessionId === sParam) renderVisitEnded();
  });

  let session = sessionForTable(client.id, table.id);
  const host = document.getElementById('bill-body');

  const isTrusted = isDeviceTrusted(table.id, session);
  if (!session || session.status !== 'open' || !isTrusted) {
    host.innerHTML =
      '<div class="empty"><span class="empty__icon"><i data-lucide="receipt"></i></span>' +
      '<p class="empty__title">Please ask staff to seat you</p>' +
      '<p class="empty__text">This table does not have an active session for your device.</p>' +
      '<div class="empty__action"><a class="btn btn--primary" href="index.html?r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token) + visitParams + '">Back to the menu</a></div></div>';
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  let chooserOpen = false;

  function requestBill(methodId) {
    const call = createBillRequest(client.id, table, methodId);
    if (!call) return;
    chooserOpen = false;
    save({ paymentMethod: methodId });
  }

  function save(patch) {
    session = update('sessions', session.id, patch);
    render();
  }

  function render() {
    session = getById('sessions', session.id) || session;
    const orders = sessionOrders(session);
    const bill = computeBill({
      lines: sessionLines(session),
      settings,
      removedChargeIds: session.removedChargeIds,
      addedChargeIds: session.addedChargeIds,
      discount: session.discount,
      tip: session.tip,
    });

    const applied = new Set(bill.charges.map((c) => c.id));
    const allCharges = (settings.charges || []).filter((c) => c.enabled);
    const methods = (settings.paymentMethods || []).filter((m) => m.enabled);
    const chosen = methods.find((m) => m.id === session.paymentMethod) || null;

    const orderRows = orders.map((order) =>
      '<div class="status-item"><span><span class="status-item__qty">#' + order.number + '</span> ' +
      order.items.length + (order.items.length === 1 ? ' item' : ' items') +
      ' <span class="muted">· ' + formatTime(order.createdAt) + '</span></span>' +
      '<span class="status-item__price">' + money(order.total) + '</span></div>').join('');

    const chargeRows = allCharges.map((charge) => {
      const line = bill.charges.find((c) => c.id === charge.id);
      const optional = charge.customerCanRemove !== false;
      if (line) {
        return '<div class="list-row"><div class="list-row__main">' +
          '<p class="list-row__title">' + esc(charge.name) + '</p>' +
          '<p class="list-row__meta">' + (charge.type === 'fixed' ? 'Fixed' : charge.value + '%') +
          (optional ? ' · This charge is optional' : '') + '</p></div>' +
          '<div class="list-row__side"><span class="list-row__amount">' + money(line.amount) + '</span>' +
          (optional ? '<button class="btn btn--secondary btn--sm" type="button" data-remove-charge="' + charge.id + '">Remove</button>' : '') +
          '</div></div>';
      }
      if (charge.addedByDefault === false) {
        return '<div class="list-row"><div class="list-row__main">' +
          '<p class="list-row__title">' + esc(charge.name) + '</p>' +
          '<p class="list-row__meta">Optional · ' + (charge.type === 'fixed' ? 'fixed' : charge.value + '%') + '</p></div>' +
          '<div class="list-row__side"><button class="btn btn--secondary btn--sm" type="button" data-add-charge="' + charge.id + '">Add</button></div></div>';
      }
      return '';
    }).join('');

    const tipChips = presets.map((pct) =>
      '<button class="chip' + (session.tip && session.tip.type === 'percent' && Number(session.tip.value) === Number(pct) ? ' chip--active' : '') +
      '" type="button" data-tip="' + pct + '">' + pct + '%</button>').join('') +
      '<button class="chip' + (session.tip && session.tip.type === 'amount' && Number(session.tip.value) === 0 ? ' chip--active' : '') +
      '" type="button" data-tip="0">No tip</button>';

    const lines = ['<div class="summary__row"><span>Subtotal</span><span>' + money(bill.subtotal) + '</span></div>'];
    if (bill.discount.amount > 0) {
      lines.push('<div class="summary__row"><span>Discount' + (bill.discount.reason ? ' <span class="muted">· ' + esc(bill.discount.reason) + '</span>' : '') + '</span><span>−' + money(bill.discount.amount) + '</span></div>');
    }
    bill.charges.forEach((c) => lines.push('<div class="summary__row"><span>' + esc(c.name) + '</span><span>' + money(c.amount) + '</span></div>'));
    bill.taxes.forEach((t) => lines.push('<div class="summary__row"><span>' + esc(t.name) + ' ' + t.rate + '%</span><span>' + money(t.amount) + '</span></div>'));
    if (bill.tip.amount > 0) lines.push('<div class="summary__row"><span>Tip</span><span>' + money(bill.tip.amount) + '</span></div>');
    lines.push('<div class="summary__row summary__row--total"><span>Total</span><span>' + money(bill.total) + '</span></div>');
    bill.includedTaxes.forEach((t) => lines.push('<p class="summary__note">Includes ' + esc(t.name) + ' ' + t.rate + '%: ' + money(t.amount) + '</p>'));
    if (bill.roundingAdjustment) lines.push('<p class="summary__note">Rounded to ' + money(bill.total) + '</p>');

    host.innerHTML =
      '<div class="status-hero"><span class="status-tick"><i data-lucide="receipt"></i></span>' +
      '<h1 class="status-title">Your bill</h1>' +
      '<p class="status-meta">' + esc(table.name) + ' · ' + orders.length + (orders.length === 1 ? ' order' : ' orders') + '</p></div>' +

      '<div class="status-card"><p class="sheet-group__label">Orders on this table</p>' +
      '<div class="status-items">' + orderRows + '</div></div>' +

      (chargeRows ? '<div class="status-card"><p class="sheet-group__label">Charges</p>' + chargeRows + '</div>' : '') +

      (tipsOn ? '<div class="status-card"><p class="sheet-group__label">Add a tip</p>' +
        '<div class="filter-row" style="padding:0">' + tipChips + '</div>' +
        (allowCustom ? '<div class="field mt-4"><label class="label" for="tip-amount">Or enter an amount</label>' +
          '<div class="row"><input class="input" id="tip-amount" type="number" min="0" step="0.50" placeholder="0.00" value="' +
          (session.tip && session.tip.type === 'amount' && session.tip.value ? session.tip.value : '') + '">' +
          '<button class="btn btn--secondary" type="button" data-tip-custom>Set</button></div></div>' : '') +
        '<p class="hint">Tips go to the team and are never taxed.</p></div>' : '') +

      '<div class="status-card"><div class="summary">' + lines.join('') + '</div></div>' +

      (taxNumber.value ? '<p class="hint text-center">' + esc(taxNumber.label || 'Tax number') + ': ' + esc(taxNumber.value) + '</p>' : '') +
      '<div class="cart-info"><i data-lucide="info"></i><span>' + esc(settings.paymentNote || 'Your waiter will bring the card machine to your table.') + '</span></div>' +
      (chooserOpen
        ? '<div class="status-card"><p class="sheet-group__label">How will you pay?</p>' +
          '<div class="row row--wrap">' +
          methods.map((m) => '<button class="btn ' + (m.id === session.paymentMethod ? 'btn--primary' : 'btn--secondary') +
            '" type="button" data-pick-pay="' + m.id + '">' + esc(m.name) + '</button>').join('') +
          '</div><p class="hint">Your waiter will be told, so they bring the right thing.</p></div>'
        : '') +
      (chosen && !chooserOpen
        ? '<div class="cart-info"><i data-lucide="wallet"></i><span>You chose <strong>' + esc(chosen.name) + '</strong> — your waiter has been told.</span></div>'
        : '') +
      '<div class="status-actions"><button class="btn btn--primary" type="button" data-ask-bill>' +
      '<i data-lucide="bell"></i> ' + (chosen ? 'Change payment method' : 'Ask for the bill') + '</button></div>';

    if (window.lucide) window.lucide.createIcons();

    host.querySelectorAll('[data-remove-charge]').forEach((btn) => btn.addEventListener('click', () => {
      save({ removedChargeIds: [...(session.removedChargeIds || []), btn.getAttribute('data-remove-charge')] });
      toast('Charge removed');
    }));
    host.querySelectorAll('[data-add-charge]').forEach((btn) => btn.addEventListener('click', () => {
      save({ addedChargeIds: [...(session.addedChargeIds || []), btn.getAttribute('data-add-charge')] });
      toast('Charge added');
    }));
    host.querySelectorAll('[data-tip]').forEach((btn) => btn.addEventListener('click', () => {
      const pct = Number(btn.getAttribute('data-tip'));
      save({ tip: { type: 'percent', value: pct } });
    }));
    const custom = host.querySelector('[data-tip-custom]');
    if (custom) custom.addEventListener('click', () => {
      const value = Number(host.querySelector('#tip-amount').value) || 0;
      save({ tip: { type: 'amount', value } });
    });
    const ask = host.querySelector('[data-ask-bill]');
    if (ask) ask.addEventListener('click', () => { chooserOpen = !chooserOpen; render(); });
    host.querySelectorAll('[data-pick-pay]').forEach((btn) =>
      btn.addEventListener('click', () => requestBill(btn.getAttribute('data-pick-pay'))));
  }

  render();
  on('order:new', (payload) => {
    if (!payload || payload.clientId !== client.id) return;
    const fresh = sessionForTable(client.id, table.id);
    if (fresh && fresh.id === session.id) render();
  });
}

/* --------------------------------------------------------- unavailable ---- */
function initUnavailable() {
  const reason = qs('reason') || 'closed';
  const map = { closed: 'closed', invalid: 'invalid', paused: 'paused' };
  const keep = map[reason] || 'closed';
  document.querySelectorAll('[data-state]').forEach((block) => {
    if (block.getAttribute('data-state') !== keep) block.hidden = true;
  });

  const slug = qs('r');
  const client = slug ? query('clients', (c) => c.slug === slug)[0] : null;
  const hoursHost = document.getElementById('state-hours');
  if (hoursHost && client) {
    const labels = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
    const todayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    hoursHost.innerHTML = Object.entries(client.settings.hours || {}).map(([key, range]) =>
      '<div class="hours__row' + (key === todayKey ? ' hours__row--today' : '') + '">' +
      '<span>' + labels[key] + '</span><span>' + (range[0] || 'Closed') + ' – ' + (range[1] || '') + '</span></div>'
    ).join('');
  }
}

/* ----------------------------------------------------------------- boot --- */
const page = document.body.getAttribute('data-page');
const ctx = resolveContext();

if (ctx.error && page !== 'unavailable') {
  goUnavailable(ctx.error, ctx);
} else if (page === 'menu') {
  initMenu(ctx);
  // Under the menu list, so it never covers ordering.
  const link = reviewLinkHtml(ctx.client);
  const anchor = document.querySelector('[data-call="waiter"]')?.parentElement;
  if (link && anchor) {
    anchor.insertAdjacentHTML('beforebegin', link);
    if (window.lucide) window.lucide.createIcons();
  }
} else if (page === 'cart') {
  initCart(ctx);
} else if (page === 'status') {
  initStatus(ctx);
} else if (page === 'bill') {
  initBill(ctx);
} else if (page === 'unavailable') {
  initUnavailable();
}

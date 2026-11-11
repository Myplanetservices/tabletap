/* ==========================================================================
   TableTap — kitchen.js
   Live tickets for the pass: columns, timers, sound, strike-through items.
   ========================================================================== */

import * as store from './store.js';
import { requireRole, currentClient, logout } from './auth.js';
import { emit, on } from './realtime.js';
import { esc, timeAgo, toast, confirmDialog, initials } from './helpers.js';

const session = requireRole('kitchen');
const client = currentClient();
const page = document.body.getAttribute('data-page');
const settings = client.settings;

document.documentElement.style.setProperty('--accent', settings.accent || '#1F4D3A');

const nameEl = document.getElementById('k-name');
if (nameEl && page === 'kitchen') nameEl.textContent = client.name + ' · Kitchen';
if (nameEl && page === 'kitchen-completed') nameEl.textContent = client.name + ' · Completed';

const logoutBtn = document.getElementById('k-logout');
if (logoutBtn) logoutBtn.addEventListener('click', () => logout());

/* Clock */
function tickClock() {
  const el = document.getElementById('k-clock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) +
    ' · ' + new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
tickClock();
setInterval(tickClock, 15000);

/* Sound */
const SOUND_KEY = 'tqr_kitchen_sound';
let soundOn = localStorage.getItem(SOUND_KEY) !== 'off';

function paintSound() {
  const btn = document.getElementById('k-sound');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(soundOn));
  btn.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
  btn.innerHTML = '<i data-lucide="' + (soundOn ? 'volume-2' : 'volume-x') + '"></i>';
  if (window.lucide) window.lucide.createIcons();
}

function beep() {
  if (!soundOn) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1180, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (err) { /* audio blocked until first tap — fine */ }
}

const soundBtn = document.getElementById('k-sound');
if (soundBtn) {
  paintSound();
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
    paintSound();
    if (soundOn) beep();
    toast(soundOn ? 'Sound on' : 'Sound off');
  });
}

/* Fullscreen */
const fsBtn = document.getElementById('k-fullscreen');
if (fsBtn) {
  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => toast('Full screen was blocked by the browser', 'warning'));
    } else {
      document.exitFullscreen?.();
    }
  });
}

/* ------------------------------------------------------------- tickets ---- */
function elapsedMinutes(order) {
  return Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000));
}

function timerClass(minutes) {
  if (minutes >= 20) return ' k-timer--red';
  if (minutes >= 10) return ' k-timer--amber';
  return '';
}

function itemsHtml(order) {
  return order.items.map((item, index) =>
    '<div class="k-item' + (item.done ? ' k-item--done' : '') + '" data-item="' + order.id + ':' + index + '">' +
    '<span class="k-item__qty">' + item.qty + '×</span>' +
    '<div class="k-item__body"><p class="k-item__name">' + esc(item.name) + '</p>' +
    (item.size || (item.addons && item.addons.length)
      ? '<p class="k-item__opts">' + esc([item.size, (item.addons || []).join(', ')].filter(Boolean).join(' · ')) + '</p>' : '') +
    (item.note ? '<p class="k-item__note">' + esc(item.note) + '</p>' : '') +
    '</div></div>').join('');
}

function ticketHtml(order, column) {
  const minutes = elapsedMinutes(order);
  const action = column === 'new' ? 'Start' : column === 'preparing' ? 'Mark ready' : 'Served';
  return '<article class="k-ticket' + (order.__flash ? ' k-ticket--flash' : '') + '" data-order="' + order.id + '">' +
    '<div class="k-ticket__head"><div><p class="k-ticket__table">' + esc(order.tableName) + '</p>' +
    '<p class="k-ticket__meta">Order #' + order.number + '</p></div>' +
    '<span class="k-timer' + timerClass(minutes) + '" data-timer="' + order.id + '"><i data-lucide="timer"></i> ' + minutes + ' min</span></div>' +
    '<div class="k-items">' + itemsHtml(order) + '</div>' +
    (order.note ? '<p class="k-note">' + esc(order.note) + '</p>' : '') +
    (order.guestName ? '<p class="k-guest">Guest: ' + esc(order.guestName) + '</p>' : '') +
    '<button class="btn btn--primary" type="button" data-action="' + order.id + '" data-next="' +
    (column === 'new' ? 'preparing' : column === 'preparing' ? 'ready' : 'served') + '">' + action + '</button>' +
    '</article>';
}

const COLUMNS = [
  ['new', 'New', 'k-col--new', 'k-new', 'k-tab-new'],
  ['preparing', 'Preparing', 'k-col--prep', 'k-prep', 'k-tab-prep'],
  ['ready', 'Ready', 'k-col--ready', 'k-ready', 'k-tab-ready'],
];

const columnsHost = document.getElementById('k-columns');
const countersHost = document.getElementById('k-counters');
const bannerHost = document.getElementById('k-banner-host');
let activeTab = 'new';

function ordersFor(status) {
  return store.ordersOf(client.id)
    .filter((o) => o.status === status)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function draw() {
  const counts = { new: ordersFor('new').length, preparing: ordersFor('preparing').length, ready: ordersFor('ready').length };
  const pending = ordersFor('pending_approval').length;

  if (countersHost) {
    countersHost.innerHTML =
      '<span class="k-counter k-counter--new"><strong>' + counts.new + '</strong> New</span>' +
      '<span class="k-counter"><strong>' + counts.preparing + '</strong> Preparing</span>' +
      '<span class="k-counter k-counter--ready"><strong>' + counts.ready + '</strong> Ready</span>' +
      (pending ? '<span class="k-counter"><strong>' + pending + '</strong> Waiting approval</span>' : '');
  }

  if (!columnsHost) return;

  columnsHost.innerHTML = COLUMNS.map(([status, label, colClass, id, tabId]) => {
    const rows = ordersFor(status);
    const pendingHtml = status === 'new' && pending
      ? '<div class="k-pending"><div class="k-pending__head"><span class="k-pending__table">Table 2</span>' +
        '<span class="badge badge--neutral">Pending</span></div>' +
        '<p class="mt-2">' + pending + ' order waiting for owner approval. It will appear here once approved.</p></div>'
      : '';
    return '<section class="k-col ' + colClass + '" id="' + id + '" role="tabpanel" aria-labelledby="' + tabId + '"' +
      (status !== activeTab ? ' hidden' : '') + '>' +
      '<div class="k-col__head"><span class="k-col__title"><span class="dot" aria-hidden="true"></span> ' + label + '</span>' +
      '<span class="k-col__count">' + rows.length + (rows.length === 1 ? ' ticket' : ' tickets') + '</span></div>' +
      '<div class="k-col__body">' +
      (rows.length ? rows.map((order) => ticketHtml(order, status)).join('') : '<p class="muted text-sm">Nothing here right now.</p>') +
      pendingHtml + '</div></section>';
  }).join('');

  const tabCounts = { new: counts.new, preparing: counts.preparing, ready: counts.ready };
  document.querySelectorAll('[data-k-tab]').forEach((tab) => {
    const key = tab.getAttribute('data-k-tab');
    tab.textContent = tab.textContent.replace(/\s*\(\d+\)$/, '') + ' (' + tabCounts[key] + ')';
  });

  if (window.lucide) window.lucide.createIcons();
}

/* Tabs (mobile) */
document.querySelectorAll('[data-k-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    activeTab = tab.getAttribute('data-k-tab');
    document.querySelectorAll('[data-k-tab]').forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    draw();
  });
});

/* Actions */
if (columnsHost) {
  columnsHost.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    const item = event.target.closest('[data-item]');

    if (action) {
      const id = action.getAttribute('data-action');
      const next = action.getAttribute('data-next');
      const order = store.update('orders', id, { status: next, updatedAt: new Date().toISOString() });
      emit('order:update', { orderId: id, clientId: client.id });
      store.logActivity({
        actor: session.name,
        clientId: client.id,
        type: 'Order',
        details: 'Order #' + order.number + ' → ' + next,
      });
      draw();
      return;
    }

    if (item) {
      const [orderId, index] = item.getAttribute('data-item').split(':');
      const order = store.getById('orders', orderId);
      if (!order) return;
      const items = order.items.map((row, i) => (i === Number(index) ? { ...row, done: !row.done } : row));
      store.update('orders', orderId, { items });
      draw();
    }
  });
}

/* Timers */
setInterval(() => {
  document.querySelectorAll('[data-timer]').forEach((el) => {
    const order = store.getById('orders', el.getAttribute('data-timer'));
    if (!order) return;
    const minutes = elapsedMinutes(order);
    el.className = 'k-timer' + timerClass(minutes);
    el.innerHTML = '<i data-lucide="timer"></i> ' + minutes + ' min';
  });
  if (window.lucide) window.lucide.createIcons();
}, 1000);

/* New order arrival */
function announce(order) {
  beep();
  if (bannerHost) {
    bannerHost.innerHTML = '<div class="k-banner"><i data-lucide="bell"></i> New order — ' + esc(order.tableName) + '</div>';
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => { bannerHost.innerHTML = ''; }, 5000);
  }
  draw();
  const card = document.querySelector('[data-order="' + order.id + '"]');
  if (card) {
    card.classList.add('k-ticket--flash');
    setTimeout(() => card.classList.remove('k-ticket--flash'), 4000);
  }
}

on('order:new', (payload) => {
  if (!payload || payload.clientId !== client.id) return;
  const order = store.getById('orders', payload.orderId);
  if (order) announce(order);
  else draw();
});

on('order:update', () => draw());
on('call:new', () => draw());

/* --------------------------------------------------- completed page ------- */
if (page === 'kitchen-completed') {
  const rowsHost = document.getElementById('k-rows');
  const search = document.getElementById('k-search');
  const summary = document.getElementById('k-summary');

  function drawCompleted() {
    const term = (search.value || '').trim().toLowerCase();
    const served = store.ordersOf(client.id)
      .filter((o) => o.status === 'served' && new Date(o.createdAt).toDateString() === new Date().toDateString())
      .filter((o) => !term || o.tableName.toLowerCase().includes(term) || String(o.number).includes(term));

    summary.textContent = 'Today · ' + served.length + ' orders served';

    rowsHost.innerHTML = served.length ? served.map((order) =>
      '<div class="k-row"><div><p class="k-row__table">' + esc(order.tableName) + '</p>' +
      '<p class="k-row__meta">Order #' + order.number + ' · ' + new Date(order.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '</p></div>' +
      '<p class="k-row__items">' + order.items.map((i) => i.qty + '× ' + esc(i.name)).join(' · ') + '</p>' +
      '<button class="btn btn--secondary" type="button" data-recall="' + order.id + '"><i data-lucide="rotate-ccw"></i> Recall to Ready</button></div>'
    ).join('') : '<div class="empty"><span class="empty__icon"><i data-lucide="check"></i></span>' +
      '<p class="empty__title">Nothing served yet today</p><p class="empty__text">Orders appear here as soon as they are marked served.</p></div>';

    if (window.lucide) window.lucide.createIcons();
  }

  rowsHost.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-recall]');
    if (!btn) return;
    const id = btn.getAttribute('data-recall');
    const order = store.update('orders', id, { status: 'ready', updatedAt: new Date().toISOString() });
    emit('order:update', { orderId: id, clientId: client.id });
    store.logActivity({ actor: session.name, clientId: client.id, type: 'Order', details: 'Order #' + order.number + ' recalled to ready' });
    toast('Order #' + order.number + ' back on the pass');
    drawCompleted();
  });

  search.addEventListener('input', drawCompleted);
  on('order:update', drawCompleted);
  drawCompleted();
} else {
  draw();
}

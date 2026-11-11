/* ==========================================================================
   TableTap — kitchen.js
   Live tickets for the pass: columns, timers, sound, strike-through items.
   ========================================================================== */

import * as store from './store.js';
import { requireRole, currentClient, logout } from './auth.js';
import { emit, on } from './realtime.js';
import { esc, timeAgo, toast, confirmDialog, initials, formatMoney, renderPaginationHtml } from './helpers.js';

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

/* ------------------------------------------- 86 / Sold Out Items Manager ---- */
function update86ButtonBadge() {
  const btn = document.getElementById('k-86-btn');
  if (!btn) return;
  const soldOutCount = store.query('items', (i) => i.clientId === client.id && i.available === false).length;
  if (soldOutCount > 0) {
    btn.innerHTML = '<i data-lucide="ban"></i> 86 Items <span class="badge badge--danger" style="margin-left:4px;padding:2px 6px;font-size:0.75rem;">' + soldOutCount + '</span>';
  } else {
    btn.innerHTML = '<i data-lucide="ban"></i> 86 Items';
  }
  if (window.lucide) window.lucide.createIcons();
}

function open86Modal() {
  const host = document.getElementById('k-modal-host');
  if (!host) return;

  const cats = store.query('categories', (c) => c.clientId === client.id).sort((a, b) => a.position - b.position);
  const catMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));

  let filterCat = 'all';
  let searchTerm = '';
  let showOnlySoldOut = false;

  function renderList() {
    let items = store.query('items', (i) => i.clientId === client.id);
    if (filterCat !== 'all') {
      items = items.filter((i) => i.categoryId === filterCat);
    }
    if (showOnlySoldOut) {
      items = items.filter((i) => i.available === false);
    }
    if (searchTerm) {
      items = items.filter((i) =>
        i.name.toLowerCase().includes(searchTerm) ||
        (i.description || '').toLowerCase().includes(searchTerm) ||
        (catMap[i.categoryId] || '').toLowerCase().includes(searchTerm)
      );
    }

    const soldOutTotal = store.query('items', (i) => i.clientId === client.id && i.available === false).length;
    const countEl = host.querySelector('#k-86-count-text');
    if (countEl) {
      countEl.textContent = soldOutTotal > 0
        ? soldOutTotal + ' dish' + (soldOutTotal > 1 ? 'es' : '') + ' currently 86’d (Sold Out)'
        : 'All dishes available · Guest menus reflect availability instantly';
    }

    const listEl = host.querySelector('#k-86-item-list');
    if (!listEl) return;

    if (!items.length) {
      listEl.innerHTML = '<div style="padding:2.5rem 1rem;text-align:center;color:var(--muted);">' +
        '<i data-lucide="check-circle" style="width:32px;height:32px;margin:0 auto 0.5rem;display:block;opacity:0.6;"></i>' +
        '<p style="font-weight:500;">No dishes found</p>' +
        '<p style="font-size:0.8rem;margin-top:2px;">Try changing your search or filter above.</p></div>';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    listEl.innerHTML = items.map((item) => {
      const isAvailable = item.available !== false;
      const catName = catMap[item.categoryId] || 'Dish';
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid ' + (isAvailable ? 'var(--line)' : 'var(--danger-wash)') + ';background:' + (isAvailable ? 'var(--paper)' : 'rgba(239,68,68,0.12)') + ';border-radius:var(--radius-md);margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;gap:12px;min-width:0;">' +
        (item.image ? '<img src="' + esc(item.image) + '" alt="" style="width:42px;height:42px;border-radius:6px;object-fit:cover;flex-shrink:0;">' : '<div style="width:42px;height:42px;border-radius:6px;background:var(--bg-sunken);display:flex;align-items:center;justify-content:center;color:var(--muted);flex-shrink:0;"><i data-lucide="utensils" style="width:18px;height:18px;"></i></div>') +
        '<div style="min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<span style="font-weight:600;font-size:0.95rem;' + (isAvailable ? '' : 'text-decoration:line-through;color:var(--muted);') + '">' + esc(item.name) + '</span>' +
        (!isAvailable ? '<span class="badge badge--danger" style="font-size:0.6875rem;padding:2px 6px;">86 / SOLD OUT</span>' : '') +
        '</div>' +
        '<div style="font-size:0.8125rem;color:var(--muted);margin-top:2px;">' + esc(catName) + ' · ' + formatMoney(item.price, settings.currency) + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="flex-shrink:0;">' +
        '<label class="switch" title="' + (isAvailable ? 'Mark Sold Out (86)' : 'Make Available') + '">' +
        '<input type="checkbox" data-86-item="' + item.id + '"' + (isAvailable ? ' checked' : '') + ' aria-label="' + esc(item.name) + ' available">' +
        '<span class="switch__track"></span>' +
        '</label>' +
        '</div>' +
        '</div>';
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  host.innerHTML = '<div class="modal is-open" id="k-86-modal" role="dialog" aria-modal="true" aria-labelledby="k-86-title">' +
    '<div class="modal__dialog" style="max-width:560px;display:flex;flex-direction:column;max-height:88vh;">' +
    '<div class="modal__header" style="border-bottom:1px solid var(--line);padding-bottom:1rem;">' +
    '<div>' +
    '<h3 class="modal__title" id="k-86-title" style="display:flex;align-items:center;gap:8px;">' +
    '<i data-lucide="ban" style="color:var(--danger);width:20px;height:20px;"></i>' +
    '86 Items / Dish Availability' +
    '</h3>' +
    '<p style="font-size:0.8125rem;color:var(--muted);margin-top:3px;" id="k-86-count-text">' +
    'Toggle dishes off when sold out. Guest menus update instantly.' +
    '</p>' +
    '</div>' +
    '<button class="btn btn--icon" type="button" id="k-86-close" aria-label="Close dialog"><i data-lucide="x"></i></button>' +
    '</div>' +

    '<div style="padding:1rem var(--s-6) 0.5rem;display:flex;flex-direction:column;gap:8px;">' +
    '<input type="search" id="k-86-search" class="input" placeholder="Search dish name or category..." style="width:100%;font-size:0.875rem;" autocomplete="off">' +
    '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;" id="k-86-chips">' +
    '<button class="chip chip--active" type="button" data-86-filter="all">All</button>' +
    '<button class="chip" type="button" data-86-filter="sold-out" style="color:var(--danger);">Sold Out Only</button>' +
    cats.map((c) => '<button class="chip" type="button" data-86-cat="' + c.id + '">' + esc(c.name) + '</button>').join('') +
    '</div>' +
    '</div>' +

    '<div class="modal__body" id="k-86-item-list" style="overflow-y:auto;flex:1;min-height:240px;padding-top:0.5rem;">' +
    '</div>' +

    '<div class="modal__footer" style="display:flex;justify-content:space-between;align-items:center;">' +
    '<span style="font-size:0.75rem;color:var(--muted);">Switch OFF = Sold out · Switch ON = Available</span>' +
    '<button class="btn btn--primary" type="button" id="k-86-done">Done</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  if (window.lucide) window.lucide.createIcons();
  renderList();

  const modalEl = host.querySelector('#k-86-modal');
  const searchInput = host.querySelector('#k-86-search');

  searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderList();
  });

  host.querySelector('#k-86-chips').addEventListener('click', (e) => {
    const btnFilter = e.target.closest('[data-86-filter]');
    const btnCat = e.target.closest('[data-86-cat]');
    if (btnFilter) {
      const type = btnFilter.getAttribute('data-86-filter');
      showOnlySoldOut = (type === 'sold-out');
      filterCat = 'all';
      host.querySelectorAll('#k-86-chips .chip').forEach((c) => c.classList.remove('chip--active'));
      btnFilter.classList.add('chip--active');
      renderList();
      return;
    }
    if (btnCat) {
      filterCat = btnCat.getAttribute('data-86-cat');
      showOnlySoldOut = false;
      host.querySelectorAll('#k-86-chips .chip').forEach((c) => c.classList.remove('chip--active'));
      btnCat.classList.add('chip--active');
      renderList();
    }
  });

  host.querySelector('#k-86-item-list').addEventListener('change', (event) => {
    const box = event.target.closest('[data-86-item]');
    if (!box) return;
    const itemId = box.getAttribute('data-86-item');
    const available = box.checked;
    const updated = store.update('items', itemId, { available });
    emit('menu:update', { clientId: client.id, itemId, available });
    store.logActivity({
      actor: (session.name || 'Kitchen') + ' · Pass',
      clientId: client.id,
      type: 'Menu',
      details: (updated?.name || 'Item') + (available ? ' marked available' : ' marked SOLD OUT (86)'),
    });
    toast((updated?.name || 'Item') + (available ? ' is now available' : ' marked SOLD OUT (86)'), available ? 'success' : 'danger');
    update86ButtonBadge();
    renderList();
  });

  function closeModal() {
    host.innerHTML = '';
  }

  host.querySelector('#k-86-close').addEventListener('click', closeModal);
  host.querySelector('#k-86-done').addEventListener('click', closeModal);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });
}

const btn86 = document.getElementById('k-86-btn');
if (btn86) {
  update86ButtonBadge();
  btn86.addEventListener('click', open86Modal);
}
on('menu:update', () => update86ButtonBadge());

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
  const pagesHost = document.getElementById('k-pages');
  const countText = document.getElementById('k-count-text');

  let pageNo = 1;
  const perPage = 10;

  function drawCompleted() {
    const term = (search.value || '').trim().toLowerCase();
    const served = store.ordersOf(client.id)
      .filter((o) => o.status === 'served' && new Date(o.createdAt).toDateString() === new Date().toDateString())
      .filter((o) => !term || o.tableName.toLowerCase().includes(term) || String(o.number).includes(term));

    const totalPages = Math.max(1, Math.ceil(served.length / perPage));
    pageNo = Math.min(pageNo, totalPages);
    const slice = served.slice((pageNo - 1) * perPage, pageNo * perPage);

    summary.textContent = 'Today · ' + served.length + ' orders served';
    if (countText) {
      countText.textContent = served.length
        ? 'Showing ' + ((pageNo - 1) * perPage + 1) + '–' + Math.min(pageNo * perPage, served.length) + ' of ' + served.length
        : '0 orders';
    }

    rowsHost.innerHTML = slice.length ? slice.map((order) =>
      '<div class="k-row"><div><p class="k-row__table">' + esc(order.tableName) + '</p>' +
      '<p class="k-row__meta">Order #' + order.number + ' · ' + new Date(order.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '</p></div>' +
      '<p class="k-row__items">' + order.items.map((i) => i.qty + '× ' + esc(i.name)).join(' · ') + '</p>' +
      '<button class="btn btn--secondary" type="button" data-recall="' + order.id + '"><i data-lucide="rotate-ccw"></i> Recall to Ready</button></div>'
    ).join('') : '<div class="empty"><span class="empty__icon"><i data-lucide="check"></i></span>' +
      '<p class="empty__title">Nothing served yet today</p><p class="empty__text">Orders appear here as soon as they are marked served.</p></div>';

    if (pagesHost) {
      pagesHost.innerHTML = renderPaginationHtml(pageNo, totalPages);
    }

    if (window.lucide) window.lucide.createIcons();
  }

  if (pagesHost) {
    pagesHost.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-page]');
      if (!btn || btn.classList.contains('page--disabled') || btn.disabled) return;
      pageNo = Math.max(1, Number(btn.getAttribute('data-page')));
      drawCompleted();
    });
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

  search.addEventListener('input', () => {
    pageNo = 1;
    drawCompleted();
  });
  on('order:update', drawCompleted);
  drawCompleted();
} else {
  draw();
}

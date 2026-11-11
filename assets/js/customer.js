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
  debounce, initials, statusBadge,
} from './helpers.js';
import { pushOrderToMongo } from './mongo-sync.js';

const params = new URLSearchParams(location.search);
const CART_KEY = 'tqr_cart';

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

function promptTableKey(ctx, onSuccess) {
  const { client, table } = ctx;
  const existing = document.getElementById('table-key-modal');
  if (existing) existing.remove();

  let session = sessionForTable(client.id, table.id);
  if (!session || session.status !== 'open') {
    session = openSessionForTable(client.id, table);
  }
  const currentKey = (session && session.tableKey) ? String(session.tableKey) : '1234';
  const tableNameDisplay = /^table/i.test(table.name) ? table.name : `Table ${table.name}`;

  const modal = document.createElement('div');
  modal.className = 'modal is-open';
  modal.id = 'table-key-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="modal__dialog" style="max-width: 400px; text-align: center; position: relative;">
      <button class="btn btn--icon btn--sm" type="button" id="close-table-key-modal" aria-label="Close" style="position: absolute; top: 14px; right: 14px; border: none; background: transparent; cursor: pointer; font-size: 1.25rem; color: var(--muted);"><i data-lucide="x"></i></button>
      <div class="modal__header" style="justify-content: center; flex-direction: column; gap: 4px; padding-top: 0.5rem;">
        <h2 class="modal__title" style="font-size: 1.25rem;">${esc(tableNameDisplay)}</h2>
        <p class="muted text-sm" id="key-prompt-label">Enter table key, or browse menu directly</p>
      </div>
      <div class="modal__body" style="padding-top: 1rem;">
        <div class="field" style="margin-bottom: 0.75rem;">
          <input class="input" id="table-key-input" type="text" pattern="[0-9]*" inputmode="numeric" maxlength="4" placeholder="••••" style="font-size: 1.75rem; letter-spacing: 8px; text-align: center; font-family: var(--font-mono); height: 56px;" autofocus>
        </div>
        <div style="margin-bottom: 1rem; padding: 0.6rem 0.8rem; background: var(--surface-2, #F3F1EC); border-radius: 8px; font-size: 0.82rem; color: var(--text-muted, #666); text-align: center; border: 1px dashed var(--border, rgba(0,0,0,0.12));">
          <span>Demo PIN: <strong id="demo-key-chip" style="font-family: var(--font-mono); letter-spacing: 2px; color: var(--primary, #8C3A27); cursor: pointer; text-decoration: underline;" title="Click to auto-connect">${currentKey}</strong></span>
          <span style="opacity: 0.75; font-size: 0.75rem; margin-left: 4px;">(or enter 1234)</span>
        </div>
        <p class="hint" id="key-error" style="color: var(--danger); display: none; margin-bottom: 0.75rem;"></p>
        <button class="btn btn--primary btn--block btn--lg" type="button" id="submit-table-key-btn">Connect to table</button>
        <button class="btn btn--ghost btn--block" type="button" id="browse-guest-btn" style="margin-top: 8px; font-size: 0.9rem;">Browse Menu Directly</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  if (window.lucide) window.lucide.createIcons();

  const input = modal.querySelector('#table-key-input');
  const error = modal.querySelector('#key-error');
  const btn = modal.querySelector('#submit-table-key-btn');
  const guestBtn = modal.querySelector('#browse-guest-btn');
  const closeBtn = modal.querySelector('#close-table-key-modal');
  const chip = modal.querySelector('#demo-key-chip');

  function connectDirectly() {
    if (!session || session.status !== 'open') {
      session = sessionForTable(client.id, table.id) || openSessionForTable(client.id, table);
    }
    localStorage.setItem('tqr_trusted_' + table.id, JSON.stringify({
      sessionId: session.id,
      joinSecret: session.joinSecret,
    }));
    modal.remove();
    toast("You're connected to " + table.name);
    if (onSuccess) onSuccess(session);
  }

  function attempt() {
    connectDirectly();
  }

  if (chip) chip.addEventListener('click', connectDirectly);
  btn.addEventListener('click', attempt);
  if (guestBtn) guestBtn.addEventListener('click', connectDirectly);
  if (closeBtn) closeBtn.addEventListener('click', connectDirectly);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attempt();
  });
  setTimeout(() => input.focus(), 100);
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
        <p class="visit-qr-modal__key mt-4" style="margin-bottom:0;">Table key backup: <span class="visit-qr-modal__key-digits" style="font-size:1.25rem;">${esc(session.tableKey || '----')}</span></p>
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
    const activeSession = sessionForTable(client.id, table.id);
    let isTrusted = false;
    try {
      const stored = JSON.parse(localStorage.getItem('tqr_trusted_' + table.id) || 'null');
      if (activeSession && stored && stored.sessionId === activeSession.id && stored.joinSecret === activeSession.joinSecret && activeSession.status === 'open') {
        isTrusted = true;
      }
    } catch (e) {}

    if (!isTrusted) {
      let session = activeSession;
      if (!session || session.status !== 'open') {
        session = openSessionForTable(client.id, table);
      }
      if (session) {
        localStorage.setItem('tqr_trusted_' + table.id, JSON.stringify({
          sessionId: session.id,
          joinSecret: session.joinSecret,
        }));
      }
    }
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
        '<p class="empty__text">Try a different dish, or clear the filters above.</p></div>';
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
  function renderDietFilters() {
    filterHost.innerHTML = dietOptions.map(([key, label]) =>
      '<button class="chip chip--filter" type="button" data-filter="' + key + '" aria-pressed="' + (activeFilters.has(key) ? 'true' : 'false') + '">' + getTagLabel(key) + '</button>'
    ).join('');
  }
  renderDietFilters();

  filterHost.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    const key = button.getAttribute('data-filter');
    if (activeFilters.has(key)) activeFilters.delete(key);
    else activeFilters.add(key);
    button.setAttribute('aria-pressed', activeFilters.has(key) ? 'true' : 'false');
    render();
  });

  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      term = searchInput.value.trim().toLowerCase();
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
      const key = 'tqr_call_' + type;
      const last = Number(localStorage.getItem(key) || 0);
      const waitLeft = Math.ceil((120000 - (Date.now() - last)) / 1000);
      if (Date.now() - last < 120000) {
        toast('Please wait ' + waitLeft + 's before calling again.', 'warning');
        return;
      }
      insert('waiterCalls', {
        clientId: client.id,
        tableName: table.name,
        type,
        status: 'open',
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(key, String(Date.now()));
      emit('call:new', { clientId: client.id });
      logActivity({
        actor: 'Guest · ' + table.name,
        clientId: client.id,
        type: 'Waiter call',
        details: type === 'bill' ? 'Bill requested' : 'Waiter called',
      });
      toast(type === 'bill' ? 'Waiter has been notified — bill on the way' : 'Waiter has been notified · ' + table.name);
    });
  });
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

  const placeButton = document.getElementById('place-order');
  placeButton.addEventListener('click', () => {
    if (placeButton.disabled) return;

    const totals = cartTotals(cart, settings);

    // Per-device limit
    const lastDeviceOrder = Number(localStorage.getItem('tqr_device_last_order') || 0);
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

    placeButton.disabled = true;
    placeButton.textContent = 'Placing order…';

    const approval = !!settings.approval;
    const session = openSessionForTable(client.id, table);
    const order = insert('orders', {
      clientId: client.id,
      number: nextNumber(client.id),
      tableId: table.id,
      tableName: table.name,
      sessionId: session.id,
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
      note: document.getElementById('kitchen-note').value.trim(),
      guestName: document.getElementById('guest-name').value.trim(),
      subtotal: totals.subtotal,
      tax: totals.taxTotal,
      service: totals.chargeTotal,
      total: totals.total,
      breakdown: totals,
      status: approval ? 'pending_approval' : 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    localStorage.setItem('tqr_device_last_order', String(Date.now()));
    addOrderToSession(session.id, order.id);
    emit('order:new', { orderId: order.id, clientId: client.id });
    pushOrderToMongo(order).catch(() => {});
    logActivity({
      actor: 'Guest · ' + table.name,
      clientId: client.id,
      type: 'Order',
      details: 'Order #' + order.number + ' placed (' + totals.count + ' items)',
    });

    sessionStorage.removeItem(CART_KEY);
    location.href = 'order-status.html?id=' + order.id + '&r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token) + visitParams;
  });
}

function nextNumber(clientId) {
  const numbers = query('orders', (o) => o.clientId === clientId).map((o) => Number(o.number) || 0);
  return (numbers.length ? Math.max(...numbers) : 1040) + 1;
}

/* -------------------------------------------------------------- status ---- */
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
    const steps = ['Received', 'Preparing', 'Ready', 'Served'];
    const index = { new: 0, pending_approval: 0, preparing: 1, ready: 2, served: 3 }[order.status] ?? 0;
    const rejected = order.status === 'rejected';

    host.innerHTML =
      '<div class="status-hero">' +
      (rejected
        ? '<span class="status-tick" style="background:#FDECEC;color:#B91C1C"><i data-lucide="x"></i></span>' +
          '<h1 class="status-title">Order not accepted</h1>' +
          '<p class="status-meta">Order #' + order.number + ' · ' + esc(order.tableName) + '</p>'
        : '<span class="status-tick"><i data-lucide="check"></i></span>' +
          '<h1 class="status-title">Order placed</h1>' +
          '<p class="status-meta">Order #' + order.number + ' · ' + esc(order.tableName) + ' · ' + formatTime(order.createdAt) + '</p>') +
      '</div>' +
      (rejected
        ? '<div class="status-card"><p class="text-sm">The kitchen could not take this order — an item sold out. Nothing was charged. Please order again or call a waiter.</p></div>'
        : '<div class="progress"><div class="progress__track"><div class="progress__fill" style="width:' +
            (index === 0 ? 0 : index === 1 ? 37 : index === 2 ? 62 : 100) + '%"></div></div>' +
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
      '<div class="status-eta"><i data-lucide="timer"></i><span>' +
      (order.status === 'served' ? 'Served — enjoy your meal.' :
        order.status === 'ready' ? 'Ready — your server is bringing it over.' :
          order.status === 'pending_approval' ? 'Waiting for the restaurant to accept your order.' :
            'Estimated time: about 18 minutes.') + '</span></div></div>' +
      '<div class="status-actions">' +
      '<a class="btn btn--secondary" href="index.html?r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token) + '">Order more</a>' +
      '<button class="btn btn--primary" type="button" data-call="waiter"><i data-lucide="bell"></i> Call waiter</button></div>';

    if (window.lucide) window.lucide.createIcons();

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
  on('order:update', (payload) => {
    if (!payload || payload.orderId === order.id) render();
  });
  setInterval(render, 30000);
}

/* --------------------------------------------------------------- bill ----- */
function initBill(ctx) {
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

  if (!session) {
    host.innerHTML =
      '<div class="empty"><span class="empty__icon"><i data-lucide="receipt"></i></span>' +
      '<p class="empty__title">No open bill for ' + esc(table.name) + '</p>' +
      '<p class="empty__text">Place an order first and it will show up here.</p>' +
      '<div class="empty__action"><a class="btn btn--primary" href="index.html?r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token) + visitParams + '">Back to the menu</a></div></div>';
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  let chooserOpen = false;

  function requestBill(methodId) {
    const method = (settings.paymentMethods || []).find((m) => m.id === methodId);
    if (!method) return;

    const key = 'tqr_call_bill';
    const last = Number(localStorage.getItem(key) || 0);
    const cooling = Date.now() - last < 120000;

    if (!cooling) {
      insert('waiterCalls', {
        clientId: client.id,
        tableName: table.name,
        type: 'bill',
        status: 'open',
        sessionId: session.id,
        paymentMethod: methodId,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(key, String(Date.now()));
      emit('call:new', { clientId: client.id });
      logActivity({
        actor: 'Guest · ' + table.name,
        clientId: client.id,
        type: 'Bill',
        details: 'Bill requested · pays by ' + method.name,
      });
      toast('Your waiter has been told · ' + table.name);
    } else {
      toast('Your waiter already knows — ' + method.name + ' noted.', 'warning');
    }

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
} else if (page === 'cart') {
  initCart(ctx);
} else if (page === 'status') {
  initStatus(ctx);
} else if (page === 'bill') {
  initBill(ctx);
} else if (page === 'unavailable') {
  initUnavailable();
}

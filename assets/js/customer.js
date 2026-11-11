/* ==========================================================================
   TableTap — customer.js
   Guest menu, cart and live order status. Reads ?r=<slug>&t=<table token>.
   ========================================================================== */

import { getAll, query, getById, insert, update, logActivity } from './store.js';
import { emit, on } from './realtime.js';
import {
  formatMoney, formatTime, timeAgo, toast, qs, esc, el, openDrawer, closeDrawer,
  debounce, initials, statusBadge,
} from './helpers.js';

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
  const table = token ? tables.find((t) => t.token === token) : tables[0];
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
  const subtotal = cart.items.reduce((sum, row) => sum + row.price * row.qty, 0);
  const tax = Math.round(subtotal * (Number(settings.tax) || 0)) / 100;
  const service = Math.round(subtotal * (Number(settings.service) || 0)) / 100;
  return {
    subtotal,
    tax,
    service,
    total: Math.round((subtotal + tax + service) * 100) / 100,
    count: cart.items.reduce((sum, row) => sum + row.qty, 0),
  };
}

/* ---------------------------------------------------------------- menu ---- */
function initMenu(ctx) {
  const { client, table } = ctx;
  const settings = client.settings;
  const money = (value) => formatMoney(value, settings.currency);

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
  if (window.lucide) window.lucide.createIcons();

  const categories = query('categories', (c) => c.clientId === client.id).sort((a, b) => a.position - b.position);
  const items = query('items', (i) => i.clientId === client.id);

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
      return '<section class="menu-section" id="cat-' + cat.id + '">' +
        '<div class="menu-section__head"><h2 class="menu-section__title">' + esc(cat.name) + '</h2>' +
        '<span class="menu-section__count">' + rows.length + (rows.length === 1 ? ' item' : ' items') + '</span></div>' +
        '<div class="item-list">' + rows.map(itemCard).join('') + '</div></section>';
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  const TAG_LABEL = { veg: 'Veg', vegan: 'Vegan', gf: 'Gluten-free', spicy: 'Spicy' };

  function itemCard(item) {
    const tags = (item.tags || []).map((tag) =>
      '<span class="tag tag--' + tag + '">' + TAG_LABEL[tag] + '</span>').join('');
    const soldOut = !item.available;
    return '<button class="item-card' + (soldOut ? ' item-card--sold-out' : '') + '" type="button" ' +
      (soldOut ? 'disabled' : 'data-item="' + item.id + '"') + '>' +
      '<img class="item-card__img" src="' + esc(item.image) + '" alt="' + esc(item.name) + '">' +
      '<span class="item-card__body">' +
      '<span class="item-card__name">' + esc(item.name) + '</span>' +
      '<span class="item-card__desc">' + esc(item.description) + '</span>' +
      '<span class="item-card__meta"><span class="item-card__price">' + money(item.price) + '</span>' +
      (soldOut ? '<span class="sold-out-flag">Sold out</span>' : tags) +
      '</span></span>' +
      '<span class="item-card__add" aria-hidden="true"><i data-lucide="plus"></i></span></button>';
  }

  chipsHost.innerHTML = categories.map((cat, index) =>
    '<a class="chip' + (index === 0 ? ' chip--active' : '') + '" href="#cat-' + cat.id + '">' + esc(cat.name) + '</a>'
  ).join('');

  const dietOptions = [['veg', 'Veg'], ['vegan', 'Vegan'], ['gf', 'Gluten-free'], ['spicy', 'Spicy']];
  filterHost.innerHTML = dietOptions.map(([key, label]) =>
    '<button class="chip chip--filter" type="button" data-filter="' + key + '" aria-pressed="false">' + label + '</button>'
  ).join('');

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
    currentItem = item;
    sheetQty = 1;
    openItemSheet(item);
  });

  function openItemSheet(item) {
    document.getElementById('sheet-img').src = item.image;
    document.getElementById('sheet-img').alt = item.name;
    document.getElementById('sheet-title').textContent = item.name;
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
    const selected = sheet.querySelector('input[name="sheet-size"]:checked');
    const sizes = currentItem.sizes && currentItem.sizes.length ? currentItem.sizes : [{ id: 'base', name: 'Regular', price: currentItem.price }];
    const size = sizes.find((s) => s.id === selected?.value) || sizes[0];
    const addons = Array.from(sheet.querySelectorAll('[data-addon]:checked'))
      .map((box) => box.getAttribute('data-name'));

    const cart = cartFor(client.id, table.id);
    const signature = currentItem.id + '|' + size.name + '|' + addons.join(',');
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
    cartBar.setAttribute('href', 'cart.html?r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token));
    document.getElementById('cart-count').textContent = totals.count + (totals.count === 1 ? ' item' : ' items');
    document.getElementById('cart-total').textContent = money(totals.total);
  }

  renderCartBar();

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
    list.innerHTML = cart.items.map((row, index) =>
      '<div class="cart-item"><div class="cart-item__body">' +
      '<p class="cart-item__name">' + esc(row.name) + '</p>' +
      '<p class="cart-item__opts">' + esc(row.size) + (row.addons.length ? ' · ' + esc(row.addons.join(', ')) : '') + '</p>' +
      (row.note ? '<p class="cart-item__opts">Note: ' + esc(row.note) + '</p>' : '') +
      '<div class="cart-item__row"><div class="qty">' +
      '<button class="qty__btn" type="button" data-dec="' + index + '" aria-label="Decrease quantity">−</button>' +
      '<span class="qty__val">' + row.qty + '</span>' +
      '<button class="qty__btn" type="button" data-inc="' + index + '" aria-label="Increase quantity">+</button>' +
      '</div><span class="cart-item__price">' + money(row.price * row.qty) + '</span></div></div>' +
      '<button class="cart-item__remove" type="button" data-remove="' + index + '">' +
      '<i data-lucide="trash-2"></i> Remove</button></div>'
    ).join('');

    const totals = cartTotals(cart, settings);
    document.getElementById('sum-subtotal').textContent = money(totals.subtotal);
    document.getElementById('sum-tax').textContent = money(totals.tax);
    document.getElementById('sum-service').textContent = money(totals.service);
    document.getElementById('sum-total').textContent = money(totals.total);
    document.getElementById('sum-tax-label').textContent = 'Tax (' + settings.tax + '%)';
    document.getElementById('sum-service-label').textContent = 'Service charge (' + settings.service + '%)';
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
    placeButton.disabled = true;
    placeButton.textContent = 'Placing order…';

    const totals = cartTotals(cart, settings);
    const approval = !!settings.approval;
    const order = insert('orders', {
      clientId: client.id,
      number: nextNumber(client.id),
      tableId: table.id,
      tableName: table.name,
      items: cart.items.map((row) => ({
        name: row.name,
        qty: row.qty,
        price: row.price,
        size: row.size,
        addons: row.addons,
        note: row.note,
        done: false,
      })),
      note: document.getElementById('kitchen-note').value.trim(),
      guestName: document.getElementById('guest-name').value.trim(),
      subtotal: totals.subtotal,
      tax: totals.tax,
      service: totals.service,
      total: totals.total,
      status: approval ? 'pending_approval' : 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    emit('order:new', { orderId: order.id, clientId: client.id });
    logActivity({
      actor: 'Guest · ' + table.name,
      clientId: client.id,
      type: 'Order',
      details: 'Order #' + order.number + ' placed (' + totals.count + ' items)',
    });

    sessionStorage.removeItem(CART_KEY);
    location.href = 'order-status.html?id=' + order.id + '&r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token);
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
} else if (page === 'unavailable') {
  initUnavailable();
}

/* ==========================================================================
   TableTap — owner.js
   Owner panel: dashboard, live orders, history, menu, tables, staff,
   reports, settings and account. Everything reads and writes store.js.
   ========================================================================== */

import * as store from './store.js';
import { requireRole, currentClient, changePassword, logout, stopImpersonation } from './auth.js';
import { emit, on } from './realtime.js';
import {
  formatMoney, formatDateTime, formatTime, timeAgo, toast, confirmDialog,
  exportCSV, debounce, esc, qs, initials, statusBadge, isToday, openDrawer, closeDrawer,
} from './helpers.js';

const session = requireRole('owner');
const client = currentClient();
const settings = client.settings;
const money = (value) => formatMoney(value, settings.currency);
const page = document.body.getAttribute('data-page');
const host = document.querySelector('.app-shell__content-inner');
const readOnly = !!client.restrictions.readOnly;

function paint(html) {
  host.innerHTML = (readOnly ? '<div class="notice-banner mb-4"><i data-lucide="lock"></i><span>Your account is in read-only mode. Contact support to make changes.</span></div>' : '') + html;
  if (window.lucide) window.lucide.createIcons();
}

function head(title, sub, actions = '') {
  return '<div class="page-head"><div><h1 class="page-head__title">' + esc(title) + '</h1>' +
    '<p class="page-head__sub">' + esc(sub) + '</p></div>' +
    (actions ? '<div class="page-head__actions">' + actions + '</div>' : '') + '</div>';
}

function statCard(label, value, note = '', delta = '', direction = 'up') {
  const meta = delta
    ? '<div class="stat__meta"><span class="stat__delta stat__delta--' + direction + '"><i data-lucide="' +
      (direction === 'up' ? 'arrow-up' : 'arrow-down') + '"></i> ' + esc(delta) + '</span><span class="muted">' + esc(note) + '</span></div>'
    : (note ? '<div class="stat__meta"><span class="muted">' + esc(note) + '</span></div>' : '');
  return '<div class="stat"><p class="stat__label">' + esc(label) + '</p><p class="stat__value">' + esc(value) + '</p>' + meta + '</div>';
}

function chart(cols, highlight = '') {
  return '<div class="chart">' + cols.map(([label, pct, value]) =>
    '<div class="chart__col"><span class="chart__value">' + esc(value) + '</span>' +
    '<span class="chart__bar' + (label === highlight ? ' chart__bar--hi' : '') + '" style="height:' + pct + '%"></span>' +
    '<span class="chart__label">' + esc(label) + '</span></div>').join('') + '</div>';
}

function ordersOf() {
  return store.ordersOf(client.id);
}

function refreshChrome() {
  const brandSub = document.querySelector('.app-shell__brand-sub');
  if (brandSub) brandSub.textContent = client.name;
  const ownerName = document.querySelector('.owner-name');
  if (ownerName) ownerName.textContent = session.name;
  const avatar = document.querySelector('.app-shell__sidebar-footer .avatar');
  if (avatar) avatar.textContent = initials(session.name);
  const pill = document.querySelector('.status-pill');
  if (pill) {
    const on = settings.acceptOrders && client.restrictions.ordering;
    pill.classList.toggle('status-pill--off', !on);
    pill.innerHTML = '<span class="dot" aria-hidden="true"></span> Ordering ' + (on ? 'ON' : 'OFF');
  }
  const dot = document.querySelector('.count-dot');
  if (dot) {
    const pending = ordersOf().filter((o) => o.status === 'pending_approval').length;
    const calls = store.query('waiterCalls', (c) => c.clientId === client.id && c.status === 'open').length;
    const total = pending + calls;
    dot.textContent = String(total);
    dot.hidden = total === 0;
  }
  const logoutBtn = document.querySelector('.app-shell__sidebar-footer a[aria-label="Log out"]');
  if (logoutBtn) logoutBtn.addEventListener('click', (event) => { event.preventDefault(); logout(); });
  if (readOnly) {
    document.querySelectorAll('.app-shell__content button, .app-shell__content .btn').forEach((btn) => {
      if (btn.closest('.pagination') || btn.matches('[data-allow-readonly]')) return;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('is-disabled');
    });
  }
}

/* ------------------------------------------------------------ dashboard -- */
function renderDashboard() {
  const orders = ordersOf();
  const today = orders.filter((o) => isToday(o.createdAt));
  const revenue = today.filter((o) => o.status !== 'rejected').reduce((sum, o) => sum + o.total, 0);
  const avg = today.length ? revenue / today.length : 0;
  const tables = store.tablesOf(client.id);
  const occupied = tables.filter((t) => t.status === 'occupied').length;
  const calls = store.query('waiterCalls', (c) => c.clientId === client.id && c.status === 'open');
  const live = orders.filter((o) => ['new', 'pending_approval', 'preparing', 'ready'].includes(o.status)).slice(0, 6);

  const topItems = {};
  today.forEach((order) => order.items.forEach((item) => {
    topItems[item.name] = topItems[item.name] || { qty: 0, revenue: 0 };
    topItems[item.name].qty += item.qty;
    topItems[item.name].revenue += item.price * item.qty;
  }));
  const top = Object.entries(topItems).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);

  const nowHour = new Date().getHours();
  const hours = Array.from({ length: 11 }, (_, i) => (nowHour - 10 + i + 24) % 24);
  const counts = hours.map((h) => today.filter((o) => new Date(o.createdAt).getHours() === h).length);
  const maxCount = Math.max(1, ...counts);

  paint(head('Good evening, ' + session.name.split(' ')[0],
    'Here is how ' + client.name + ' is doing today, ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '.',
    '<a class="btn btn--secondary btn--sm" href="reports.html"><i data-lucide="trending-up"></i> Reports</a>' +
    '<a class="btn btn--primary btn--sm" href="orders.html"><i data-lucide="receipt"></i> View live orders</a>') +
    '<div class="stat-grid">' +
    statCard("Today's orders", String(today.length), 'vs yesterday', '', 'up') +
    statCard("Today's revenue", money(revenue), 'vs yesterday', '', 'up') +
    statCard('Avg order value', money(avg), 'per order today') +
    statCard('Active tables', occupied + ' / ' + tables.length, (tables.length - occupied) + ' free right now') +
    '</div>' +
    '<div class="split mt-6"><div class="card"><div class="card__header"><span class="card__title">Live orders</span>' +
    '<a class="card__link" href="orders.html">View all</a></div><div class="card__body">' +
    (live.length ? live.map((order) =>
      '<div class="order-card"><div><p class="order-card__id">#' + order.number + ' ' + statusBadge(order.status) + '</p>' +
      '<p class="order-card__meta">' + esc(order.tableName) + ' · ' + order.items.length + ' items · ' + timeAgo(order.createdAt) + '</p></div>' +
      '<div class="order-card__side"><span class="order-card__total">' + money(order.total) + '</span>' +
      '<a class="btn btn--secondary btn--sm" href="orders.html">Open</a></div></div>').join('')
      : '<div class="empty"><span class="empty__icon"><i data-lucide="check"></i></span><p class="empty__title">No live orders</p><p class="empty__text">Every ticket is closed. New orders appear here the moment a guest sends one.</p></div>') +
    '</div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Waiter calls &amp; bill requests</span>' +
    '<span class="badge badge--warning">' + calls.length + ' open</span></div><div class="card__body" id="calls-host">' +
    (calls.length ? calls.map((call) =>
      '<div class="list-row"><div class="list-row__main"><p class="list-row__title">' + esc(call.tableName) + '</p>' +
      '<p class="list-row__meta">' + (call.type === 'bill' ? 'Bill requested' : 'Call waiter') + ' · ' + timeAgo(call.createdAt) + '</p></div>' +
      '<div class="list-row__side"><button class="btn btn--secondary btn--sm" type="button" data-done-call="' + call.id + '">Done</button></div></div>').join('')
      : '<p class="muted text-sm">No open calls.</p>') +
    '</div></div></div>' +
    '<div class="split split--even mt-4"><div class="card"><div class="card__header"><span class="card__title">Top items today</span>' +
    '<span class="muted text-xs">By revenue</span></div><div class="card__body">' +
    (top.length ? top.map(([name, data]) =>
      '<div class="list-row"><div class="list-row__main"><p class="list-row__title">' + esc(name) + '</p>' +
      '<p class="list-row__meta">' + data.qty + ' sold</p></div><div class="list-row__side">' +
      '<span class="list-row__amount">' + money(data.revenue) + '</span></div></div>').join('')
      : '<p class="muted text-sm">No sales yet today.</p>') +
    '</div></div><div class="card"><div class="card__header"><span class="card__title">Orders by hour</span>' +
    '<span class="muted text-xs">' + today.length + ' orders today</span></div><div class="card__body">' +
    chart(hours.map((h, i) => [h > 12 ? (h - 12) + 'p' : h + 'p', Math.round((counts[i] / maxCount) * 100), counts[i]])) +
    '</div></div></div>');

  host.querySelectorAll('[data-done-call]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.update('waiterCalls', btn.getAttribute('data-done-call'), { status: 'done' });
      emit('call:update', { clientId: client.id });
      toast('Marked as done');
      renderDashboard();
      refreshChrome();
    });
  });
}

/* --------------------------------------------------------------- orders -- */
function renderOrders() {
  const orders = ordersOf();
  const tabs = [
    ['all', 'All', orders.length],
    ['pending_approval', 'Pending approval', orders.filter((o) => o.status === 'pending_approval').length],
    ['new', 'New', orders.filter((o) => o.status === 'new').length],
    ['preparing', 'Preparing', orders.filter((o) => o.status === 'preparing').length],
    ['ready', 'Ready', orders.filter((o) => o.status === 'ready').length],
    ['served', 'Served', orders.filter((o) => o.status === 'served').length],
  ];
  const calls = store.query('waiterCalls', (c) => c.clientId === client.id && c.status === 'open');
  let active = 'all';

  paint(head('Live orders', 'Every open ticket for ' + client.name + ', updated as the kitchen works.',
    '<button class="btn btn--secondary btn--sm" type="button" data-print><i data-lucide="printer"></i> Print all</button>') +
    '<div class="tabs" data-tabs><div class="tabs__list" role="tablist" aria-label="Order status">' +
    tabs.map(([key, label, count], i) =>
      '<button class="tab" role="tab" type="button" data-tab="' + key + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' +
      label + ' <span class="muted">(' + count + ')</span></button>').join('') +
    '</div><div class="tab-panel" role="tabpanel"><div class="card"><div class="card__body" id="order-cards"></div></div>' +
    '<div class="card mt-6"><div class="card__header"><span class="card__title">Waiter calls &amp; bill requests</span>' +
    '<span class="badge badge--warning">' + calls.length + ' open</span></div><div class="card__body">' +
    (calls.length ? calls.map((call) =>
      '<div class="list-row"><div class="list-row__main"><p class="list-row__title">' + esc(call.tableName) + '</p>' +
      '<p class="list-row__meta">' + (call.type === 'bill' ? 'Bill requested' : 'Call waiter') + ' · ' + timeAgo(call.createdAt) + '</p></div>' +
      '<div class="list-row__side"><button class="btn btn--secondary btn--sm" type="button" data-done-call="' + call.id + '">Done</button></div></div>').join('')
      : '<p class="muted text-sm">No open calls.</p>') +
    '</div></div></div></div><div id="drawer-host"></div>');

  const cardsHost = host.querySelector('#order-cards');

  function draw() {
    const rows = ordersOf().filter((o) => active === 'all' ? true : o.status === active);
    cardsHost.innerHTML = rows.length ? rows.map((order) =>
      '<div class="order-card"><div><p class="order-card__id">#' + order.number + ' ' + statusBadge(order.status) + '</p>' +
      '<p class="order-card__meta">' + esc(order.tableName) + ' · ' + order.items.length + ' items · ' + timeAgo(order.createdAt) + '</p></div>' +
      '<div class="order-card__side"><span class="order-card__total">' + money(order.total) + '</span>' +
      '<button class="btn btn--secondary btn--sm" type="button" data-open="' + order.id + '">Details</button>' +
      '<button class="btn btn--primary btn--sm" type="button" data-next="' + order.id + '">' + nextLabel(order) + '</button></div></div>').join('')
      : '<div class="empty"><span class="empty__icon"><i data-lucide="receipt"></i></span><p class="empty__title">Nothing here</p>' +
        '<p class="empty__text">No orders in this state right now.</p></div>';
    if (window.lucide) window.lucide.createIcons();
  }

  function nextLabel(order) {
    if (order.status === 'pending_approval') return 'Approve';
    if (order.status === 'new') return 'Start';
    if (order.status === 'preparing') return 'Mark ready';
    if (order.status === 'ready') return 'Served';
    return 'Served';
  }

  function nextStatus(status) {
    return { pending_approval: 'new', new: 'preparing', preparing: 'ready', ready: 'served', served: 'served' }[status];
  }

  host.querySelector('.tabs__list').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab) return;
    active = tab.getAttribute('data-tab');
    host.querySelectorAll('[data-tab]').forEach((t) => {
      t.setAttribute('aria-selected', String(t === tab));
      t.tabIndex = t === tab ? 0 : -1;
    });
    draw();
  });

  cardsHost.addEventListener('click', async (event) => {
    const openBtn = event.target.closest('[data-open]');
    const nextBtn = event.target.closest('[data-next]');
    const rejectBtn = event.target.closest('[data-reject]');

    if (openBtn) openOrderDrawer(openBtn.getAttribute('data-open'));
    if (rejectBtn) {
      const ok = await confirmDialog('Reject this order? The guest will see that it was not accepted.', { confirmLabel: 'Reject order' });
      if (ok) setStatus(rejectBtn.getAttribute('data-reject'), 'rejected');
    }
    if (nextBtn) setStatus(nextBtn.getAttribute('data-next'), nextStatus(store.getById('orders', nextBtn.getAttribute('data-next')).status));
  });

  function setStatus(id, status) {
    if (readOnly) return toast('Read-only mode — changes are blocked.', 'warning');
    const order = store.update('orders', id, { status, updatedAt: new Date().toISOString() });
    emit('order:update', { orderId: id, clientId: client.id });
    store.logActivity({ actor: session.name, clientId: client.id, type: 'Order', details: 'Order #' + order.number + ' → ' + status });
    toast('Order #' + order.number + ' is now ' + status.replace('_', ' '));
    draw();
    refreshChrome();
  }

  function openOrderDrawer(id) {
    const order = store.getById('orders', id);
    if (!order) return;
    const drawerHost = host.querySelector('#drawer-host');
    drawerHost.innerHTML =
      '<div class="drawer is-open" id="order-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">' +
      '<div class="drawer__header"><div><p class="card__title" id="drawer-title">Order #' + order.number + '</p>' +
      '<p class="muted text-xs">' + esc(order.tableName) + ' · ' + formatTime(order.createdAt) + ' · ' + timeAgo(order.createdAt) + '</p></div>' +
      '<button class="btn btn--icon" type="button" data-close-drawer aria-label="Close order"><i data-lucide="x"></i></button></div>' +
      '<div class="drawer__body"><div class="status-items">' +
      order.items.map((item) =>
        '<div class="status-item"><span><span class="status-item__qty">' + item.qty + '×</span> ' + esc(item.name) +
        (item.size ? ' <span class="muted">(' + esc(item.size) + (item.addons && item.addons.length ? ', ' + esc(item.addons.join(', ')) : '') + ')</span>' : '') +
        '</span><span class="status-item__price">' + money(item.price * item.qty) + '</span></div>').join('') +
      '</div>' +
      (order.note ? '<div class="cart-info mt-4"><i data-lucide="message-square"></i><span>' + esc(order.note) + '</span></div>' : '') +
      '<div class="summary"><div class="summary__row"><span>Subtotal</span><span>' + money(order.subtotal) + '</span></div>' +
      '<div class="summary__row"><span>Tax</span><span>' + money(order.tax) + '</span></div>' +
      '<div class="summary__row"><span>Service charge</span><span>' + money(order.service) + '</span></div>' +
      '<div class="summary__row summary__row--total"><span>Total</span><span>' + money(order.total) + '</span></div></div>' +
      '<p class="hint">' + (order.guestName ? 'Guest: ' + esc(order.guestName) + ' · ' : '') + 'Pay at counter</p></div>' +
      '<div class="drawer__footer"><div class="row">' +
      (order.status === 'pending_approval'
        ? '<button class="btn btn--secondary btn--block" type="button" data-reject="' + order.id + '">Reject</button>' +
          '<button class="btn btn--primary btn--block" type="button" data-next="' + order.id + '">Approve</button>'
        : '<button class="btn btn--secondary btn--block" type="button" data-close-drawer>Close</button>' +
          '<button class="btn btn--primary btn--block" type="button" data-next="' + order.id + '">' + nextLabel(order) + '</button>') +
      '</div></div></div>';

    if (window.lucide) window.lucide.createIcons();

    drawerHost.querySelectorAll('[data-close-drawer]').forEach((btn) => btn.addEventListener('click', () => {
      drawerHost.innerHTML = '';
    }));
    drawerHost.addEventListener('click', (event) => {
      if (event.target.closest('[data-next]')) {
        const btn = event.target.closest('[data-next]');
        setStatus(btn.getAttribute('data-next'), nextStatus(store.getById('orders', btn.getAttribute('data-next')).status));
        drawerHost.innerHTML = '';
      }
      if (event.target.closest('[data-reject]')) {
        const btn = event.target.closest('[data-reject]');
        setStatus(btn.getAttribute('data-reject'), 'rejected');
        drawerHost.innerHTML = '';
      }
    });
  }

  host.querySelectorAll('[data-done-call]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.update('waiterCalls', btn.getAttribute('data-done-call'), { status: 'done' });
      emit('call:update', { clientId: client.id });
      toast('Marked as done');
      renderOrders();
    });
  });

  draw();
}

/* -------------------------------------------------------- order history -- */
function renderHistory() {
  const all = ordersOf();
  let pageNo = 1;
  const perPage = 20;
  let filters = { from: '', to: '', status: 'all', table: 'all', term: '' };

  paint(head('Order history', 'Every order since the restaurant opened. Filter, then export if you need it.',
    '<button class="btn btn--secondary btn--sm" type="button" data-export><i data-lucide="download"></i> Export CSV</button>') +
    '<div class="card"><div class="card__body">' +
    '<div class="toolbar">' +
    '<input class="input" type="date" id="f-from" aria-label="From date">' +
    '<input class="input" type="date" id="f-to" aria-label="To date">' +
    '<select class="select" id="f-status" aria-label="Status"><option value="all">All statuses</option>' +
    ['new', 'pending_approval', 'preparing', 'ready', 'served', 'rejected'].map((s) => '<option value="' + s + '">' + s.replace('_', ' ') + '</option>').join('') +
    '</select><select class="select" id="f-table" aria-label="Table"><option value="all">All tables</option>' +
    store.tablesOf(client.id).map((t) => '<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>').join('') +
    '</select><input class="input" type="search" id="f-term" placeholder="Search order #" aria-label="Search by order number">' +
    '<span class="toolbar__spacer"></span><span class="muted text-xs" id="hist-count"></span></div>' +
    '<div class="table-wrap"><table class="table table-stack"><thead><tr>' +
    '<th scope="col">Order #</th><th scope="col">Date / time</th><th scope="col">Table</th><th scope="col">Items</th>' +
    '<th scope="col" class="table__num">Total</th><th scope="col">Status</th></tr></thead>' +
    '<tbody id="hist-rows"></tbody></table></div>' +
    '<div class="row row--between mt-6"><span class="muted text-xs">20 orders per page</span>' +
    '<nav class="pagination" id="hist-pages" aria-label="Order history pages"></nav></div>' +
    '</div></div>');

  const rowsHost = host.querySelector('#hist-rows');
  const countHost = host.querySelector('#hist-count');
  const pagesHost = host.querySelector('#hist-pages');

  function filtered() {
    return all.filter((order) => {
      const when = new Date(order.createdAt);
      if (filters.from && when < new Date(filters.from)) return false;
      if (filters.to && when > new Date(filters.to + 'T23:59:59')) return false;
      if (filters.status !== 'all' && order.status !== filters.status) return false;
      if (filters.table !== 'all' && order.tableName !== filters.table) return false;
      if (filters.term && !String(order.number).includes(filters.term)) return false;
      return true;
    });
  }

  function draw() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    pageNo = Math.min(pageNo, pages);
    const slice = rows.slice((pageNo - 1) * perPage, pageNo * perPage);

    rowsHost.innerHTML = slice.length ? slice.map((order) =>
      '<tr><td data-label="Order" class="table__strong">#' + order.number + '</td>' +
      '<td data-label="Date/time">' + formatDateTime(order.createdAt) + '</td>' +
      '<td data-label="Table">' + esc(order.tableName) + '</td>' +
      '<td data-label="Items">' + order.items.length + '</td>' +
      '<td data-label="Total" class="table__num">' + money(order.total) + '</td>' +
      '<td data-label="Status">' + statusBadge(order.status) + '</td></tr>').join('')
      : '<tr><td colspan="6"><div class="empty"><span class="empty__icon"><i data-lucide="history"></i></span>' +
        '<p class="empty__title">No orders match those filters</p></div></td></tr>';

    countHost.textContent = rows.length
      ? 'Showing ' + ((pageNo - 1) * perPage + 1) + '–' + Math.min(pageNo * perPage, rows.length) + ' of ' + rows.length
      : 'No orders';

    pagesHost.innerHTML =
      '<button class="page' + (pageNo === 1 ? ' page--disabled' : '') + '" type="button" data-page="' + (pageNo - 1) + '" aria-label="Previous page"><i data-lucide="chevron-left"></i></button>' +
      Array.from({ length: pages }, (_, i) => i + 1).slice(0, 5).map((n) =>
        '<button class="page" type="button" data-page="' + n + '"' + (n === pageNo ? ' aria-current="page"' : '') + '>' + n + '</button>').join('') +
      (pages > 5 ? '<span class="page page--disabled">…</span><button class="page" type="button" data-page="' + pages + '">' + pages + '</button>' : '') +
      '<button class="page' + (pageNo === pages ? ' page--disabled' : '') + '" type="button" data-page="' + (pageNo + 1) + '" aria-label="Next page"><i data-lucide="chevron-right"></i></button>';

    if (window.lucide) window.lucide.createIcons();
  }

  pagesHost.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn) return;
    pageNo = Math.max(1, Number(btn.getAttribute('data-page')));
    draw();
  });

  ['from', 'to', 'status', 'table'].forEach((key) => {
    host.querySelector('#f-' + key).addEventListener('change', (event) => {
      filters[key] = event.target.value;
      pageNo = 1;
      draw();
    });
  });
  host.querySelector('#f-term').addEventListener('input', debounce((event) => {
    filters.term = event.target.value.trim();
    pageNo = 1;
    draw();
  }, 200));

  host.querySelector('[data-export]').addEventListener('click', () => {
    const rows = [['Order #', 'Date', 'Table', 'Items', 'Total', 'Status']].concat(
      filtered().map((o) => ['#' + o.number, formatDateTime(o.createdAt), o.tableName, o.items.length, o.total.toFixed(2), o.status])
    );
    exportCSV(rows, client.slug + '-orders.csv');
    toast('CSV exported');
  });

  draw();
}

/* ----------------------------------------------------------------- menu -- */
function renderMenu() {
  let selectedCat = store.categoriesOf(client.id)[0];
  let term = '';

  paint(head('Menu', 'Categories, items, prices and availability for ' + client.name + '.',
    '<button class="btn btn--secondary btn--sm" type="button" data-add-cat><i data-lucide="plus"></i> Add category</button>' +
    '<a class="btn btn--primary btn--sm" href="menu-item.html"><i data-lucide="plus"></i> Add item</a>') +
    '<div class="menu-editor"><div class="card"><div class="card__header"><span class="card__title">Categories</span>' +
    '<span class="muted text-xs" id="cat-count"></span></div><div class="card__body"><div id="cat-list"></div>' +
    '<button class="btn btn--secondary btn--block mt-4" type="button" data-add-cat><i data-lucide="plus"></i> Add category</button></div></div>' +
    '<div class="card"><div class="card__header"><div class="card__title-row"><span class="card__title" id="cat-title"></span>' +
    '<span class="badge badge--neutral" id="cat-badge"></span></div>' +
    '<input class="input" type="search" id="item-search" placeholder="Search items" aria-label="Search items" style="height:32px;min-height:32px;width:180px;font-size:0.8125rem">' +
    '</div><div class="card__body"><div id="item-list"></div>' +
    '<a class="btn btn--secondary btn--block mt-4" href="menu-item.html"><i data-lucide="plus"></i> Add item</a></div></div></div>');

  const catList = host.querySelector('#cat-list');
  const itemList = host.querySelector('#item-list');

  function drawCats() {
    const cats = store.categoriesOf(client.id);
    catList.innerHTML = cats.map((cat, index) =>
      '<div class="cat-item' + (cat.id === selectedCat?.id ? ' cat-item--active' : '') + '" data-cat="' + cat.id + '">' +
      '<div><p class="cat-item__name">' + esc(cat.name) + '</p>' +
      '<p class="cat-item__count">' + store.query('items', (i) => i.categoryId === cat.id).length + ' items</p></div>' +
      '<div class="cat-item__actions">' +
      '<button class="btn btn--icon btn--sm" type="button" data-move="up" data-id="' + cat.id + '" aria-label="Move up"><i data-lucide="arrow-up"></i></button>' +
      '<button class="btn btn--icon btn--sm" type="button" data-move="down" data-id="' + cat.id + '" aria-label="Move down"><i data-lucide="arrow-down"></i></button>' +
      '<button class="btn btn--icon btn--sm" type="button" data-rename="' + cat.id + '" aria-label="Rename"><i data-lucide="pencil"></i></button>' +
      '<button class="btn btn--icon btn--sm" type="button" data-del-cat="' + cat.id + '" aria-label="Delete"><i data-lucide="trash-2"></i></button>' +
      '</div></div>').join('');
    host.querySelector('#cat-count').textContent = cats.length + ' total';
  }

  function drawItems() {
    if (!selectedCat) {
      itemList.innerHTML = '<p class="muted text-sm">Add a category first.</p>';
      return;
    }
    host.querySelector('#cat-title').textContent = selectedCat.name;
    const items = store.query('items', (i) => i.categoryId === selectedCat.id && (!term || i.name.toLowerCase().includes(term)));
    host.querySelector('#cat-badge').textContent = items.length + ' items';

    itemList.innerHTML = items.length ? items.map((item) => {
      const tags = (item.tags || []).map((t) =>
        '<span class="tag tag--' + t + '">' + ({ veg: 'Veg', vegan: 'Vegan', gf: 'Gluten-free', spicy: 'Spicy' }[t]) + '</span>').join('');
      return '<div class="item-row"><img class="item-row__img" src="' + esc(item.image) + '" alt="' + esc(item.name) + '">' +
        '<div class="item-row__body"><p class="item-row__name">' + esc(item.name) + '</p>' +
        '<p class="list-row__meta">' + esc(item.description) + '</p>' +
        '<div class="item-row__meta">' + tags + '<span class="muted text-xs">· ' + item.prepTime + ' min prep</span></div></div>' +
        '<div class="item-row__side"><span class="item-row__price">' + money(item.price) + '</span>' +
        '<label class="switch" title="Available"><input type="checkbox" data-avail="' + item.id + '"' + (item.available ? ' checked' : '') + ' aria-label="' + esc(item.name) + ' available">' +
        '<span class="switch__track"></span><span class="sr-only">Available</span></label>' +
        '<a class="btn btn--icon btn--sm" href="menu-item.html?id=' + item.id + '" aria-label="Edit ' + esc(item.name) + '"><i data-lucide="pencil"></i></a>' +
        '<button class="btn btn--icon btn--sm" type="button" data-del-item="' + item.id + '" aria-label="Delete ' + esc(item.name) + '"><i data-lucide="trash-2"></i></button>' +
        '</div></div>';
    }).join('') : '<div class="empty"><span class="empty__icon"><i data-lucide="book-open"></i></span><p class="empty__title">No items yet</p>' +
      '<p class="empty__text">Add your first dish to this category.</p></div>';

    if (window.lucide) window.lucide.createIcons();
  }

  catList.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-cat]');
    const moveBtn = event.target.closest('[data-move]');
    const renameBtn = event.target.closest('[data-rename]');
    const delBtn = event.target.closest('[data-del-cat]');

    if (moveBtn) {
      event.stopPropagation();
      const cats = store.categoriesOf(client.id);
      const index = cats.findIndex((c) => c.id === moveBtn.getAttribute('data-id'));
      const swap = moveBtn.getAttribute('data-move') === 'up' ? index - 1 : index + 1;
      if (swap < 0 || swap >= cats.length) return;
      store.update('categories', cats[index].id, { position: cats[swap].position });
      store.update('categories', cats[swap].id, { position: cats[index].position });
      drawCats();
      return;
    }

    if (renameBtn) {
      event.stopPropagation();
      const cat = store.getById('categories', renameBtn.getAttribute('data-rename'));
      const name = prompt('Category name', cat.name);
      if (name && name.trim()) {
        store.update('categories', cat.id, { name: name.trim() });
        drawCats();
        toast('Category renamed');
      }
      return;
    }

    if (delBtn) {
      event.stopPropagation();
      const cat = store.getById('categories', delBtn.getAttribute('data-del-cat'));
      const count = store.query('items', (i) => i.categoryId === cat.id).length;
      const ok = await confirmDialog('Delete “' + cat.name + '” and its ' + count + ' items? This cannot be undone.', { confirmLabel: 'Delete category' });
      if (!ok) return;
      store.query('items', (i) => i.categoryId === cat.id).forEach((i) => store.remove('items', i.id));
      store.remove('categories', cat.id);
      if (selectedCat && selectedCat.id === cat.id) selectedCat = store.categoriesOf(client.id)[0];
      drawCats();
      drawItems();
      toast('Category deleted');
      return;
    }

    if (row) {
      selectedCat = store.getById('categories', row.getAttribute('data-cat'));
      drawCats();
      drawItems();
    }
  });

  itemList.addEventListener('change', (event) => {
    const box = event.target.closest('[data-avail]');
    if (!box) return;
    store.update('items', box.getAttribute('data-avail'), { available: box.checked });
    emit('menu:update', { clientId: client.id });
    toast(box.checked ? 'Item is available again' : 'Item marked sold out');
  });

  itemList.addEventListener('click', async (event) => {
    const del = event.target.closest('[data-del-item]');
    if (!del) return;
    const item = store.getById('items', del.getAttribute('data-del-item'));
    const ok = await confirmDialog('Delete “' + item.name + '” from the menu?', { confirmLabel: 'Delete item' });
    if (!ok) return;
    store.remove('items', item.id);
    emit('menu:update', { clientId: client.id });
    drawItems();
    drawCats();
    toast('Item deleted');
  });

  host.querySelectorAll('[data-add-cat]').forEach((btn) => btn.addEventListener('click', () => {
    const name = prompt('New category name');
    if (!name || !name.trim()) return;
    store.insert('categories', { clientId: client.id, name: name.trim(), position: store.categoriesOf(client.id).length });
    drawCats();
    toast('Category added');
  }));

  host.querySelector('#item-search').addEventListener('input', debounce((event) => {
    term = event.target.value.trim().toLowerCase();
    drawItems();
  }, 200));

  drawCats();
  drawItems();
}

/* ------------------------------------------------------------ menu item -- */
function renderMenuItem() {
  const id = qs('id');
  const item = id ? store.getById('items', id) : null;
  const cats = store.categoriesOf(client.id);
  const usage = store.usageFor(client.id);

  paint(head(item ? 'Edit menu item' : 'Add a menu item',
    'Items appear on the guest menu as soon as they are saved and available.',
    '<a class="btn btn--secondary btn--sm" href="menu.html"><i data-lucide="arrow-left"></i> Back to menu</a>') +
    '<div class="card"><div class="card__body"><form id="item-form">' +
    '<div class="form-grid form-grid--2">' +
    '<div class="field field--full"><label class="label" for="item-name">Item name</label>' +
    '<input class="input" id="item-name" type="text" value="' + esc(item ? item.name : '') + '" required></div>' +
    '<div class="field field--full"><label class="label" for="item-desc">Description</label>' +
    '<textarea class="textarea" id="item-desc">' + esc(item ? item.description : '') + '</textarea>' +
    '<p class="hint">Two lines read best on a phone. Mention allergens here.</p></div>' +
    '<div class="field"><label class="label" for="item-price">Base price (' + esc(settings.currency) + ')</label>' +
    '<input class="input" id="item-price" type="number" step="0.50" min="0" value="' + (item ? item.price : '0.00') + '" required></div>' +
    '<div class="field"><label class="label" for="item-category">Category</label><select class="select" id="item-category">' +
    cats.map((c) => '<option value="' + c.id + '"' + (item && item.categoryId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') +
    '</select></div>' +
    '<div class="field field--full"><span class="label">Photo</span><div class="dropzone">' +
    '<img class="dropzone__preview" id="item-image-preview" src="' + esc(item ? item.image : '') + '" alt="Item photo">' +
    '<span>Drag a JPG or PNG here, or choose a file. Resized to 800px wide before saving.</span>' +
    '<input type="file" id="item-image" accept="image/*" hidden>' +
    '<button class="btn btn--secondary btn--sm" type="button" id="pick-image"><i data-lucide="upload"></i> Choose file</button></div></div>' +
    '<div class="field"><span class="label">Tags</span><div class="stack-2">' +
    [['veg', 'Veg'], ['vegan', 'Vegan'], ['gf', 'Gluten-free'], ['spicy', 'Spicy']].map(([key, label]) =>
      '<label class="check"><input type="checkbox" value="' + key + '"' + (item && item.tags.includes(key) ? ' checked' : '') + '>' +
      '<span class="check__text">' + label + '</span></label>').join('') + '</div></div>' +
    '<div class="field"><label class="label" for="prep-time">Prep time (minutes)</label>' +
    '<input class="input" id="prep-time" type="number" min="1" value="' + (item ? item.prepTime : 12) + '">' +
    '<p class="hint">Used for the estimated time on the guest order page.</p></div>' +
    '<div class="field field--full"><span class="label">Sizes</span><div id="sizes-host"></div>' +
    '<button class="btn btn--secondary btn--sm mt-4" type="button" id="add-size"><i data-lucide="plus"></i> Add size</button></div>' +
    '<div class="field field--full"><span class="label">Add-on groups</span><div id="addons-host"></div>' +
    '<button class="btn btn--secondary btn--sm mt-4" type="button" id="add-group"><i data-lucide="plus"></i> Add group</button></div>' +
    '<div class="field field--full"><label class="switch"><input type="checkbox" id="item-available"' + (!item || item.available ? ' checked' : '') + '>' +
    '<span class="switch__track"></span><span class="switch__label">Available to order</span></label>' +
    '<p class="hint">Turn this off to hide the item from the guest menu without deleting it.</p></div>' +
    '</div><div class="form-actions"><a class="btn btn--secondary" href="menu.html">Cancel</a>' +
    '<button class="btn btn--primary" type="submit">Save item</button></div></form></div></div>');

  const sizesHost = host.querySelector('#sizes-host');
  const addonsHost = host.querySelector('#addons-host');
  let sizes = item && item.sizes.length ? item.sizes.map((s) => ({ ...s })) : [];
  let groups = item && item.addons.length ? JSON.parse(JSON.stringify(item.addons)) : [];
  let imageData = item ? item.image : '';

  function drawSizes() {
    sizesHost.innerHTML = sizes.length ? sizes.map((size, index) =>
      '<div class="repeat-block"><div class="repeat-block__head"><span class="repeat-block__title">Size ' + (index + 1) + '</span>' +
      '<button class="btn btn--icon btn--sm" type="button" data-del-size="' + index + '" aria-label="Remove size"><i data-lucide="x"></i></button></div>' +
      '<div class="form-grid form-grid--2"><div class="field"><label class="label">Name</label>' +
      '<input class="input" data-size-name="' + index + '" type="text" value="' + esc(size.name) + '"></div>' +
      '<div class="field"><label class="label">Price</label><input class="input" data-size-price="' + index + '" type="number" step="0.50" value="' + size.price + '"></div>' +
      '</div></div>').join('') : '<p class="hint">No sizes — the base price is used.</p>';
    if (window.lucide) window.lucide.createIcons();
  }

  function drawGroups() {
    addonsHost.innerHTML = groups.length ? groups.map((group, gi) =>
      '<div class="repeat-block"><div class="repeat-block__head"><span class="repeat-block__title">' + esc(group.name) + '</span>' +
      '<button class="btn btn--icon btn--sm" type="button" data-del-group="' + gi + '" aria-label="Remove group"><i data-lucide="x"></i></button></div>' +
      '<div class="form-grid form-grid--2"><div class="field"><label class="label">Group name</label>' +
      '<input class="input" data-group-name="' + gi + '" type="text" value="' + esc(group.name) + '"></div>' +
      '<div class="field"><label class="label">Max selections</label>' +
      '<input class="input" data-group-max="' + gi + '" type="number" min="0" value="' + group.max + '"></div></div>' +
      group.options.map((option, oi) =>
        '<div class="field-row mt-2"><div class="field"><label class="label">Option</label>' +
        '<input class="input" data-opt-name="' + gi + '-' + oi + '" type="text" value="' + esc(option.name) + '"></div>' +
        '<div class="field"><label class="label">+ Price</label><input class="input" data-opt-price="' + gi + '-' + oi + '" type="number" step="0.25" value="' + option.price + '"></div>' +
        '<button class="btn btn--icon" type="button" data-del-opt="' + gi + '-' + oi + '" aria-label="Remove option"><i data-lucide="trash-2"></i></button></div>').join('') +
      '<button class="btn btn--secondary btn--sm mt-4" type="button" data-add-opt="' + gi + '"><i data-lucide="plus"></i> Add option</button></div>').join('')
      : '<p class="hint">No add-on groups yet.</p>';
    if (window.lucide) window.lucide.createIcons();
  }

  drawSizes();
  drawGroups();

  host.querySelector('#add-size').addEventListener('click', () => {
    sizes.push({ id: 'sz_' + Date.now(), name: 'Size ' + (sizes.length + 1), price: Number(host.querySelector('#item-price').value) || 0 });
    drawSizes();
  });

  host.querySelector('#add-group').addEventListener('click', () => {
    groups.push({ id: 'ag_' + Date.now(), name: 'Extras', min: 0, max: 3, options: [{ name: 'Option 1', price: 1 }] });
    drawGroups();
  });

  host.addEventListener('click', (event) => {
    const delSize = event.target.closest('[data-del-size]');
    const delGroup = event.target.closest('[data-del-group]');
    const delOpt = event.target.closest('[data-del-opt]');
    const addOpt = event.target.closest('[data-add-opt]');

    if (delSize) { sizes.splice(Number(delSize.getAttribute('data-del-size')), 1); drawSizes(); }
    if (delGroup) { groups.splice(Number(delGroup.getAttribute('data-del-group')), 1); drawGroups(); }
    if (delOpt) {
      const [gi, oi] = delOpt.getAttribute('data-del-opt').split('-').map(Number);
      groups[gi].options.splice(oi, 1);
      drawGroups();
    }
    if (addOpt) {
      const gi = Number(addOpt.getAttribute('data-add-opt'));
      groups[gi].options.push({ name: 'New option', price: 1 });
      drawGroups();
    }
  });

  host.addEventListener('input', (event) => {
    const target = event.target;
    if (target.dataset.sizeName !== undefined) sizes[Number(target.dataset.sizeName)].name = target.value;
    if (target.dataset.sizePrice !== undefined) sizes[Number(target.dataset.sizePrice)].price = Number(target.value);
    if (target.dataset.groupName !== undefined) groups[Number(target.dataset.groupName)].name = target.value;
    if (target.dataset.groupMax !== undefined) groups[Number(target.dataset.groupMax)].max = Number(target.value);
    if (target.dataset.optName !== undefined) {
      const [gi, oi] = target.dataset.optName.split('-').map(Number);
      groups[gi].options[oi].name = target.value;
    }
    if (target.dataset.optPrice !== undefined) {
      const [gi, oi] = target.dataset.optPrice.split('-').map(Number);
      groups[gi].options[oi].price = Number(target.value);
    }
  });

  host.querySelector('#pick-image').addEventListener('click', () => host.querySelector('#item-image').click());

  host.querySelector('#item-image').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 800;
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        imageData = canvas.toDataURL('image/jpeg', 0.82);
        host.querySelector('#item-image-preview').src = imageData;
        toast('Photo resized to ' + canvas.width + 'px wide');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  host.querySelector('#item-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = host.querySelector('#item-name').value.trim();
    const price = Number(host.querySelector('#item-price').value);
    if (!name) return toast('Give the item a name.', 'danger');
    if (!(price > 0)) return toast('Price must be more than 0.', 'danger');

    const payload = {
      clientId: client.id,
      name,
      description: host.querySelector('#item-desc').value.trim(),
      price,
      categoryId: host.querySelector('#item-category').value,
      image: imageData,
      tags: Array.from(host.querySelectorAll('.check input:checked')).map((box) => box.value),
      prepTime: Number(host.querySelector('#prep-time').value) || 10,
      sizes: sizes.map((s) => ({ id: s.id || 'sz_' + Math.random().toString(36).slice(2, 6), name: s.name, price: Number(s.price) })),
      addons: groups,
      available: host.querySelector('#item-available').checked,
    };

    if (item) {
      store.update('items', item.id, payload);
      toast('Item saved');
    } else {
      if (usage.items >= usage.limits.items) {
        return toast("You've reached your plan limit (" + usage.limits.items + ' items). Contact support to upgrade.', 'danger');
      }
      store.insert('items', payload);
      toast('Item added to the menu');
    }
    emit('menu:update', { clientId: client.id });
    setTimeout(() => { location.href = 'menu.html'; }, 500);
  });
}

/* --------------------------------------------------------------- tables -- */
function renderTables() {
  const usage = store.usageFor(client.id);
  paint(head('Tables & QR codes', store.tablesOf(client.id).length + ' tables, each with its own QR code and secret link.',
    '<button class="btn btn--secondary btn--sm" type="button" data-print-all><i data-lucide="printer"></i> Print all QR codes</button>' +
    '<button class="btn btn--primary btn--sm" type="button" data-add-table><i data-lucide="plus"></i> Add table</button>') +
    '<div class="table-grid" id="table-grid"></div><div id="modal-host"></div>');

  const grid = host.querySelector('#table-grid');
  const modalHost = host.querySelector('#modal-host');

  function draw() {
    const tables = store.tablesOf(client.id);
    grid.innerHTML = tables.map((table) =>
      '<div class="card table-card"><div class="table-card__head"><div>' +
      '<p class="table-card__num">' + esc(table.name) + '</p>' +
      '<p class="table-card__seats">' + table.seats + ' seats · QR active</p></div>' +
      '<span class="badge badge--' + (table.status === 'occupied' ? 'warning' : 'success') + '">' +
      (table.status === 'occupied' ? 'Occupied' : 'Free') + '</span></div>' +
      '<div class="table-card__qr"><i data-lucide="qr-code"></i></div>' +
      '<div class="table-card__actions">' +
      '<button class="btn btn--secondary btn--sm" type="button" data-view="' + table.id + '"><i data-lucide="eye"></i> View QR</button>' +
      '<button class="btn btn--icon btn--sm" type="button" data-edit="' + table.id + '" aria-label="Edit ' + esc(table.name) + '"><i data-lucide="pencil"></i></button>' +
      '<button class="btn btn--icon btn--sm" type="button" data-del="' + table.id + '" aria-label="Delete ' + esc(table.name) + '"><i data-lucide="trash-2"></i></button>' +
      '</div></div>').join('');
    if (window.lucide) window.lucide.createIcons();
  }

  function menuLink(table) {
    return '../menu/index.html?r=' + encodeURIComponent(client.slug) + '&t=' + encodeURIComponent(table.token);
  }

  function openQr(table) {
    modalHost.innerHTML =
      '<div class="modal is-open" role="dialog" aria-modal="true" aria-labelledby="qr-title"><div class="modal__dialog">' +
      '<div class="modal__header"><div><p class="modal__title" id="qr-title">' + esc(table.name) + '</p>' +
      '<p class="muted text-xs">' + table.seats + ' seats · ' + esc(client.name) + '</p></div>' +
      '<button class="btn btn--icon" type="button" data-close-modal aria-label="Close"><i data-lucide="x"></i></button></div>' +
      '<div class="modal__body"><div class="qr-preview" id="qr-target"></div>' +
      '<p class="text-center text-sm mt-4">' + esc(menuLink(table)) + '</p>' +
      '<p class="hint text-center">Guests scan this to open the menu with ' + esc(table.name) + ' already selected.</p>' +
      '<div class="row mt-6"><button class="btn btn--secondary btn--block" type="button" data-download><i data-lucide="download"></i> Download PNG</button>' +
      '<button class="btn btn--secondary btn--block" type="button" data-print><i data-lucide="printer"></i> Print</button></div>' +
      '<div class="cart-info mt-6"><i data-lucide="alert-triangle"></i><span>Generating a new QR code replaces this one immediately. Any printed card using the old code will stop working.</span></div>' +
      '<button class="btn btn--danger btn--block mt-4" type="button" data-regenerate><i data-lucide="refresh-cw"></i> Generate new QR code</button>' +
      '</div></div></div>';

    if (window.QRCode) {
      new window.QRCode(document.getElementById('qr-target'), {
        text: menuLink(table),
        width: 160,
        height: 160,
        colorDark: '#1C1917',
        colorLight: '#FFFFFF',
        correctLevel: window.QRCode.CorrectLevel.M,
      });
    } else {
      document.getElementById('qr-target').innerHTML = '<i data-lucide="qr-code"></i>';
    }
    if (window.lucide) window.lucide.createIcons();

    modalHost.querySelector('[data-close-modal]').addEventListener('click', () => { modalHost.innerHTML = ''; });
    modalHost.querySelector('[data-print]').addEventListener('click', () => window.print());
    modalHost.querySelector('[data-download]').addEventListener('click', () => {
      const canvas = document.querySelector('#qr-target canvas');
      if (!canvas) return toast('QR code is still loading', 'warning');
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = client.slug + '-' + table.name.toLowerCase().replace(/\s+/g, '-') + '.png';
      link.click();
      toast('QR code downloaded');
    });
    modalHost.querySelector('[data-regenerate]').addEventListener('click', async () => {
      const ok = await confirmDialog('Generate a new QR code for ' + table.name + '? The printed code on the table stops working immediately.', { confirmLabel: 'Generate new code' });
      if (!ok) return;
      store.update('tables', table.id, { token: client.slug.slice(0, 3) + '-' + Math.random().toString(36).slice(2, 7) });
      emit('table:update', { clientId: client.id });
      modalHost.innerHTML = '';
      toast('New QR code generated');
      draw();
    });
  }

  grid.addEventListener('click', async (event) => {
    const view = event.target.closest('[data-view]');
    const edit = event.target.closest('[data-edit]');
    const del = event.target.closest('[data-del]');

    if (view) openQr(store.getById('tables', view.getAttribute('data-view')));

    if (edit) {
      const table = store.getById('tables', edit.getAttribute('data-edit'));
      const name = prompt('Table name', table.name);
      if (name === null) return;
      const seats = prompt('Seats', table.seats);
      store.update('tables', table.id, { name: name.trim() || table.name, seats: Number(seats) || table.seats });
      draw();
      toast('Table updated');
    }

    if (del) {
      const table = store.getById('tables', del.getAttribute('data-del'));
      const ok = await confirmDialog('Delete ' + table.name + '? Its QR code stops working immediately.', { confirmLabel: 'Delete table' });
      if (!ok) return;
      store.remove('tables', table.id);
      draw();
      toast('Table deleted');
    }
  });

  host.querySelector('[data-add-table]').addEventListener('click', () => {
    const used = store.tablesOf(client.id).length;
    if (used >= usage.limits.tables) {
      return toast("You've reached your plan limit (" + usage.limits.tables + ' tables). Contact support to upgrade.', 'danger');
    }
    const name = prompt('Table name', 'Table ' + (used + 1));
    if (!name || !name.trim()) return;
    store.insert('tables', {
      clientId: client.id,
      name: name.trim(),
      seats: 2,
      token: client.slug.slice(0, 3) + '-' + Math.random().toString(36).slice(2, 7),
      status: 'free',
      createdAt: new Date().toISOString(),
    });
    draw();
    toast('Table added');
  });

  host.querySelector('[data-print-all]').addEventListener('click', () => {
    const tables = store.tablesOf(client.id);
    const win = window.open('', '_blank');
    if (!win) return toast('Allow pop-ups to print the QR sheet', 'warning');
    win.document.write('<html><head><title>QR codes — ' + esc(client.name) + '</title>' +
      '<style>body{font-family:Arial,sans-serif;padding:24px}h2{font-size:16px;margin:0 0 4px}' +
      '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}' +
      '.card{border:1px solid #E7E5E4;border-radius:12px;padding:16px;text-align:center;break-inside:avoid}' +
      '.t{font-size:22px;font-weight:700}.s{font-size:11px;color:#78716C;margin-top:2px}</style></head><body>' +
      '<h2>' + esc(client.name) + '</h2><p class="s">Scan to order</p><div class="grid">' +
      tables.map((t) => '<div class="card"><div class="t">' + esc(t.name) + '</div>' +
        '<div class="s">Scan to order</div><img style="margin-top:10px" width="140" height="140" src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=' +
        encodeURIComponent(location.origin + location.pathname.replace('tables.html', '') + menuLink(t)) + '"></div>').join('') +
      '</div></body></html>');
    win.document.close();
    setTimeout(() => win.print(), 600);
  });

  draw();
}

/* ---------------------------------------------------------------- staff -- */
function renderStaff() {
  const usage = store.usageFor(client.id);
  paint(head('Staff', 'Kitchen logins for ' + client.name + '. Cooks use a code and a 4-digit PIN, not email.',
    '<button class="btn btn--primary btn--sm" type="button" data-add-staff><i data-lucide="user-plus"></i> Add staff</button>') +
    '<div class="card"><div class="card__body"><div class="row row--between row--wrap">' +
    '<div><p class="muted text-xs">Kitchen login code</p>' +
    '<p class="mono strong" style="font-size:1.5rem;letter-spacing:0.12em">' + esc(client.kitchenCode) + '</p></div>' +
    '<div class="row"><span class="badge badge--success">Active</span>' +
    '<button class="btn btn--secondary btn--sm" type="button" data-copy-code><i data-lucide="copy"></i> Copy code</button></div></div>' +
    '<p class="hint">Staff enter this code plus their PIN on kitchen-login.html. Change the code only if it has been shared outside the kitchen.</p>' +
    '</div></div>' +
    '<div class="card mt-6"><div class="card__header"><span class="card__title">Kitchen staff</span>' +
    '<span class="muted text-xs">' + usage.staff + ' of ' + usage.limits.staff + ' seats used</span></div>' +
    '<div class="card__body"><div class="table-wrap"><table class="table table-stack"><thead><tr>' +
    '<th scope="col">Name</th><th scope="col">Role</th><th scope="col">PIN</th><th scope="col">Status</th>' +
    '<th scope="col">Last active</th><th scope="col">Actions</th></tr></thead><tbody id="staff-rows"></tbody></table></div></div></div>' +
    '<div id="modal-host"></div>');

  const rows = host.querySelector('#staff-rows');
  const modalHost = host.querySelector('#modal-host');

  function draw() {
    const staff = store.query('staff', (s) => s.clientId === client.id);
    rows.innerHTML = staff.map((member) =>
      '<tr><td data-label="Name" class="table__strong">' + esc(member.name) + '</td>' +
      '<td data-label="Role">Kitchen</td><td data-label="PIN">••••</td>' +
      '<td data-label="Status"><span class="badge badge--' + (member.active ? 'success' : 'neutral') + '">' +
      (member.active ? 'Active' : 'Deactivated') + '</span></td>' +
      '<td data-label="Last active">' + timeAgo(member.lastActive) + '</td>' +
      '<td data-label="Actions"><div class="row">' +
      '<button class="btn btn--secondary btn--sm" type="button" data-reset="' + member.id + '">Reset PIN</button>' +
      '<button class="btn btn--icon btn--sm" type="button" data-toggle="' + member.id + '" aria-label="Toggle ' + esc(member.name) + '"><i data-lucide="ban"></i></button>' +
      '<button class="btn btn--icon btn--sm" type="button" data-del="' + member.id + '" aria-label="Delete ' + esc(member.name) + '"><i data-lucide="trash-2"></i></button>' +
      '</div></td></tr>').join('');
    if (window.lucide) window.lucide.createIcons();
  }

  rows.addEventListener('click', async (event) => {
    const reset = event.target.closest('[data-reset]');
    const toggle = event.target.closest('[data-toggle]');
    const del = event.target.closest('[data-del]');

    if (reset) {
      const member = store.getById('staff', reset.getAttribute('data-reset'));
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      store.update('staff', member.id, { pin });
      modalHost.innerHTML = '<div class="modal is-open" role="dialog" aria-modal="true"><div class="modal__dialog">' +
        '<div class="modal__header"><p class="modal__title">New PIN for ' + esc(member.name) + '</p>' +
        '<button class="btn btn--icon" type="button" data-close aria-label="Close"><i data-lucide="x"></i></button></div>' +
        '<div class="modal__body"><p class="mono strong" style="font-size:2rem;letter-spacing:0.3em;text-align:center">' + pin + '</p>' +
        '<p class="hint text-center">Shown once. Give it to ' + esc(member.name.split(' ')[0]) + ' and ask them to keep it to themselves.</p></div>' +
        '<div class="modal__footer"><button class="btn btn--primary" type="button" data-close>Done</button></div></div></div>';
      if (window.lucide) window.lucide.createIcons();
      modalHost.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { modalHost.innerHTML = ''; }));
      toast('PIN reset');
    }

    if (toggle) {
      const member = store.getById('staff', toggle.getAttribute('data-toggle'));
      store.update('staff', member.id, { active: !member.active });
      draw();
      toast(member.active ? 'Staff deactivated' : 'Staff reactivated');
    }

    if (del) {
      const member = store.getById('staff', del.getAttribute('data-del'));
      const ok = await confirmDialog('Delete ' + member.name + '? Their PIN stops working immediately.', { confirmLabel: 'Delete staff' });
      if (!ok) return;
      store.remove('staff', member.id);
      draw();
      toast('Staff deleted');
    }
  });

  host.querySelector('[data-copy-code]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(client.kitchenCode);
      toast('Kitchen code copied');
    } catch (err) {
      toast('Code: ' + client.kitchenCode, 'warning');
    }
  });

  host.querySelector('[data-add-staff]').addEventListener('click', () => {
    if (usage.staff >= usage.limits.staff) {
      return toast("You've reached your plan limit (" + usage.limits.staff + ' staff). Contact support to upgrade.', 'danger');
    }
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    modalHost.innerHTML = '<div class="modal is-open" role="dialog" aria-modal="true"><div class="modal__dialog">' +
      '<div class="modal__header"><div><p class="modal__title">Add kitchen staff</p>' +
      '<p class="muted text-xs">They log in with the restaurant code and this PIN.</p></div>' +
      '<button class="btn btn--icon" type="button" data-close aria-label="Close"><i data-lucide="x"></i></button></div>' +
      '<div class="modal__body"><div class="field"><label class="label" for="staff-name">Full name</label>' +
      '<input class="input" id="staff-name" type="text" placeholder="e.g. Ravi Kumar"></div>' +
      '<div class="field"><span class="label">PIN</span><div class="card card--flat"><div class="card__body row row--between">' +
      '<span class="mono strong" style="font-size:1.25rem;letter-spacing:0.2em">' + pin + '</span>' +
      '<span class="badge badge--neutral">Generated</span></div></div>' +
      '<p class="hint">Shown once — reset it any time from this page.</p></div></div>' +
      '<div class="modal__footer"><button class="btn btn--secondary" type="button" data-close>Cancel</button>' +
      '<button class="btn btn--primary" type="button" data-save>Add staff</button></div></div></div>';
    if (window.lucide) window.lucide.createIcons();
    modalHost.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { modalHost.innerHTML = ''; }));
    modalHost.querySelector('[data-save]').addEventListener('click', () => {
      const name = modalHost.querySelector('#staff-name').value.trim();
      if (!name) return toast('Enter a name first.', 'danger');
      store.insert('staff', { clientId: client.id, name, role: 'kitchen', pin, active: true, lastActive: null });
      modalHost.innerHTML = '';
      draw();
      toast('Staff added');
    });
  });

  draw();
}

/* -------------------------------------------------------------- reports -- */
function renderReports() {
  const orders = ordersOf().filter((o) => o.status !== 'rejected');
  const days = 7;
  const since = new Date(Date.now() - days * 86400000);
  const rows = orders.filter((o) => new Date(o.createdAt) >= since);
  const revenue = rows.reduce((sum, o) => sum + o.total, 0);
  const itemsSold = rows.reduce((sum, o) => sum + o.items.reduce((n, i) => n + i.qty, 0), 0);

  const byDay = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86400000);
    const key = date.toDateString();
    const total = rows.filter((o) => new Date(o.createdAt).toDateString() === key).reduce((sum, o) => sum + o.total, 0);
    return [date.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + date.getDate(), total];
  });
  const maxDay = Math.max(1, ...byDay.map((d) => d[1]));

  const byItem = {};
  const byCat = {};
  rows.forEach((order) => order.items.forEach((item) => {
    byItem[item.name] = byItem[item.name] || { qty: 0, revenue: 0 };
    byItem[item.name].qty += item.qty;
    byItem[item.name].revenue += item.price * item.qty;
    const menuItem = store.query('items', (m) => m.name === item.name)[0];
    const cat = menuItem ? store.getById('categories', menuItem.categoryId) : null;
    const catName = cat ? cat.name : 'Other';
    byCat[catName] = byCat[catName] || { qty: 0, revenue: 0 };
    byCat[catName].qty += item.qty;
    byCat[catName].revenue += item.price * item.qty;
  }));

  const byTable = {};
  rows.forEach((order) => {
    byTable[order.tableName] = byTable[order.tableName] || { orders: 0, revenue: 0 };
    byTable[order.tableName].orders += 1;
    byTable[order.tableName].revenue += order.total;
  });

  const hourBuckets = [['12:00 – 2:00 PM', 12, 14], ['2:00 – 5:00 PM', 14, 17], ['6:00 – 8:00 PM', 18, 20], ['8:00 – 10:00 PM', 20, 22], ['10:00 PM – close', 22, 24]];
  const byHour = hourBuckets.map(([label, from, to]) => {
    const matching = rows.filter((o) => {
      const h = new Date(o.createdAt).getHours();
      return h >= from && h < to;
    });
    return [label, matching.length, matching.reduce((sum, o) => sum + o.total, 0)];
  });

  const tableRows = (entries) => entries.length ? entries.map(([name, data]) =>
    '<tr><td class="table__strong">' + esc(name) + '</td>' +
    '<td class="table__num">' + (data.qty !== undefined ? data.qty : data.orders) + '</td>' +
    '<td class="table__num">' + money(data.revenue) + '</td></tr>').join('')
    : '<tr><td colspan="3"><p class="muted text-sm">No data in this range.</p></td></tr>';

  paint(head('Reports', 'Sales for the last ' + days + ' days. Every number comes from real orders.',
    '<button class="btn btn--secondary btn--sm" type="button" data-export><i data-lucide="download"></i> Export CSV</button>') +
    '<div class="card"><div class="card__body"><div class="toolbar">' +
    '<button class="chip chip--filter" type="button" aria-pressed="false">Today</button>' +
    '<button class="chip chip--filter" type="button" aria-pressed="true">7 days</button>' +
    '<button class="chip chip--filter" type="button" aria-pressed="false">30 days</button>' +
    '<span class="toolbar__spacer"></span><span class="muted text-xs">' + formatDateTime(since.toISOString()) + ' → now</span></div></div></div>' +
    '<div class="stat-grid mt-4">' +
    statCard('Revenue', money(revenue), 'last ' + days + ' days') +
    statCard('Orders', String(rows.length), 'last ' + days + ' days') +
    statCard('Avg order value', money(rows.length ? revenue / rows.length : 0), 'per order') +
    statCard('Items sold', String(itemsSold), 'last ' + days + ' days') +
    '</div>' +
    '<div class="card mt-4"><div class="card__header"><span class="card__title">Revenue by day</span>' +
    '<span class="muted text-xs">Best day: ' + esc(byDay.reduce((a, b) => (b[1] > a[1] ? b : a), byDay[0])[0]) + '</span></div>' +
    '<div class="card__body">' + chart(byDay.map(([label, value]) => [label, Math.round((value / maxDay) * 100), money(value)])) + '</div></div>' +
    '<div class="split split--even mt-4">' +
    '<div class="card"><div class="card__header"><span class="card__title">Top items</span><span class="muted text-xs">By revenue</span></div>' +
    '<div class="card__body"><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Item</th>' +
    '<th scope="col" class="table__num">Sold</th><th scope="col" class="table__num">Revenue</th></tr></thead><tbody>' +
    tableRows(Object.entries(byItem).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 6)) + '</tbody></table></div></div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Sales by category</span></div>' +
    '<div class="card__body"><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Category</th>' +
    '<th scope="col" class="table__num">Items</th><th scope="col" class="table__num">Revenue</th></tr></thead><tbody>' +
    tableRows(Object.entries(byCat).sort((a, b) => b[1].revenue - a[1].revenue)) + '</tbody></table></div></div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Busiest hours</span></div>' +
    '<div class="card__body"><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Time</th>' +
    '<th scope="col" class="table__num">Orders</th><th scope="col" class="table__num">Revenue</th></tr></thead><tbody>' +
    byHour.map(([label, count, total]) => '<tr><td class="table__strong">' + esc(label) + '</td>' +
      '<td class="table__num">' + count + '</td><td class="table__num">' + money(total) + '</td></tr>').join('') +
    '</tbody></table></div></div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Orders by table</span></div>' +
    '<div class="card__body"><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Table</th>' +
    '<th scope="col" class="table__num">Orders</th><th scope="col" class="table__num">Revenue</th></tr></thead><tbody>' +
    tableRows(Object.entries(byTable).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8)) + '</tbody></table></div></div></div>' +
    '</div>');

  host.querySelector('[data-export]').addEventListener('click', () => {
    const csv = [['Order #', 'Date', 'Table', 'Total', 'Status']].concat(
      rows.map((o) => ['#' + o.number, formatDateTime(o.createdAt), o.tableName, o.total.toFixed(2), o.status])
    );
    exportCSV(csv, client.slug + '-report.csv');
    toast('Report exported');
  });
}

/* ------------------------------------------------------------- settings -- */
function renderSettings() {
  const h = settings.hours;
  const days = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

  paint(head('Settings', 'Restaurant profile, ordering rules, hours and branding.') +
    '<div class="tabs" data-tabs><div class="tabs__list" role="tablist" aria-label="Settings sections">' +
    ['Restaurant profile|profile', 'Ordering|ordering', 'Opening hours|hours', 'Branding|branding', 'Notifications|notify'].map((pair, i) => {
      const [label, key] = pair.split('|');
      return '<button class="tab" role="tab" type="button" data-tab="' + key + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' + label + '</button>';
    }).join('') + '</div>' +

    '<div class="tab-panel" data-panel="profile"><div class="card"><div class="card__body">' +
    '<div class="form-grid form-grid--2">' +
    '<div class="field"><label class="label" for="rest-name">Restaurant name</label><input class="input" id="rest-name" type="text" value="' + esc(client.name) + '"></div>' +
    '<div class="field"><label class="label" for="rest-phone">Phone</label><input class="input" id="rest-phone" type="tel" value="' + esc(settings.phone) + '"></div>' +
    '<div class="field field--full"><label class="label" for="rest-address">Address</label><input class="input" id="rest-address" type="text" value="' + esc(settings.address) + '"></div>' +
    '<div class="field field--full"><label class="label" for="rest-tagline">Welcome line</label><input class="input" id="rest-tagline" type="text" value="' + esc(settings.tagline) + '"></div>' +
    '<div class="field"><span class="label">Logo</span><div class="row">' +
    '<img class="avatar avatar--lg" src="' + esc(settings.logo) + '" alt="Current logo">' +
    '<button class="btn btn--secondary btn--sm" type="button" data-pick="logo"><i data-lucide="upload"></i> Replace</button></div></div>' +
    '<div class="field"><span class="label">Cover image</span><div class="row">' +
    '<img class="avatar avatar--lg" src="' + esc(settings.cover) + '" alt="Current cover">' +
    '<button class="btn btn--secondary btn--sm" type="button" data-pick="cover"><i data-lucide="upload"></i> Replace</button></div></div>' +
    '</div><div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save="profile">Save profile</button></div>' +
    '</div></div></div>' +

    '<div class="tab-panel" data-panel="ordering" hidden><div class="card"><div class="card__body">' +
    '<div class="list-row"><div class="list-row__main"><p class="list-row__title">Accept orders</p>' +
    '<p class="list-row__meta">When off, guests see “Ordering is paused” instead of the menu.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-accept"' + (settings.acceptOrders ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Accept orders</span></label></div>' +
    '<div class="list-row"><div class="list-row__main"><p class="list-row__title">Staff must approve orders before the kitchen</p>' +
    '<p class="list-row__meta">New orders wait for approval on the Live orders page.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-approval"' + (settings.approval ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Require approval</span></label></div>' +
    '<div class="form-grid form-grid--2 mt-6">' +
    '<div class="field"><label class="label" for="set-tax">Tax (%)</label><input class="input" id="set-tax" type="number" step="0.5" value="' + settings.tax + '"></div>' +
    '<div class="field"><label class="label" for="set-service">Service charge (%)</label><input class="input" id="set-service" type="number" step="0.5" value="' + settings.service + '"></div>' +
    '<div class="field"><label class="label" for="set-currency">Currency</label><select class="select" id="set-currency">' +
    ['$', '₹', '£', '€'].map((c) => '<option' + (settings.currency === c ? ' selected' : '') + '>' + c + '</option>').join('') +
    '</select></div></div>' +
    '<div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save="ordering">Save ordering</button></div>' +
    '</div></div></div>' +

    '<div class="tab-panel" data-panel="hours" hidden><div class="card"><div class="card__body"><div class="hours-grid">' +
    days.map(([key, label]) =>
      '<div class="hours-row"><span class="hours-row__day">' + label + '</span>' +
      '<input class="input" type="time" data-hour="' + key + '-open" value="' + (h[key] ? h[key][0] : '12:00') + '" aria-label="' + label + ' open">' +
      '<input class="input" type="time" data-hour="' + key + '-close" value="' + (h[key] ? h[key][1] : '23:00') + '" aria-label="' + label + ' close"></div>').join('') +
    '</div><p class="hint mt-4">Outside these hours the guest menu shows the “Restaurant is closed” state.</p>' +
    '<div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save="hours">Save hours</button></div>' +
    '</div></div></div>' +

    '<div class="tab-panel" data-panel="branding" hidden><div class="card"><div class="card__body">' +
    '<div class="form-grid form-grid--2"><div>' +
    '<div class="field"><label class="label" for="set-accent">Accent colour</label><div class="row">' +
    '<input class="input" id="set-accent" type="color" value="' + esc(settings.accent) + '" style="width:56px;padding:4px;height:44px">' +
    '<input class="input" type="text" id="set-accent-text" value="' + esc(settings.accent) + '" aria-label="Accent colour hex"></div>' +
    '<p class="hint">Used for buttons, chips and the cart bar on the guest menu.</p></div></div>' +
    '<div><span class="label">Live preview</span><div class="phone-preview" style="--preview-accent:' + esc(settings.accent) + '">' +
    '<div class="phone-preview__cover"></div><div class="phone-preview__body">' +
    '<p class="phone-preview__title">' + esc(client.name) + '</p><p class="text-xs muted">Table 7</p>' +
    '<div class="phone-preview__line"></div><div class="phone-preview__line phone-preview__line--short"></div>' +
    '<span class="phone-preview__chip">View order</span></div></div></div></div>' +
    '<div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save="branding">Save branding</button></div>' +
    '</div></div></div>' +

    '<div class="tab-panel" data-panel="notify" hidden><div class="card"><div class="card__body">' +
    '<div class="list-row"><div class="list-row__main"><p class="list-row__title">Sound on new orders</p>' +
    '<p class="list-row__meta">A short chime on the kitchen screen when a ticket arrives.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-sound"' + (settings.sound ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Sound on new orders</span></label></div>' +
    '<div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save="notify">Save notifications</button></div>' +
    '</div></div></div></div>');

  const tabs = host.querySelector('.tabs__list');
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab) return;
    tabs.querySelectorAll('[data-tab]').forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      host.querySelector('[data-panel="' + t.getAttribute('data-tab') + '"]').hidden = !on;
    });
  });

  host.querySelector('#set-accent').addEventListener('input', (event) => {
    host.querySelector('#set-accent-text').value = event.target.value;
    host.querySelector('.phone-preview').style.setProperty('--preview-accent', event.target.value);
  });
  host.querySelector('#set-accent-text').addEventListener('input', (event) => {
    if (!/^#[0-9a-f]{6}$/i.test(event.target.value)) return;
    host.querySelector('#set-accent').value = event.target.value;
    host.querySelector('.phone-preview').style.setProperty('--preview-accent', event.target.value);
  });

  host.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (readOnly) return toast('Read-only mode — changes are blocked.', 'warning');
      const which = btn.getAttribute('data-save');
      const next = { ...settings };

      if (which === 'profile') {
        next.phone = host.querySelector('#rest-phone').value;
        next.address = host.querySelector('#rest-address').value;
        next.tagline = host.querySelector('#rest-tagline').value;
        store.update('clients', client.id, { name: host.querySelector('#rest-name').value, settings: next });
        toast('Profile saved');
      }
      if (which === 'ordering') {
        next.acceptOrders = host.querySelector('#set-accept').checked;
        next.approval = host.querySelector('#set-approval').checked;
        next.tax = Number(host.querySelector('#set-tax').value);
        next.service = Number(host.querySelector('#set-service').value);
        next.currency = host.querySelector('#set-currency').value;
        store.update('clients', client.id, { settings: next });
        emit('settings:update', { clientId: client.id });
        toast('Ordering settings saved');
      }
      if (which === 'hours') {
        const hours = {};
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach((key) => {
          hours[key] = [host.querySelector('[data-hour="' + key + '-open"]').value, host.querySelector('[data-hour="' + key + '-close"]').value];
        });
        next.hours = hours;
        store.update('clients', client.id, { settings: next });
        toast('Opening hours saved');
      }
      if (which === 'branding') {
        next.accent = host.querySelector('#set-accent').value;
        store.update('clients', client.id, { settings: next });
        emit('settings:update', { clientId: client.id });
        toast('Branding saved — the guest menu updates instantly');
      }
      if (which === 'notify') {
        next.sound = host.querySelector('#set-sound').checked;
        store.update('clients', client.id, { settings: next });
        toast('Notifications saved');
      }
      store.logActivity({ actor: session.name, clientId: client.id, type: 'Settings', details: 'Settings saved (' + which + ')' });
    });
  });

  host.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => toast('Photo upload is available in the full build — this demo keeps the seeded image.', 'warning'));
  });
}

/* -------------------------------------------------------------- account -- */
function renderAccount() {
  const usage = store.usageFor(client.id);
  const plan = store.getById('plans', client.planId);
  const owner = store.getById('owners', session.id);
  const bar = (label, used, limit) => {
    const pct = Math.min(100, Math.round((used / limit) * 100));
    return '<div class="usage"><div class="usage__head"><span>' + label + '</span>' +
      '<span class="usage__value">' + used + ' / ' + limit + '</span></div>' +
      '<div class="usage-bar"><div class="usage-bar__fill' + (pct >= 80 ? ' usage-bar__fill--warn' : '') + '" style="width:' + pct + '%"></div></div></div>';
  };

  paint(head('Account', 'Your profile, password and plan for ' + client.name + '.') +
    '<div class="split split--even"><div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Owner profile</span></div><div class="card__body">' +
    '<div class="row mb-4"><span class="avatar avatar--lg">' + initials(session.name) + '</span><div>' +
    '<p class="strong">' + esc(session.name) + '</p><p class="muted text-xs">Owner · ' + esc(client.name) + '</p></div></div>' +
    '<div class="form-grid form-grid--2">' +
    '<div class="field"><label class="label" for="acc-name">Full name</label><input class="input" id="acc-name" type="text" value="' + esc(session.name) + '"></div>' +
    '<div class="field"><label class="label" for="acc-phone">Phone</label><input class="input" id="acc-phone" type="tel" value="' + esc(owner ? owner.phone : '') + '"></div>' +
    '<div class="field field--full"><label class="label" for="acc-email">Email</label><input class="input" id="acc-email" type="email" value="' + esc(session.email) + '" readonly></div>' +
    '</div><div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save-profile>Save profile</button></div>' +
    '</div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Change password</span></div><div class="card__body">' +
    '<div class="field"><label class="label" for="cur-pass">Current password</label><input class="input" id="cur-pass" type="password" autocomplete="current-password"></div>' +
    '<div class="field"><label class="label" for="new-pass">New password</label><input class="input" id="new-pass" type="password" autocomplete="new-password">' +
    '<p class="hint">At least 8 characters.</p></div>' +
    '<div class="field"><label class="label" for="conf-pass">Confirm new password</label><input class="input" id="conf-pass" type="password" autocomplete="new-password"></div>' +
    '<div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save-password>Update password</button></div>' +
    '</div></div></div>' +
    '<div><div class="card"><div class="card__header"><span class="card__title">Your plan</span>' +
    '<span class="badge badge--success">Active</span></div><div class="card__body">' +
    '<div class="plan-card"><p class="plan-card__name">' + esc(plan.name) + '</p>' +
    '<p class="plan-card__meta">Purchased ' + formatDateTime(client.createdAt) + ' · one-time ' + money(plan.price) + ' · never expires</p></div>' +
    bar('Tables', usage.tables, usage.limits.tables) +
    bar('Menu items', usage.items, usage.limits.items) +
    bar('Staff accounts', usage.staff, usage.limits.staff) +
    '<p class="hint mt-4">Need higher limits? Contact support and we will raise them on your plan.</p>' +
    '</div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Support</span></div><div class="card__body">' +
    '<p class="text-sm">Email us at <a class="auth-link" href="mailto:support@tabletap.demo">support@tabletap.demo</a> — we reply within one working day.</p>' +
    '<p class="muted text-xs mt-2">Mon–Sat, 10:00 AM – 7:00 PM IST</p>' +
    '<button class="btn btn--secondary btn--block mt-4" type="button"><i data-lucide="mail"></i> Email support</button>' +
    '</div></div></div></div>');

  host.querySelector('[data-save-profile]').addEventListener('click', () => {
    const name = host.querySelector('#acc-name').value.trim();
    if (!name) return toast('Enter your name.', 'danger');
    store.update('owners', session.id, { name, phone: host.querySelector('#acc-phone').value });
    session.name = name;
    localStorage.setItem('tqr_session', JSON.stringify(session));
    toast('Profile saved');
    refreshChrome();
    renderAccount();
  });

  host.querySelector('[data-save-password]').addEventListener('click', () => {
    const current = host.querySelector('#cur-pass').value;
    const next = host.querySelector('#new-pass').value;
    const confirm = host.querySelector('#conf-pass').value;
    if (next !== confirm) return toast('The two passwords do not match.', 'danger');
    try {
      changePassword(session.id, current, next);
      toast('Password updated');
      host.querySelector('#cur-pass').value = '';
      host.querySelector('#new-pass').value = '';
      host.querySelector('#conf-pass').value = '';
    } catch (err) {
      toast(err.message, 'danger');
    }
  });
}

/* ----------------------------------------------------------------- boot --- */
const PAGES = {
  dashboard: renderDashboard,
  orders: renderOrders,
  'order-history': renderHistory,
  menu: renderMenu,
  'menu-item': renderMenuItem,
  tables: renderTables,
  staff: renderStaff,
  reports: renderReports,
  settings: renderSettings,
  account: renderAccount,
};

refreshChrome();

if (session.impersonating) {
  const bar = document.createElement('div');
  bar.className = 'demo-banner';
  bar.innerHTML = '<span>Viewing as ' + esc(session.restaurant || client.name) + ' — admin preview</span>' +
    '<button class="btn btn--sm" type="button">Exit</button>';
  bar.querySelector('button').addEventListener('click', () => stopImpersonation());
  document.body.insertBefore(bar, document.body.firstChild);
}

const render = PAGES[page];
if (render) {
  try {
    render();
  } catch (err) {
    console.error(err);
    host.innerHTML = '<div class="notice-banner"><i data-lucide="alert-triangle"></i><span>Something went wrong loading this page: ' + esc(err.message) + '</span></div>';
  }
}

/* Live updates from other tabs */
on('order:new', () => { if (['dashboard', 'orders'].includes(page)) { refreshChrome(); PAGES[page](); } });
on('order:update', () => { if (['dashboard', 'orders'].includes(page)) { refreshChrome(); PAGES[page](); } });
on('call:new', () => { if (['dashboard', 'orders'].includes(page)) { refreshChrome(); PAGES[page](); } });

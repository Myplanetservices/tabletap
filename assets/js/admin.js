/* ==========================================================================
   TableTap — admin.js
   Super Admin: clients, invites, restrictions, activity, plans, settings.
   ========================================================================== */

import * as store from './store.js';
import {
  requireRole, getSession, startImpersonation, logout, platformSettings,
} from './auth.js';
import { emit } from './realtime.js';
import {
  formatMoney, formatDateTime, timeAgo, toast, confirmDialog, exportCSV,
  debounce, esc, qs, initials, statusBadge, openModal, closeModal,
  renderPaginationHtml,
} from './helpers.js';

const session = requireRole('admin');
const page = document.body.getAttribute('data-page');
const host = document.querySelector('.app-shell__content-inner');
const isSupport = session.adminRole === 'support';

function paint(html) {
  host.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

function head(title, sub, actions = '') {
  return '<div class="page-head"><div><h1 class="page-head__title">' + esc(title) + '</h1>' +
    '<p class="page-head__sub">' + esc(sub) + '</p></div>' +
    (actions ? '<div class="page-head__actions">' + actions + '</div>' : '') + '</div>';
}

function statCard(label, value, note = '', delta = '') {
  return '<div class="stat"><p class="stat__label">' + esc(label) + '</p><p class="stat__value">' + esc(value) + '</p>' +
    '<div class="stat__meta">' + (delta ? '<span class="stat__delta stat__delta--up"><i data-lucide="arrow-up"></i> ' + esc(delta) + '</span>' : '') +
    '<span class="muted">' + esc(note) + '</span></div></div>';
}

function chart(cols, highlight = '') {
  return '<div class="chart">' + cols.map(([label, pct, value]) =>
    '<div class="chart__col"><span class="chart__value">' + esc(value) + '</span>' +
    '<span class="chart__bar' + (label === highlight ? ' chart__bar--hi' : '') + '" style="height:' + pct + '%"></span>' +
    '<span class="chart__label">' + esc(label) + '</span></div>').join('') + '</div>';
}

function usageOf(clientId) {
  return {
    tables: store.tablesOf(clientId).length,
    items: store.itemsOf(clientId).length,
    staff: store.query('staff', (s) => s.clientId === clientId).length,
  };
}

function planName(planId) {
  const plan = store.getById('plans', planId);
  return plan ? plan.name : planId;
}

function refreshChrome() {
  const sub = document.querySelector('.app-shell__brand-sub');
  if (sub) sub.textContent = 'MyPlanetServices';
  const name = document.querySelector('.owner-name');
  if (name) name.textContent = session.name;
  const avatar = document.querySelector('.app-shell__sidebar-footer .avatar');
  if (avatar) avatar.textContent = initials(session.name);
  const logoutBtn = document.querySelector('.app-shell__sidebar-footer a[aria-label="Log out"]');
  if (logoutBtn) logoutBtn.addEventListener('click', (event) => { event.preventDefault(); logout(); });
}

/* ------------------------------------------------------------ dashboard -- */
function renderDashboard() {
  const clients = store.getAll('clients');
  const active = clients.filter((c) => c.status === 'active').length;
  const suspended = clients.filter((c) => c.status === 'suspended').length;
  const invited = store.query('invites', (i) => i.status === 'pending').length;
  const ordersToday = store.getAll('orders').filter((o) => new Date(o.createdAt).toDateString() === new Date().toDateString());
  const revenue = clients.reduce((sum, c) => {
    const plan = store.getById('plans', c.planId);
    return sum + (plan ? plan.price : 0);
  }, 0);

  const months = [];
  for (let i = 9; i >= 0; i -= 1) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const key = date.getMonth() + '-' + date.getFullYear();
    const count = clients.filter((c) => {
      const created = new Date(c.createdAt);
      return created.getMonth() + '-' + created.getFullYear() === key;
    }).length;
    months.push([date.toLocaleDateString('en-GB', { month: 'short' }), count]);
  }
  const maxMonth = Math.max(1, ...months.map((m) => m[1]));

  const needs = [];
  clients.forEach((client) => {
    const owner = store.query('owners', (o) => o.clientId === client.id)[0];
    const days = owner && owner.lastLogin ? Math.floor((Date.now() - new Date(owner.lastLogin)) / 86400000) : 99;
    const usage = usageOf(client.id);
    if (days >= 14) needs.push([client.name, 'No owner login in ' + (days > 90 ? '90+' : days) + ' days.']);
    else if (usage.tables >= client.limits.tables * 0.8) needs.push([client.name, 'Tables at ' + usage.tables + ' / ' + client.limits.tables + '.']);
    else if (usage.items >= client.limits.items * 0.8) needs.push([client.name, 'Menu items at ' + usage.items + ' / ' + client.limits.items + '.']);
  });

  const feed = store.getAll('activity')
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8);

  paint(head('Dashboard', 'Every restaurant on TableTap, at a glance.',
    '<a class="btn btn--secondary btn--sm" href="activity.html"><i data-lucide="history"></i> Activity log</a>') +
    '<div class="stat-grid">' +
    statCard('Total clients', String(clients.length), 'across 4 countries') +
    statCard('Active', String(active), Math.round((active / clients.length) * 100) + '% of all clients') +
    statCard('Suspended', String(suspended), 'logins blocked') +
    statCard('Pending invites', String(invited), 'expire in 7 days') +
    statCard('Orders today', String(ordersToday.length), 'across all clients') +
    statCard('License revenue', formatMoney(revenue), clients.length + ' licences sold') +
    '</div>' +
    '<div class="split mt-6"><div class="card"><div class="card__header"><span class="card__title">New clients per month</span>' +
    '<span class="muted text-xs">Last 10 months</span></div><div class="card__body">' +
    chart(months.map(([label, count]) => [label, Math.round((count / maxMonth) * 100), count]), months[months.length - 1][0]) +
    '</div></div><div class="card"><div class="card__header"><span class="card__title">Needs attention</span>' +
    '<span class="badge badge--warning">' + needs.length + ' items</span></div><div class="card__body"><div class="needs-list">' +
    (needs.length ? needs.slice(0, 4).map(([name, text]) =>
      '<div class="needs-item"><i data-lucide="alert-triangle"></i><div><p class="needs-item__title">' + esc(name) + '</p>' +
      '<p class="needs-item__text">' + esc(text) + '</p></div></div>').join('')
      : '<p class="muted text-sm">Nothing needs attention.</p>') +
    '</div></div></div></div>' +
    '<div class="card mt-4"><div class="card__header"><span class="card__title">Recent activity</span>' +
    '<a class="card__link" href="activity.html">View all</a></div><div class="card__body"><div class="activity-feed">' +
    feed.map((row) => {
      const client = row.clientId ? store.getById('clients', row.clientId) : null;
      return '<div class="activity-feed__item"><span class="activity-feed__icon"><i data-lucide="activity"></i></span>' +
        '<div class="activity-feed__body"><p>' + esc(row.details) + (client ? ' · <strong>' + esc(client.name) + '</strong>' : '') + '</p>' +
        '<p class="activity-feed__meta">' + esc(row.actor) + ' · ' + timeAgo(row.at) + '</p></div></div>';
    }).join('') +
    '</div></div></div>');
}

/* --------------------------------------------------------------- clients -- */
function renderClients() {
  let filters = { term: '', status: 'all', plan: 'all', country: 'all', sort: 'newest' };
  let pageNo = 1;
  const perPage = 8;
  const selected = new Set();

  paint(head('Clients', store.getAll('clients').length + ' restaurants. Search, filter or open a client to manage it.',
    '<button class="btn btn--secondary btn--sm" type="button" data-export><i data-lucide="download"></i> Export CSV</button>' +
    '<a class="btn btn--primary btn--sm" href="invites.html"><i data-lucide="user-plus"></i> Invite client</a>') +
    '<div class="card"><div class="card__body"><div class="toolbar">' +
    '<input class="input" type="search" id="c-term" placeholder="Search restaurant, owner or email" aria-label="Search clients">' +
    '<select class="select" id="c-status" aria-label="Status"><option value="all">All statuses</option>' +
    ['active', 'suspended', 'restricted', 'invited'].map((s) => '<option value="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</option>').join('') +
    '</select><select class="select" id="c-plan" aria-label="Plan"><option value="all">All plans</option>' +
    store.getAll('plans').map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') +
    '</select><select class="select" id="c-country" aria-label="Country"><option value="all">All countries</option>' +
    Array.from(new Set(store.getAll('clients').map((c) => c.country))).map((c) => '<option>' + esc(c) + '</option>').join('') +
    '</select><select class="select" id="c-sort" aria-label="Sort"><option value="newest">Newest first</option>' +
    '<option value="oldest">Oldest first</option><option value="name">Name A–Z</option><option value="active">Last active</option></select></div>' +
    '<div class="row row--between row--wrap mb-4"><span class="muted text-xs" id="c-count"></span>' +
    '<button class="btn btn--secondary btn--sm" type="button" id="c-bulk"><i data-lucide="ban"></i> Suspend selected</button></div>' +
    '<div class="table-wrap"><table class="table table-stack table--wide"><thead><tr>' +
    '<th scope="col"><input type="checkbox" id="c-all" aria-label="Select all clients"></th>' +
    '<th scope="col">Restaurant</th><th scope="col">Owner</th><th scope="col">Email</th><th scope="col">Country</th>' +
    '<th scope="col">Plan</th><th scope="col">Status</th><th scope="col" class="table__num">Tables</th>' +
    '<th scope="col">Last active</th><th scope="col"></th></tr></thead><tbody id="c-rows"></tbody></table></div>' +
    '<div class="row row--between mt-6"><span class="muted text-xs">' + perPage + ' per page</span>' +
    '<nav class="pagination" id="c-pages" aria-label="Client pages"></nav></div></div></div>');

  const rowsHost = host.querySelector('#c-rows');
  const pagesHost = host.querySelector('#c-pages');
  const countHost = host.querySelector('#c-count');

  function filtered() {
    let rows = store.getAll('clients');
    if (filters.term) {
      const term = filters.term.toLowerCase();
      rows = rows.filter((c) => {
        const owner = store.query('owners', (o) => o.clientId === c.id)[0];
        return c.name.toLowerCase().includes(term) || c.country.toLowerCase().includes(term) ||
          (owner && (owner.name.toLowerCase().includes(term) || owner.email.toLowerCase().includes(term)));
      });
    }
    if (filters.status !== 'all') rows = rows.filter((c) => c.status === filters.status);
    if (filters.plan !== 'all') rows = rows.filter((c) => c.planId === filters.plan);
    if (filters.country !== 'all') rows = rows.filter((c) => c.country === filters.country);
    if (filters.sort === 'newest') rows = rows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (filters.sort === 'oldest') rows = rows.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (filters.sort === 'name') rows = rows.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (filters.sort === 'active') rows = rows.slice().sort((a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0));
    return rows;
  }

  function draw() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    pageNo = Math.min(pageNo, pages);
    const slice = rows.slice((pageNo - 1) * perPage, pageNo * perPage);

    rowsHost.innerHTML = slice.map((client) => {
      const owner = store.query('owners', (o) => o.clientId === client.id)[0];
      const usage = usageOf(client.id);
      return '<tr><td data-label=""><input type="checkbox" data-select="' + client.id + '"' + (selected.has(client.id) ? ' checked' : '') + ' aria-label="Select ' + esc(client.name) + '"></td>' +
        '<td data-label="Restaurant"><div class="client-cell"><span class="client-cell__logo">' + initials(client.name) + '</span>' +
        '<div><p class="client-cell__name"><a href="client-detail.html?id=' + client.id + '">' + esc(client.name) + '</a></p>' +
        '<p class="client-cell__sub">' + esc(client.country) + '</p></div></div></td>' +
        '<td data-label="Owner">' + esc(owner ? owner.name : '—') + '</td>' +
        '<td data-label="Email">' + esc(owner ? owner.email : '—') + '</td>' +
        '<td data-label="Country">' + esc(client.country) + '</td>' +
        '<td data-label="Plan">' + esc(planName(client.planId)) + '</td>' +
        '<td data-label="Status">' + statusBadge(client.status) + '</td>' +
        '<td data-label="Tables used" class="table__num">' + usage.tables + ' / ' + client.limits.tables + '</td>' +
        '<td data-label="Last active">' + timeAgo(client.lastActive) + '</td>' +
        '<td data-label="Actions"><div class="row-actions">' +
        '<a class="btn btn--icon btn--sm" href="client-detail.html?id=' + client.id + '" aria-label="Open ' + esc(client.name) + '"><i data-lucide="eye"></i></a>' +
        '<button class="btn btn--icon btn--sm" type="button" data-impersonate="' + client.id + '" aria-label="Login as owner"><i data-lucide="log-in"></i></button>' +
        '<button class="btn btn--icon btn--sm" type="button" data-suspend="' + client.id + '" aria-label="Suspend"><i data-lucide="ban"></i></button>' +
        (isSupport ? '' : '<button class="btn btn--icon btn--sm" type="button" data-delete="' + client.id + '" aria-label="Delete"><i data-lucide="trash-2"></i></button>') +
        '</div></td></tr>';
    }).join('');

    countHost.textContent = rows.length + ' clients · ' + rows.filter((c) => c.status === 'active').length + ' active · ' +
      rows.filter((c) => c.status === 'suspended').length + ' suspended';

    pagesHost.innerHTML = renderPaginationHtml(pageNo, pages);

    if (window.lucide) window.lucide.createIcons();
  }

  host.querySelector('#c-term').addEventListener('input', debounce((event) => {
    filters.term = event.target.value.trim();
    pageNo = 1;
    draw();
  }, 200));

  ['status', 'plan', 'country', 'sort'].forEach((key) => {
    host.querySelector('#c-' + key).addEventListener('change', (event) => {
      filters[key] = event.target.value;
      pageNo = 1;
      draw();
    });
  });

  pagesHost.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn || btn.classList.contains('page--disabled') || btn.disabled) return;
    pageNo = Math.max(1, Number(btn.getAttribute('data-page')));
    draw();
  });

  rowsHost.addEventListener('change', (event) => {
    const box = event.target.closest('[data-select]');
    if (!box) return;
    if (box.checked) selected.add(box.getAttribute('data-select'));
    else selected.delete(box.getAttribute('data-select'));
  });

  host.querySelector('#c-all').addEventListener('change', (event) => {
    filtered().slice((pageNo - 1) * perPage, pageNo * perPage).forEach((c) => {
      if (event.target.checked) selected.add(c.id);
      else selected.delete(c.id);
    });
    draw();
  });

  rowsHost.addEventListener('click', async (event) => {
    const suspend = event.target.closest('[data-suspend]');
    const del = event.target.closest('[data-delete]');
    const imp = event.target.closest('[data-impersonate]');

    if (suspend) {
      const client = store.getById('clients', suspend.getAttribute('data-suspend'));
      const next = client.status === 'suspended' ? 'active' : 'suspended';
      const ok = await confirmDialog(
        next === 'suspended' ? 'Suspend ' + client.name + '? Owner and kitchen logins stop working.' : 'Reactivate ' + client.name + '?',
        { confirmLabel: next === 'suspended' ? 'Suspend' : 'Reactivate' });
      if (!ok) return;
      store.update('clients', client.id, { status: next, restrictions: { ...client.restrictions, ordering: next === 'active' } });
      store.logActivity({ actor: session.name, clientId: client.id, type: 'Suspension', details: next === 'suspended' ? 'Account suspended' : 'Account reactivated' });
      toast(client.name + (next === 'suspended' ? ' suspended' : ' reactivated'));
      draw();
    }

    if (del) {
      if (isSupport) return toast('Support admins cannot delete clients.', 'danger');
      const client = store.getById('clients', del.getAttribute('data-delete'));
      const ok = await confirmDialog('Delete ' + client.name + ' and all of its data? This cannot be undone.', { confirmLabel: 'Delete client' });
      if (!ok) return;
      deleteClient(client.id);
      toast('Client deleted');
      draw();
    }

    if (imp) {
      const id = imp.getAttribute('data-impersonate');
      startImpersonation(id);
      location.href = '../owner/dashboard.html';
    }
  });

  host.querySelector('#c-bulk').addEventListener('click', async () => {
    if (!selected.size) return toast('Select at least one client first.', 'warning');
    const ok = await confirmDialog('Suspend ' + selected.size + ' selected client(s)?', { confirmLabel: 'Suspend selected' });
    if (!ok) return;
    selected.forEach((id) => {
      const client = store.getById('clients', id);
      store.update('clients', id, { status: 'suspended', restrictions: { ...client.restrictions, ordering: false } });
      store.logActivity({ actor: session.name, clientId: id, type: 'Suspension', details: 'Account suspended (bulk)' });
    });
    selected.clear();
    toast('Selected clients suspended');
    draw();
  });

  host.querySelector('[data-export]').addEventListener('click', () => {
    const rows = [['Restaurant', 'Owner', 'Email', 'Country', 'Plan', 'Status', 'Tables', 'Items', 'Staff']].concat(
      filtered().map((c) => {
        const owner = store.query('owners', (o) => o.clientId === c.id)[0];
        const usage = usageOf(c.id);
        return [c.name, owner ? owner.name : '', owner ? owner.email : '', c.country, planName(c.planId), c.status, usage.tables, usage.items, usage.staff];
      })
    );
    exportCSV(rows, 'tabletap-clients.csv');
    toast('CSV exported');
  });

  draw();
}

function deleteClient(clientId) {
  ['tables', 'categories', 'items', 'orders', 'staff', 'waiterCalls', 'notes'].forEach((collection) => {
    store.query(collection, (row) => row.clientId === clientId).forEach((row) => store.remove(collection, row.id));
  });
  store.query('owners', (o) => o.clientId === clientId).forEach((o) => store.remove('owners', o.id));
  store.remove('clients', clientId);
  store.logActivity({ actor: session.name, clientId, type: 'Delete', details: 'Client and all data deleted' });
}

/* --------------------------------------------------------- client detail -- */
function renderClientDetail() {
  const id = qs('id') || 'cli_olive-table';
  const client = store.getById('clients', id);
  if (!client) {
    paint(head('Client not found', 'That restaurant is not in the demo database.',
      '<a class="btn btn--secondary btn--sm" href="clients.html"><i data-lucide="arrow-left"></i> Back to clients</a>'));
    return;
  }

  const owner = store.query('owners', (o) => o.clientId === client.id)[0];
  const usage = usageOf(client.id);
  const plan = store.getById('plans', client.planId);
  const notes = store.query('notes', (n) => n.clientId === client.id);
  const clientOrders = store.ordersOf(client.id);
  const last30 = clientOrders.filter((o) => new Date(o.createdAt) > new Date(Date.now() - 30 * 86400000));

  const usageBar = (label, used, limit) => {
    const pct = Math.min(100, Math.round((used / limit) * 100));
    return '<div class="usage"><div class="usage__head"><span>' + label + '</span>' +
      '<span class="usage__value">' + used + ' / ' + limit + '</span></div>' +
      '<div class="usage-bar"><div class="usage-bar__fill' + (pct >= 80 ? ' usage-bar__fill--warn' : '') + '" style="width:' + pct + '%"></div></div></div>';
  };

  paint('<div class="detail-head"><div class="detail-head__brand">' +
    '<span class="detail-logo">' + initials(client.name) + '</span><div>' +
    '<h1 class="detail-head__name">' + esc(client.name) + '</h1>' +
    '<p class="detail-head__meta">' + esc(owner ? owner.name : 'No owner') + ' · ' + esc(owner ? owner.email : '') + ' · ' +
    esc(client.country) + ' · joined ' + formatDateTime(client.createdAt) + '</p>' +
    '<p class="mt-2">' + statusBadge(client.status) + ' <span class="badge badge--neutral">' + esc(plan ? plan.name : '') + '</span></p>' +
    '</div></div><div class="detail-head__actions">' +
    '<button class="btn btn--secondary btn--sm" type="button" data-impersonate><i data-lucide="log-in"></i> Login as owner</button>' +
    '<button class="btn btn--secondary btn--sm" type="button" data-suspend><i data-lucide="ban"></i> ' +
    (client.status === 'suspended' ? 'Reactivate' : 'Suspend') + '</button>' +
    '<button class="btn btn--secondary btn--sm" type="button" data-reset><i data-lucide="key"></i> Reset password</button>' +
    '<button class="btn btn--secondary btn--sm" type="button" data-resend><i data-lucide="mail"></i> Resend invite</button>' +
    (isSupport ? '' : '<button class="btn btn--danger btn--sm" type="button" data-delete><i data-lucide="trash-2"></i> Delete</button>') +
    '</div></div>' +

    '<div class="tabs" data-tabs><div class="tabs__list" role="tablist" aria-label="Client sections">' +
    ['Overview|overview', 'Usage|usage', 'Restrictions|restrictions', 'Activity|activity', 'Notes|notes'].map((pair, i) => {
      const [label, key] = pair.split('|');
      return '<button class="tab" role="tab" type="button" data-tab="' + key + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' + label + '</button>';
    }).join('') + '</div>' +

    '<div class="tab-panel" data-panel="overview"><div class="split">' +
    '<div class="card"><div class="card__header"><span class="card__title">Restaurant details</span></div><div class="card__body"><div class="info-list">' +
    '<div class="info-list__row"><span class="info-list__key">Address</span><span class="info-list__val">' + esc(client.settings.address || '—') + '</span></div>' +
    '<div class="info-list__row"><span class="info-list__key">Country</span><span class="info-list__val">' + esc(client.country) + '</span></div>' +
    '<div class="info-list__row"><span class="info-list__key">Joined</span><span class="info-list__val">' + formatDateTime(client.createdAt) + '</span></div>' +
    '<div class="info-list__row"><span class="info-list__key">Plan</span><span class="info-list__val">' + esc(plan ? plan.name : '') + ' · ' + formatMoney(plan ? plan.price : 0) + ' one-time</span></div>' +
    '<div class="info-list__row"><span class="info-list__key">Kitchen code</span><span class="info-list__val mono">' + esc(client.kitchenCode) + '</span></div>' +
    '<div class="info-list__row"><span class="info-list__key">Menu link</span><span class="info-list__val">menu/index.html?r=' + esc(client.slug) + '</span></div>' +
    '</div></div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Owner</span></div><div class="card__body">' +
    '<div class="row mb-4"><span class="avatar avatar--lg">' + initials(owner ? owner.name : '?') + '</span><div>' +
    '<p class="strong">' + esc(owner ? owner.name : '—') + '</p><p class="muted text-xs">' + esc(owner ? owner.email : '') + '</p></div></div>' +
    '<div class="info-list">' +
    '<div class="info-list__row"><span class="info-list__key">Phone</span><span class="info-list__val">' + esc(owner && owner.phone ? owner.phone : '—') + '</span></div>' +
    '<div class="info-list__row"><span class="info-list__key">Last login</span><span class="info-list__val">' + timeAgo(owner ? owner.lastLogin : null) + '</span></div>' +
    '</div></div></div></div>' +
    '<div class="stat-grid mt-4">' +
    statCard('Orders (30 days)', String(last30.length), 'last 30 days') +
    statCard('Revenue (30 days)', formatMoney(last30.reduce((s, o) => s + o.total, 0)), 'last 30 days') +
    statCard('Tables', String(usage.tables), 'of ' + client.limits.tables + ' allowed') +
    statCard('Menu items', String(usage.items), 'of ' + client.limits.items + ' allowed') +
    '</div></div>' +

    '<div class="tab-panel" data-panel="usage" hidden><div class="card"><div class="card__header">' +
    '<span class="card__title">Orders per day</span><span class="muted text-xs">Last 7 days</span></div><div class="card__body">' +
    chart(Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.now() - (6 - i) * 86400000);
      const count = clientOrders.filter((o) => new Date(o.createdAt).toDateString() === date.toDateString()).length;
      return [date.toLocaleDateString('en-GB', { weekday: 'short' }), Math.min(100, count * 12), count];
    })) + '</div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Usage against plan limits</span></div><div class="card__body">' +
    usageBar('Tables', usage.tables, client.limits.tables) +
    usageBar('Menu items', usage.items, client.limits.items) +
    usageBar('Staff accounts', usage.staff, client.limits.staff) +
    '<p class="hint mt-4">Custom limits can be set in the Restrictions tab.</p></div></div></div>' +

    '<div class="tab-panel" data-panel="restrictions" hidden><div class="card"><div class="card__body">' +
    [['ordering', 'Ordering enabled', 'Guests can place orders from the table menu.'],
      ['readOnly', 'Read-only mode', 'Owner can look, but cannot add, edit or delete anything.'],
      ['kitchen', 'Kitchen panel access', 'Allows the restaurant code and PIN login.'],
      ['reports', 'Reports access', 'Hides the Reports page in the owner panel.']].map(([key, title, text]) =>
      '<div class="restriction-row"><div><p class="restriction-row__title">' + title + '</p>' +
      '<p class="restriction-row__text">' + text + '</p></div>' +
      '<label class="switch"><input type="checkbox" data-restrict="' + key + '"' + (client.restrictions[key] ? ' checked' : '') + '>' +
      '<span class="switch__track"></span><span class="sr-only">' + title + '</span></label></div>').join('') +
    '<div class="form-grid form-grid--2 mt-6">' +
    '<div class="field"><label class="label" for="max-tables">Max tables</label><input class="input" id="max-tables" type="number" value="' + client.limits.tables + '"></div>' +
    '<div class="field"><label class="label" for="max-items">Max menu items</label><input class="input" id="max-items" type="number" value="' + client.limits.items + '"></div>' +
    '<div class="field"><label class="label" for="max-staff">Max staff accounts</label><input class="input" id="max-staff" type="number" value="' + client.limits.staff + '"></div>' +
    '<div class="field"><label class="label" for="plan-select">Plan</label><select class="select" id="plan-select">' +
    store.getAll('plans').map((p) => '<option value="' + p.id + '"' + (client.planId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
    '</select></div>' +
    '<div class="field field--full"><label class="label" for="restriction-reason">Reason for the change</label>' +
    '<textarea class="textarea" id="restriction-reason" placeholder="Shown in the activity log"></textarea></div></div>' +
    '<div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save-restrictions>Save restrictions</button></div>' +
    '</div></div></div>' +

    '<div class="tab-panel" data-panel="activity" hidden><div class="card"><div class="card__body"><div class="timeline">' +
    store.query('activity', (a) => a.clientId === client.id).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12).map((row) =>
      '<div class="timeline__item"><span class="timeline__dot"></span><div>' +
      '<p class="timeline__body">' + esc(row.details) + ' · <span class="muted">' + esc(row.actor) + '</span></p>' +
      '<p class="timeline__time">' + formatDateTime(row.at) + '</p></div></div>').join('') +
    '</div></div></div></div>' +

    '<div class="tab-panel" data-panel="notes" hidden><div class="card"><div class="card__body">' +
    (notes.length ? notes.map((note) =>
      '<div class="note-item"><p class="note-item__meta">' + esc(note.author) + ' · ' + formatDateTime(note.at) + '</p>' +
      '<p>' + esc(note.text) + '</p>' +
      '<button class="btn btn--icon btn--sm mt-2" type="button" data-del-note="' + note.id + '" aria-label="Delete note"><i data-lucide="trash-2"></i></button></div>').join('')
      : '<p class="muted text-sm">No notes yet.</p>') +
    '<div class="field mt-6"><label class="label" for="new-note">Add an internal note</label>' +
    '<textarea class="textarea" id="new-note" placeholder="Only admins can see this."></textarea></div>' +
    '<div class="row mt-4" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-add-note>Add note</button></div>' +
    '</div></div></div></div><div id="modal-host"></div>');

  /* tabs */
  host.querySelector('.tabs__list').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab) return;
    host.querySelectorAll('[data-tab]').forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      host.querySelector('[data-panel="' + t.getAttribute('data-tab') + '"]').hidden = !on;
    });
  });

  const modalHost = host.querySelector('#modal-host');
  const closeAll = () => { modalHost.innerHTML = ''; };

  host.querySelector('[data-impersonate]').addEventListener('click', () => {
    startImpersonation(client.id);
    location.href = '../owner/dashboard.html';
  });

  host.querySelector('[data-suspend]').addEventListener('click', async () => {
    const next = client.status === 'suspended' ? 'active' : 'suspended';
    const ok = await confirmDialog(
      next === 'suspended' ? 'Suspend ' + client.name + '? Owner and kitchen logins stop working immediately.' : 'Reactivate ' + client.name + '?',
      { confirmLabel: next === 'suspended' ? 'Suspend account' : 'Reactivate' });
    if (!ok) return;
    store.update('clients', client.id, {
      status: next,
      restrictions: { ...client.restrictions, ordering: next === 'active' },
    });
    store.logActivity({ actor: session.name, clientId: client.id, type: 'Suspension', details: next === 'suspended' ? 'Account suspended' : 'Account reactivated' });
    toast(client.name + (next === 'suspended' ? ' suspended' : ' reactivated'));
    renderClientDetail();
  });

  host.querySelector('[data-reset]').addEventListener('click', () => {
    const temp = 'tt-' + Math.random().toString(36).slice(2, 8);
    store.update('owners', owner.id, { password: temp });
    store.logActivity({ actor: session.name, clientId: client.id, type: 'Password', details: 'Temporary password issued' });
    modalHost.innerHTML = '<div class="modal is-open" role="dialog" aria-modal="true"><div class="modal__dialog">' +
      '<div class="modal__header"><p class="modal__title">Temporary password</p>' +
      '<button class="btn btn--icon" type="button" data-close aria-label="Close"><i data-lucide="x"></i></button></div>' +
      '<div class="modal__body"><p class="mono strong" style="font-size:1.5rem;text-align:center">' + temp + '</p>' +
      '<p class="hint text-center">Shown once. Send it to ' + esc(owner.email) + ' and ask them to change it after logging in.</p></div>' +
      '<div class="modal__footer"><button class="btn btn--secondary" type="button" data-copy>Copy</button>' +
      '<button class="btn btn--primary" type="button" data-close>Done</button></div></div></div>';
    if (window.lucide) window.lucide.createIcons();
    modalHost.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeAll));
    modalHost.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(temp); toast('Password copied'); } catch (err) { toast('Copy blocked — select it manually', 'warning'); }
    });
  });

  host.querySelector('[data-resend]').addEventListener('click', () => {
    const invite = store.insert('invites', {
      token: 'tok_' + Math.random().toString(36).slice(2, 10),
      clientName: client.name,
      ownerName: owner ? owner.name : '',
      email: owner ? owner.email : '',
      country: client.country,
      planId: client.planId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      sentBy: session.name,
    });
    store.logActivity({ actor: session.name, clientId: client.id, type: 'Invite', details: 'Invite re-sent to ' + (owner ? owner.email : '') });
    toast('New invite link created');
    copyInviteLink(invite);
  });

  const deleteBtn = host.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      modalHost.innerHTML = '<div class="modal is-open" role="dialog" aria-modal="true"><div class="modal__dialog">' +
        '<div class="modal__header"><div><p class="modal__title">Delete ' + esc(client.name) + '</p>' +
        '<p class="muted text-xs">This cannot be undone.</p></div>' +
        '<button class="btn btn--icon" type="button" data-close aria-label="Close"><i data-lucide="x"></i></button></div>' +
        '<div class="modal__body"><div class="danger-zone"><p class="danger-zone__title">Everything is removed</p>' +
        '<p class="danger-zone__text">Menu, tables, QR codes, staff, orders and reports for this restaurant are deleted permanently.</p></div>' +
        '<div class="field mt-4"><label class="label" for="confirm-name">Type <strong>' + esc(client.name) + '</strong> to confirm</label>' +
        '<input class="input" id="confirm-name" type="text" placeholder="Restaurant name"></div></div>' +
        '<div class="modal__footer"><button class="btn btn--secondary" type="button" data-close>Cancel</button>' +
        '<button class="btn btn--danger" type="button" data-confirm disabled>Delete restaurant</button></div></div></div>';
      if (window.lucide) window.lucide.createIcons();
      modalHost.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeAll));
      const input = modalHost.querySelector('#confirm-name');
      const confirmBtn = modalHost.querySelector('[data-confirm]');
      input.addEventListener('input', () => { confirmBtn.disabled = input.value.trim() !== client.name; });
      confirmBtn.addEventListener('click', () => {
        deleteClient(client.id);
        toast('Client deleted');
        location.href = 'clients.html';
      });
    });
  }

  host.querySelector('[data-save-restrictions]').addEventListener('click', () => {
    const restrictions = {};
    host.querySelectorAll('[data-restrict]').forEach((box) => { restrictions[box.getAttribute('data-restrict')] = box.checked; });
    const limits = {
      tables: Number(host.querySelector('#max-tables').value),
      items: Number(host.querySelector('#max-items').value),
      staff: Number(host.querySelector('#max-staff').value),
    };
    const planId = host.querySelector('#plan-select').value;
    const reason = host.querySelector('#restriction-reason').value.trim();
    store.update('clients', client.id, { restrictions, limits, planId, status: restrictions.ordering ? (client.status === 'suspended' ? 'active' : client.status) : client.status });
    store.logActivity({
      actor: session.name, clientId: client.id, type: 'Restriction change',
      details: 'Restrictions saved' + (reason ? ': ' + reason : ''),
    });
    emit('settings:update', { clientId: client.id });
    toast('Restrictions saved');
    renderClientDetail();
  });

  host.addEventListener('click', (event) => {
    const del = event.target.closest('[data-del-note]');
    if (del) {
      store.remove('notes', del.getAttribute('data-del-note'));
      toast('Note deleted');
      renderClientDetail();
    }
    if (event.target.closest('[data-add-note]')) {
      const text = host.querySelector('#new-note').value.trim();
      if (!text) return toast('Write something first.', 'warning');
      store.insert('notes', { clientId: client.id, author: session.name, text, at: new Date().toISOString() });
      toast('Note added');
      renderClientDetail();
    }
  });
}

function copyInviteLink(invite) {
  const link = location.origin + location.pathname.replace('invites.html', '').replace('client-detail.html', '') + '../auth/accept-invite.html?token=' + invite.token;
  navigator.clipboard.writeText(link).then(() => toast('Invite link copied')).catch(() => toast(link, 'warning'));
}

/* --------------------------------------------------------------- invites -- */
function renderInvites() {
  paint(head('Invites', 'Send an invite, copy the link, or revoke one before it is used.') +
    '<div class="split split--even"><div class="card"><div class="card__header"><span class="card__title">Invite a restaurant</span></div>' +
    '<div class="card__body"><div class="form-grid form-grid--2">' +
    '<div class="field"><label class="label" for="inv-rest">Restaurant name</label><input class="input" id="inv-rest" type="text" placeholder="e.g. Tiffin &amp; Chai"></div>' +
    '<div class="field"><label class="label" for="inv-owner">Owner name</label><input class="input" id="inv-owner" type="text" placeholder="e.g. Rohan Mehta"></div>' +
    '<div class="field field--full"><label class="label" for="inv-email">Owner email</label><input class="input" id="inv-email" type="email" placeholder="owner@restaurant.com"></div>' +
    '<div class="field"><label class="label" for="inv-country">Country</label><select class="select" id="inv-country">' +
    ['India', 'United Kingdom', 'United States', 'South Africa'].map((c) => '<option>' + c + '</option>').join('') + '</select></div>' +
    '<div class="field"><label class="label" for="inv-plan">Plan</label><select class="select" id="inv-plan">' +
    store.getAll('plans').map((p) => '<option value="' + p.id + '">' + esc(p.name) + ' · ' + formatMoney(p.price) + '</option>').join('') +
    '</select></div></div>' +
    '<div class="row mt-6" style="justify-content:flex-end">' +
    '<button class="btn btn--primary" type="button" data-send><i data-lucide="send"></i> Send invite</button></div></div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Invite email preview</span>' +
    '<span class="badge badge--neutral" id="inv-expiry">expires in ' + (platformSettings().inviteExpiryDays || 7) + ' days</span></div>' +
    '<div class="card__body"><div class="email-preview"><div class="email-preview__head" id="inv-preview-head">To: — · Subject: —</div>' +
    '<div class="email-preview__body" id="inv-preview-body"><p class="muted">Fill in the form to preview the email.</p></div></div>' +
    '<div class="row mt-4"><button class="btn btn--secondary btn--block" type="button" data-open-mail><i data-lucide="mail"></i> Open in email</button></div>' +
    '</div></div></div>' +
    '<div class="card mt-6"><div class="card__header"><span class="card__title">Invites</span>' +
    '<span class="muted text-xs" id="inv-count"></span></div><div class="card__body"><div class="table-wrap">' +
    '<table class="table table-stack"><thead><tr><th scope="col">Email</th><th scope="col">Restaurant</th>' +
    '<th scope="col">Sent</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>' +
    '<tbody id="inv-rows"></tbody></table></div>' +
    '<div class="row row--between mt-6" style="margin-top:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
    '<span class="muted text-xs" id="inv-page-count"></span>' +
    '<nav class="pagination" id="inv-pages" aria-label="Invite pages"></nav></div>' +
    '</div></div>');

  const rowsHost = host.querySelector('#inv-rows');
  const pagesHost = host.querySelector('#inv-pages');
  const pageCountHost = host.querySelector('#inv-page-count');

  let pageNo = 1;
  const perPage = 10;

  function preview() {
    const name = host.querySelector('#inv-rest').value || 'Tiffin & Chai';
    const ownerName = host.querySelector('#inv-owner').value || 'Rohan';
    const email = host.querySelector('#inv-email').value || 'owner@restaurant.com';
    const planId = host.querySelector('#inv-plan').value;
    const plan = store.getById('plans', planId);
    const settings = platformSettings();

    host.querySelector('#inv-preview-head').textContent = 'To: ' + email + ' · Subject: ' + (settings.inviteSubject || '').replace('{{owner_name}}', ownerName);
    host.querySelector('#inv-preview-body').innerHTML = esc(settings.inviteBody || '')
      .replace(/\{\{owner_name\}\}/g, esc(ownerName))
      .replace(/\{\{restaurant_name\}\}/g, esc(name))
      .replace(/\{\{plan_name\}\}/g, esc(plan ? plan.name : ''))
      .replace(/\{\{invite_link\}\}/g, 'tabletap.demo/auth/accept-invite.html?token=…')
      .replace(/\{\{expiry_days\}\}/g, String(settings.inviteExpiryDays || 7))
      .replace(/\{\{sender_name\}\}/g, esc(session.name.split(' ')[0]))
      .split('\n').map((line) => line.trim() ? '<p>' + line + '</p>' : '').join('');
  }

  ['inv-rest', 'inv-owner', 'inv-email', 'inv-plan'].forEach((id) => {
    host.querySelector('#' + id).addEventListener('input', preview);
    host.querySelector('#' + id).addEventListener('change', preview);
  });

  function draw() {
    const invites = store.getAll('invites').slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const totalPages = Math.max(1, Math.ceil(invites.length / perPage));
    pageNo = Math.min(pageNo, totalPages);
    const slice = invites.slice((pageNo - 1) * perPage, pageNo * perPage);

    rowsHost.innerHTML = slice.map((invite) => {
      const expired = new Date(invite.expiresAt) < new Date() && invite.status === 'pending';
      const status = expired ? 'expired' : invite.status;
      const tone = { pending: 'warning', accepted: 'success', expired: 'neutral', revoked: 'danger' }[status] || 'neutral';
      return '<tr><td data-label="Email" class="table__strong">' + esc(invite.email) + '</td>' +
        '<td data-label="Restaurant">' + esc(invite.clientName) + '</td>' +
        '<td data-label="Sent">' + formatDateTime(invite.createdAt) + '</td>' +
        '<td data-label="Expires">' + formatDateTime(invite.expiresAt) + '</td>' +
        '<td data-label="Status"><span class="badge badge--' + tone + '">' + status[0].toUpperCase() + status.slice(1) + '</span></td>' +
        '<td data-label="Actions"><div class="row">' +
        '<button class="btn btn--icon btn--sm" type="button" data-copy="' + invite.id + '" aria-label="Copy invite link"><i data-lucide="copy"></i></button>' +
        '<button class="btn btn--icon btn--sm" type="button" data-resend="' + invite.id + '" aria-label="Resend invite"><i data-lucide="refresh-cw"></i></button>' +
        '<button class="btn btn--icon btn--sm" type="button" data-revoke="' + invite.id + '" aria-label="Revoke invite"><i data-lucide="ban"></i></button>' +
        '</div></td></tr>';
    }).join('');

    host.querySelector('#inv-count').textContent = invites.length + ' invites · ' +
      invites.filter((i) => i.status === 'pending').length + ' pending';
    if (pageCountHost) {
      pageCountHost.textContent = invites.length
        ? 'Showing ' + ((pageNo - 1) * perPage + 1) + '–' + Math.min(pageNo * perPage, invites.length) + ' of ' + invites.length
        : '0 invites';
    }
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
      draw();
    });
  }

  host.querySelector('[data-send]').addEventListener('click', () => {
    const name = host.querySelector('#inv-rest').value.trim();
    const ownerName = host.querySelector('#inv-owner').value.trim();
    const email = host.querySelector('#inv-email').value.trim();
    if (!name || !ownerName || !email) return toast('Fill in the restaurant, owner and email.', 'danger');
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('That email does not look right.', 'danger');

    const invite = store.insert('invites', {
      token: 'tok_' + Math.random().toString(36).slice(2, 10),
      clientName: name,
      ownerName,
      email,
      country: host.querySelector('#inv-country').value,
      planId: host.querySelector('#inv-plan').value,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (platformSettings().inviteExpiryDays || 7) * 86400000).toISOString(),
      sentBy: session.name,
    });
    store.logActivity({ actor: session.name, type: 'Invite', details: 'Invite sent to ' + email + ' (' + name + ')' });
    toast('Invite created for ' + name);
    copyInviteLink(invite);
    draw();
  });

  rowsHost.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-copy]');
    const resend = event.target.closest('[data-resend]');
    const revoke = event.target.closest('[data-revoke]');

    if (copy) copyInviteLink(store.getById('invites', copy.getAttribute('data-copy')));

    if (resend) {
      const invite = store.getById('invites', resend.getAttribute('data-resend'));
      store.update('invites', invite.id, {
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (platformSettings().inviteExpiryDays || 7) * 86400000).toISOString(),
      });
      toast('Invite resent');
      draw();
    }

    if (revoke) {
      const invite = store.getById('invites', revoke.getAttribute('data-revoke'));
      const ok = await confirmDialog('Revoke the invite for ' + invite.email + '? The link stops working.', { confirmLabel: 'Revoke invite' });
      if (!ok) return;
      store.update('invites', invite.id, { status: 'revoked' });
      store.logActivity({ actor: session.name, type: 'Invite', details: 'Invite revoked for ' + invite.email });
      toast('Invite revoked');
      draw();
    }
  });

  host.querySelector('[data-open-mail]').addEventListener('click', () => {
    const email = host.querySelector('#inv-email').value || '';
    const subject = host.querySelector('#inv-preview-head').textContent.split('Subject: ')[1] || 'You are invited to TableTap';
    const body = host.querySelector('#inv-preview-body').textContent.slice(0, 900);
    location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  });

  preview();
  draw();
}

/* -------------------------------------------------------------- activity -- */
function renderActivity() {
  let pageNo = 1;
  const perPage = 12;
  let filters = { client: 'all', type: 'all', actor: 'all' };

  paint(head('Activity log', 'Everything that happened across every restaurant, in order.',
    '<button class="btn btn--secondary btn--sm" type="button" data-export><i data-lucide="download"></i> Export CSV</button>') +
    '<div class="card"><div class="card__body"><div class="toolbar">' +
    '<select class="select" id="a-client" aria-label="Client"><option value="all">All clients</option>' +
    store.getAll('clients').map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select>' +
    '<select class="select" id="a-type" aria-label="Event type"><option value="all">All events</option>' +
    Array.from(new Set(store.getAll('activity').map((a) => a.type))).map((t) => '<option>' + esc(t) + '</option>').join('') + '</select>' +
    '<select class="select" id="a-actor" aria-label="Actor"><option value="all">All actors</option>' +
    Array.from(new Set(store.getAll('activity').map((a) => a.actor))).map((a) => '<option>' + esc(a) + '</option>').join('') + '</select>' +
    '<span class="toolbar__spacer"></span><span class="muted text-xs" id="a-count"></span></div>' +
    '<div class="table-wrap"><table class="table table-stack"><thead><tr>' +
    '<th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Client</th><th scope="col">Event</th>' +
    '<th scope="col">Details</th><th scope="col">Device</th></tr></thead><tbody id="a-rows"></tbody></table></div>' +
    '<div class="row row--between mt-6"><span class="muted text-xs">' + perPage + ' events per page</span>' +
    '<nav class="pagination" id="a-pages" aria-label="Activity pages"></nav></div></div></div>');

  const rowsHost = host.querySelector('#a-rows');
  const pagesHost = host.querySelector('#a-pages');

  function filtered() {
    return store.getAll('activity')
      .filter((row) => filters.client === 'all' || row.clientId === filters.client)
      .filter((row) => filters.type === 'all' || row.type === filters.type)
      .filter((row) => filters.actor === 'all' || row.actor === filters.actor)
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function draw() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    pageNo = Math.min(pageNo, pages);
    const slice = rows.slice((pageNo - 1) * perPage, pageNo * perPage);

    rowsHost.innerHTML = slice.length ? slice.map((row) => {
      const client = row.clientId ? store.getById('clients', row.clientId) : null;
      return '<tr><td data-label="Time">' + formatDateTime(row.at) + '</td>' +
        '<td data-label="Actor" class="table__strong">' + esc(row.actor) + '</td>' +
        '<td data-label="Client">' + esc(client ? client.name : '—') + '</td>' +
        '<td data-label="Event"><span class="badge badge--neutral">' + esc(row.type) + '</span></td>' +
        '<td data-label="Details">' + esc(row.details) + '</td>' +
        '<td data-label="Device">' + esc(row.device || 'Server') + '</td></tr>';
    }).join('') : '<tr><td colspan="6"><p class="muted text-sm">No events match those filters.</p></td></tr>';

    host.querySelector('#a-count').textContent = rows.length + ' events';
    pagesHost.innerHTML = renderPaginationHtml(pageNo, pages);
    if (window.lucide) window.lucide.createIcons();
  }

  ['client', 'type', 'actor'].forEach((key) => {
    host.querySelector('#a-' + key).addEventListener('change', (event) => {
      filters[key] = event.target.value;
      pageNo = 1;
      draw();
    });
  });

  pagesHost.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn || btn.classList.contains('page--disabled') || btn.disabled) return;
    pageNo = Math.max(1, Number(btn.getAttribute('data-page')));
    draw();
  });

  host.querySelector('[data-export]').addEventListener('click', () => {
    const rows = [['Time', 'Actor', 'Client', 'Event', 'Details', 'Device']].concat(
      filtered().map((row) => {
        const client = row.clientId ? store.getById('clients', row.clientId) : null;
        return [formatDateTime(row.at), row.actor, client ? client.name : '', row.type, row.details, row.device || 'Server'];
      })
    );
    exportCSV(rows, 'tabletap-activity.csv');
    toast('CSV exported');
  });

  draw();
}

/* ----------------------------------------------------------------- plans -- */
function renderPlans() {
  const plans = store.getAll('plans');
  const clientsOn = (planId) => store.query('clients', (c) => c.planId === planId).length;

  paint(head('Plans', 'Two lifetime plans. Limits are applied to new clients automatically.',
    isSupport ? '' : '<button class="btn btn--secondary btn--sm" type="button" data-new-plan><i data-lucide="plus"></i> New plan</button>') +
    '<div class="split split--even">' + plans.map((plan) =>
      '<div class="plan-card-lg"><p class="plan-card-lg__label">' + esc(plan.name) + '</p>' +
      '<p class="plan-card-lg__price">' + formatMoney(plan.price) + ' <span>one-time</span></p>' +
      '<p class="muted text-sm mt-2">' + (plan.id === 'pro' ? 'The default plan for restaurants and bars running full service.' : 'For cafés and small rooms that only need the basics.') + '</p>' +
      '<div class="plan-limits"><span><strong>' + plan.limits.tables + '</strong> tables</span>' +
      '<span><strong>' + plan.limits.items + '</strong> menu items</span>' +
      '<span><strong>' + plan.limits.staff + '</strong> staff</span></div>' +
      '<div class="row row--between mt-6"><span class="badge badge--' + (plan.id === 'pro' ? 'success' : 'neutral') + '">' +
      clientsOn(plan.id) + ' clients</span>' +
      (isSupport ? '' : '<button class="btn btn--secondary btn--sm" type="button" data-edit="' + plan.id + '"><i data-lucide="pencil"></i> Edit plan</button>') +
      '</div></div>').join('') + '</div>' +
    '<div class="card mt-6"><div class="card__header"><span class="card__title">Clients on each plan</span></div><div class="card__body">' +
    '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Plan</th><th scope="col" class="table__num">Price</th>' +
    '<th scope="col" class="table__num">Clients</th><th scope="col" class="table__num">Revenue</th></tr></thead><tbody>' +
    plans.map((plan) => '<tr><td class="table__strong">' + esc(plan.name) + '</td>' +
      '<td class="table__num">' + formatMoney(plan.price) + '</td>' +
      '<td class="table__num">' + clientsOn(plan.id) + '</td>' +
      '<td class="table__num">' + formatMoney(clientsOn(plan.id) * plan.price) + '</td></tr>').join('') +
    '</tbody></table></div></div></div><div id="modal-host"></div>');

  const modalHost = host.querySelector('#modal-host');

  host.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const plan = store.getById('plans', btn.getAttribute('data-edit'));
      modalHost.innerHTML = '<div class="modal is-open" role="dialog" aria-modal="true"><div class="modal__dialog">' +
        '<div class="modal__header"><div><p class="modal__title">Edit ' + esc(plan.name) + '</p>' +
        '<p class="muted text-xs">Applies to new clients on this plan.</p></div>' +
        '<button class="btn btn--icon" type="button" data-close aria-label="Close"><i data-lucide="x"></i></button></div>' +
        '<div class="modal__body"><div class="field"><label class="label" for="plan-name">Plan name</label>' +
        '<input class="input" id="plan-name" type="text" value="' + esc(plan.name) + '"></div>' +
        '<div class="field"><label class="label" for="plan-price">Price</label>' +
        '<input class="input" id="plan-price" type="number" value="' + plan.price + '"></div>' +
        '<div class="form-grid form-grid--2 mt-4">' +
        '<div class="field"><label class="label" for="plan-tables">Max tables</label><input class="input" id="plan-tables" type="number" value="' + plan.limits.tables + '"></div>' +
        '<div class="field"><label class="label" for="plan-items">Max menu items</label><input class="input" id="plan-items" type="number" value="' + plan.limits.items + '"></div>' +
        '<div class="field"><label class="label" for="plan-staff">Max staff</label><input class="input" id="plan-staff" type="number" value="' + plan.limits.staff + '"></div></div>' +
        '<p class="hint mt-4">Clients with custom limits keep their own numbers.</p></div>' +
        '<div class="modal__footer"><button class="btn btn--secondary" type="button" data-close>Cancel</button>' +
        '<button class="btn btn--primary" type="button" data-save>Save plan</button></div></div></div>';
      if (window.lucide) window.lucide.createIcons();
      modalHost.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { modalHost.innerHTML = ''; }));
      modalHost.querySelector('[data-save]').addEventListener('click', () => {
        const limits = {
          tables: Number(modalHost.querySelector('#plan-tables').value),
          items: Number(modalHost.querySelector('#plan-items').value),
          staff: Number(modalHost.querySelector('#plan-staff').value),
        };
        store.update('plans', plan.id, {
          name: modalHost.querySelector('#plan-name').value,
          price: Number(modalHost.querySelector('#plan-price').value),
          limits,
        });
        store.query('clients', (c) => c.planId === plan.id).forEach((c) => {
          store.update('clients', c.id, { limits: { ...limits } });
        });
        store.logActivity({ actor: session.name, type: 'Plan', details: 'Plan updated: ' + plan.name });
        modalHost.innerHTML = '';
        toast('Plan updated');
        renderPlans();
      });
    });
  });

  const newBtn = host.querySelector('[data-new-plan]');
  if (newBtn) newBtn.addEventListener('click', () => toast('Adding plans is out of scope for the demo — edit the two seeded plans.', 'warning'));
}

/* -------------------------------------------------------------- settings -- */
function renderSettings() {
  const settings = platformSettings();
  const admins = store.getAll('admins');

  paint(head('Settings', 'Your profile, the admin team, the invite email and platform switches.') +
    '<div class="tabs" data-tabs><div class="tabs__list" role="tablist" aria-label="Admin settings">' +
    ['Profile|profile', 'Admin team|team', 'Invite email template|template', 'Platform|platform'].map((pair, i) => {
      const [label, key] = pair.split('|');
      return '<button class="tab" role="tab" type="button" data-tab="' + key + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' + label + '</button>';
    }).join('') + '</div>' +

    '<div class="tab-panel" data-panel="profile"><div class="card"><div class="card__body">' +
    '<div class="form-grid form-grid--2">' +
    '<div class="field"><label class="label" for="admin-name">Full name</label><input class="input" id="admin-name" type="text" value="' + esc(session.name) + '"></div>' +
    '<div class="field"><label class="label" for="admin-email">Email</label><input class="input" id="admin-email" type="email" value="' + esc(session.email) + '"></div>' +
    '<div class="field"><label class="label" for="admin-role">Role</label><select class="select" id="admin-role">' +
    '<option value="super"' + (session.adminRole === 'super' ? ' selected' : '') + '>Super admin</option>' +
    '<option value="support"' + (session.adminRole === 'support' ? ' selected' : '') + '>Support</option></select></div>' +
    '</div><div class="row mt-6" style="justify-content:flex-end">' +
    '<button class="btn btn--primary" type="button" data-save-profile>Save profile</button></div></div></div></div>' +

    '<div class="tab-panel" data-panel="team" hidden><div class="card"><div class="card__header">' +
    '<span class="card__title">Admin team</span>' +
    '<button class="btn btn--primary btn--sm" type="button" data-add-admin><i data-lucide="user-plus"></i> Add admin</button></div>' +
    '<div class="card__body"><div class="table-wrap"><table class="table table-stack"><thead><tr>' +
    '<th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Actions</th></tr></thead><tbody>' +
    admins.map((admin) => '<tr><td data-label="Name" class="table__strong">' + esc(admin.name) + '</td>' +
      '<td data-label="Email">' + esc(admin.email) + '</td>' +
      '<td data-label="Role"><span class="badge badge--' + (admin.role === 'super' ? 'success' : 'neutral') + '">' +
      (admin.role === 'super' ? 'Super admin' : 'Support') + '</span></td>' +
      '<td data-label="Actions">' + (admin.id === session.id ? '<span class="muted text-xs">You</span>' :
        '<button class="btn btn--icon btn--sm" type="button" data-del-admin="' + admin.id + '" aria-label="Remove ' + esc(admin.name) + '"><i data-lucide="trash-2"></i></button>') +
      '</td></tr>').join('') +
    '</tbody></table></div><p class="hint mt-4">Support admins cannot delete clients or edit plans.</p></div></div></div>' +

    '<div class="tab-panel" data-panel="template" hidden><div class="card"><div class="card__body">' +
    '<div class="field"><label class="label" for="tpl-subject">Subject</label>' +
    '<input class="input" id="tpl-subject" type="text" value="' + esc(settings.inviteSubject) + '"></div>' +
    '<div class="field"><label class="label" for="tpl-body">Body</label>' +
    '<textarea class="textarea" id="tpl-body" style="min-height:180px">' + esc(settings.inviteBody) + '</textarea>' +
    '<p class="hint">Variables: {{owner_name}}, {{restaurant_name}}, {{plan_name}}, {{invite_link}}, {{expiry_days}}, {{sender_name}}</p></div>' +
    '<span class="label mt-6">Live preview</span><div class="email-preview">' +
    '<div class="email-preview__head" id="tpl-head"></div><div class="email-preview__body" id="tpl-preview"></div></div>' +
    '<div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save-template>Save template</button></div>' +
    '</div></div></div>' +

    '<div class="tab-panel" data-panel="platform" hidden><div class="card"><div class="card__body">' +
    '<div class="restriction-row"><div><p class="restriction-row__title">Maintenance mode</p>' +
    '<p class="restriction-row__text">Blocks owner logins and shows a banner on every owner page.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-maintenance"' + (settings.maintenance ? ' checked' : '') + '>' +
    '<span class="switch__track"></span><span class="sr-only">Maintenance mode</span></label></div>' +
    '<div class="field mt-4"><label class="label" for="maintenance-msg">Maintenance message</label>' +
    '<textarea class="textarea" id="maintenance-msg">' + esc(settings.maintenanceMessage) + '</textarea></div>' +
    '<div class="form-grid form-grid--2 mt-4">' +
    '<div class="field"><label class="label" for="default-plan">Default plan for new clients</label>' +
    '<select class="select" id="default-plan">' + store.getAll('plans').map((p) =>
      '<option value="' + p.id + '"' + (settings.defaultPlan === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label class="label" for="expiry-days">Invite expiry (days)</label>' +
    '<input class="input" id="expiry-days" type="number" value="' + settings.inviteExpiryDays + '"></div></div>' +
    '<div class="row mt-6" style="justify-content:flex-end">' +
    '<button class="btn btn--primary" type="button" data-save-platform>Save platform settings</button></div>' +
    '</div></div></div></div><div id="modal-host"></div>');

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

  const renderPreview = () => {
    const subject = host.querySelector('#tpl-subject').value.replace('{{owner_name}}', 'Rohan');
    const body = host.querySelector('#tpl-body').value
      .replace(/\{\{owner_name\}\}/g, 'Rohan')
      .replace(/\{\{restaurant_name\}\}/g, 'Tiffin & Chai')
      .replace(/\{\{plan_name\}\}/g, 'Lifetime Pro')
      .replace(/\{\{invite_link\}\}/g, 'tabletap.demo/auth/accept-invite.html?token=k4x9…')
      .replace(/\{\{expiry_days\}\}/g, '7')
      .replace(/\{\{sender_name\}\}/g, session.name.split(' ')[0]);
    host.querySelector('#tpl-head').textContent = 'To: rohan@tiffinchai.in · Subject: ' + subject;
    host.querySelector('#tpl-preview').innerHTML = body.split('\n').map((line) => line.trim() ? '<p>' + esc(line) + '</p>' : '').join('');
  };

  host.querySelector('#tpl-subject').addEventListener('input', renderPreview);
  host.querySelector('#tpl-body').addEventListener('input', renderPreview);
  renderPreview();

  host.querySelector('[data-save-profile]').addEventListener('click', () => {
    const name = host.querySelector('#admin-name').value.trim();
    store.update('admins', session.id, { name, email: host.querySelector('#admin-email').value });
    session.name = name;
    localStorage.setItem('tqr_session', JSON.stringify(session));
    toast('Profile saved');
    refreshChrome();
  });

  host.querySelector('[data-save-template]').addEventListener('click', () => {
    store.update('settings', settings.id, {
      inviteSubject: host.querySelector('#tpl-subject').value,
      inviteBody: host.querySelector('#tpl-body').value,
    });
    toast('Template saved');
  });

  host.querySelector('[data-save-platform]').addEventListener('click', () => {
    store.update('settings', settings.id, {
      maintenance: host.querySelector('#set-maintenance').checked,
      maintenanceMessage: host.querySelector('#maintenance-msg').value,
      defaultPlan: host.querySelector('#default-plan').value,
      inviteExpiryDays: Number(host.querySelector('#expiry-days').value) || 7,
    });
    store.logActivity({ actor: session.name, type: 'Platform', details: 'Platform settings saved' });
    toast('Platform settings saved');
  });

  const modalHost = host.querySelector('#modal-host');
  host.querySelector('[data-add-admin]').addEventListener('click', () => {
    modalHost.innerHTML = '<div class="modal is-open" role="dialog" aria-modal="true"><div class="modal__dialog">' +
      '<div class="modal__header"><div><p class="modal__title">Add admin</p>' +
      '<p class="muted text-xs">They get an email with a temporary password.</p></div>' +
      '<button class="btn btn--icon" type="button" data-close aria-label="Close"><i data-lucide="x"></i></button></div>' +
      '<div class="modal__body"><div class="field"><label class="label" for="new-admin-name">Full name</label>' +
      '<input class="input" id="new-admin-name" type="text"></div>' +
      '<div class="field"><label class="label" for="new-admin-email">Email</label>' +
      '<input class="input" id="new-admin-email" type="email"></div>' +
      '<div class="field"><label class="label" for="new-admin-role">Role</label>' +
      '<select class="select" id="new-admin-role"><option value="super">Super admin</option><option value="support">Support</option></select>' +
      '<p class="hint">Support can view and edit clients but cannot delete them or change plans.</p></div></div>' +
      '<div class="modal__footer"><button class="btn btn--secondary" type="button" data-close>Cancel</button>' +
      '<button class="btn btn--primary" type="button" data-save>Add admin</button></div></div></div>';
    if (window.lucide) window.lucide.createIcons();
    modalHost.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { modalHost.innerHTML = ''; }));
    modalHost.querySelector('[data-save]').addEventListener('click', () => {
      const name = modalHost.querySelector('#new-admin-name').value.trim();
      const email = modalHost.querySelector('#new-admin-email').value.trim();
      if (!name || !email) return toast('Name and email are required.', 'danger');
      store.insert('admins', {
        name, email, role: modalHost.querySelector('#new-admin-role').value,
        password: 'temp-' + Math.random().toString(36).slice(2, 8),
      });
      store.logActivity({ actor: session.name, type: 'Admin', details: 'Admin added: ' + name });
      modalHost.innerHTML = '';
      toast('Admin added');
      renderSettings();
    });
  });

  host.addEventListener('click', async (event) => {
    const del = event.target.closest('[data-del-admin]');
    if (!del) return;
    if (isSupport) return toast('Support admins cannot manage the admin team.', 'danger');
    const admin = store.getById('admins', del.getAttribute('data-del-admin'));
    const ok = await confirmDialog('Remove ' + admin.name + ' from the admin team?', { confirmLabel: 'Remove admin' });
    if (!ok) return;
    store.remove('admins', admin.id);
    toast('Admin removed');
    renderSettings();
  });
}

/* ------------------------------------------------------------------ boot -- */
const PAGES = {
  dashboard: renderDashboard,
  clients: renderClients,
  'client-detail': renderClientDetail,
  invites: renderInvites,
  activity: renderActivity,
  plans: renderPlans,
  settings: renderSettings,
};

refreshChrome();

const render = PAGES[page];
if (render) {
  try {
    render();
  } catch (err) {
    console.error(err);
    host.innerHTML = '<div class="notice-banner"><i data-lucide="alert-triangle"></i><span>Something went wrong loading this page: ' + esc(err.message) + '</span></div>';
  }
}

/* ==========================================================================
   TableTap — owner.js
   Owner panel: dashboard, live orders, history, menu, tables, staff,
   reports, settings and account. Everything reads and writes store.js.
   ========================================================================== */

import { checkMongoHealth, syncWithMongo, renderMongoSettingsCard, pushOrderToMongo } from './mongo-sync.js';
import { renderSyncDialog, pushToSheet, updateSyncChip, isSyncReady, uploadFileToDrive } from './google-sync.js';
import * as store from './store.js';
import { legacyBreakdown, sessionForTable, sessionOrders, sessionLines, closeSession, openSessionForTable, seatTable } from './store.js';
import { computeBill } from './billing.js';
import { requireRole, currentClient, changePassword, logout, stopImpersonation } from './auth.js';
import { emit, on } from './realtime.js';
import {
  formatMoney, formatDateTime, formatTime, timeAgo, toast, confirmDialog,
  exportCSV, debounce, esc, qs, initials, statusBadge, isToday, openDrawer, closeDrawer,
  renderPaginationHtml,
} from './helpers.js';

const session = requireRole('owner');
const client = currentClient();
const settings = client.settings;
const money = (value) => formatMoney(value, settings.currency);
const page = document.body.getAttribute('data-page');
const host = document.querySelector('.app-shell__content-inner');
const readOnly = !!client.restrictions.readOnly;

function ordersOf() {
  return store.ordersOf(client.id);
}

/* ---------- Notification Popover Implementation ---------- */
function initNotificationDropdown() {
  let bellBtn = document.querySelector('.app-shell__topbar-right button[aria-label*="Notification"]');
  if (!bellBtn) {
    const dot = document.querySelector('.app-shell__topbar-right .count-dot');
    if (dot) bellBtn = dot.closest('button');
  }
  if (!bellBtn) {
    bellBtn = document.querySelector('.app-shell__topbar-right button.btn--icon');
  }
  if (!bellBtn) return;

  // Ensure bellBtn is wrapped in notif-dropdown
  let container = bellBtn.closest('.notif-dropdown');
  if (!container) {
    container = document.createElement('div');
    container.className = 'notif-dropdown';
    bellBtn.parentNode.insertBefore(container, bellBtn);
    container.appendChild(bellBtn);
  }

  // Create or get popover
  let popover = container.querySelector('.notif-popover');
  if (!popover) {
    popover = document.createElement('div');
    popover.className = 'notif-popover';
    popover.id = 'notif-popover-menu';
    container.appendChild(popover);
  }

  function renderNotifItems() {
    const pendingOrders = ordersOf().filter((o) => o.status === 'pending_approval');
    const openCalls = store.query('waiterCalls', (c) => c.clientId === client.id && c.status === 'open');
    const totalCount = pendingOrders.length + openCalls.length;

    const dot = container.querySelector('.count-dot');
    if (dot) {
      dot.textContent = String(totalCount);
      dot.hidden = totalCount === 0;
    }

    let itemsHtml = '';
    pendingOrders.forEach((o) => {
      itemsHtml += '<div class="notif-item">' +
        '<div class="notif-item__icon"><i data-lucide="clock"></i></div>' +
        '<div class="notif-item__content">' +
          '<p class="notif-item__title">Order #' + o.number + ' needs approval</p>' +
          '<p class="notif-item__sub">' + esc(o.tableName) + ' · ' + (o.items || []).length + ' items · ' + money(o.total) + '</p>' +
          '<div class="notif-item__actions">' +
            '<button class="btn btn--primary btn--sm" type="button" data-notif-approve="' + o.id + '">Approve</button>' +
            '<button class="btn btn--secondary btn--sm" type="button" data-notif-reject="' + o.id + '">Reject</button>' +
          '</div>' +
        '</div></div>';
    });

    openCalls.forEach((c) => {
      itemsHtml += '<div class="notif-item">' +
        '<div class="notif-item__icon notif-item__icon--call"><i data-lucide="bell"></i></div>' +
        '<div class="notif-item__content">' +
          '<p class="notif-item__title">' + esc(c.tableName) + ' — ' + (c.type === 'bill' ? 'Bill requested' : 'Waiter call') + '</p>' +
          '<p class="notif-item__sub">' + timeAgo(c.createdAt) + '</p>' +
          '<div class="notif-item__actions">' +
            '<button class="btn btn--secondary btn--sm" type="button" data-notif-call-done="' + c.id + '">Mark Done</button>' +
          '</div>' +
        '</div></div>';
    });

    if (!itemsHtml) {
      itemsHtml = '<div class="notif-popover__empty"><p>No pending alerts. All orders and tables are up to date!</p></div>';
    }

    popover.innerHTML =
      '<div class="notif-popover__header">' +
        '<span class="notif-popover__title">Notifications <span class="badge badge--neutral">' + totalCount + '</span></span>' +
        (totalCount > 0 ? '<button class="btn btn--sm text-xs" type="button" id="notif-clear-all">Approve all</button>' : '') +
      '</div>' +
      '<div class="notif-popover__body">' + itemsHtml + '</div>';

    if (window.lucide) window.lucide.createIcons();

    // Wire actions
    popover.querySelectorAll('[data-notif-approve]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const ordId = b.getAttribute('data-notif-approve');
        store.update('orders', ordId, { status: 'preparing' });
        emit('order:update', { id: ordId, status: 'preparing' });
        toast('Order approved and sent to kitchen pass', 'success');
        refreshChrome();
        renderNotifItems();
        if (typeof render === 'function') render();
      });
    });

    popover.querySelectorAll('[data-notif-reject]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const ordId = b.getAttribute('data-notif-reject');
        store.update('orders', ordId, { status: 'rejected' });
        emit('order:update', { id: ordId, status: 'rejected' });
        toast('Order rejected', 'warning');
        refreshChrome();
        renderNotifItems();
        if (typeof render === 'function') render();
      });
    });

    popover.querySelectorAll('[data-notif-call-done]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const callId = b.getAttribute('data-notif-call-done');
        store.update('waiterCalls', callId, { status: 'resolved' });
        emit('call:done', { id: callId });
        toast('Call marked as handled', 'neutral');
        refreshChrome();
        renderNotifItems();
      });
    });

    const clearAllBtn = popover.querySelector('#notif-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingOrders.forEach((o) => {
          store.update('orders', o.id, { status: 'preparing' });
          emit('order:update', { id: o.id, status: 'preparing' });
        });
        toast('All pending orders approved!', 'success');
        refreshChrome();
        renderNotifItems();
        if (typeof render === 'function') render();
      });
    }
  }

  bellBtn.onclick = (e) => {
    e.stopPropagation();
    const open = popover.classList.toggle('is-open');
    if (open) renderNotifItems();
  };

  if (!window._notifClickBound) {
    window._notifClickBound = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.notif-popover.is-open').forEach((p) => {
        if (!p.closest('.notif-dropdown')?.contains(e.target)) {
          p.classList.remove('is-open');
        }
      });
    });
  }

  renderNotifItems();
}

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

function breakdownOf(order) {
  return order.breakdown || legacyBreakdown(order, settings);
}

function taxText(b) {
  const parts = (b.taxes || []).map((t) => t.name + ' ' + t.rate + '%: ' + t.amount.toFixed(2));
  const inside = (b.includedTaxes || []).map((t) => t.name + ' ' + t.rate + '%: ' + t.amount.toFixed(2) + ' (included)');
  return parts.concat(inside).join('; ');
}

function chargeText(b) {
  return (b.charges || []).map((c) => c.name + (c.type === 'percent' ? ' ' + c.value + '%' : ' fixed') + ': ' + c.amount.toFixed(2)).join('; ');
}

function breakdownHtml(order) {
  const b = breakdownOf(order);
  const rows = ['<div class="summary__row"><span>Subtotal</span><span>' + money(b.subtotal) + '</span></div>'];

  if (!b.pricesIncludeTax) {
    (b.taxes || []).forEach((t) => rows.push(
      '<div class="summary__row"><span>' + esc(t.name) + ' ' + t.rate + '%</span><span>' + money(t.amount) + '</span></div>'));
  }
  (b.charges || []).forEach((c) => rows.push(
    '<div class="summary__row"><span>' + esc(c.name) + (c.type === 'percent' ? ' ' + c.value + '%' : '') + '</span><span>' + money(c.amount) + '</span></div>'));

  rows.push('<div class="summary__row summary__row--total"><span>Total</span><span>' + money(b.total) + '</span></div>');

  if (b.pricesIncludeTax) {
    (b.includedTaxes || []).forEach((t) => rows.push(
      '<p class="summary__note">Includes ' + esc(t.name) + ' ' + t.rate + '%: ' + money(t.amount) + '</p>'));
  }
  return '<div class="summary">' + rows.join('') + '</div>';
}

function refreshChrome() {
  initNotificationDropdown();
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

function payMethodName(id) {
  const hit = (settings.paymentMethods || []).find((m) => m.id === id);
  if (hit) return hit.name;
  return id ? id[0].toUpperCase() + id.slice(1) : 'Other';
}

function guestPayLine(call) {
  let methodId = call && call.paymentMethod;
  if (!methodId && call && call.sessionId) {
    const session = store.getById('sessions', call.sessionId);
    if (session) methodId = session.paymentMethod;
  }
  if (!methodId) return '';
  const name = payMethodName(methodId);
  return 'Guest will pay by ' + name + ' — ' + (methodId === 'card' ? 'bring card machine' : 'bring the bill');
}

/* ------------------------------------------------------------ bill modal -- */
function openBillModal(sessionId, onDone) {
  let session = store.getById('sessions', sessionId);
  if (!session) return;

  const hostEl = document.createElement('div');
  hostEl.id = 'bill-modal-host';
  document.body.appendChild(hostEl);

  function close() {
    hostEl.remove();
  }

  function draw() {
    session = store.getById('sessions', sessionId) || session;
    const orders = sessionOrders(session);
    const bill = computeBill({
      lines: sessionLines(session),
      settings,
      removedChargeIds: session.removedChargeIds,
      addedChargeIds: session.addedChargeIds,
      discount: session.discount,
      tip: session.tip,
    });

    const orderRows = orders.map((order) =>
      '<div class="status-item"><span><span class="status-item__qty">#' + order.number + '</span> ' +
      order.items.map((i) => i.qty + '× ' + esc(i.name)).join(', ') + '</span>' +
      '<span class="status-item__price">' + money(order.total) + '</span></div>').join('');

    const rows = ['<div class="summary__row"><span>Subtotal</span><span>' + money(bill.subtotal) + '</span></div>'];
    if (bill.discount.amount > 0) {
      rows.push('<div class="summary__row"><span>Discount' + (bill.discount.reason ? ' <span class="muted">· ' + esc(bill.discount.reason) + '</span>' : '') + '</span><span>−' + money(bill.discount.amount) + '</span></div>');
    }
    bill.charges.forEach((c) => rows.push('<div class="summary__row"><span>' + esc(c.name) + '</span><span>' + money(c.amount) + '</span></div>'));
    bill.taxes.forEach((t) => rows.push('<div class="summary__row"><span>' + esc(t.name) + ' ' + t.rate + '%</span><span>' + money(t.amount) + '</span></div>'));
    if (bill.tip.amount > 0) rows.push('<div class="summary__row"><span>Tip</span><span>' + money(bill.tip.amount) + '</span></div>');
    rows.push('<div class="summary__row summary__row--total"><span>Total</span><span>' + money(bill.total) + '</span></div>');
    bill.includedTaxes.forEach((t) => rows.push('<p class="summary__note">Includes ' + esc(t.name) + ' ' + t.rate + '%: ' + money(t.amount) + '</p>'));

    hostEl.innerHTML =
      '<div class="modal is-open" role="dialog" aria-modal="true" aria-labelledby="bill-title"><div class="modal__dialog">' +
      '<div class="modal__header"><div><p class="modal__title" id="bill-title">Bill · ' + esc(session.tableName) + '</p>' +
      '<p class="muted text-xs">' + orders.length + (orders.length === 1 ? ' order' : ' orders') + ' · opened ' + formatTime(session.openedAt) + '</p></div>' +
      '<button class="btn btn--icon" type="button" data-close aria-label="Close"><i data-lucide="x"></i></button></div>' +
      '<div class="modal__body">' +
      '<div class="status-items">' + (orderRows || '<p class="muted text-sm">No orders on this table yet.</p>') + '</div>' +
      '<div class="summary mt-4">' + rows.join('') + '</div>' +
      '<div class="bill-discount mt-6"><p class="label">Add discount</p>' +
      '<div class="row row--wrap"><select class="select" id="discount-type" style="width:110px"><option value="percent">%</option><option value="amount">Amount</option></select>' +
      '<input class="input" id="discount-value" type="number" min="0" step="0.5" placeholder="0" style="width:110px" value="' + (session.discount && session.discount.value ? session.discount.value : '') + '">' +
      '<input class="input" id="discount-reason" type="text" placeholder="Reason (e.g. staff meal)" value="' + esc((session.discount && session.discount.reason) || '') + '">' +
      '<button class="btn btn--secondary" type="button" data-apply-discount>Apply</button></div></div>' +
      '<div class="mt-5">' +
      '<button class="btn btn--primary btn--block btn--lg" id="btn-open-terminal" type="button" style="background:#059669; border-color:#059669; font-weight:700; height:48px; display:flex; align-items:center; justify-content:center; gap:8px;">' +
      '<i data-lucide="credit-card"></i> Take Payment / Collect Now (' + money(bill.total) + ')</button>' +
      '</div>' +
      '<p class="label mt-4">Quick Settle</p>' +
      (session.paymentMethod ? '<div class="notice-banner"><i data-lucide="wallet"></i><span>' + esc(guestPayLine({ sessionId: session.id, paymentMethod: session.paymentMethod })) + '</span></div>' : '') +
      '<div class="row row--wrap mt-2">' +
      (settings.paymentMethods || []).filter((m) => m.enabled).map((m) =>
        '<button class="btn ' + (m.id === session.paymentMethod ? 'btn--primary' : 'btn--secondary') +
        '" type="button" data-pay="' + m.id + '">' + esc(m.name) + '</button>').join('') +
      '</div><p class="hint">Paying closes the session and frees ' + esc(session.tableName) + '.</p>' +
      '</div></div></div>';

    if (window.lucide) window.lucide.createIcons();

    hostEl.querySelector('[data-close]').addEventListener('click', close);
    hostEl.querySelector('.modal').addEventListener('click', (event) => { if (event.target.classList.contains('modal')) close(); });
    hostEl.querySelector('#discount-type').value = (session.discount && session.discount.type) || 'percent';

    const openTerminalBtn = hostEl.querySelector('#btn-open-terminal');
    if (openTerminalBtn) {
      openTerminalBtn.addEventListener('click', () => {
        close();
        openTakePaymentModal(sessionId, onDone);
      });
    }

    hostEl.querySelector('[data-apply-discount]').addEventListener('click', () => {
      const type = hostEl.querySelector('#discount-type').value;
      const value = Number(hostEl.querySelector('#discount-value').value) || 0;
      const reason = hostEl.querySelector('#discount-reason').value.trim();
      store.update('sessions', sessionId, { discount: { type, value, reason } });
      store.logActivity({ actor: session.name || 'Owner', clientId: client.id, type: 'Discount', details: 'Discount ' + (type === 'percent' ? value + '%' : money(value)) + ' on ' + session.tableName });
      toast('Discount applied');
      draw();
    });

    hostEl.querySelectorAll('[data-pay]').forEach((btn) => btn.addEventListener('click', () => {
      const method = btn.getAttribute('data-pay');
      const finalBill = computeBill({
        lines: sessionLines(session),
        settings,
        removedChargeIds: session.removedChargeIds,
        addedChargeIds: session.addedChargeIds,
        discount: session.discount,
        tip: session.tip,
      });
      closeSession(sessionId, { method, at: new Date().toISOString(), amount: finalBill.total }, finalBill);
      store.logActivity({
        actor: session.name || 'Owner',
        clientId: client.id,
        type: 'Payment',
        details: session.tableName + ' paid by ' + method + ' · ' + money(finalBill.total),
      });
      emit('order:update', { clientId: client.id });
      emit('session:paid', { clientId: client.id, sessionId });
      emit('session:close', { clientId: client.id, sessionId, tableId: session.tableId });
      toast(session.tableName + ' paid by ' + method + ' · ' + money(finalBill.total));
      close();
      if (onDone) onDone();
      else if (page === 'orders') renderOrders();
      else if (page === 'tables') renderTables();
    }));
  }

  draw();
}

/* ----------------------------------------------------- take payment modal -- */
function openTakePaymentModal(sessionId, onDone) {
  let session = store.getById('sessions', sessionId);
  if (!session) return;

  const hostEl = document.createElement('div');
  hostEl.id = 'take-payment-host';
  document.body.appendChild(hostEl);

  function close() {
    hostEl.remove();
  }

  let selectedTab = 'apple_pay';
  let tipPercent = 0;
  let customTipAmount = 0;
  let cashTendered = 0;
  let isCompleted = false;

  function draw() {
    session = store.getById('sessions', sessionId) || session;
    const orders = sessionOrders(session);
    const subtotalLines = sessionLines(session);

    let tipObj = session.tip || { type: 'percent', value: 0, amount: 0 };
    if (tipPercent > 0) {
      const sub = subtotalLines.reduce((acc, l) => acc + (l.price * l.qty), 0);
      tipObj = { type: 'percent', value: tipPercent, amount: Math.round(sub * (tipPercent / 100) * 100) / 100 };
    } else if (customTipAmount > 0) {
      tipObj = { type: 'amount', value: customTipAmount, amount: customTipAmount };
    }

    const bill = computeBill({
      lines: subtotalLines,
      settings,
      removedChargeIds: session.removedChargeIds,
      addedChargeIds: session.addedChargeIds,
      discount: session.discount,
      tip: tipObj,
    });

    const changeDue = Math.max(0, cashTendered - bill.total);

    if (isCompleted) {
      hostEl.innerHTML =
        '<div class="modal is-open" role="dialog" aria-modal="true">' +
        '<div class="modal__dialog" style="max-width:440px;text-align:center;">' +
        '<div style="font-size:3rem;margin-bottom:0.5rem;">🎉</div>' +
        '<h2 style="font-size:1.4rem;font-weight:800;color:#059669;margin-bottom:0.25rem;">Payment Successful!</h2>' +
        '<p class="muted text-sm mb-4">Table ' + esc(session.tableName) + ' is marked clean &amp; free.</p>' +
        '<div style="background:var(--surface-2, #F8F6F1);border-radius:12px;padding:1.25rem;text-align:left;font-size:0.88rem;margin-bottom:1.5rem;border:1px dashed var(--border, rgba(0,0,0,0.15));font-family:var(--font-mono);">' +
        '<div style="text-align:center;font-weight:700;font-size:1rem;margin-bottom:4px;">' + esc(client.name) + '</div>' +
        '<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;margin-bottom:12px;">RECEIPT #' + Math.floor(100000 + Math.random() * 900000) + ' · ' + new Date().toLocaleTimeString() + '</div>' +
        '<div style="border-top:1px dashed rgba(0,0,0,0.1);padding-top:8px;margin-bottom:6px;">' +
        orders.map((o) => o.items.map((i) => '<div style="display:flex;justify-content:space-between;"><span>' + i.qty + '× ' + esc(i.name) + '</span><span>' + money(i.price * i.qty) + '</span></div>').join('')).join('') +
        '</div><div style="border-top:1px solid rgba(0,0,0,0.1);padding-top:6px;margin-top:6px;">' +
        '<div style="display:flex;justify-content:space-between;"><span>Subtotal:</span><span>' + money(bill.subtotal) + '</span></div>' +
        bill.taxes.map((t) => '<div style="display:flex;justify-content:space-between;color:var(--text-muted);"><span>' + esc(t.name) + ' ' + t.rate + '%:</span><span>' + money(t.amount) + '</span></div>').join('') +
        (bill.tip.amount > 0 ? '<div style="display:flex;justify-content:space-between;color:var(--text-muted);"><span>Tip:</span><span>' + money(bill.tip.amount) + '</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.05rem;margin-top:6px;border-top:1px dashed rgba(0,0,0,0.15);padding-top:6px;">' +
        '<span>TOTAL PAID:</span><span style="color:#059669;">' + money(bill.total) + '</span></div>' +
        '<div style="margin-top:8px;font-size:0.75rem;color:var(--text-muted);text-align:center;">Paid via <strong>' + esc(selectedTab.replace('_', ' ').toUpperCase()) + '</strong> · Auth #' + Math.random().toString(36).slice(2, 8).toUpperCase() + '</div>' +
        '</div></div>' +
        '<div class="row gap-2" style="justify-content:center;">' +
        '<button class="btn btn--secondary" id="btn-print-receipt" type="button"><i data-lucide="printer"></i> Print Receipt</button>' +
        '<button class="btn btn--primary" id="btn-done-payment" type="button" style="background:#059669;border-color:#059669;font-weight:700;">Done</button>' +
        '</div></div></div>';
      if (window.lucide) window.lucide.createIcons();
      hostEl.querySelector('#btn-print-receipt').addEventListener('click', () => window.print());
      hostEl.querySelector('#btn-done-payment').addEventListener('click', () => {
        close();
        if (onDone) onDone();
        else if (page === 'orders') renderOrders();
        else if (page === 'tables') renderTables();
        else if (page === 'dashboard') renderDashboard();
      });
      return;
    }

    let methodHtml = '';
    if (selectedTab === 'apple_pay') {
      methodHtml =
        '<div style="text-align:center;padding:1.25rem 0.5rem;">' +
        '<div style="width:64px;height:64px;background:#000;color:#fff;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;box-shadow:0 0 0 8px rgba(0,0,0,0.06);">' +
        '</div>' +
        '<h4 style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">Tap to Pay on Staff Device</h4>' +
        '<p class="muted text-xs" style="max-width:300px;margin:0 auto 1.25rem;">Ask customer to tap their iPhone, Apple Watch, or Contactless Card against the top of your device.</p>' +
        '<button class="btn btn--primary btn--block btn--lg" id="btn-simulate-tap-pay" type="button" style="background:#000;border-color:#000;height:50px;font-size:1rem;font-weight:700;">' +
        '<span>Tap to Pay (' + money(bill.total) + ')</span></button>' +
        '<p class="hint mt-2 text-xs muted">Simulates NFC Tap to Pay contactless authorization</p></div>';
    } else if (selectedTab === 'google_pay') {
      methodHtml =
        '<div style="text-align:center;padding:1.25rem 0.5rem;">' +
        '<div style="width:64px;height:64px;background:#1F2937;color:#fff;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:800;box-shadow:0 0 0 8px rgba(0,0,0,0.06);">' +
        'GPay</div>' +
        '<h4 style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">Google Pay &amp; Contactless</h4>' +
        '<p class="muted text-xs" style="max-width:300px;margin:0 auto 1.25rem;">Hold customer\'s Android device or Contactless card near reader.</p>' +
        '<button class="btn btn--primary btn--block btn--lg" id="btn-simulate-tap-pay" type="button" style="background:#1F2937;border-color:#1F2937;height:50px;font-size:1rem;font-weight:700;">' +
        '<span>Authorize Google Pay (' + money(bill.total) + ')</span></button></div>';
    } else if (selectedTab === 'card') {
      methodHtml =
        '<div style="padding:1rem 0.25rem;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-2, #F8F6F1);padding:10px 14px;border-radius:10px;margin-bottom:1rem;border:1px solid var(--border, rgba(0,0,0,0.08));">' +
        '<div><div style="font-weight:700;font-size:0.88rem;">POS Reader: Counter Terminal 1</div>' +
        '<div class="muted text-xs">Stripe / Square Terminal · Ready</div></div>' +
        '<span class="badge badge--success" style="font-size:0.75rem;"><span class="dot" style="background:#10B981;"></span> Online</span></div>' +
        '<button class="btn btn--primary btn--block btn--lg" id="btn-send-to-pos" type="button" style="height:50px;font-size:1rem;font-weight:700;margin-bottom:0.75rem;">' +
        'Send ' + money(bill.total) + ' to Card Terminal</button>' +
        '<button class="btn btn--secondary btn--block" id="btn-key-card" type="button" style="font-size:0.85rem;">' +
        'Key in Card Manually (MOTO)</button></div>';
    } else if (selectedTab === 'qr_pay') {
      const qrUrl = encodeURIComponent(window.location.origin + '/menu/bill.html?s=' + session.id);
      methodHtml =
        '<div style="text-align:center;padding:1rem 0.5rem;">' +
        '<h4 style="font-size:1rem;font-weight:700;margin-bottom:4px;">Dynamic Bill QR Code</h4>' +
        '<p class="muted text-xs mb-3">Turn screen toward diner. Scanning lets them pay with Apple Pay, Google Pay, or UPI on their phone.</p>' +
        '<div style="display:inline-block;padding:12px;background:#fff;border-radius:16px;border:2px solid var(--border, rgba(0,0,0,0.15));box-shadow:0 4px 12px rgba(0,0,0,0.05);margin-bottom:1rem;">' +
        '<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&amp;data=' + qrUrl + '" alt="Bill QR" style="width:160px;height:160px;display:block;">' +
        '<div style="font-weight:700;font-size:0.85rem;margin-top:6px;color:var(--primary, #8C3A27);">' + money(bill.total) + '</div></div>' +
        '<button class="btn btn--primary btn--block" id="btn-guest-paid" type="button" style="background:#059669;border-color:#059669;height:46px;font-weight:700;">' +
        '✓ Confirm Guest Paid on Phone</button></div>';
    } else if (selectedTab === 'cash') {
      methodHtml =
        '<div style="padding:0.75rem 0.25rem;">' +
        '<div class="row gap-2 mb-3" style="justify-content:center;">' +
        '<button class="btn btn--secondary btn--sm btn-tender-preset" type="button" data-val="' + bill.total + '">Exact (' + money(bill.total) + ')</button>' +
        '<button class="btn btn--secondary btn--sm btn-tender-preset" type="button" data-val="' + (Math.ceil(bill.total / 10) * 10) + '">$' + (Math.ceil(bill.total / 10) * 10) + '</button>' +
        '<button class="btn btn--secondary btn--sm btn-tender-preset" type="button" data-val="' + (Math.ceil(bill.total / 20) * 20 || 20) + '">$' + (Math.ceil(bill.total / 20) * 20 || 20) + '</button>' +
        '<button class="btn btn--secondary btn--sm btn-tender-preset" type="button" data-val="50">$50</button>' +
        '<button class="btn btn--secondary btn--sm btn-tender-preset" type="button" data-val="100">$100</button>' +
        '</div>' +
        '<div class="field mb-3"><label class="label text-xs">Cash Tendered by Guest</label>' +
        '<input class="input" id="cash-tendered-input" type="number" step="0.5" value="' + (cashTendered || '') + '" placeholder="0.00" style="font-size:1.2rem;font-weight:700;text-align:center;"></div>' +
        '<div style="background:' + (cashTendered >= bill.total && cashTendered > 0 ? '#ECFDF5' : 'var(--surface-2, #F8F6F1)') + ';border:1px solid ' + (cashTendered >= bill.total && cashTendered > 0 ? '#10B981' : 'var(--border, rgba(0,0,0,0.1))') + ';border-radius:10px;padding:10px 14px;text-align:center;margin-bottom:1rem;">' +
        (cashTendered >= bill.total && cashTendered > 0
          ? '<div style="color:#059669;font-size:0.8rem;font-weight:600;text-transform:uppercase;">Change Due to Guest</div><div style="font-size:1.6rem;font-weight:800;color:#059669;">' + money(changeDue) + '</div>'
          : '<div class="muted text-xs">Enter cash received to calculate change due</div><div style="font-size:1.2rem;font-weight:700;color:var(--text);">' + money(bill.total) + ' due</div>') +
        '</div>' +
        '<button class="btn btn--primary btn--block btn--lg" id="btn-collect-cash" type="button" style="background:#059669;border-color:#059669;height:50px;font-size:1rem;font-weight:700;" ' + (cashTendered < bill.total && cashTendered > 0 ? 'disabled' : '') + '>' +
        'Collect Cash &amp; Free Table</button></div>';
    } else {
      methodHtml =
        '<div style="text-align:center;padding:1.25rem 0.5rem;">' +
        '<div style="width:64px;height:64px;background:#003087;color:#fff;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:800;">🅿️</div>' +
        '<h4 style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">PayPal &amp; Venmo</h4>' +
        '<p class="muted text-xs mb-4">Request payment directly to diner\'s PayPal or Venmo account.</p>' +
        '<button class="btn btn--primary btn--block btn--lg" id="btn-simulate-tap-pay" type="button" style="background:#003087;border-color:#003087;height:50px;font-weight:700;">' +
        'Charge ' + money(bill.total) + ' via PayPal / Venmo</button></div>';
    }

    hostEl.innerHTML =
      '<div class="modal is-open" role="dialog" aria-modal="true" aria-labelledby="take-pay-title">' +
      '<div class="modal__dialog" style="max-width:520px;padding:1.5rem;">' +
      '<div class="modal__header" style="margin-bottom:1rem;">' +
      '<div><p class="modal__title" id="take-pay-title" style="font-size:1.2rem;font-weight:800;">Take Payment · ' + esc(session.tableName) + '</p>' +
      '<p class="muted text-xs">' + orders.length + ' order(s) · Opened ' + formatTime(session.openedAt) + '</p></div>' +
      '<button class="btn btn--icon" type="button" data-close aria-label="Close"><i data-lucide="x"></i></button></div>' +

      '<div style="background:linear-gradient(135deg, #1A1A1A 0%, #2D2D2D 100%);color:#fff;border-radius:14px;padding:1rem 1.25rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;box-shadow:0 4px 14px rgba(0,0,0,0.12);">' +
      '<div><span style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.7);font-weight:600;">Total Balance Due</span>' +
      '<div style="font-size:1.8rem;font-weight:800;letter-spacing:-0.5px;color:#fff;">' + money(bill.total) + '</div></div>' +
      '<div style="text-align:right;font-size:0.78rem;color:rgba(255,255,255,0.8);">' +
      '<div>Subtotal: ' + money(bill.subtotal) + '</div>' +
      '<div>Tax: ' + money(bill.taxes.reduce((acc, t) => acc + t.amount, 0)) + '</div>' +
      (bill.tip.amount > 0 ? '<div style="color:#34D399;font-weight:700;">Tip: +' + money(bill.tip.amount) + '</div>' : '') +
      '</div></div>' +

      '<div style="margin-bottom:1.25rem;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '<span class="label text-xs" style="margin:0;">Add Tip</span>' +
      '<span class="muted text-xs">' + (bill.tip.amount > 0 ? money(bill.tip.amount) : 'No tip') + '</span></div>' +
      '<div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;">' +
      '<button type="button" class="btn btn--sm btn-tip-chip ' + (tipPercent === 0 && customTipAmount === 0 ? 'is-active' : 'btn--secondary') + '" data-tip="0">No Tip</button>' +
      '<button type="button" class="btn btn--sm btn-tip-chip ' + (tipPercent === 10 ? 'is-active' : 'btn--secondary') + '" data-tip="10">10%</button>' +
      '<button type="button" class="btn btn--sm btn-tip-chip ' + (tipPercent === 15 ? 'is-active' : 'btn--secondary') + '" data-tip="15">15%</button>' +
      '<button type="button" class="btn btn--sm btn-tip-chip ' + (tipPercent === 20 ? 'is-active' : 'btn--secondary') + '" data-tip="20">20%</button>' +
      '</div></div>' +

      '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:1rem;border-bottom:1px solid var(--border, rgba(0,0,0,0.08));">' +
      '<button type="button" class="btn btn--sm btn-method-tab ' + (selectedTab === 'apple_pay' ? 'btn--primary' : 'btn--secondary') + '" data-tab="apple_pay" style="white-space:nowrap;">🍏 Apple Pay</button>' +
      '<button type="button" class="btn btn--sm btn-method-tab ' + (selectedTab === 'google_pay' ? 'btn--primary' : 'btn--secondary') + '" data-tab="google_pay" style="white-space:nowrap;">🌐 Google Pay</button>' +
      '<button type="button" class="btn btn--sm btn-method-tab ' + (selectedTab === 'card' ? 'btn--primary' : 'btn--secondary') + '" data-tab="card" style="white-space:nowrap;">💳 Card Terminal</button>' +
      '<button type="button" class="btn btn--sm btn-method-tab ' + (selectedTab === 'qr_pay' ? 'btn--primary' : 'btn--secondary') + '" data-tab="qr_pay" style="white-space:nowrap;">📱 Dynamic QR</button>' +
      '<button type="button" class="btn btn--sm btn-method-tab ' + (selectedTab === 'cash' ? 'btn--primary' : 'btn--secondary') + '" data-tab="cash" style="white-space:nowrap;">💵 Cash</button>' +
      '<button type="button" class="btn btn--sm btn-method-tab ' + (selectedTab === 'paypal' ? 'btn--primary' : 'btn--secondary') + '" data-tab="paypal" style="white-space:nowrap;">🅿️ PayPal</button>' +
      '</div>' +

      '<div style="background:#fff;border:1px solid var(--border, rgba(0,0,0,0.1));border-radius:12px;padding:1rem;margin-bottom:1rem;">' +
      methodHtml + '</div>' +
      '</div></div>';

    if (window.lucide) window.lucide.createIcons();
    hostEl.querySelector('[data-close]').addEventListener('click', close);

    hostEl.querySelectorAll('.btn-tip-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        tipPercent = Number(btn.getAttribute('data-tip')) || 0;
        customTipAmount = 0;
        draw();
      });
    });

    hostEl.querySelectorAll('.btn-method-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedTab = btn.getAttribute('data-tab');
        draw();
      });
    });

    hostEl.querySelectorAll('.btn-tender-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        cashTendered = Number(btn.getAttribute('data-val')) || 0;
        draw();
      });
    });

    const cashInput = hostEl.querySelector('#cash-tendered-input');
    if (cashInput) {
      cashInput.addEventListener('input', (e) => {
        cashTendered = Number(e.target.value) || 0;
      });
      cashInput.addEventListener('change', (e) => {
        cashTendered = Number(e.target.value) || 0;
        draw();
      });
    }

    function processPayment(methodName) {
      const finalBill = computeBill({
        lines: subtotalLines,
        settings,
        removedChargeIds: session.removedChargeIds,
        addedChargeIds: session.addedChargeIds,
        discount: session.discount,
        tip: tipObj,
      });

      const paymentRecord = {
        method: methodName,
        at: new Date().toISOString(),
        amount: finalBill.total,
        tip: tipObj.amount,
        cashTendered: selectedTab === 'cash' ? cashTendered : finalBill.total,
        changeDue: selectedTab === 'cash' ? changeDue : 0,
        txnId: (selectedTab === 'apple_pay' ? 'APL_' : selectedTab === 'card' ? 'CRD_' : selectedTab === 'cash' ? 'CSH_' : 'TXN_') + Math.random().toString(36).slice(2, 8).toUpperCase(),
        cashier: (session && session.name) || 'Staff',
      };

      closeSession(sessionId, paymentRecord, finalBill);
      store.logActivity({
        actor: session.name || 'Owner',
        clientId: client.id,
        type: 'Payment',
        details: session.tableName + ' paid ' + money(finalBill.total) + ' via ' + methodName,
      });
      emit('order:update', { clientId: client.id });
      emit('session:paid', { clientId: client.id, sessionId });
      emit('session:close', { clientId: client.id, sessionId, tableId: session.tableId });
      toast(session.tableName + ' paid ' + money(finalBill.total) + ' via ' + methodName);

      isCompleted = true;
      draw();
    }

    const tapPayBtn = hostEl.querySelector('#btn-simulate-tap-pay');
    if (tapPayBtn) {
      tapPayBtn.addEventListener('click', () => {
        tapPayBtn.disabled = true;
        tapPayBtn.innerHTML = '<span><span class="dot" style="background:#fff;width:8px;height:8px;border-radius:50%;display:inline-block;animation:pulse 0.6s infinite alternate;margin-right:6px;"></span> Reading NFC…</span>';
        setTimeout(() => {
          tapPayBtn.innerHTML = '<span style="color:#10B981;">✓ Approved!</span>';
          setTimeout(() => processPayment(selectedTab === 'apple_pay' ? 'Apple Pay (Tap to Pay)' : selectedTab === 'google_pay' ? 'Google Pay' : 'PayPal / Venmo'), 400);
        }, 600);
      });
    }

    const posBtn = hostEl.querySelector('#btn-send-to-pos');
    if (posBtn) {
      posBtn.addEventListener('click', () => {
        posBtn.disabled = true;
        posBtn.innerHTML = '<span><span class="dot" style="background:#fff;width:8px;height:8px;border-radius:50%;display:inline-block;animation:pulse 0.6s infinite alternate;margin-right:6px;"></span> Waiting for terminal tap…</span>';
        setTimeout(() => {
          posBtn.innerHTML = '<span style="color:#10B981;">✓ Card Approved!</span>';
          setTimeout(() => processPayment('Card Terminal (Stripe / Square POS)'), 400);
        }, 700);
      });
    }

    const keyCardBtn = hostEl.querySelector('#btn-key-card');
    if (keyCardBtn) {
      keyCardBtn.addEventListener('click', () => {
        processPayment('Manual Card Entry (Keyed)');
      });
    }

    const guestPaidBtn = hostEl.querySelector('#btn-guest-paid');
    if (guestPaidBtn) {
      guestPaidBtn.addEventListener('click', () => {
        processPayment('Mobile Bill QR Pay');
      });
    }

    const collectCashBtn = hostEl.querySelector('#btn-collect-cash');
    if (collectCashBtn) {
      collectCashBtn.addEventListener('click', () => {
        processPayment('Cash');
      });
    }
  }

  draw();
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
  const greeting = nowHour < 12 ? 'Good morning' : (nowHour < 17 ? 'Good afternoon' : 'Good evening');
  const hours = Array.from({ length: 11 }, (_, i) => (nowHour - 10 + i + 24) % 24);
  const counts = hours.map((h) => today.filter((o) => new Date(o.createdAt).getHours() === h).length);
  const maxCount = Math.max(1, ...counts);

  // Dynamic comparison vs yesterday
  const yesterdayDate = new Date(Date.now() - 86400000);
  const yesterday = orders.filter((o) => new Date(o.createdAt).toDateString() === yesterdayDate.toDateString());
  const yestRevenue = yesterday.filter((o) => o.status !== 'rejected').reduce((sum, o) => sum + o.total, 0);

  let ordersDelta = '';
  let ordersDir = 'up';
  if (yesterday.length > 0) {
    const diff = Math.round(((today.length - yesterday.length) / yesterday.length) * 100);
    ordersDelta = (diff >= 0 ? '+' : '') + diff + '%';
    ordersDir = diff >= 0 ? 'up' : 'down';
  } else if (today.length > 0) {
    ordersDelta = '+' + today.length + ' orders';
  }

  let revDelta = '';
  let revDir = 'up';
  if (yestRevenue > 0) {
    const diff = Math.round(((revenue - yestRevenue) / yestRevenue) * 100);
    revDelta = (diff >= 0 ? '+' : '') + diff + '%';
    revDir = diff >= 0 ? 'up' : 'down';
  } else if (revenue > 0) {
    revDelta = '+' + money(revenue);
  }

  paint(head(greeting + ', ' + session.name.split(' ')[0],
    'Here is how ' + client.name + ' is doing today, ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '.',
    '<a class="btn btn--secondary btn--sm" href="reports.html"><i data-lucide="trending-up"></i> Reports</a>' +
    '<a class="btn btn--primary btn--sm" href="orders.html"><i data-lucide="receipt"></i> View live orders</a>') +
    '<div class="stat-grid">' +
    statCard("Today's orders", String(today.length), 'vs yesterday', ordersDelta, ordersDir) +
    statCard("Today's revenue", money(revenue), 'vs yesterday', revDelta, revDir) +
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
      '<p class="list-row__meta">' + (call.type === 'bill'
        ? 'Bill · ' + (guestPayLine(call) || 'Bill requested')
        : 'Call waiter') + ' · ' + timeAgo(call.createdAt) + '</p></div>' +
      '<div class="list-row__side">' +
      (call.type === 'bill' && call.sessionId ? '<button class="btn btn--sm" style="background:#059669; color:#fff; border-color:#059669; margin-right:6px;" type="button" data-take-pay="' + call.sessionId + '"><i data-lucide="credit-card"></i> Take Payment</button>' : '') +
      '<button class="btn btn--secondary btn--sm" type="button" data-done-call="' + call.id + '">Done</button></div></div>').join('')
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

  host.querySelectorAll('[data-take-pay]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openTakePaymentModal(btn.getAttribute('data-take-pay'), () => {
        renderDashboard();
        refreshChrome();
      });
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
    '<div class="row gap-2">' +
    '<button class="btn btn--secondary btn--sm" type="button" data-export-live><i data-lucide="download"></i> Export CSV</button>' +
    '<button class="btn btn--secondary btn--sm" type="button" data-print><i data-lucide="printer"></i> Print all</button>' +
    '</div>') +
    '<div class="tabs" data-tabs><div class="tabs__list" role="tablist" aria-label="Order status">' +
    tabs.map(([key, label, count], i) =>
      '<button class="tab" role="tab" type="button" data-tab="' + key + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' +
      label + ' <span class="muted">(' + count + ')</span></button>').join('') +
    '</div><div class="tab-panel" role="tabpanel"><div class="card"><div class="card__body" id="order-cards"></div>' +
    '<div class="row row--between mt-4" id="order-pagination-row" style="padding:0 var(--s-6) var(--s-4);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
    '<span class="muted text-xs" id="order-count-text"></span>' +
    '<nav class="pagination" id="order-pages" aria-label="Order pages"></nav></div>' +
    '</div>' +
    '<div class="card mt-6"><div class="card__header"><span class="card__title">Waiter calls &amp; bill requests</span>' +
    '<span class="badge badge--warning">' + calls.length + ' open</span></div><div class="card__body">' +
    (calls.length ? calls.map((call) =>
      '<div class="list-row"><div class="list-row__main"><p class="list-row__title">' + esc(call.tableName) + '</p>' +
      '<p class="list-row__meta">' + (call.type === 'bill'
        ? 'Bill · ' + (guestPayLine(call) || 'Bill requested')
        : 'Call waiter') + ' · ' + timeAgo(call.createdAt) + '</p></div>' +
      '<div class="list-row__side"><button class="btn btn--secondary btn--sm" type="button" data-done-call="' + call.id + '">Done</button></div></div>').join('')
      : '<p class="muted text-sm">No open calls.</p>') +
    '</div></div></div></div><div id="drawer-host"></div>');

  const cardsHost = host.querySelector('#order-cards');
  const countText = host.querySelector('#order-count-text');
  const pagesHost = host.querySelector('#order-pages');

  let pageNo = 1;
  const perPage = 10;

  function draw() {
    const rows = ordersOf().filter((o) => active === 'all' ? true : o.status === active);
    const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
    pageNo = Math.min(pageNo, totalPages);
    const slice = rows.slice((pageNo - 1) * perPage, pageNo * perPage);

    if (countText) {
      countText.textContent = rows.length
        ? 'Showing ' + ((pageNo - 1) * perPage + 1) + '–' + Math.min(pageNo * perPage, rows.length) + ' of ' + rows.length + ' orders'
        : '0 orders';
    }
    if (pagesHost) {
      pagesHost.innerHTML = renderPaginationHtml(pageNo, totalPages);
    }

    cardsHost.innerHTML = slice.length ? slice.map((order) => {
      const session = order.sessionId ? store.getById('sessions', order.sessionId) : sessionForTable(client.id, order.tableId);
      const isPaid = order.paid || (session && session.status === 'paid');
      const payBadge = isPaid
        ? '<span class="badge badge--success" style="font-size:0.72rem; padding:2px 7px;"><span class="dot" style="background:#10B981;"></span> Paid</span>'
        : '<span class="badge badge--warning" style="font-size:0.72rem; padding:2px 7px;">Unpaid</span>';
      const takePayBtn = (!isPaid && session && session.status === 'open')
        ? '<button class="btn btn--sm" style="background:#059669; color:#fff; border-color:#059669;" type="button" data-take-pay="' + session.id + '"><i data-lucide="credit-card"></i> Take Payment</button>' : '';
      const billBtn = session && session.status === 'open'
        ? '<button class="btn btn--secondary btn--sm" type="button" data-bill="' + session.id + '">View bill</button>' : '';
      return '<div class="order-card"><div><p class="order-card__id">#' + order.number + ' ' + statusBadge(order.status) + ' ' + payBadge + '</p>' +
        '<p class="order-card__meta">' + esc(order.tableName) + ' · ' + order.items.length + ' items · ' + timeAgo(order.createdAt) + '</p></div>' +
        '<div class="order-card__side"><span class="order-card__total">' + money(order.total) + '</span>' + takePayBtn + billBtn +
        '<button class="btn btn--secondary btn--sm" type="button" data-open="' + order.id + '">Details</button>' +
        '<button class="btn btn--primary btn--sm" type="button" data-next="' + order.id + '">' + nextLabel(order) + '</button></div></div>';
    }).join('')
      : '<div class="empty"><span class="empty__icon"><i data-lucide="receipt"></i></span><p class="empty__title">Nothing here</p>' +
        '<p class="empty__text">No orders in this state right now.</p></div>';
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
    pageNo = 1;
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
    const billBtn = event.target.closest('[data-bill]');
    if (billBtn) openBillModal(billBtn.getAttribute('data-bill'));
    const takePayBtn = event.target.closest('[data-take-pay]');
    if (takePayBtn) openTakePaymentModal(takePayBtn.getAttribute('data-take-pay'), () => draw());
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
      breakdownHtml(order) +
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

  const exportLiveBtn = host.querySelector('[data-export-live]');
  if (exportLiveBtn) {
    exportLiveBtn.addEventListener('click', () => {
      const rows = ordersOf().filter((o) => active === 'all' ? true : o.status === active);
      const csv = [['Order #', 'Date', 'Table', 'Items', 'Subtotal', 'Taxes', 'Charges', 'Total', 'Status']].concat(
        rows.map((o) => {
          const b = breakdownOf(o);
          return ['#' + o.number, formatDateTime(o.createdAt), o.tableName, o.items.length,
            b.subtotal.toFixed(2), taxText(b), chargeText(b), b.total.toFixed(2), o.status];
        })
      );
      exportCSV(csv, client.slug + '-live-orders.csv');
      toast('Live orders exported as CSV');
    });
  }

  const printBtn = host.querySelector('[data-print]');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

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
    '<th scope="col" class="table__num">Total</th><th scope="col">Status</th><th scope="col"></th></tr></thead>' +
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

    rowsHost.innerHTML = slice.length ? slice.map((order) => {
      const session = order.sessionId ? store.getById('sessions', order.sessionId) : null;
      const receipt = session && session.status === 'paid'
        ? '<a class="card__link" href="receipt.html?session=' + session.id + '">Receipt</a>'
        : (session && session.status === 'open' ? '<button class="card__link" type="button" data-bill="' + session.id + '">View bill</button>' : '');
      return '<tr><td data-label="Order" class="table__strong">#' + order.number + '</td>' +
        '<td data-label="Date/time">' + formatDateTime(order.createdAt) + '</td>' +
        '<td data-label="Table">' + esc(order.tableName) + '</td>' +
        '<td data-label="Items">' + order.items.length + '</td>' +
        '<td data-label="Total" class="table__num">' + money(order.total) + '</td>' +
        '<td data-label="Status">' + statusBadge(order.status) + '</td>' +
        '<td data-label="">' + receipt + '</td></tr>';
    }).join('')
      : '<tr><td colspan="6"><div class="empty"><span class="empty__icon"><i data-lucide="history"></i></span>' +
        '<p class="empty__title">No orders match those filters</p></div></td></tr>';

    countHost.textContent = rows.length
      ? 'Showing ' + ((pageNo - 1) * perPage + 1) + '–' + Math.min(pageNo * perPage, rows.length) + ' of ' + rows.length
      : 'No orders';

    pagesHost.innerHTML = renderPaginationHtml(pageNo, pages);

    if (window.lucide) window.lucide.createIcons();
  }

  pagesHost.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn || btn.classList.contains('page--disabled') || btn.disabled) return;
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

  rowsHost.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-bill]');
    if (btn) openBillModal(btn.getAttribute('data-bill'), () => renderHistory());
  });

  host.querySelector('[data-export]').addEventListener('click', () => {
    const rows = [['Order #', 'Date', 'Table', 'Items', 'Subtotal', 'Taxes', 'Charges', 'Total', 'Status']].concat(
      filtered().map((o) => {
        const b = breakdownOf(o);
        return ['#' + o.number, formatDateTime(o.createdAt), o.tableName, o.items.length,
          b.subtotal.toFixed(2), taxText(b), chargeText(b), b.total.toFixed(2), o.status];
      })
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
    '<div class="row row--between mt-3" id="menu-pagination-row" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:0.75rem;">' +
    '<span class="muted text-xs" id="item-count-text"></span>' +
    '<nav class="pagination" id="item-pages" aria-label="Menu item pages"></nav></div>' +
    '<a class="btn btn--secondary btn--block mt-4" href="menu-item.html"><i data-lucide="plus"></i> Add item</a></div></div></div>');

  const catList = host.querySelector('#cat-list');
  const itemList = host.querySelector('#item-list');
  const itemPages = host.querySelector('#item-pages');
  const countText = host.querySelector('#item-count-text');

  let itemPage = 1;
  const itemsPerPage = 8;

  function drawCats() {
    const cats = store.categoriesOf(client.id);
    catList.innerHTML = cats.map((cat, index) =>
      '<div class="cat-item' + (cat.id === selectedCat?.id ? ' cat-item--active' : '') + '" data-cat="' + cat.id + '">' +
      '<div><p class="cat-item__name">' + esc(cat.name) + '</p>' +
      '<p class="cat-item__count">' + store.query('items', (i) => i.categoryId === cat.id).length + ' items</p>' +
      '<select class="select cat-tax" data-cat-tax="' + cat.id + '" aria-label="Tax override for ' + esc(cat.name) + '">' +
      '<option value="default"' + (!cat.taxOverride || cat.taxOverride === 'default' ? ' selected' : '') + '>Tax: default</option>' +
      '<option value="none"' + (cat.taxOverride === 'none' ? ' selected' : '') + '>Tax: none</option>' +
      (settings.taxes || []).filter((t) => t.enabled).map((t) =>
        '<option value="' + t.id + '"' + (cat.taxOverride === t.id ? ' selected' : '') + '>Tax: ' + esc(t.name) + '</option>').join('') +
      '</select></div>' +
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
      if (itemPages) itemPages.innerHTML = '';
      if (countText) countText.textContent = '';
      return;
    }
    host.querySelector('#cat-title').textContent = selectedCat.name;
    const items = store.query('items', (i) => i.categoryId === selectedCat.id && (!term || i.name.toLowerCase().includes(term)));
    host.querySelector('#cat-badge').textContent = items.length + ' items';

    const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
    itemPage = Math.min(itemPage, totalPages);
    const slice = items.slice((itemPage - 1) * itemsPerPage, itemPage * itemsPerPage);

    if (countText) {
      countText.textContent = items.length > itemsPerPage
        ? 'Showing ' + ((itemPage - 1) * itemsPerPage + 1) + '–' + Math.min(itemPage * itemsPerPage, items.length) + ' of ' + items.length
        : '';
    }
    if (itemPages) {
      itemPages.innerHTML = renderPaginationHtml(itemPage, totalPages);
    }

    itemList.innerHTML = slice.length ? slice.map((item) => {
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

  if (itemPages) {
    itemPages.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-page]');
      if (!btn || btn.classList.contains('page--disabled') || btn.disabled) return;
      itemPage = Math.max(1, Number(btn.getAttribute('data-page')));
      drawItems();
    });
  }

  catList.addEventListener('change', (event) => {
    const select = event.target.closest('[data-cat-tax]');
    if (!select) return;
    store.update('categories', select.getAttribute('data-cat-tax'), { taxOverride: select.value });
    emit('menu:update', { clientId: client.id });
    toast('Category tax updated');
  });

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
      itemPage = 1;
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
    itemPage = 1;
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
    '<div class="field"><label class="label" for="item-tax">Tax override</label><select class="select" id="item-tax">' +
    '<option value="default">Default (restaurant rate)</option>' +
    '<option value="none">No tax</option>' +
    (settings.taxes || []).filter((t) => t.enabled).map((t) =>
      '<option value="' + t.id + '">' + esc(t.name) + ' ' + t.rate + '% only</option>').join('') +
    '</select><p class="hint">Beats the category override. Use it for alcohol or takeaway items.</p></div>' +
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

  const taxSelect = host.querySelector('#item-tax');
  if (taxSelect && item && item.taxOverride) taxSelect.value = item.taxOverride;

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

  const dropzoneEl = host.querySelector('.dropzone');
  const imageInputEl = host.querySelector('#item-image');
  const previewImgEl = host.querySelector('#item-image-preview');

  function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      return toast('Please choose a valid JPG or PNG image.', 'warning');
    }
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
        if (previewImgEl) previewImgEl.src = imageData;
        toast('Photo resized to ' + canvas.width + 'px wide');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  host.querySelector('#pick-image').addEventListener('click', () => imageInputEl.click());
  imageInputEl.addEventListener('change', (event) => {
    if (event.target.files && event.target.files[0]) handleImageFile(event.target.files[0]);
  });

  if (dropzoneEl) {
    dropzoneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzoneEl.classList.add('is-dragover');
    });
    dropzoneEl.addEventListener('dragleave', () => {
      dropzoneEl.classList.remove('is-dragover');
    });
    dropzoneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove('is-dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleImageFile(e.dataTransfer.files[0]);
      }
    });
  }

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
      taxOverride: host.querySelector('#item-tax').value,
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

/* ------------------------------------------------------------- visit qr -- */
function showVisitQr(table, session) {
  const existing = document.getElementById('visit-qr-modal');
  if (existing) existing.remove();

  const url = new URL('../menu/index.html', window.location.href);
  url.searchParams.set('r', client.slug);
  url.searchParams.set('t', table.token);
  url.searchParams.set('s', session.id);
  url.searchParams.set('j', session.joinSecret);
  const fullUrl = url.href;

  const modal = document.createElement('div');
  modal.className = 'visit-qr-modal';
  modal.id = 'visit-qr-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <h2 class="visit-qr-modal__title">${esc(table.name)}</h2>
    <p class="visit-qr-modal__sub">Scan with phone camera to connect &amp; order</p>
    <div class="visit-qr-modal__qr" id="visit-qr-canvas"></div>
    <p class="visit-qr-modal__key">Table key backup: <span class="visit-qr-modal__key-digits">${esc(session.tableKey || '----')}</span></p>
    <button class="btn btn--secondary btn--lg" type="button" id="visit-qr-hide-btn" style="min-width: 160px;">Hide</button>
  `;

  document.body.appendChild(modal);

  if (window.QRCode) {
    new window.QRCode(modal.querySelector('#visit-qr-canvas'), {
      text: fullUrl,
      width: 260,
      height: 260,
      colorDark: '#0B0F0E',
      colorLight: '#FFFFFF',
      correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0,
    });
  }

  modal.querySelector('#visit-qr-hide-btn').addEventListener('click', () => {
    modal.remove();
  });
}

function printVisitSlip(table, session) {
  let slip = document.getElementById('visit-print-slip');
  if (!slip) {
    slip = document.createElement('div');
    slip.id = 'visit-print-slip';
    document.body.appendChild(slip);
  }

  const url = new URL('../menu/index.html', window.location.href);
  url.searchParams.set('r', client.slug);
  url.searchParams.set('t', table.token);
  url.searchParams.set('s', session.id);
  url.searchParams.set('j', session.joinSecret);
  const fullUrl = url.href;

  const now = new Date();
  const dateStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  slip.innerHTML = `
    <div class="slip-restaurant">${esc(client.name)}</div>
    <div class="slip-table">${esc(table.name)}</div>
    <div class="slip-tagline">Scan to order</div>
    <div class="slip-qr" id="slip-qr-box"></div>
    <div class="slip-key">KEY: ${esc(session.tableKey || '----')}</div>
    <div class="slip-datetime">${dateStr}</div>
  `;

  if (window.QRCode) {
    new window.QRCode(slip.querySelector('#slip-qr-box'), {
      text: fullUrl,
      width: 160,
      height: 160,
      colorDark: '#000000',
      colorLight: '#FFFFFF',
      correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0,
    });
  }

  document.body.classList.add('printing-slip');
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-slip');
    }, 1000);
  }, 250);
}

/* ---------------------------------------------------------------- floor ---- */
function renderFloor() {
  paint(head('Floor Plan', 'Live dining tables, guest seating, and visit QR codes.') +
    '<div class="table-grid" id="floor-grid"></div><div id="modal-host"></div>');

  const grid = host.querySelector('#floor-grid');

  function draw() {
    const tables = store.tablesOf(client.id);
    grid.innerHTML = tables.map((table) => {
      const session = sessionForTable(client.id, table.id);
      const isOccupied = table.status === 'occupied' || (session && session.status === 'open');

      return '<div class="card table-card"><div class="table-card__head"><div>' +
        '<p class="table-card__num">' + esc(table.name) + '</p>' +
        '<p class="table-card__seats">' + table.seats + ' seats · ' + (isOccupied ? 'Session active' : 'Ready') + '</p></div>' +
        '<span class="badge badge--' + (isOccupied ? 'warning' : 'success') + '">' +
        (isOccupied ? 'Occupied' : 'Free') + '</span></div>' +
        '<div class="table-card__qr" data-view-qr="' + table.id + '"><i data-lucide="qr-code"></i></div>' +
        (isOccupied && session && session.tableKey ? '<div class="text-xs muted text-center mt-1">Backup Key: <strong style="font-family:var(--font-mono);letter-spacing:2px;">' + esc(session.tableKey) + '</strong></div>' : '') +
        '<div class="table-card__actions">' +
        (isOccupied
          ? (session ? '<button class="btn btn--sm" style="background:#059669; color:#fff; border-color:#059669;" type="button" data-take-pay="' + session.id + '"><i data-lucide="credit-card"></i> Take Payment</button>' : '') +
            '<button class="btn btn--secondary btn--sm" type="button" data-show-visit="' + table.id + '"><i data-lucide="qr-code"></i> Visit QR</button>' +
            (session ? '<button class="btn btn--secondary btn--sm" type="button" data-bill="' + session.id + '"><i data-lucide="receipt"></i> Bill</button>' : '') +
            '<button class="btn btn--danger btn--sm" type="button" data-close-table="' + table.id + '"><i data-lucide="check-circle"></i> Close table</button>'
          : '<button class="btn btn--primary btn--sm" type="button" data-seat="' + table.id + '"><i data-lucide="user-check"></i> Seat guests</button>') +
        '</div></div>';
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  grid.addEventListener('click', (event) => {
    const takePayBtn = event.target.closest('[data-take-pay]');
    if (takePayBtn) {
      openTakePaymentModal(takePayBtn.getAttribute('data-take-pay'), () => draw());
    }
    const seatBtn = event.target.closest('[data-seat]');
    const showVisitBtn = event.target.closest('[data-show-visit]');
    const closeBtn = event.target.closest('[data-close-table]');
    const billBtn = event.target.closest('[data-bill]');
    const viewQr = event.target.closest('[data-view-qr]');

    if (seatBtn) {
      const tableId = seatBtn.getAttribute('data-seat');
      const table = store.getById('tables', tableId);
      if (!table) return;
      const session = seatTable(client.id, table);
      emit('table:update', { tableId: table.id, clientId: client.id });
      if (client.settings && client.settings.printVisitSlip) {
        printVisitSlip(table, session);
      }
      showVisitQr(table, session);
      draw();
      toast('Guests seated at ' + table.name);
    }

    if (showVisitBtn) {
      const tableId = showVisitBtn.getAttribute('data-show-visit');
      const table = store.getById('tables', tableId);
      if (!table) return;
      let session = sessionForTable(client.id, table.id);
      if (!session) session = openSessionForTable(client.id, table);
      showVisitQr(table, session);
    }

    if (closeBtn) {
      const tableId = closeBtn.getAttribute('data-close-table');
      const table = store.getById('tables', tableId);
      if (!table) return;
      const session = sessionForTable(client.id, table.id);
      if (session) {
        closeSession(session.id, { method: 'Cash' }, { total: 0 });
        emit('session:close', { sessionId: session.id, clientId: client.id, tableId: table.id });
      } else {
        store.update('tables', table.id, { status: 'free', tableKey: null, activeSecret: null });
      }
      emit('table:update', { tableId: table.id, clientId: client.id });
      toast('Table ' + table.name + ' closed');
      draw();
    }

    if (billBtn) {
      location.href = 'receipt.html?session=' + billBtn.getAttribute('data-bill');
    }

    if (viewQr) {
      const tableId = viewQr.getAttribute('data-view-qr');
      const table = store.getById('tables', tableId);
      if (!table) return;
      let session = sessionForTable(client.id, table.id);
      if (!session) session = openSessionForTable(client.id, table);
      showVisitQr(table, session);
    }
  });

  draw();
  on('table:update', () => draw());
  on('order:new', () => draw());
}

/* --------------------------------------------------------------- tables -- */
function renderTables() {
  const usage = store.usageFor(client.id);
  paint(head('Tables & QR codes', store.tablesOf(client.id).length + ' tables, each with its own QR code and secret link.',
    '<button class="btn btn--secondary btn--sm" type="button" data-print-all><i data-lucide="printer"></i> Print all QR codes</button>' +
    '<button class="btn btn--primary btn--sm" type="button" data-add-table><i data-lucide="plus"></i> Add table</button>') +
    '<div class="table-grid" id="table-grid"></div>' +
    '<div class="row row--between mt-6" id="table-pagination-row" style="margin-top:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
    '<span class="muted text-xs" id="table-count-text"></span>' +
    '<nav class="pagination" id="table-pages" aria-label="Table pages"></nav></div>' +
    '<div id="modal-host"></div>');

  const grid = host.querySelector('#table-grid');
  const modalHost = host.querySelector('#modal-host');
  const pagesHost = host.querySelector('#table-pages');
  const countText = host.querySelector('#table-count-text');

  let pageNo = 1;
  const perPage = 12;

  function draw() {
    const tables = store.tablesOf(client.id);
    const totalPages = Math.max(1, Math.ceil(tables.length / perPage));
    pageNo = Math.min(pageNo, totalPages);
    const slice = tables.slice((pageNo - 1) * perPage, pageNo * perPage);

    if (countText) {
      countText.textContent = tables.length > perPage
        ? 'Showing ' + ((pageNo - 1) * perPage + 1) + '–' + Math.min(pageNo * perPage, tables.length) + ' of ' + tables.length + ' tables'
        : tables.length + ' tables';
    }
    if (pagesHost) {
      pagesHost.innerHTML = renderPaginationHtml(pageNo, totalPages);
    }

    grid.innerHTML = slice.map((table) => {
      const session = sessionForTable(client.id, table.id);
      const isOccupied = table.status === 'occupied' || (session && session.status === 'open');

      return '<div class="card table-card"><div class="table-card__head"><div>' +
      '<p class="table-card__num">' + esc(table.name) + '</p>' +
      '<p class="table-card__seats">' + table.seats + ' seats · QR active</p></div>' +
      '<span class="badge badge--' + (isOccupied ? 'warning' : 'success') + '">' +
      (isOccupied ? 'Occupied' : 'Free') + '</span></div>' +
      '<div class="table-card__qr"><i data-lucide="qr-code"></i></div>' +
      '<div class="table-card__actions">' +
      (isOccupied
        ? '<button class="btn btn--primary btn--sm" type="button" data-show-visit="' + table.id + '"><i data-lucide="qr-code"></i> Show visit QR</button>' +
          (session ? '<button class="btn btn--secondary btn--sm" type="button" data-bill="' + session.id + '"><i data-lucide="receipt"></i> View bill</button>' : '')
        : '<button class="btn btn--primary btn--sm" type="button" data-seat="' + table.id + '"><i data-lucide="user-check"></i> Seat guests</button>') +
      '<button class="btn btn--secondary btn--sm" type="button" data-view="' + table.id + '"><i data-lucide="eye"></i> View QR</button>' +
      '<button class="btn btn--icon btn--sm" type="button" data-edit="' + table.id + '" aria-label="Edit ' + esc(table.name) + '"><i data-lucide="pencil"></i></button>' +
      '<button class="btn btn--icon btn--sm" type="button" data-del="' + table.id + '" aria-label="Delete ' + esc(table.name) + '"><i data-lucide="trash-2"></i></button>' +
      '</div></div>';
    }).join('');
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
    const seatBtn = event.target.closest('[data-seat]');
    const showVisitBtn = event.target.closest('[data-show-visit]');
    const view = event.target.closest('[data-view]');
    const edit = event.target.closest('[data-edit]');
    const del = event.target.closest('[data-del]');

    if (seatBtn) {
      const table = store.getById('tables', seatBtn.getAttribute('data-seat'));
      if (table) {
        const session = seatTable(client.id, table);
        emit('table:update', { tableId: table.id, clientId: client.id });
        if (client.settings && client.settings.printVisitSlip) {
          printVisitSlip(table, session);
        }
        showVisitQr(table, session);
        draw();
        toast('Guests seated at ' + table.name);
      }
      return;
    }

    if (showVisitBtn) {
      const table = store.getById('tables', showVisitBtn.getAttribute('data-show-visit'));
      if (table) {
        let session = sessionForTable(client.id, table.id);
        if (!session) session = openSessionForTable(client.id, table);
        showVisitQr(table, session);
      }
      return;
    }

    const billBtn = event.target.closest('[data-bill]');
    if (billBtn) openBillModal(billBtn.getAttribute('data-bill'));

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

  let taxCollected = 0;
  let chargesCollected = 0;
  let discountsGiven = 0;
  let tipsCollected = 0;
  const methodNames = new Map((settings.paymentMethods || []).map((m) => [m.id, m.name]));
  const payments = new Map();

  store.query('sessions', (x) => x.clientId === client.id && x.status === 'paid' && new Date(x.closedAt) >= since)
    .forEach((session) => {
      const saved = session.bill || {};
      discountsGiven += (saved.discount && saved.discount.amount) || 0;
      tipsCollected += (saved.tip && saved.tip.amount) || 0;
      const method = (session.payment && session.payment.method) || 'other';
      const bucket = payments.get(method) || { count: 0, amount: 0 };
      bucket.count += 1;
      bucket.amount += (session.payment && session.payment.amount) || saved.total || 0;
      payments.set(method, bucket);
    });
  rows.forEach((order) => {
    const b = breakdownOf(order);
    taxCollected += b.taxTotal || 0;
    chargesCollected += b.chargeTotal || 0;
  });

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
    '<div class="row gap-2">' +
    '<button class="btn btn--secondary btn--sm" type="button" data-google-sync><i data-lucide="sheet"></i> Google Sheet Sync</button>' +
    '<button class="btn btn--secondary btn--sm" type="button" data-export><i data-lucide="download"></i> Export CSV</button>' +
    '</div>') +
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
    statCard('Tax collected', money(taxCollected), settings.pricesIncludeTax ? 'inside menu prices' : 'added on top') +
    statCard('Charges collected', money(chargesCollected), 'service and fees') +
    statCard('Discounts given', money(discountsGiven), 'on paid bills') +
    statCard('Tips collected', money(tipsCollected), 'never taxed') +
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
    '<div class="card"><div class="card__header"><span class="card__title">Payments by method</span></div>' +
    '<div class="card__body"><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Method</th>' +
    '<th scope="col" class="table__num">Bills</th><th scope="col" class="table__num">Amount</th></tr></thead><tbody>' +
    Array.from(new Set([...(settings.paymentMethods || []).map((m) => m.id), ...payments.keys()])).map((key) => {
      const bucket = payments.get(key) || { count: 0, amount: 0 };
      const name = methodNames.get(key) || (key[0].toUpperCase() + key.slice(1));
      return '<tr><td class="table__strong">' + esc(name) + '</td>' +
        '<td class="table__num">' + bucket.count + '</td>' +
        '<td class="table__num">' + money(bucket.amount) + '</td></tr>';
    }).join('') +
    '</tbody></table></div></div></div>' +
    '<div class="card"><div class="card__header"><span class="card__title">Orders by table</span></div>' +
    '<div class="card__body"><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Table</th>' +
    '<th scope="col" class="table__num">Orders</th><th scope="col" class="table__num">Revenue</th></tr></thead><tbody>' +
    tableRows(Object.entries(byTable).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8)) + '</tbody></table></div></div></div>' +
    '</div>');

  const syncBtn = host.querySelector('[data-google-sync]');
  if (syncBtn) syncBtn.addEventListener('click', () => renderSyncDialog());

  host.querySelector('[data-export]').addEventListener('click', () => {
    const csv = [['Order #', 'Date', 'Table', 'Subtotal', 'Taxes', 'Charges', 'Total', 'Status']].concat(
      rows.map((o) => {
        const b = breakdownOf(o);
        return ['#' + o.number, formatDateTime(o.createdAt), o.tableName, b.subtotal.toFixed(2),
          taxText(b), chargeText(b), b.total.toFixed(2), o.status];
      })
    );
    exportCSV(csv, client.slug + '-report.csv');
    toast('Report exported');
  });
}

/* ------------------------------------------------------------- settings -- */
function renderSettings() {
  const h = settings.hours;
  const days = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
  const payments = settings.payments || {};
  const stripeConf = payments.stripe || {};
  const paypalConf = payments.paypal || {};
  const razorpayConf = payments.razorpay || {};
  const squareConf = payments.square || {};
  const inPersonConf = payments.inPerson || { cash: true, cardMachine: true };
  const payPolicy = payments.policy || 'pay_at_order';

  paint(head('Settings', 'Restaurant profile, ordering rules, hours and branding.') +
    '<div class="tabs" data-tabs><div class="tabs__list" role="tablist" aria-label="Settings sections">' +
    ['Restaurant profile|profile', 'Ordering|ordering', 'Security|security', 'Payment Gateways & Methods|payments', 'Opening hours|hours', 'Branding|branding', 'Notifications|notify', 'Cloud & Sync|sync'].map((pair, i) => {
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

    '<div class="tab-panel" data-panel="security" hidden><div class="card"><div class="card__body">' +
    '<h3 class="card__title mb-4" style="font-size:1.05rem;">Anti-Spam & Payment Security</h3>' +
    '<div class="list-row"><div class="list-row__main"><p class="list-row__title">GPS Geofence Protection</p>' +
    '<p class="list-row__meta">Restricts table orders to customers physically inside your restaurant radius. Stops remote photo pranksters.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-geofence"' + (settings.geofence?.enabled !== false ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">GPS Geofence</span></label></div>' +
    '<div class="form-grid form-grid--3 mt-3 mb-4" style="background:var(--surface-2, #F8F6F1); padding:1rem; border-radius:10px;">' +
    '<div class="field"><label class="label" for="set-geo-lat">Latitude</label><input class="input" id="set-geo-lat" type="number" step="0.0001" value="' + (settings.geofence?.lat || 19.0596) + '"></div>' +
    '<div class="field"><label class="label" for="set-geo-lng">Longitude</label><input class="input" id="set-geo-lng" type="number" step="0.0001" value="' + (settings.geofence?.lng || 72.8295) + '"></div>' +
    '<div class="field"><label class="label" for="set-geo-radius">Radius (meters)</label><input class="input" id="set-geo-radius" type="number" step="10" value="' + (settings.geofence?.radiusMeters || 250) + '"></div>' +
    '</div>' +
    '<hr class="my-4" style="border:0;border-top:1px solid var(--border, rgba(0,0,0,0.08));">' +
    '<div class="list-row"><div class="list-row__main"><p class="list-row__title">Pay-at-Order Enforcement (Apple Pay / UPI / Card)</p>' +
    '<p class="list-row__meta">Require customers to pay upfront with Apple Pay, UPI, or Card before the order fires to the kitchen. Zero unpaid food cooked.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-pay-order"' + (settings.payAtOrder?.enabled !== false ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Pay at order</span></label></div>' +
    '<hr class="my-4" style="border:0;border-top:1px solid var(--border, rgba(0,0,0,0.08));">' +
    '<div class="list-row"><div class="list-row__main"><p class="list-row__title">Floor Plan Seated Check</p>' +
    '<p class="list-row__meta">Warn kitchen staff if an order arrives for a table marked Vacant on the Floor Plan so ghost orders are caught immediately.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-seated-check"' + (settings.seatedCheck?.enabled !== false ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Seated check</span></label></div>' +
    '<hr class="my-4" style="border:0;border-top:1px solid var(--border, rgba(0,0,0,0.08));">' +
    '<div class="list-row"><div class="list-row__main"><p class="list-row__title">Print visit QR slip</p>' +
    '<p class="list-row__meta">Automatically print an 80mm thermal slip with Visit QR and table key when seating guests.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-print-slip"' + (settings.printVisitSlip ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Print visit QR slip</span></label></div>' +
    '<div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary" type="button" data-save="security">Save security</button></div>' +
    '</div></div></div>' +

    '<div class="tab-panel" data-panel="payments" hidden>' +
    '<div class="card mb-4"><div class="card__body">' +
    '<h3 class="card__title mb-2" style="font-size:1.1rem; display:flex; align-items:center; gap:8px;"><i data-lucide="shield-check" style="color:#059669;"></i> Dining Payment &amp; Anti-Spam Policy</h3>' +
    '<p class="muted text-sm mb-4">Choose how guests settle payments to stop unpaid ghost orders and speed up table turnover.</p>' +
    '<div class="form-grid form-grid--3" style="gap:12px;">' +
    '<label class="policy-opt" style="border:2px solid var(--primary, #8C3A27); background:#fff; border-radius:12px; padding:14px; cursor:pointer; display:block;">' +
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><strong style="font-size:0.95rem;">🛡️ Pay-at-Order (Recommended)</strong>' +
    '<input type="radio" name="set-pay-policy" value="pay_at_order"' + ((payments.policy || 'pay_at_order') === 'pay_at_order' ? ' checked' : '') + ' style="accent-color:var(--primary, #8C3A27);"></div>' +
    '<p class="text-xs muted" style="margin:0;">Guest pays upfront on their phone (Apple Pay, GPay, Card, UPI). Orders are verified before kitchen prepares food. 100% spam-proof.</p></label>' +
    '<label class="policy-opt" style="border:1px solid var(--border, rgba(0,0,0,0.12)); background:#fff; border-radius:12px; padding:14px; cursor:pointer; display:block;">' +
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><strong style="font-size:0.95rem;">🛎️ Flexible Checkout</strong>' +
    '<input type="radio" name="set-pay-policy" value="flexible"' + (payments.policy === 'flexible' ? ' checked' : '') + ' style="accent-color:var(--primary, #8C3A27);"></div>' +
    '<p class="text-xs muted" style="margin:0;">Guests can pay online immediately or select "Pay Server" to settle in cash or card machine at the table.</p></label>' +
    '<label class="policy-opt" style="border:1px solid var(--border, rgba(0,0,0,0.12)); background:#fff; border-radius:12px; padding:14px; cursor:pointer; display:block;">' +
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><strong style="font-size:0.95rem;">🧾 Traditional Bill at End</strong>' +
    '<input type="radio" name="set-pay-policy" value="post_pay"' + (payments.policy === 'post_pay' ? ' checked' : '') + ' style="accent-color:var(--primary, #8C3A27);"></div>' +
    '<p class="text-xs muted" style="margin:0;">Guests order freely without checkout prompts and request the bill at the end of their meal.</p></label>' +
    '</div></div></div>' +

    '<div class="card mb-4"><div class="card__body">' +
    '<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:1rem;">' +
    '<div><h3 class="card__title" style="font-size:1.15rem; display:flex; align-items:center; gap:8px;">' +
    '<span style="background:#635BFF; color:#fff; font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.85rem;">stripe</span>' +
    'Stripe Connect (US, UK, Europe &amp; Global)</h3>' +
    '<p class="muted text-sm mt-1">Accept Apple Pay, Google Pay, and international cards with direct daily payouts to your local bank account.</p></div>' +
    '<span class="badge badge--success" id="stripe-status-badge" style="font-size:0.8rem; padding:4px 10px;"><span class="dot" style="background:#10B981;"></span> Stripe Connected</span>' +
    '</div>' +
    '<div style="background:var(--surface-2, #F8F6F1); border-radius:12px; padding:1rem; border:1px solid var(--border, rgba(0,0,0,0.08)); margin-bottom:1.25rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">' +
    '<div><div style="font-weight:700; font-size:0.95rem;">Connected Account: ' + esc(client.name) + ' Ltd</div>' +
    '<div class="muted text-xs mt-0.5">Payout Bank: Barclays Business / Chase Bank (•••• 4192) · Daily Rolling Payouts</div></div>' +
    '<button type="button" class="btn btn--sm" id="btn-toggle-stripe" style="background:#635BFF; color:#fff; border:none; font-weight:700; padding:8px 16px; border-radius:8px;">Manage Stripe Account</button>' +
    '</div>' +
    '<h4 class="text-sm font-bold uppercase tracking-wider text-muted mb-2">Stripe Payment Methods Offered to Diners</h4>' +
    '<div class="form-grid form-grid--3 mb-4">' +
    '<div style="padding:12px; border:1px solid var(--border, rgba(0,0,0,0.1)); border-radius:10px; background:#fff; display:flex; justify-content:space-between; align-items:center;">' +
    '<div><strong>🍏 Apple Pay</strong><p class="text-xs muted" style="margin:2px 0 0;">Face ID / Touch ID</p></div>' +
    '<label class="switch"><input type="checkbox" id="stripe-opt-apple"' + (stripeConf.applePay !== false ? ' checked' : '') + '><span class="switch__track"></span></label></div>' +
    '<div style="padding:12px; border:1px solid var(--border, rgba(0,0,0,0.1)); border-radius:10px; background:#fff; display:flex; justify-content:space-between; align-items:center;">' +
    '<div><strong>🌐 Google Pay</strong><p class="text-xs muted" style="margin:2px 0 0;">Android / Chrome</p></div>' +
    '<label class="switch"><input type="checkbox" id="stripe-opt-google"' + (stripeConf.googlePay !== false ? ' checked' : '') + '><span class="switch__track"></span></label></div>' +
    '<div style="padding:12px; border:1px solid var(--border, rgba(0,0,0,0.1)); border-radius:10px; background:#fff; display:flex; justify-content:space-between; align-items:center;">' +
    '<div><strong>💳 Visa / MC / Amex</strong><p class="text-xs muted" style="margin:2px 0 0;">Global Debit &amp; Credit</p></div>' +
    '<label class="switch"><input type="checkbox" id="stripe-opt-cards"' + (stripeConf.cards !== false ? ' checked' : '') + '><span class="switch__track"></span></label></div>' +
    '</div>' +
    '<div class="form-grid form-grid--2 mb-2">' +
    '<div class="field"><label class="label" for="stripe-pub-key">Stripe Publishable Key</label><input class="input" id="stripe-pub-key" type="text" placeholder="pk_test_... or pk_live_..." style="font-family:var(--font-mono); font-size:0.85rem;" value="' + esc(stripeConf.pubKey || '') + '"></div>' +
    '<div class="field"><label class="label" for="stripe-sec-key">Stripe Secret Key</label><input class="input" id="stripe-sec-key" type="password" placeholder="sk_test_... or sk_live_..." style="font-family:var(--font-mono); font-size:0.85rem;" value="' + esc(stripeConf.secKey || '') + '"></div>' +
    '</div></div></div>' +

    '<div class="card mb-4"><div class="card__body">' +
    '<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:1rem;">' +
    '<div><h3 class="card__title" style="font-size:1.15rem; display:flex; align-items:center; gap:8px;">' +
    '<span style="background:#003087; color:#fff; font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.85rem;">PayPal</span>' +
    'PayPal &amp; Venmo (US &amp; UK Diners)</h3>' +
    '<p class="muted text-sm mt-1">Allow diners to checkout with PayPal wallet or Venmo (popular for younger US diners).</p></div>' +
    '<span class="badge badge--success" id="paypal-status-badge" style="font-size:0.8rem; padding:4px 10px;"><span class="dot" style="background:#10B981;"></span> Active</span>' +
    '</div>' +
    '<div class="form-grid form-grid--2 mb-3">' +
    '<div style="padding:12px; border:1px solid var(--border, rgba(0,0,0,0.1)); border-radius:10px; background:#fff; display:flex; justify-content:space-between; align-items:center;">' +
    '<div><strong>🅿️ PayPal Wallet Checkout</strong><p class="text-xs muted" style="margin:2px 0 0;">Standard PayPal web pay</p></div>' +
    '<label class="switch"><input type="checkbox" id="paypal-opt-wallet"' + (paypalConf.paypalWallet !== false ? ' checked' : '') + '><span class="switch__track"></span></label></div>' +
    '<div style="padding:12px; border:1px solid var(--border, rgba(0,0,0,0.1)); border-radius:10px; background:#fff; display:flex; justify-content:space-between; align-items:center;">' +
    '<div><strong>📱 Venmo Checkout</strong><p class="text-xs muted" style="margin:2px 0 0;">Direct Venmo app pay (US)</p></div>' +
    '<label class="switch"><input type="checkbox" id="paypal-opt-venmo"' + (paypalConf.venmo !== false ? ' checked' : '') + '><span class="switch__track"></span></label></div>' +
    '</div>' +
    '<div class="form-grid form-grid--2">' +
    '<div class="field"><label class="label" for="paypal-client-id">PayPal Client ID</label><input class="input" id="paypal-client-id" type="text" placeholder="e.g. Ae8X... (Sandbox or Live)" style="font-family:var(--font-mono); font-size:0.85rem;" value="' + esc(paypalConf.clientId || '') + '"></div>' +
    '<div class="field"><label class="label" for="paypal-sec-key">PayPal Secret</label><input class="input" id="paypal-sec-key" type="password" placeholder="e.g. EL29..." style="font-family:var(--font-mono); font-size:0.85rem;" value="' + esc(paypalConf.secKey || '') + '"></div>' +
    '</div></div></div>' +

    '<div class="card mb-4"><div class="card__body">' +
    '<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:1rem;">' +
    '<div><h3 class="card__title" style="font-size:1.15rem; display:flex; align-items:center; gap:8px;">' +
    '<span style="background:#000; color:#fff; font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.85rem;">Square</span>' +
    'Square &amp; Clover POS Terminal Sync</h3>' +
    '<p class="muted text-sm mt-1">Sync digital table orders with physical handheld card terminals and POS cash registers.</p></div>' +
    '<span class="badge badge--neutral" style="font-size:0.8rem; padding:4px 10px;">Ready to Link</span>' +
    '</div>' +
    '<div class="form-grid form-grid--2">' +
    '<div class="field"><label class="label" for="square-loc-id">POS Location ID</label><input class="input" id="square-loc-id" type="text" placeholder="e.g. L938FKLW..." style="font-family:var(--font-mono); font-size:0.85rem;" value="' + esc(squareConf.locationId || '') + '"></div>' +
    '<div class="field"><label class="label" for="square-token">POS Terminal Access Token</label><input class="input" id="square-token" type="password" placeholder="e.g. sq0atp-..." style="font-family:var(--font-mono); font-size:0.85rem;" value="' + esc(squareConf.accessToken || '') + '"></div>' +
    '</div></div></div>' +

    '<div class="card mb-4"><div class="card__body">' +
    '<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:1rem;">' +
    '<div><h3 class="card__title" style="font-size:1.15rem; display:flex; align-items:center; gap:8px;">' +
    '<span style="background:#02042B; color:#00D09C; font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.85rem;">UPI</span>' +
    'Razorpay &amp; UPI Gateway (India &amp; South Asia)</h3>' +
    '<p class="muted text-sm mt-1">Accept GPay, PhonePe, Paytm, and BHIM with auto-reconciliation.</p></div>' +
    '<span class="badge badge--success" style="font-size:0.8rem; padding:4px 10px;"><span class="dot" style="background:#10B981;"></span> Active</span>' +
    '</div>' +
    '<div class="form-grid form-grid--2">' +
    '<div class="field"><label class="label" for="razorpay-vpa">Merchant UPI ID / VPA</label><input class="input" id="razorpay-vpa" type="text" value="' + esc(razorpayConf.vpa || 'olivetable@icici') + '" style="font-family:var(--font-mono); font-size:0.85rem;"></div>' +
    '<div class="field"><label class="label" for="razorpay-key-id">Razorpay Key ID</label><input class="input" id="razorpay-key-id" type="text" placeholder="rzp_live_..." style="font-family:var(--font-mono); font-size:0.85rem;" value="' + esc(razorpayConf.keyId || '') + '"></div>' +
    '</div></div></div>' +

    '<div class="card mb-4"><div class="card__body">' +
    '<h3 class="card__title mb-2" style="font-size:1.05rem;">Physical In-Person Dining Methods</h3>' +
    '<p class="muted text-sm mb-4">Methods where guests pay staff directly at the table or counter.</p>' +
    '<div class="form-grid form-grid--2">' +
    '<div style="padding:12px; border:1px solid var(--border, rgba(0,0,0,0.1)); border-radius:10px; background:#fff; display:flex; justify-content:space-between; align-items:center;">' +
    '<div><strong>💵 Cash to Server / Counter</strong><p class="text-xs muted" style="margin:2px 0 0;">Guest pays paper cash to waiter</p></div>' +
    '<label class="switch"><input type="checkbox" id="pay-opt-cash"' + (inPersonConf.cash !== false ? ' checked' : '') + '><span class="switch__track"></span></label></div>' +
    '<div style="padding:12px; border:1px solid var(--border, rgba(0,0,0,0.1)); border-radius:10px; background:#fff; display:flex; justify-content:space-between; align-items:center;">' +
    '<div><strong>📟 Handheld POS Terminal at Table</strong><p class="text-xs muted" style="margin:2px 0 0;">Server brings portable card reader</p></div>' +
    '<label class="switch"><input type="checkbox" id="pay-opt-terminal"' + (inPersonConf.cardMachine !== false ? ' checked' : '') + '><span class="switch__track"></span></label></div>' +
    '</div></div></div>' +

    '<div class="row mt-6" style="justify-content:flex-end"><button class="btn btn--primary btn--lg" type="button" data-save="payments"><i data-lucide="save"></i> Save Payment Gateways &amp; Settings</button></div>' +
    '</div>' +

    '<div class="tab-panel" data-panel="sync" hidden><div class="card"><div class="card__body">' +
    '<h3 class="card__title mb-2">Google Sheets & Google Drive Integration</h3>' +
    '<p class="muted text-sm mb-4">Export and continuously sync your live orders, menu catalog, tables, and daily revenue reports to your restaurant\'s Google Spreadsheet. Back up your database to Google Drive.</p>' +
    '<div class="row gap-3">' +
    '<button class="btn btn--primary" type="button" id="open-sync-dlg-btn"><i data-lucide="sheet"></i> Configure Google Sync</button>' +
    '<button class="btn btn--secondary" type="button" id="backup-drive-btn"><i data-lucide="cloud"></i> Backup to Google Drive</button>' +
    '</div></div></div>' +
    renderMongoSettingsCard() +
    '</div>' +

    '<div class="tab-panel" data-panel="ordering" hidden><div class="card"><div class="card__body">' +
    '<div class="list-row"><div class="list-row__main"><p class="list-row__title">Accept orders</p>' +
    '<p class="list-row__meta">When off, guests see “Ordering is paused” instead of the menu.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-accept"' + (settings.acceptOrders ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Accept orders</span></label></div>' +
    '<div class="list-row"><div class="list-row__main"><p class="list-row__title">Staff must approve orders before the kitchen</p>' +
    '<p class="list-row__meta">New orders wait for approval on the Live orders page.</p></div>' +
    '<label class="switch"><input type="checkbox" id="set-approval"' + (settings.approval ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Require approval</span></label></div>' +
    '<div class="tax-section">' +
    '<div class="tax-section__head"><span class="label" style="margin:0">Taxes &amp; charges</span>' +
    '<span class="muted text-xs">Applied to the guest menu, cart and every new order.</span></div>' +
    '<label class="switch tax-inclusive"><input type="checkbox" id="set-inclusive"' + (settings.pricesIncludeTax ? ' checked' : '') + '>' +
    '<span class="switch__track"></span><span class="switch__label">Menu prices already include tax</span></label>' +
    '<p class="hint">On: tax is inside the price (UK, South Africa). Off: tax is added on top (USA, India).</p>' +

    '<div class="tax-list-head"><span>Tax</span><span>Rate</span><span>On</span><span></span></div>' +
    '<div id="tax-rows"></div>' +
    '<button class="btn btn--secondary btn--sm mt-2" type="button" data-add-tax><i data-lucide="plus"></i> Add tax</button>' +

    '<div class="tax-list-head mt-6"><span>Charge</span><span>Type &amp; value</span><span>On</span><span></span></div>' +
    '<div id="charge-rows"></div>' +
    '<button class="btn btn--secondary btn--sm mt-2" type="button" data-add-charge><i data-lucide="plus"></i> Add charge</button>' +

    '<div class="form-grid form-grid--2 mt-6">' +
    '<div class="field"><label class="label" for="set-taxlabel">Tax number label</label>' +
    '<input class="input" id="set-taxlabel" type="text" value="' + esc((settings.taxNumber && settings.taxNumber.label) || 'GSTIN') + '" placeholder="GSTIN, VAT no., Tax ID"></div>' +
    '<div class="field"><label class="label" for="set-taxvalue">Tax registration number</label>' +
    '<input class="input" id="set-taxvalue" type="text" value="' + esc((settings.taxNumber && settings.taxNumber.value) || '') + '"></div>' +
    '</div>' +

    '<div class="tax-section__head mt-6"><span class="label" style="margin:0">Tips</span>' +
    '<span class="muted text-xs">Offered on the guest bill, never taxed.</span></div>' +
    '<label class="switch"><input type="checkbox" id="set-tips"' + (settings.tips && settings.tips.enabled ? ' checked' : '') + '>' +
    '<span class="switch__track"></span><span class="switch__label">Let guests add a tip</span></label>' +
    '<p class="hint">Turn off if guests add tips on your card machine.</p>' +
    '<div class="form-grid form-grid--2 mt-4">' +
    '<div class="field"><label class="label" for="set-tippresets">Preset percentages</label>' +
    '<input class="input" id="set-tippresets" type="text" value="' + esc(((settings.tips && settings.tips.presets) || [10, 15, 20]).join(', ')) + '" placeholder="10, 15, 20">' +
    '<p class="hint">Comma separated.</p></div>' +
    '<div class="field"><label class="switch"><input type="checkbox" id="set-tipcustom"' +
    (settings.tips && settings.tips.allowCustom === false ? '' : ' checked') + '>' +
    '<span class="switch__track"></span><span class="switch__label">Allow a custom tip amount</span></label></div>' +
    '</div>' +

    '<div class="tax-section__head mt-6"><span class="label" style="margin:0">Payments</span>' +
    '<span class="muted text-xs">The methods a guest can pick when asking for the bill.</span></div>' +
    '<div class="tax-list-head"><span>Method</span><span></span><span>On</span><span></span></div>' +
    '<div id="pay-rows"></div>' +
    '<button class="btn btn--secondary btn--sm mt-2" type="button" data-add-method><i data-lucide="plus"></i> Add method</button>' +
    '<div class="field mt-6"><label class="label" for="set-paynote">Bill footer text</label>' +
    '<input class="input" id="set-paynote" type="text" value="' + esc(settings.paymentNote || 'Your waiter will bring the card machine to your table.') + '"></div>' +

    '<div class="form-grid form-grid--2 mt-6">' +
    '<div class="field"><label class="label" for="set-rounding">Rounding</label><select class="select" id="set-rounding">' +
    [['none', 'None'], ['0.05', 'Nearest 0.05'], ['1', 'Nearest whole number']]
      .map(([v, label]) => '<option value="' + v + '"' + ((settings.rounding || 'none') === v ? ' selected' : '') + '>' + label + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label class="label" for="set-currency">Currency</label><select class="select" id="set-currency">' +
    ['$', '₹', '£', '€'].map((c) => '<option' + (settings.currency === c ? ' selected' : '') + '>' + c + '</option>').join('') +
    '</select></div></div>' +

    '<div class="tax-preview" id="tax-preview" aria-live="polite"></div>' +
    '</div>' +
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

  /* ---------------------------------------------- taxes & charges editor -- */
  let taxDraft = {
    taxes: (settings.taxes || []).map((t) => ({ ...t })),
    charges: (settings.charges || []).map((c) => ({ ...c })),
  };
  let payDraft = (settings.paymentMethods || []).map((m) => ({ ...m }));
  const payRowsHost = host.querySelector('#pay-rows');
  const taxRowsHost = host.querySelector('#tax-rows');
  const chargeRowsHost = host.querySelector('#charge-rows');
  const previewHost = host.querySelector('#tax-preview');
  const newId = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 8);

  function drawTaxRows() {
    taxRowsHost.innerHTML = taxDraft.taxes.length
      ? taxDraft.taxes.map((t) =>
        '<div class="tax-row">' +
        '<input class="input" type="text" value="' + esc(t.name) + '" data-tax-name="' + t.id + '" placeholder="VAT, GST, Sales tax" aria-label="Tax name">' +
        '<div class="tax-row__value"><input class="input" type="number" step="0.01" min="0" value="' + t.rate + '" data-tax-rate="' + t.id + '" aria-label="Tax rate"><span>%</span></div>' +
        '<label class="switch"><input type="checkbox" data-tax-on="' + t.id + '"' + (t.enabled ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Tax on</span></label>' +
        '<button class="btn btn--icon btn--sm" type="button" data-tax-del="' + t.id + '" aria-label="Delete tax"><i data-lucide="trash-2"></i></button>' +
        '</div>').join('')
      : '<p class="hint">No taxes yet — add one to charge tax on top of the menu.</p>';
    if (window.lucide) window.lucide.createIcons();
  }

  function drawChargeRows() {
    chargeRowsHost.innerHTML = taxDraft.charges.length
      ? taxDraft.charges.map((c) =>
        '<div class="tax-row tax-row--charge">' +
        '<input class="input" type="text" value="' + esc(c.name) + '" data-charge-name="' + c.id + '" placeholder="Service charge, Packing fee" aria-label="Charge name">' +
        '<div class="tax-row__value">' +
        '<select class="select" data-charge-type="' + c.id + '" aria-label="Charge type">' +
        '<option value="percent"' + (c.type !== 'fixed' ? ' selected' : '') + '>%</option>' +
        '<option value="fixed"' + (c.type === 'fixed' ? ' selected' : '') + '>Fixed</option></select>' +
        '<input class="input" type="number" step="0.01" min="0" value="' + c.value + '" data-charge-value="' + c.id + '" aria-label="Charge value"></div>' +
        '<label class="switch"><input type="checkbox" data-charge-on="' + c.id + '"' + (c.enabled ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Charge on</span></label>' +
        '<button class="btn btn--icon btn--sm" type="button" data-charge-del="' + c.id + '" aria-label="Delete charge"><i data-lucide="trash-2"></i></button>' +
        '<div class="tax-row__opts">' +
        '<label class="check check--sm"><input type="checkbox" data-charge-removable="' + c.id + '"' + (c.customerCanRemove !== false ? ' checked' : '') + '><span class="check__text">Customer can remove this charge</span></label>' +
        '<label class="check check--sm"><input type="checkbox" data-charge-default="' + c.id + '"' + (c.addedByDefault !== false ? ' checked' : '') + '><span class="check__text">Added by default</span></label>' +
        '<label class="check check--sm"><input type="checkbox" data-charge-tax="' + c.id + '"' + (c.applyTax !== false ? ' checked' : '') + '><span class="check__text">Apply tax on this charge</span></label>' +
        '</div>' +
        '</div>').join('')
      : '<p class="hint">No charges yet.</p>';
    if (window.lucide) window.lucide.createIcons();
  }

  function drawPayRows() {
    payRowsHost.innerHTML = payDraft.length
      ? payDraft.map((m) =>
        '<div class="tax-row tax-row--pay">' +
        '<input class="input" type="text" value="' + esc(m.name) + '" data-pay-name="' + m.id + '" placeholder="Card, Cash, UPI" aria-label="Payment method name">' +
        '<span></span>' +
        '<label class="switch"><input type="checkbox" data-pay-on="' + m.id + '"' + (m.enabled ? ' checked' : '') + '><span class="switch__track"></span><span class="sr-only">Method on</span></label>' +
        '<button class="btn btn--icon btn--sm" type="button" data-pay-del="' + m.id + '" aria-label="Delete method"><i data-lucide="trash-2"></i></button>' +
        '</div>').join('')
      : '<p class="hint">No payment methods — guests will not be asked how they want to pay.</p>';
    if (window.lucide) window.lucide.createIcons();
  }

  function taxConfigFromForm() {
    return {
      currency: host.querySelector('#set-currency').value,
      pricesIncludeTax: host.querySelector('#set-inclusive').checked,
      rounding: host.querySelector('#set-rounding').value,
      taxes: taxDraft.taxes,
      charges: taxDraft.charges,
    };
  }

  function drawPreview() {
    const config = taxConfigFromForm();
    const money = (v) => formatMoney(v, config.currency);
    const totals = computeBill({ lines: [{ amount: 20, taxOverride: 'default' }], settings: config });
    const rows = ['<div class="tax-preview__row"><span>Menu subtotal</span><span>' + money(20) + '</span></div>'];

    if (!totals.pricesIncludeTax) {
      totals.taxes.forEach((t) => rows.push(
        '<div class="tax-preview__row"><span>' + esc(t.name) + ' ' + t.rate + '%</span><span>' + money(t.amount) + '</span></div>'));
    }
    totals.charges.forEach((c) => rows.push(
      '<div class="tax-preview__row"><span>' + esc(c.name) + (c.type === 'percent' ? ' ' + c.value + '%' : '') + '</span><span>' + money(c.amount) + '</span></div>'));
    rows.push('<div class="tax-preview__row tax-preview__row--total"><span>Guest pays</span><span>' + money(totals.total) + '</span></div>');
    if (totals.pricesIncludeTax) {
      totals.includedTaxes.forEach((t) => rows.push(
        '<p class="tax-preview__note">Includes ' + esc(t.name) + ' ' + t.rate + '%: ' + money(t.amount) + '</p>'));
    }
    previewHost.innerHTML = '<p class="tax-preview__title">Example: a $20.00 order</p>' + rows.join('');
  }

  function syncTaxDraft(target) {
    const pick = (attr) => target.getAttribute(attr);
    if (pick('data-tax-name')) { const row = taxDraft.taxes.find((t) => t.id === pick('data-tax-name')); if (row) row.name = target.value; }
    if (pick('data-tax-rate')) { const row = taxDraft.taxes.find((t) => t.id === pick('data-tax-rate')); if (row) row.rate = Number(target.value) || 0; }
    if (pick('data-tax-on')) { const row = taxDraft.taxes.find((t) => t.id === pick('data-tax-on')); if (row) row.enabled = target.checked; }
    if (pick('data-charge-name')) { const row = taxDraft.charges.find((c) => c.id === pick('data-charge-name')); if (row) row.name = target.value; }
    if (pick('data-charge-value')) { const row = taxDraft.charges.find((c) => c.id === pick('data-charge-value')); if (row) row.value = Number(target.value) || 0; }
    if (pick('data-charge-type')) { const row = taxDraft.charges.find((c) => c.id === pick('data-charge-type')); if (row) row.type = target.value; }
    if (pick('data-pay-name')) { const row = payDraft.find((m) => m.id === pick('data-pay-name')); if (row) row.name = target.value; }
    if (pick('data-pay-on')) { const row = payDraft.find((m) => m.id === pick('data-pay-on')); if (row) row.enabled = target.checked; }
    if (pick('data-charge-on')) { const row = taxDraft.charges.find((c) => c.id === pick('data-charge-on')); if (row) row.enabled = target.checked; }
    if (pick('data-charge-removable')) { const row = taxDraft.charges.find((c) => c.id === pick('data-charge-removable')); if (row) row.customerCanRemove = target.checked; }
    if (pick('data-charge-default')) { const row = taxDraft.charges.find((c) => c.id === pick('data-charge-default')); if (row) row.addedByDefault = target.checked; }
    if (pick('data-charge-tax')) { const row = taxDraft.charges.find((c) => c.id === pick('data-charge-tax')); if (row) row.applyTax = target.checked; }
  }

  host.querySelector('[data-panel="ordering"]').addEventListener('input', (event) => {
    syncTaxDraft(event.target);
    drawPreview();
  });
  host.querySelector('[data-panel="ordering"]').addEventListener('change', (event) => {
    syncTaxDraft(event.target);
    drawPreview();
  });

  host.querySelector('[data-panel="ordering"]').addEventListener('click', (event) => {
    const addMethod = event.target.closest('[data-add-method]');
    const delMethod = event.target.closest('[data-pay-del]');

    if (addMethod) {
      payDraft.push({ id: newId('pay'), name: 'New method', enabled: true });
      drawPayRows();
    }
    if (delMethod) {
      payDraft = payDraft.filter((m) => m.id !== delMethod.getAttribute('data-pay-del'));
      drawPayRows();
    }

    const addTax = event.target.closest('[data-add-tax]');
    const addCharge = event.target.closest('[data-add-charge]');
    const delTax = event.target.closest('[data-tax-del]');
    const delCharge = event.target.closest('[data-charge-del]');

    if (addTax) {
      taxDraft.taxes.push({ id: newId('tax'), name: 'New tax', rate: 0, enabled: true });
      drawTaxRows(); drawPreview();
    }
    if (addCharge) {
      taxDraft.charges.push({
        id: newId('chg'), name: 'New charge', type: 'percent', value: 0, enabled: true,
        customerCanRemove: true, addedByDefault: true, applyTax: true,
      });
      drawChargeRows(); drawPreview();
    }
    if (delTax) {
      taxDraft.taxes = taxDraft.taxes.filter((t) => t.id !== delTax.getAttribute('data-tax-del'));
      drawTaxRows(); drawPreview();
    }
    if (delCharge) {
      taxDraft.charges = taxDraft.charges.filter((c) => c.id !== delCharge.getAttribute('data-charge-del'));
      drawChargeRows(); drawPreview();
    }
  });

  drawTaxRows();
  drawChargeRows();
  drawPayRows();
  drawPreview();

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
        next.currency = host.querySelector('#set-currency').value;
        next.pricesIncludeTax = host.querySelector('#set-inclusive').checked;
        next.rounding = host.querySelector('#set-rounding').value;
        next.taxes = taxDraft.taxes.map((t) => ({ ...t }));
        next.charges = taxDraft.charges.map((c) => ({ ...c }));
        next.taxNumber = {
          label: host.querySelector('#set-taxlabel').value.trim() || 'GSTIN',
          value: host.querySelector('#set-taxvalue').value.trim(),
        };
        const presets = host.querySelector('#set-tippresets').value
          .split(',').map((n) => Number(n.trim())).filter((n) => n > 0);
        next.tips = {
          enabled: host.querySelector('#set-tips').checked,
          presets: presets.length ? presets : [10, 15, 20],
          allowCustom: host.querySelector('#set-tipcustom').checked,
        };
        next.paymentMethods = payDraft.map((m) => ({ ...m }));
        next.paymentNote = host.querySelector('#set-paynote').value.trim()
          || 'Your waiter will bring the card machine to your table.';
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
      if (which === 'security') {
        next.printVisitSlip = host.querySelector('#set-print-slip') ? host.querySelector('#set-print-slip').checked : false;
        next.geofence = {
          enabled: host.querySelector('#set-geofence') ? host.querySelector('#set-geofence').checked : true,
          lat: parseFloat(host.querySelector('#set-geo-lat')?.value) || 19.0596,
          lng: parseFloat(host.querySelector('#set-geo-lng')?.value) || 72.8295,
          radiusMeters: parseInt(host.querySelector('#set-geo-radius')?.value, 10) || 250,
          name: settings.geofence?.name || 'Restaurant Premises',
        };
        next.payAtOrder = {
          enabled: host.querySelector('#set-pay-order') ? host.querySelector('#set-pay-order').checked : true,
          methods: ['apple_pay', 'upi', 'card', 'counter'],
        };
        next.seatedCheck = {
          enabled: host.querySelector('#set-seated-check') ? host.querySelector('#set-seated-check').checked : true,
        };
        store.update('clients', client.id, { settings: next });
        emit('settings:update', { clientId: client.id });
        toast('Security & anti-spam settings saved');
      }
      if (which === 'payments') {
        const policyVal = host.querySelector('input[name="set-pay-policy"]:checked')?.value || host.querySelector('input[name="payment-policy"]:checked')?.value || 'pay_at_order';
        const applePayOn = host.querySelector('#stripe-opt-apple') ? host.querySelector('#stripe-opt-apple').checked : true;
        const googlePayOn = host.querySelector('#stripe-opt-google') ? host.querySelector('#stripe-opt-google').checked : true;
        const cardsOn = host.querySelector('#stripe-opt-cards') ? host.querySelector('#stripe-opt-cards').checked : true;
        const paypalWalletOn = host.querySelector('#paypal-opt-wallet') ? host.querySelector('#paypal-opt-wallet').checked : true;
        const venmoOn = host.querySelector('#paypal-opt-venmo') ? host.querySelector('#paypal-opt-venmo').checked : true;
        const cashOn = host.querySelector('#pay-opt-cash') ? host.querySelector('#pay-opt-cash').checked : true;
        const terminalOn = host.querySelector('#pay-opt-terminal') ? host.querySelector('#pay-opt-terminal').checked : true;

        next.payments = {
          policy: policyVal,
          stripe: {
            connected: true,
            accountName: client.name + ' Ltd',
            bankName: 'Barclays Business / Chase Bank (•••• 4192)',
            payoutSchedule: 'Daily Rolling Payouts',
            liveMode: true,
            pubKey: host.querySelector('#stripe-pub-key')?.value.trim() || '',
            secKey: host.querySelector('#stripe-sec-key')?.value.trim() || '',
            applePay: applePayOn,
            googlePay: googlePayOn,
            cards: cardsOn,
          },
          paypal: {
            connected: true,
            clientId: host.querySelector('#paypal-client-id')?.value.trim() || '',
            secKey: host.querySelector('#paypal-sec-key')?.value.trim() || '',
            paypalWallet: paypalWalletOn,
            venmo: venmoOn,
          },
          square: {
            connected: true,
            locationId: host.querySelector('#square-loc-id')?.value.trim() || '',
            accessToken: host.querySelector('#square-token')?.value.trim() || '',
            syncPos: true,
          },
          razorpay: {
            connected: true,
            vpa: host.querySelector('#razorpay-vpa')?.value.trim() || 'olivetable@icici',
            keyId: host.querySelector('#razorpay-key-id')?.value.trim() || '',
            upi: true,
            netbanking: true,
          },
          inPerson: {
            cash: cashOn,
            cardMachine: terminalOn,
          },
        };

        next.paymentMethods = [
          { id: 'apple_pay', name: 'Apple Pay', enabled: applePayOn },
          { id: 'google_pay', name: 'Google Pay', enabled: googlePayOn },
          { id: 'card', name: 'Credit / Debit Card', enabled: cardsOn },
          { id: 'paypal', name: 'PayPal / Venmo', enabled: paypalWalletOn || venmoOn },
          { id: 'upi', name: 'UPI (GPay / PhonePe / Paytm)', enabled: true },
          { id: 'cash', name: 'Cash to Waiter', enabled: cashOn },
        ];
        next.payAtOrder = {
          enabled: policyVal === 'pay_at_order',
          methods: ['apple_pay', 'google_pay', 'card', 'paypal', 'upi', 'counter'],
        };

        store.update('clients', client.id, { settings: next });
        emit('settings:update', { clientId: client.id });
        toast('Payment Gateways & Methods saved');
      }
      store.logActivity({ actor: session.name, clientId: client.id, type: 'Settings', details: 'Settings saved (' + which + ')' });
    });
  });

  const toggleStripeBtn = host.querySelector('#btn-toggle-stripe') || host.querySelector('#btn-reconnect-stripe');
  if (toggleStripeBtn) {
    toggleStripeBtn.addEventListener('click', () => {
      toast('Stripe Connect Dashboard: Barclays Business (•••• 4192) active · Payouts daily');
    });
  }

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
  floor: renderFloor,
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
on('order:new', () => { if (['dashboard', 'orders', 'floor'].includes(page)) { refreshChrome(); PAGES[page](); } });
on('order:update', () => { if (['dashboard', 'orders', 'floor'].includes(page)) { refreshChrome(); PAGES[page](); } });
on('call:new', () => { if (['dashboard', 'orders', 'floor'].includes(page)) { refreshChrome(); PAGES[page](); } });

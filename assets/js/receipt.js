/* ==========================================================================
   TableTap — receipt.js
   Printable receipt for a paid table session.
   ========================================================================== */

import { getById, sessionOrders } from './store.js';
import { requireRole, currentClient } from './auth.js';
import { formatMoney, formatDateTime, esc, qs } from './helpers.js';

requireRole('owner');
const client = currentClient();
const settings = client.settings;
const money = (value) => formatMoney(value, settings.currency);
const taxNumber = settings.taxNumber || {};

const host = document.getElementById('receipt');
const session = getById('sessions', qs('session') || '');

if (!session || session.status !== 'paid') {
  host.innerHTML = '<p class="receipt__name">Receipt not found</p>' +
    '<p class="receipt__meta">This bill has not been paid, or the demo data was reset.</p>';
} else {
  const orders = sessionOrders(session);
  const bill = session.bill || {};
  const payment = session.payment || {};
  const rows = [];

  orders.forEach((order) => {
    order.items.forEach((item) => {
      rows.push('<tr><td>' + item.qty + '× ' + esc(item.name) +
        (item.size && item.size !== 'Regular' ? ' <span class="receipt__sub">(' + esc(item.size) + ')</span>' : '') + '</td>' +
        '<td class="receipt__num">' + money(item.price * item.qty) + '</td></tr>');
    });
  });

  const lines = ['<div class="summary__row"><span>Subtotal</span><span>' + money(bill.subtotal || 0) + '</span></div>'];
  if (bill.discount && bill.discount.amount > 0) {
    lines.push('<div class="summary__row"><span>Discount' + (bill.discount.reason ? ' · ' + esc(bill.discount.reason) : '') + '</span><span>−' + money(bill.discount.amount) + '</span></div>');
  }
  (bill.charges || []).forEach((c) => lines.push('<div class="summary__row"><span>' + esc(c.name) + '</span><span>' + money(c.amount) + '</span></div>'));
  (bill.taxes || []).forEach((t) => lines.push('<div class="summary__row"><span>' + esc(t.name) + ' ' + t.rate + '%</span><span>' + money(t.amount) + '</span></div>'));
  if (bill.tip && bill.tip.amount > 0) lines.push('<div class="summary__row"><span>Tip</span><span>' + money(bill.tip.amount) + '</span></div>');
  lines.push('<div class="summary__row summary__row--total"><span>Total paid</span><span>' + money(bill.total || 0) + '</span></div>');
  (bill.includedTaxes || []).forEach((t) => lines.push('<p class="summary__note">Includes ' + esc(t.name) + ' ' + t.rate + '%: ' + money(t.amount) + '</p>'));

  host.innerHTML =
    '<p class="receipt__name">' + esc(client.name) + '</p>' +
    '<p class="receipt__meta">' + esc(settings.address || '') + '</p>' +
    '<p class="receipt__meta">' + esc(settings.phone || '') + '</p>' +
    (taxNumber.value ? '<p class="receipt__meta">' + esc(taxNumber.label || 'Tax number') + ': ' + esc(taxNumber.value) + '</p>' : '') +
    '<div class="receipt__rule"></div>' +
    '<div class="receipt__row"><span>' + esc(session.tableName) + '</span><span>' + esc(String(orders.length)) + (orders.length === 1 ? ' order' : ' orders') + '</span></div>' +
    '<div class="receipt__row"><span>Paid</span><span>' + formatDateTime(payment.at || session.closedAt) + '</span></div>' +
    '<div class="receipt__row"><span>Method</span><span>' + esc((payment.method || 'other').toUpperCase()) + '</span></div>' +
    '<div class="receipt__rule"></div>' +
    '<table class="receipt__items">' + rows.join('') + '</table>' +
    '<div class="receipt__rule"></div>' +
    '<div class="summary">' + lines.join('') + '</div>' +
    '<div class="receipt__rule"></div>' +
    '<p class="receipt__meta receipt__center">Thank you — paid in full</p>' +
    '<p class="receipt__meta receipt__center">Powered by TableTap</p>';

  if (window.lucide) window.lucide.createIcons();
}

const printBtn = document.getElementById('print-receipt');
if (printBtn) printBtn.addEventListener('click', () => window.print());

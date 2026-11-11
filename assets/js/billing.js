/* ==========================================================================
   TableTap — billing.js
   The one place money is calculated. Every page imports this.

   Order of calculation, always:
     subtotal → discount → charges → tax → tip → rounding → total
   Tips are never taxed. Charges are calculated on the discounted subtotal.
   ========================================================================== */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function applyRounding(value, mode) {
  const v = Number(value) || 0;
  if (mode === '0.05') return Math.round(v * 20) / 20;
  if (mode === '1') return Math.round(v);
  return round2(v);
}

/** Which charges apply to this bill, given what the guest added or removed. */
export function activeCharges(settings, removedChargeIds = [], addedChargeIds = []) {
  const removed = new Set(removedChargeIds || []);
  const added = new Set(addedChargeIds || []);
  return (settings.charges || [])
    .filter((c) => c.enabled)
    .filter((c) => (c.addedByDefault === false ? added.has(c.id) : !removed.has(c.id)));
}

/** Charges the guest is allowed to change (remove if applied, add if opt-in). */
export function optionalCharges(settings) {
  return (settings.charges || []).filter((c) => c.enabled && c.customerCanRemove !== false);
}

/**
 * computeBill — the single source of truth for money.
 *
 * @param {Object}   input
 * @param {Array}    input.lines            [{ amount, taxOverride }]
 * @param {Object}   input.settings         client.settings
 * @param {Array}    input.removedChargeIds charge ids the guest removed
 * @param {Array}    input.addedChargeIds   opt-in charge ids the guest added
 * @param {Object}   input.discount         { type:'percent'|'amount', value, reason }
 * @param {Object}   input.tip              { type:'percent'|'amount', value }
 */
export function computeBill(input = {}) {
  const settings = input.settings || {};
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const inclusive = !!settings.pricesIncludeTax;
  const taxes = (settings.taxes || []).filter((t) => t.enabled);
  const charges = activeCharges(settings, input.removedChargeIds, input.addedChargeIds);

  /* 1 — subtotal ------------------------------------------------------- */
  const subtotal = round2(lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0));

  /* 2 — discount ------------------------------------------------------- */
  const discountInput = input.discount || {};
  const discountType = discountInput.type === 'amount' ? 'amount' : 'percent';
  const discountValue = Math.max(0, Number(discountInput.value) || 0);
  let discountAmount = discountType === 'amount' ? discountValue : subtotal * discountValue / 100;
  discountAmount = round2(Math.min(Math.max(0, discountAmount), subtotal));
  const discountedSubtotal = round2(subtotal - discountAmount);
  const lineScale = subtotal > 0 ? discountedSubtotal / subtotal : 0;

  /* 3 — charges (on the discounted subtotal) --------------------------- */
  const chargeLines = charges.map((c) => {
    const value = Number(c.value) || 0;
    const amount = c.type === 'fixed' ? value : discountedSubtotal * value / 100;
    return {
      id: c.id,
      name: c.name,
      type: c.type || 'percent',
      value,
      amount: round2(amount),
      applyTax: c.applyTax !== false,
      customerCanRemove: c.customerCanRemove !== false,
      addedByDefault: c.addedByDefault !== false,
    };
  }).filter((c) => c.amount > 0);

  const chargeTotal = round2(chargeLines.reduce((sum, c) => sum + c.amount, 0));

  /* 4 — tax ------------------------------------------------------------ */
  const rateOf = (list) => list.reduce((sum, t) => sum + (Number(t.rate) || 0), 0);
  const applicableFor = (override) => {
    if (override === 'none') return [];
    if (override && override !== 'default') {
      const hit = taxes.filter((t) => t.id === override);
      return hit.length ? hit : taxes;
    }
    return taxes;
  };

  const addedPerTax = new Map();     // tax collected on top
  const includedPerTax = new Map();  // tax already inside the price
  taxes.forEach((t) => { addedPerTax.set(t.id, 0); includedPerTax.set(t.id, 0); });

  // items
  lines.forEach((line) => {
    const amount = round2((Number(line.amount) || 0) * lineScale);
    if (!amount) return;
    const applicable = applicableFor(line.taxOverride || 'default');
    if (!applicable.length) return;

    if (inclusive) {
      const totalRate = rateOf(applicable);
      if (totalRate <= 0) return;
      const inside = amount - amount / (1 + totalRate / 100);
      applicable.forEach((t) => {
        const share = (Number(t.rate) || 0) / totalRate;
        includedPerTax.set(t.id, (includedPerTax.get(t.id) || 0) + inside * share);
      });
    } else {
      applicable.forEach((t) => {
        addedPerTax.set(t.id, (addedPerTax.get(t.id) || 0) + amount * (Number(t.rate) || 0) / 100);
      });
    }
  });

  // taxable charges — always charged on top, never inside the price
  chargeLines.forEach((charge) => {
    if (!charge.applyTax || !taxes.length) return;
    taxes.forEach((t) => {
      addedPerTax.set(t.id, (addedPerTax.get(t.id) || 0) + charge.amount * (Number(t.rate) || 0) / 100);
    });
  });

  const taxLines = taxes
    .map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate) || 0, amount: round2(addedPerTax.get(t.id) || 0) }))
    .filter((t) => t.amount > 0);
  const includedTaxLines = taxes
    .map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate) || 0, amount: round2(includedPerTax.get(t.id) || 0) }))
    .filter((t) => t.amount > 0);

  const taxTotal = round2(taxLines.reduce((sum, t) => sum + t.amount, 0));
  const includedTaxTotal = round2(includedTaxLines.reduce((sum, t) => sum + t.amount, 0));

  /* 5 — tip (never taxed) ---------------------------------------------- */
  const tipInput = input.tip || {};
  const tipType = tipInput.type === 'amount' ? 'amount' : 'percent';
  const tipValue = Math.max(0, Number(tipInput.value) || 0);
  const tipBase = round2(discountedSubtotal + chargeTotal + taxTotal);
  const tipAmount = round2(tipType === 'amount' ? tipValue : tipBase * tipValue / 100);

  /* 6 — total ---------------------------------------------------------- */
  const beforeRounding = round2(discountedSubtotal + chargeTotal + taxTotal + tipAmount);
  const total = applyRounding(beforeRounding, settings.rounding);
  const roundingAdjustment = round2(total - beforeRounding);

  return {
    pricesIncludeTax: inclusive,
    rounding: settings.rounding || 'none',
    subtotal,
    discount: {
      type: discountType,
      value: discountValue,
      reason: (discountInput.reason || '').trim(),
      amount: discountAmount,
    },
    discountedSubtotal,
    charges: chargeLines,
    chargeTotal,
    taxes: taxLines,
    includedTaxes: includedTaxLines,
    taxTotal,
    includedTaxTotal,
    tip: { type: tipType, value: tipValue, amount: tipAmount },
    tipBase,
    beforeRounding,
    roundingAdjustment,
    total,
  };
}

/** Charges on a saved bill, for pages that only stored the result. */
export function billFromSession(session, settings) {
  return computeBill({
    lines: (session.lines || []).map((l) => ({ amount: l.amount, taxOverride: l.taxOverride })),
    settings,
    removedChargeIds: session.removedChargeIds || [],
    addedChargeIds: session.addedChargeIds || [],
    discount: session.discount || {},
    tip: session.tip || {},
  });
}

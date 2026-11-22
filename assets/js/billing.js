/* ==========================================================================
   TableTap — billing.js
   The one place money is calculated. Every page imports this.

   Order of calculation, always:
     subtotal → discount → charges → tax → tip → rounding → total
   Tips are never taxed. Charges are calculated on the discounted subtotal.
   All internal calculations are done in integer pennies/cents to prevent rounding errors.
   ========================================================================== */

function applyRoundingCents(valueCents, mode) {
  if (mode === '0.05') return Math.round(valueCents / 5) * 5;
  if (mode === '1') return Math.round(valueCents / 100) * 100;
  return valueCents;
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

  /* 1 — subtotal (in cents/pennies) ------------------------------------ */
  const lineItems = lines.map((l) => ({
    cents: Math.round((Number(l.amount) || 0) * 100),
    taxOverride: l.taxOverride || 'default',
  }));
  const subtotalCents = lineItems.reduce((sum, l) => sum + l.cents, 0);

  /* 2 — discount ------------------------------------------------------- */
  const discountInput = input.discount || {};
  const discountType = discountInput.type === 'amount' ? 'amount' : 'percent';
  const discountValue = Math.max(0, Number(discountInput.value) || 0);
  let discountCents = 0;
  if (discountType === 'amount') {
    discountCents = Math.round(discountValue * 100);
  } else {
    discountCents = Math.round(subtotalCents * discountValue / 100);
  }
  discountCents = Math.min(Math.max(0, discountCents), subtotalCents);
  const discountedSubtotalCents = subtotalCents - discountCents;
  const lineScale = subtotalCents > 0 ? discountedSubtotalCents / subtotalCents : 0;

  /* 3 — charges (calculated on discounted subtotal) -------------------- */
  const chargeLines = charges.map((c) => {
    const value = Number(c.value) || 0;
    const cents = c.type === 'fixed'
      ? Math.round(value * 100)
      : Math.round(discountedSubtotalCents * value / 100);
    return {
      id: c.id,
      name: c.name,
      type: c.type || 'percent',
      value,
      cents,
      amount: cents / 100,
      applyTax: c.applyTax === true,
      customerCanRemove: c.customerCanRemove !== false,
      addedByDefault: c.addedByDefault !== false,
    };
  }).filter((c) => c.cents > 0);

  const chargeTotalCents = chargeLines.reduce((sum, c) => sum + c.cents, 0);

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

  const addedPerTaxCents = new Map();
  const includedPerTaxCents = new Map();
  taxes.forEach((t) => { addedPerTaxCents.set(t.id, 0); includedPerTaxCents.set(t.id, 0); });

  // items
  lineItems.forEach((l) => {
    const lineDiscountedCents = Math.round(l.cents * lineScale);
    if (!lineDiscountedCents) return;
    const applicable = applicableFor(l.taxOverride);
    if (!applicable.length) return;

    if (inclusive) {
      const totalRate = rateOf(applicable);
      if (totalRate <= 0) return;
      // Prices include tax formula: tax included = amount * rate / (100 + rate)
      const insideCents = Math.round(lineDiscountedCents * totalRate / (100 + totalRate));
      applicable.forEach((t) => {
        const share = (Number(t.rate) || 0) / totalRate;
        const taxShareCents = Math.round(insideCents * share);
        includedPerTaxCents.set(t.id, (includedPerTaxCents.get(t.id) || 0) + taxShareCents);
      });
    } else {
      applicable.forEach((t) => {
        const addedCents = Math.round(lineDiscountedCents * (Number(t.rate) || 0) / 100);
        addedPerTaxCents.set(t.id, (addedPerTaxCents.get(t.id) || 0) + addedCents);
      });
    }
  });

  // taxable charges — added on top (only if applyTax is true)
  chargeLines.forEach((charge) => {
    if (!charge.applyTax || !taxes.length) return;
    taxes.forEach((t) => {
      const addedCents = Math.round(charge.cents * (Number(t.rate) || 0) / 100);
      addedPerTaxCents.set(t.id, (addedPerTaxCents.get(t.id) || 0) + addedCents);
    });
  });

  const taxLines = taxes
    .map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate) || 0, amount: (addedPerTaxCents.get(t.id) || 0) / 100 }))
    .filter((t) => t.amount > 0);
  const includedTaxLines = taxes
    .map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate) || 0, amount: (includedPerTaxCents.get(t.id) || 0) / 100 }))
    .filter((t) => t.amount > 0);

  const taxTotalCents = Array.from(addedPerTaxCents.values()).reduce((sum, v) => sum + v, 0);
  const includedTaxTotalCents = Array.from(includedPerTaxCents.values()).reduce((sum, v) => sum + v, 0);

  /* 5 — tip (never taxed) ---------------------------------------------- */
  const tipInput = input.tip || {};
  const tipType = tipInput.type === 'amount' ? 'amount' : 'percent';
  const tipValue = Math.max(0, Number(tipInput.value) || 0);
  const tipBaseCents = discountedSubtotalCents + chargeTotalCents + taxTotalCents;
  const tipCents = tipType === 'amount'
    ? Math.round(tipValue * 100)
    : Math.round(tipBaseCents * tipValue / 100);

  /* 6 — total ---------------------------------------------------------- */
  const beforeRoundingCents = discountedSubtotalCents + chargeTotalCents + taxTotalCents + tipCents;
  const totalCents = applyRoundingCents(beforeRoundingCents, settings.rounding);
  const roundingAdjustmentCents = totalCents - beforeRoundingCents;

  return {
    pricesIncludeTax: inclusive,
    rounding: settings.rounding || 'none',
    currency: settings.currency || 'GBP',
    subtotal: subtotalCents / 100,
    discount: {
      type: discountType,
      value: discountValue,
      reason: (discountInput.reason || '').trim(),
      amount: discountCents / 100,
    },
    discountedSubtotal: discountedSubtotalCents / 100,
    charges: chargeLines.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      value: c.value,
      amount: c.amount,
      applyTax: c.applyTax,
      customerCanRemove: c.customerCanRemove,
      addedByDefault: c.addedByDefault,
    })),
    chargeTotal: chargeTotalCents / 100,
    taxes: taxLines,
    includedTaxes: includedTaxLines,
    taxTotal: taxTotalCents / 100,
    includedTaxTotal: includedTaxTotalCents / 100,
    tip: { type: tipType, value: tipValue, amount: tipCents / 100 },
    tipBase: tipBaseCents / 100,
    beforeRounding: beforeRoundingCents / 100,
    roundingAdjustment: roundingAdjustmentCents / 100,
    total: totalCents / 100,
  };
}

/** Charges on a saved bill, for pages that only stored the result. */
export function billFromSession(session, settings) {
  const lines = session.lines || (session.orderIds ? [] : []);
  return computeBill({
    lines: (lines || []).map((l) => ({ amount: l.amount, taxOverride: l.taxOverride })),
    settings,
    removedChargeIds: session.removedChargeIds || [],
    addedChargeIds: session.addedChargeIds || [],
    discount: session.discount || {},
    tip: session.tip || {},
  });
}

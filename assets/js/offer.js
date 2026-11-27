/* TableTap — the guest thank-you offer: a free menu item or a % off the bill.
   Every table visit that meets the minimum gets it, once.

   It is deliberately independent of reviews and ratings. Rewarding reviews
   breaks Google's rules, so nothing here may read, ask for or mention one. */

export const OFFER_REASON = 'Thank-you offer';
export const MAX_PERCENT = 90;

/**
 * The restaurant's offer, ready to use. `active` is false when it is off or
 * incomplete (for example the free item was deleted or is sold out).
 * @param {Object} client
 * @param {(id: string) => Object|null} findItem
 */
export function offerSettings(client, findItem) {
  const saved = (client && client.settings && client.settings.offer) || {};
  const type = saved.type === 'percent' ? 'percent' : 'item';
  const percent = Math.min(MAX_PERCENT, Math.max(0, Number(saved.percent) || 0));
  const minOrder = Math.max(0, Number(saved.minOrder) || 0);
  const item = type === 'item' && saved.itemId ? findItem(saved.itemId) : null;
  const usableItem = item && item.clientId === client.id && item.available !== false ? item : null;
  const active = saved.enabled === true && (type === 'percent' ? percent > 0 : !!usableItem);
  return { active, type, percent, minOrder, item: usableItem };
}

/** "Free Greek frappé" or "10% off your bill". */
export function offerTitle(offer) {
  return offer.type === 'percent' ? `${offer.percent}% off your bill` : `Free ${offer.item.name}`;
}

/**
 * Has this table visit already had an offer, of either type (the owner may switch
 * it mid-visit)? Rejected orders are not in `orders`.
 */
export function offerUsed(session, orders) {
  return !!(session && session.offerDiscountApplied) ||
    orders.some((order) => (order.items || []).some((line) => line.offer));
}

/**
 * Where a visit stands: 'off', 'used', 'qualifies' or 'short' (with `missing`,
 * the amount still to order).
 * @param {number} subtotal everything ordered in the visit, including this cart
 */
export function offerStatus(offer, { session, orders, subtotal }) {
  if (!offer.active) return { state: 'off' };
  if (offerUsed(session, orders)) return { state: 'used' };
  // A discount staff already gave is never replaced.
  if (offer.type === 'percent' && session && session.discount && Number(session.discount.value) > 0) return { state: 'off' };
  const missing = Math.round((offer.minOrder - subtotal) * 100) / 100;
  return missing > 0 || subtotal <= 0 ? { state: 'short', missing: Math.max(0, missing) } : { state: 'qualifies' };
}

/** The order line for a free item: the kitchen, bill and receipt all show it. */
export function freeLine(item) {
  return {
    name: `${item.name} (free offer)`,
    qty: 1,
    price: 0,
    size: 'Regular',
    addons: [],
    note: '',
    taxOverride: item.taxOverride || 'default',
    done: false,
    offer: true,
  };
}

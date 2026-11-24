# Hidden features: how to bring them back

Nothing was deleted. Two switches in `assets/js/features.js` hide the screens. Set a switch to `true` and reload to restore the screens it controls.

```js
export const ONLINE_PAYMENTS_ENABLED = false;   // online payments
export const SEATING_FLOW_ENABLED = false;      // manual seating, visit QR, backup key
```

## 1. Online payments (`ONLINE_PAYMENTS_ENABLED`)

Reason: payments are not taken for now. Guests settle outside the app.

### Guest menu (`assets/js/customer.js`)
- The cart forces the `post_pay` policy. The pay-method grid (Apple Pay, Google Pay, Card, PayPal, UPI) is hidden and the button reads "Place order". Search for `const payPolicy`.
- The pay-first rule is off. Search for `isPayFirst` (two places: `placeOrder` and the cart's place-order handler).
- Still in place, only unreachable: `showPaymentModal` and its Apple Pay, Google Pay, PayPal, UPI and card screens.
- Not hidden: "Ask for the bill" on the guest bill page. It only calls the waiter.

### Owner panel (`assets/js/owner.js`)
- "Take Payment" buttons are hidden on the live orders page, the order cards, the tables page and the floor plan. Search for `data-take-pay`.
- Bill window: Take Payment and Quick Settle are replaced by one "Close table" button (`data-pay="counter"`). With the switch on, the original buttons return.
- Floor Plan bills tab: the Pay button is replaced by "Close table".
- Settings: the "Payment Gateways & Methods" tab is removed from the tab list. Its panel is still in the page, so saving still works. Search for `|payments`.
- Settings, Security tab: the "Pay-at-Order Enforcement" row is hidden with the `hidden` attribute.
- Reports: the "Payments by method" card is hidden with the `hidden` attribute.
- Live orders: Paid and Unpaid badges are removed (`payBadge`).

### Not changed
- Super-admin plan prices ($49 Lifetime Pro, $29 Lifetime Starter) in `admin/*.html`. That is your own subscription pricing, not guest payment.
- Server side: `api/*`, the stored `settings.payments` data and the Stripe, PayPal and Razorpay settings are untouched.

## 2. Seating flow (`SEATING_FLOW_ENABLED`)

Reason: restaurant owners will not create and show a QR for every visit.

Hidden in `assets/js/owner.js` (floor plan "Tables" tab and `owner/tables.html`):
- "Seat guests" button on free tables.
- "Visit QR" and "Show visit QR" buttons.
- The small QR icon on floor plan table cards.
- The "Backup Key" line and the "failed key attempts" badge.

Hidden in Settings, Security tab: "Floor Plan Seated Check" and "Print visit QR slip" rows.

Still visible: "View QR" on the tables page. That is the permanent table QR to print.

## 3. Behaviour changes that go with the above

These are not behind a switch. To undo them, restore the old code.

- Guests join automatically (`assets/js/customer.js`):
  - `isDeviceTrusted` now trusts any device on an open visit. The original check compared the stored visit id and secret.
  - The menu page opens a visit by itself when a plain table QR is scanned (search for `Plain table QR`). Before this, the guest got a PIN prompt and "Please ask staff to seat you".
  - Result: the kitchen's ghost-order check ("Reject Ghost") never triggers, because a scan marks the table occupied first.
  - Result: anyone holding the table's QR can order. A photo of the QR works too.
- Owner floor plan: the "Start Shift" overlay only shows for floor staff, not the owner (`renderFloor`, check `session.role !== 'owner'`).

## 4. Turn everything back on

1. Open `assets/js/features.js`.
2. Set both constants to `true`.
3. Reload the owner and guest pages.
4. To also restore the PIN flow, put back the original `isDeviceTrusted` body and remove the `Plain table QR` block in `customer.js`. Use `git diff assets/js/customer.js` to see the original lines.

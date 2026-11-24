/* TableTap — feature switches.
   Set ONLINE_PAYMENTS_ENABLED to true to bring back every online-payment screen
   (guest pay methods, owner Take Payment, Payment Gateways settings, payment reports).
   All the payment code is still in place; this only hides it. */
export const ONLINE_PAYMENTS_ENABLED = false;

/* Manual seating / per-visit QR, backup key and slip. Off: the permanent table QR
   opens the visit by itself, so staff never seat guests or show a visit QR. */
export const SEATING_FLOW_ENABLED = false;

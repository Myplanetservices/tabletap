# TableTap — product truth

**What it is.** A QR table-ordering system for restaurants, bars and cafés. A guest scans the
code on the table, the menu opens in their browser, they order, and the ticket lands on a screen
at the kitchen pass. One lifetime price per restaurant.

**Who it serves, and what each of them came to do.**

| Surface | Who | What they must be able to do |
|---|---|---|
| Guest menu (`/menu`) | A diner at the table, on a phone, mid-conversation | Read the menu, see what is sold out, order with options and a note, know it went through, track it |
| Owner panel (`/owner`) | The owner, on a phone between services or a laptop in the office | See today's numbers, run the floor, edit the menu, print QR codes, manage staff, read reports |
| Kitchen screen (`/kitchen`) | A cook, two metres away, hands busy, low light | See new tickets first, know how long each has waited, tap items off, move a ticket on |
| Super admin (`/admin`) | The SaaS operator | Find a client, invite one, restrict or suspend, see what happened |

**How an order moves.** Scan → browse → add (size, add-ons, note) → place → `pending_approval`
(if the restaurant requires approval) → `new` → `preparing` → `ready` → `served`. A rejected order
tells the guest plainly that nothing was charged.

**Non-negotiables.**
- Guests never install anything, and never create an account.
- A table's QR carries the restaurant and a secret table token; regenerating it kills the old print.
- Money is per-restaurant currency, tax and service charge from settings, always shown as a total.
- The kitchen screen must be legible from two metres and work with wet hands.
- Suspended clients: owner and kitchen logins fail, the guest menu says ordering is paused.

**This build is a demo.** All data lives in the browser (`localStorage` key `tqr_db`), seeded with
12 restaurants, 180 tables, 23 dishes and 26 orders. There is no backend: "live" means
`BroadcastChannel` between tabs on the same machine. Copy is the product's own language, and any
figure shown is computed from the seeded data rather than invented per page.

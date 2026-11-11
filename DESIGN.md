# TableTap — design system

**World: the pass.** A restaurant's service language — dockets on the rail, stamped status, table
numbers called across a kitchen. The product borrows that world's *materials*, not its costume:
no ticket-printer skeuomorphism, no terminal cosplay. On working screens the world lends four
things only — type, palette, density and one signature move.

## Signature move
**The docket.** Order identity is always a ticket: a hairline card with a perforated top edge, the
table number set large in Anton, a stamped status, and figures in mono. It appears where the
product actually has tickets — the pass board on the landing page, kitchen tickets, order rows,
table cards. It is never decoration on a page that has no tickets.

## Palette
| Token | Value | Job |
|---|---|---|
| `--chalk` | `#F4F2ED` | Ground. Warm paper, not cream-and-serif. |
| `--paper` | `#FFFFFF` | Cards, sheets, the guest menu. |
| `--ink` | `#111318` | Text, the cart bar, the primary dark surface. |
| `--graphite` | `#15171C` | The shell: sidebar rail, the landing hero, the kitchen. |
| `--cobalt` | `#1B3FD8` | The committed accent: primary actions, selection, chart marks. |
| `--success / --warning / --danger` | `#0E6A3E` / `#8A5200` / `#A31D14` | Status only, never decoration. |

Colour does real work: the graphite rail separates shell from content; cobalt marks the one action
per screen; state colours are confined to badges, timers and banners. The guest menu takes the
restaurant's own accent from settings, which is why the demo restaurant (The Olive Table) runs
oxblood `#7A2E2B` while the product chrome stays cobalt.

## Type
| Voice | Face | Use |
|---|---|---|
| Display | **Anton** | Table numbers, page titles, marketing headlines. Uppercase, 0.9 line-height, never below 20px. |
| Body | **Archivo** | Everything a person reads or clicks. 16px/1.6, measure capped at 72ch. |
| Data | **Spline Sans Mono** | Money, timers, order numbers, table counts, status stamps, labels. Never prose. |

All three are self-hosted in `assets/fonts` (OFL) — no third-party request at runtime.
Tracking floor −0.04em; body copy never below 14px; tabular numerals everywhere figures align.

## Surfaces and depth
Border *or* shadow, never both. Cards are 12px radius with a 1px hairline (`--line`); the shell is
the only shadowed surface that lifts (drawers, modals, the pass board). Pills are for small
controls; status is a 4px-radius stamp, not a pill. No gradient fills, no glass, no side stripes.

## Density
Operate surfaces are dense and quiet: 32px table rows, 40px controls, 24px card padding, section
rules instead of nested cards. Marketing breathes: 64–96px section rhythm, one idea per band.

## Motion
One authored moment per page, never a fade on every section. The landing hero rises and the pass
board settles (560–780ms, `cubic-bezier(.2,.7,.2,1)`); the kitchen flashes a new ticket and pings
its live dot. Everything else is a 200ms state change. `prefers-reduced-motion` removes all of it.

## Browser surfaces
Selection is cobalt on white. Carets take the accent. Scrollbars are thin and themed. Focus is a
2px ring with 2px offset on every interactive element, including inside drawers and modals.
Numerals are tabular wherever data aligns.

## Component contract
Class names are stable and shared by all 31 pages (`assets/css/style.css`). Panels reuse
`.app-shell`; the guest app is a 480px column on desktop; the kitchen is the same tokens in
`.theme-dark`. Page-specific JS renders markup with these same classes, so a token change reaches
every surface at once.

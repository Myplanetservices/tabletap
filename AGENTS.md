# Working rules for this project

## UI work always goes through the Impeccable skill

Any task that touches the interface — new pages, components, redesigns, audits, polish,
animation, UX copy — is a **design task** and must follow the Impeccable doctrine before code
is written. Source: `pbakaus/impeccable` (https://impeccable.style). Read the skill's own files
(`SKILL.src.md`, `reference/new-work.md`, `reference/craft-floor.md`, `reference/mode-*.md`)
when the skill is not installed as a skill.

**Order of work**

1. **Name the mode** from the surface, not the product: Persuade (landing, pricing, marketing),
   Operate (dashboards, editors, settings, admin), Read (docs), Experience (galleries).
2. **Decide what is already true.** Refinement preserves the incumbent identity; a redesign
   replaces the visual world and treats the old look as anti-reference. Never split the
   difference into polish on a discarded look.
3. **Settle the direction before markup.** A committed world lends an Operate screen only four
   things: type, palette, density, and one named signature move. It never supplies the layout,
   navigation model, or controls.
4. **Read `craft-floor.md` immediately before editing.** Then build.
5. **Verify by looking at the render** at the sizes it ships at (375 / 768 / 1024 / 1440), and
   batch the checks into one look.

**Hard rules carried from the craft floor**

- No eyebrow/kicker above a heading. No numbered section markers unless the sequence is information.
- No identical icon-heading-text card grids as page structure; no nested cards; no hero-metric template.
- No gradient text, no decorative glass/blur, no side-stripe borders, no hard offset shadows.
- No monospace as a costume — only for code, data, measurement. No emoji or glyphs as icons.
- Border **or** shadow, never both. Radii 12–16px; pills only for small controls.
- Body measure 65–75ch, display capped at 6rem, tracking never below −0.04em.
- Body/placeholder contrast ≥ 4.5:1; large text ≥ 3:1; never grey secondary text on a coloured surface.
- Theme the browser surfaces: selection, caret, scrollbars, focus rings, underline offset, tabular numerals.
- One authored motion moment per page, exponential ease-out, from an already-visible default.
- Ship every state: hover, focus, disabled, loading, error, empty.

## Project specifics

- Product truth lives in `PRODUCT.md`; the committed visual world, tokens and component contract
  live in `DESIGN.md`. Both are authoritative — do not invent missing context, ask.
- `assets/css/style.css` is the single design system for all 31 pages. Class names are a contract:
  page scripts render markup with the same classes, so token changes reach every surface at once.
- Fonts are self-hosted in `assets/fonts` (Anton, Archivo, Spline Sans Mono — OFL). Do not add a
  third-party font request.
- The demo runs on ES modules: serve it over HTTP (`python3 -m http.server 8000`), never `file://`.

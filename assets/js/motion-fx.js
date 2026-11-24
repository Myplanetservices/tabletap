/* ==========================================================================
   TableTap — motion-fx.js
   Shared motion for the whole site, built on Motion (the Framer Motion engine for
   plain JavaScript). One small module, loaded on every public and app page:

     · springy hover and press feedback on buttons and cards (everywhere)
     · entrance of sign-in cards, and of anything marked data-reveal (public pages)
     · scroll-triggered reveal of marked elements (public pages)

   It never animates the live app content (orders, tickets, tables) on arrival, so
   screens that update in real time do not flicker. With reduced motion requested it
   does nothing at all. If the CDN is unreachable the pages work as they always did.
   ========================================================================== */

import { animate, inView, stagger } from 'https://cdn.jsdelivr.net/npm/motion@12.23.12/+esm';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const EASE = [0.22, 1, 0.36, 1];
const SPRING = { type: 'spring', stiffness: 420, damping: 24 };

/** Hover lift and press squeeze for buttons and clickable cards.
 *  Uses event delegation, so buttons drawn later by the app (tables, tickets, modals) get it too. */
const HOVER_SELECTOR = '.btn:not(.btn--icon), .hero-pillar, .f-card, .price-card, .faq__trigger, .shot__window, .table-card, .stat';
export function interactive(selector = HOVER_SELECTOR) {
  if (reduce) return;
  let current = null;
  const target = (event) => (event.target instanceof Element ? event.target.closest(selector) : null);
  const isButton = (el) => el.matches('.btn');
  const settle = (el) => animate(el, { y: 0, scale: 1 }, SPRING);

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const el = target(event);
    if (!el || el === current || el.matches('[disabled]')) return;
    if (current) settle(current);
    current = el;
    animate(el, { y: -2, scale: isButton(el) ? 1.03 : 1.012 }, SPRING);
  });
  document.addEventListener('pointerout', (event) => {
    if (!current) return;
    const to = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (to && current.contains(to)) return;
    settle(current);
    current = null;
  });
  document.addEventListener('pointerdown', (event) => {
    const el = target(event);
    if (el && !el.matches('[disabled]')) animate(el, { scale: 0.97 }, { duration: 0.1 });
  });
  const release = (event) => {
    const el = target(event);
    if (el) animate(el, { y: el === current ? -2 : 0, scale: el === current && isButton(el) ? 1.03 : 1 }, SPRING);
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
}

/** Entrance for centred cards (sign-in, kitchen login) and anything marked data-enter. */
export function pageEnter() {
  if (reduce) return;
  const cards = document.querySelectorAll('.auth-card, .kitchen-card, [data-enter]');
  if (!cards.length) return;
  // No opacity change: the card is already painted, so it only settles into place (no flash).
  animate(cards, { y: [18, 0], scale: [0.985, 1] }, { duration: 0.55, ease: EASE, delay: stagger(0.08) });
}

/** Elements marked data-reveal fade and rise when they scroll into view. */
export function revealOnScroll(root = document) {
  const targets = [...root.querySelectorAll('[data-reveal]')];
  if (!targets.length) return;
  if (reduce) { targets.forEach((el) => { el.style.opacity = 1; }); return; }
  document.documentElement.classList.add('motion-ready');
  targets.forEach((el) => {
    inView(el, () => {
      const delay = Number(el.getAttribute('data-reveal-delay') || 0);
      animate(el, { opacity: [0, 1], y: [30, 0] }, { duration: 0.75, ease: EASE, delay });
    }, { amount: 0.2 });
  });
}

/** Header gets a soft shadow once the page has scrolled. */
export function headerShadow() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

export function initMotion() {
  interactive();
  pageEnter();
  revealOnScroll();
  headerShadow();
}

// Pages that only import the helpers (the home page) call initMotion themselves.
if (!document.currentScript && !window.__ttMotionManual) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMotion);
  else initMotion();
}

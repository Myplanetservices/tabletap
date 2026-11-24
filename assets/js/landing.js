/* ==========================================================================
   TableTap — landing.js (home page)
   GSAP + ScrollTrigger: the live phone in the hero and the pinned, horizontally
   scrolling "Inside TableTap" screenshot carousel.
   Motion (assets/js/motion-fx.js): entrance, reveals, hover and press springs,
   floating chips, scroll progress bar, header shadow.
   GSAP is loaded as a classic script before this module; without it (or with
   reduced motion) the page still reads and works, the carousel becomes a swipe strip.
   ========================================================================== */

import { animate, scroll, stagger } from 'https://cdn.jsdelivr.net/npm/motion@12.23.12/+esm';
import { initMotion, EASE } from './motion-fx.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

/* ------------------------------------------------------------ Motion: page ---- */
function heroEntrance() {
  if (reduce) return;
  const parts = [
    '.hero-badge-wrap', '.hero-redesign__title', '.hero-redesign__lead',
    '.hero-pillar', '.hero-redesign__actions', '[data-hero-phone]',
  ];
  const nodes = parts.flatMap((sel) => [...document.querySelectorAll('.hero-split ' + sel)]);
  if (!nodes.length) return;
  nodes.forEach((n) => { n.style.opacity = 0; });
  animate(nodes, { opacity: [0, 1], y: [28, 0] }, { duration: 0.8, ease: EASE, delay: stagger(0.09, { startDelay: 0.1 }) });
}

function floatChips() {
  if (reduce) return;
  document.querySelectorAll('.ip-chip').forEach((chip, i) => {
    animate(chip, { y: [0, -9, 0] }, { duration: 4.2 + i, repeat: Infinity, ease: 'easeInOut', delay: i * 0.6 });
  });
}

function progressBar() {
  const bar = document.getElementById('scroll-progress');
  if (!bar || reduce) return;
  scroll(animate(bar, { scaleX: [0, 1] }, { ease: 'linear' }));
}

/* ---------------------------------------------------------- GSAP: hero phone -- */
function heroPhone() {
  const img = document.querySelector('.ip__scroll');
  const screen = document.querySelector('.ip__screen');
  if (!img || !screen || !gsap || reduce) return;

  const start = () => {
    const max = img.offsetTop + img.offsetHeight - screen.clientHeight;
    if (max <= 0) return;
    // Scroll the menu down and back up, slowly, like a guest browsing it.
    const tl = gsap.timeline({ repeat: -1, yoyo: true, repeatDelay: 1.4, delay: 1.2 });
    tl.to(img, { y: -max, duration: max / 38, ease: 'sine.inOut' });
    const col = document.querySelector('[data-hero-phone]');
    if (col) {
      col.addEventListener('mouseenter', () => tl.pause());
      col.addEventListener('mouseleave', () => tl.play());
    }
  };
  if (img.complete) start(); else img.addEventListener('load', start, { once: true });

  if (ScrollTrigger) {
    gsap.to('.ip', {
      yPercent: -6, ease: 'none',
      scrollTrigger: { trigger: '.hero-redesign', start: 'top top', end: 'bottom top', scrub: true },
    });
  }
}

/* -------------------------------------------- GSAP: Inside TableTap carousel -- */
function insideCarousel() {
  const section = document.getElementById('inside');
  if (!section || !gsap || !ScrollTrigger) return;
  const pin = section.querySelector('.inside__pin');
  const viewport = section.querySelector('.inside__viewport');
  const track = section.querySelector('.inside__track');
  const slides = [...section.querySelectorAll('.shot')];
  const bar = section.querySelector('.inside__bar i');
  const count = section.querySelector('.inside__count');
  if (!pin || !viewport || !track || !slides.length) return;

  const pad = (n) => String(n).padStart(2, '0');
  const setMeter = (progress) => {
    if (bar) bar.style.transform = 'scaleX(' + Math.max(0.04, progress) + ')';
    if (count) count.textContent = pad(Math.min(slides.length, Math.round(progress * (slides.length - 1)) + 1)) + ' / ' + pad(slides.length);
  };
  setMeter(0);

  const mm = gsap.matchMedia();
  mm.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', () => {
    const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
    const tween = gsap.to(track, {
      x: () => -distance(), ease: 'none',
      scrollTrigger: {
        trigger: pin, start: 'top top', end: () => '+=' + (distance() + window.innerHeight * 0.25),
        pin: true, scrub: 0.7, anticipatePin: 1, invalidateOnRefresh: true,
        onUpdate: (self) => setMeter(self.progress),
      },
    });
    // Each screenshot eases in as it enters the view
    slides.forEach((slide) => {
      const win = slide.querySelector('.shot__window');
      gsap.fromTo(win, { scale: 0.92, opacity: 0.55 }, {
        scale: 1, opacity: 1, ease: 'none',
        scrollTrigger: { trigger: slide, containerAnimation: tween, start: 'left 92%', end: 'left 52%', scrub: true },
      });
    });
    return () => setMeter(0);
  });
  window.addEventListener('load', () => ScrollTrigger.refresh());
}

/* ------------------------------------------------------------------ start ----- */
window.__ttMotionManual = true;
initMotion();
heroEntrance();
floatChips();
progressBar();
heroPhone();
insideCarousel();

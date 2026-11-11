/* ==========================================================================
   TableTap — ui.js
   UI toggles only: mobile menu, FAQ accordion, modals, drawers, bottom sheet,
   dropdown menus, tabs, password visibility. No data logic.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- Mobile navigation (landing header) ---------- */
  document.querySelectorAll('[data-nav-toggle]').forEach(function (btn) {
    var nav = document.getElementById(btn.getAttribute('aria-controls'));
    if (!nav) return;
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  });

  /* ---------- Accordion (FAQ) ---------- */
  document.querySelectorAll('[data-accordion]').forEach(function (acc) {
    var single = acc.getAttribute('data-accordion') === 'single';
    acc.querySelectorAll('.faq__trigger').forEach(function (trigger) {
      var panel = document.getElementById(trigger.getAttribute('aria-controls'));
      if (!panel) return;
      trigger.addEventListener('click', function () {
        var open = trigger.getAttribute('aria-expanded') === 'true';
        if (single && !open) {
          acc.querySelectorAll('.faq__trigger[aria-expanded="true"]').forEach(function (other) {
            other.setAttribute('aria-expanded', 'false');
            var otherPanel = document.getElementById(other.getAttribute('aria-controls'));
            if (otherPanel) otherPanel.classList.remove('is-open');
          });
        }
        trigger.setAttribute('aria-expanded', String(!open));
        panel.classList.toggle('is-open', !open);
      });
    });
  });

  /* ---------- Modal ---------- */
  function openModal(modal) {
    modal.classList.add('is-open');
    modal.removeAttribute('hidden');
    var focusable = modal.querySelector('[data-autofocus], .btn, input, button');
    if (focusable) focusable.focus({ preventScroll: true });
  }
  function closeModal(modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('hidden', '');
  }
  document.querySelectorAll('[data-modal-open]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var modal = document.getElementById(btn.getAttribute('data-modal-open'));
      if (modal) openModal(modal);
    });
  });
  document.querySelectorAll('[data-modal-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var modal = btn.closest('.modal');
      if (modal) closeModal(modal);
    });
  });
  document.querySelectorAll('.modal').forEach(function (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal(modal);
    });
  });

  /* ---------- Drawer / bottom sheet ---------- */
  function setPanel(id, open) {
    var panel = document.getElementById(id);
    if (!panel) return;
    panel.classList.toggle('is-open', open);
    var scrim = document.querySelector('[data-scrim-for="' + id + '"]');
    if (scrim) scrim.classList.toggle('is-open', open);
  }
  document.querySelectorAll('[data-drawer-open], [data-sheet-open]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-drawer-open') || btn.getAttribute('data-sheet-open');
      setPanel(id, true);
    });
  });
  document.querySelectorAll('[data-panel-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panel = btn.closest('.drawer, .bottom-sheet, .app-shell__sidebar');
      if (!panel) return;
      if (panel.classList.contains('app-shell__sidebar')) {
        panel.classList.remove('is-open');
        var scrim = document.querySelector('.app-shell__scrim');
        if (scrim) scrim.classList.remove('is-open');
      } else {
        setPanel(panel.id, false);
      }
    });
  });
  document.querySelectorAll('[data-scrim-for]').forEach(function (scrim) {
    scrim.addEventListener('click', function () {
      setPanel(scrim.getAttribute('data-scrim-for'), false);
    });
  });

  /* ---------- App shell sidebar (mobile drawer) ---------- */
  document.querySelectorAll('[data-sidebar-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var sidebar = document.getElementById(btn.getAttribute('aria-controls'));
      if (!sidebar) return;
      var open = sidebar.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
      var scrim = document.querySelector('.app-shell__scrim');
      if (scrim) scrim.classList.toggle('is-open', open);
    });
  });

  /* ---------- Dropdown menu ---------- */
  document.querySelectorAll('[data-dropdown-trigger]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = document.getElementById(btn.getAttribute('aria-controls'));
      if (!menu) return;
      var open = menu.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.dropdown__menu.is-open').forEach(function (menu) {
      menu.classList.remove('is-open');
      var trigger = document.querySelector('[aria-controls="' + menu.id + '"]');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- Tabs ---------- */
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    var tabs = Array.prototype.slice.call(group.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { activate(index); });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        if (next === null) return;
        e.preventDefault();
        tabs[next].focus();
        activate(next);
      });
    });
    function activate(index) {
      tabs.forEach(function (tab, i) {
        var panel = document.getElementById(tab.getAttribute('aria-controls'));
        var selected = i === index;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (panel) panel.hidden = !selected;
      });
    }
  });

  /* ---------- Password show / hide ---------- */
  document.querySelectorAll('[data-password-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.getElementById(btn.getAttribute('aria-controls'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      var icon = btn.querySelector('[data-lucide]');
      if (icon && window.lucide) {
        icon.setAttribute('data-lucide', show ? 'eye-off' : 'eye');
        window.lucide.createIcons();
      }
    });
  });

  /* ---------- Demo forms: swap form for its success state ---------- */
  document.querySelectorAll('[data-demo-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var card = form.closest('.auth-card, .kitchen-card');
      if (!card) return;
      var success = card.querySelector('[data-form-success]');
      if (!success) return;
      form.hidden = true;
      var intro = card.querySelector('[data-form-intro]');
      if (intro) intro.hidden = true;
      success.hidden = false;
      var focusTarget = success.querySelector('.btn, [tabindex="-1"]');
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    });
  });

  /* ---------- Customer: search field toggle ---------- */
  document.querySelectorAll('[data-search-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var field = document.getElementById(btn.getAttribute('aria-controls'));
      if (!field) return;
      var open = field.hasAttribute('hidden');
      if (open) {
        field.removeAttribute('hidden');
      } else {
        field.setAttribute('hidden', '');
      }
      btn.setAttribute('aria-expanded', String(open));
      var input = field.querySelector('input');
      if (open && input) input.focus();
    });
  });

  /* ---------- Customer: quantity stepper (visual only) ---------- */
  document.querySelectorAll('[data-qty]').forEach(function (stepper) {
    var valueEl = stepper.querySelector('[data-qty-val]');
    var priceEl = document.querySelector('[data-qty-price]');
    if (!valueEl) return;
    stepper.querySelectorAll('[data-qty-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = (parseInt(valueEl.textContent, 10) || 1) + parseInt(btn.getAttribute('data-qty-step'), 10);
        if (next < 1) next = 1;
        if (next > 20) next = 20;
        valueEl.textContent = String(next);
        if (priceEl && priceEl.getAttribute('data-unit')) {
          var unit = parseFloat(priceEl.getAttribute('data-unit'));
          priceEl.textContent = 'Add to order · $' + (unit * next).toFixed(2);
        }
      });
    });
  });

  /* ---------- Escape closes overlays ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal.is-open').forEach(closeModal);
    document.querySelectorAll('.drawer.is-open, .bottom-sheet.is-open').forEach(function (panel) {
      setPanel(panel.id, false);
    });
    var sidebar = document.querySelector('.app-shell__sidebar.is-open');
    if (sidebar) sidebar.classList.remove('is-open');
    var scrim = document.querySelector('.app-shell__scrim.is-open');
    if (scrim) scrim.classList.remove('is-open');
    document.querySelectorAll('.dropdown__menu.is-open').forEach(function (menu) {
      menu.classList.remove('is-open');
    });
  });
})();

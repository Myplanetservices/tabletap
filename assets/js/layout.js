/* ==========================================================================
   TableTap — layout.js
   Single source of truth for Owner & Admin Shell (Sidebar & Top Bar).
   ========================================================================== */

import * as store from './store.js';
import {
  currentClient, getSession, getAdminSession, logout, floorLogout, stopImpersonation,
  OWNER_SESSION_KEY, KITCHEN_SESSION_KEY, FLOOR_SESSION_KEY,
} from './auth.js';
import { esc, initials } from './helpers.js';
import { on } from './realtime.js';
import { emailProblems, acknowledgeEmailProblems, retryEmail } from './mailer.js';

const EMAIL_PROBLEM_TEXT = {
  rate_limited: 'the hourly email limit was reached',
  failed: 'the email service rejected them',
  not_configured: 'the email service is not set up',
};

/* Persistent warning for undelivered emails. Admin sees all; an owner sees emails to their own address. */
function renderEmailAlert(topbarContainer, { isAdmin, client, session }) {
  if (!topbarContainer || (!isAdmin && session && session.role && session.role !== 'owner')) return;
  let host = document.getElementById('email-alert');
  if (!host) {
    host = document.createElement('div');
    host.id = 'email-alert';
    topbarContainer.appendChild(host);
  }

  const ownerEmail = isAdmin ? '' : ((store.getAll('owners').find((o) => client && o.clientId === client.id) || {}).email || session.email || '');
  const draw = () => {
    if (!isAdmin && !ownerEmail) { host.innerHTML = ''; return; }
    const problems = emailProblems(ownerEmail);
    if (!problems.length) { host.innerHTML = ''; return; }

    const reasons = [...new Set(problems.map((p) => EMAIL_PROBLEM_TEXT[p.deliveryStatus] || 'delivery failed'))];
    const detail = problems.find((p) => p.deliveryStatus === 'failed' && p.deliveryDetail);
    const who = isAdmin
      ? problems.slice(0, 3).map((p) => esc(p.to)).join(', ') + (problems.length > 3 ? ' and ' + (problems.length - 3) + ' more' : '')
      : 'your account';
    host.innerHTML = '<div class="banner banner--warning" role="alert" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:10px 16px;background:#FBF0DF;color:#8A5200;border-bottom:1px solid #E8D3AB;font-size:0.875rem;">' +
      '<span style="flex:1 1 320px;"><strong>' + problems.length + (problems.length === 1 ? ' email was' : ' emails were') + ' not delivered</strong> to ' + who + ': ' +
      esc(reasons.join(' and ')) + '.' + (detail ? ' ' + esc(String(detail.deliveryDetail).slice(0, 140)) : '') +
      (isAdmin ? ' They are kept in the mailbox.' : ' Please tell your administrator.') + '</span>' +
      (isAdmin ? '<button class="btn btn--xs btn--secondary" type="button" data-email-retry>Retry now</button>' : '') +
      '<button class="btn btn--xs btn--primary" type="button" data-email-ack>Acknowledge</button></div>';

    host.querySelector('[data-email-ack]').addEventListener('click', () => {
      acknowledgeEmailProblems(problems.map((p) => p.id), (session && session.name) || '');
    });
    const retry = host.querySelector('[data-email-retry]');
    if (retry) retry.addEventListener('click', () => {
      retry.disabled = true;
      retry.textContent = 'Retrying…';
      problems.forEach((p) => retryEmail(p.id));
    });
  };

  draw();
  window.addEventListener('tt:email-status', draw);
  on('*', draw); // changes merged from another device (e.g. an email failing on the admin's screen)
}

/* auth.js has no currentSession / isImpersonating exports; derive them here. */
function currentSession(isAdmin) {
  if (isAdmin) return getAdminSession();
  if ((document.body.getAttribute('data-page') || '') === 'floor') {
    return getSession(FLOOR_SESSION_KEY) || getSession(OWNER_SESSION_KEY);
  }
  return getSession(OWNER_SESSION_KEY) || getSession(KITCHEN_SESSION_KEY) || getSession(FLOOR_SESSION_KEY);
}

function isImpersonating() {
  const s = getSession(OWNER_SESSION_KEY);
  return !!(s && s.impersonating);
}

/* Run one piece of the shell; on failure log it and return the fallback so the rest still draws. */
function safe(label, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.error(`[layout] ${label} failed:`, err);
    return fallback;
  }
}

function plainNavLink(item, isCurrent) {
  return `
    <a class="nav-link ${isCurrent ? 'active' : ''}" href="${item.href}" ${isCurrent ? 'aria-current="page"' : ''} data-nav-id="${item.id}">
      <span class="nav-link__text">${String(item.label)}</span>
    </a>`;
}

export const OWNER_NAV = [
  {
    group: 'Service',
    items: [
      { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'layout-dashboard' },
      { id: 'live-orders', label: 'Live Orders', href: 'orders.html', icon: 'receipt', hasBadge: true },
      { id: 'order-history', label: 'Order History', href: 'order-history.html', icon: 'history' },
      { id: 'floor', label: 'Floor Plan', href: 'floor.html', icon: 'layout-grid' },
    ],
  },
  {
    group: 'Manage',
    items: [
      { id: 'menu', label: 'Menu', href: 'menu.html', icon: 'book-open' },
      { id: 'tables', label: 'Tables & QR', href: 'tables.html', icon: 'qr-code' },
      { id: 'staff', label: 'Staff', href: 'staff.html', icon: 'users' },
    ],
  },
  {
    group: 'Business',
    items: [
      { id: 'reports', label: 'Reports', href: 'reports.html', icon: 'trending-up', restrictionKey: 'reports' },
      { id: 'settings', label: 'Settings', href: 'settings.html', icon: 'settings' },
      { id: 'account', label: 'Account', href: 'account.html', icon: 'user' },
    ],
  },
];

export const ADMIN_NAV = [
  {
    group: 'Navigation',
    items: [
      { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'layout-dashboard' },
      { id: 'clients', label: 'Clients', href: 'clients.html', icon: 'users' },
      { id: 'invites', label: 'Invites', href: 'invites.html', icon: 'mail' },
      { id: 'activity', label: 'Activity Log', href: 'activity.html', icon: 'history' },
      { id: 'payments', label: 'Payments', href: 'payments.html', icon: 'wallet' },
      { id: 'plans', label: 'Plans', href: 'plans.html', icon: 'credit-card' },
      { id: 'settings', label: 'Settings', href: 'settings.html', icon: 'settings' },
    ],
  },
];

export function getLiveOrdersCount(clientId) {
  if (!clientId) return 0;
  return store.query('orders', (o) => o.clientId === clientId && (o.status === 'new' || o.status === 'pending_approval')).length;
}

export function initLayout() {
  const isAdmin = window.location.pathname.includes('/admin/') || document.body.dataset.role === 'admin';
  const rawPage = (document.body.getAttribute('data-page') || '').toLowerCase().replace(/_/g, '-');
  // data-page also picks the page renderer in owner.js/admin.js, so sub-pages keep their own
  // value and are mapped to the nav item they belong to here.
  const NAV_ALIASES = { orders: 'live-orders', 'menu-item': 'menu', 'client-detail': 'clients' };
  const activePage = NAV_ALIASES[rawPage] || rawPage;
  const sidebarContainer = document.getElementById('app-sidebar');
  const topbarContainer = document.getElementById('app-topbar');

  if (!sidebarContainer && !topbarContainer) return;

  const client = isAdmin ? null : safe('currentClient', () => currentClient(), null);
  const session = safe('currentSession', () => currentSession(isAdmin), null) || {};
  const isWaiter = !isAdmin && session.role === 'floor';

  /* ----------------------------------------------------------- Sidebar -- */
  if (sidebarContainer) {
    let brandHtml = '';
    let navGroupsHtml = '';
    let footerHtml = '';

    if (isAdmin) {
      brandHtml = safe('admin brand', () => `
        <div class="app-shell__brand">
          <span class="brand__mark"><i data-lucide="shield"></i></span>
          <span class="app-shell__brand-text">
            <span class="brand__name">TableTap Admin</span>
            <span class="app-shell__brand-sub">MyPlanetServices</span>
          </span>
        </div>`, '');

      navGroupsHtml = ADMIN_NAV.map((grp) => `
        <div class="app-shell__nav-group">
          ${grp.group !== 'Navigation' ? `<p class="app-shell__nav-label">${esc(grp.group)}</p>` : ''}
          ${grp.items.map((item) => {
            const isCurrent = activePage === item.id;
            return safe(`nav item "${item.id}"`, () => `
              <a class="nav-link ${isCurrent ? 'active' : ''}" href="${item.href}" ${isCurrent ? 'aria-current="page"' : ''}>
                <i data-lucide="${item.icon}"></i>
                <span class="nav-link__text">${esc(item.label)}</span>
              </a>`, plainNavLink(item, isCurrent));
          }).join('')}
        </div>`).join('');

      footerHtml = safe('admin footer', () => `
        <div class="app-shell__sidebar-footer">
          <div class="row">
            <span class="avatar">${initials(session.name || 'Admin')}</span>
            <span class="app-shell__brand-text">
              <span class="owner-name">${esc(session.name || 'Admin User')}</span>
              <span class="app-shell__brand-sub">Super Admin</span>
            </span>
            <a class="btn btn--icon" href="login.html" id="layout-logout-btn" aria-label="Log out"><i data-lucide="log-out"></i></a>
          </div>
        </div>`, '');
    } else if (isWaiter) {
      brandHtml = safe('waiter brand', () => `
        <div class="app-shell__brand">
          <span class="brand__mark"><i data-lucide="qr-code"></i></span>
          <span class="app-shell__brand-text">
            <span class="brand__name">TableTap</span>
            <span class="app-shell__brand-sub">${esc(client ? client.name : '')}</span>
          </span>
        </div>`, '');
      navGroupsHtml = `
        <div class="app-shell__nav-group">
          <p class="app-shell__nav-label">Waiter</p>
          <a class="nav-link active" href="${location.pathname}" aria-current="page" data-nav-id="floor">
            <i data-lucide="concierge-bell"></i>
            <span class="nav-link__text">My tasks</span>
          </a>
        </div>`;
      footerHtml = safe('waiter footer', () => `
        <div class="app-shell__sidebar-footer">
          <div class="row">
            <span class="avatar">${initials(session.name || 'Waiter')}</span>
            <span class="app-shell__brand-text">
              <span class="owner-name">${esc(session.name || 'Waiter')}</span>
              <span class="app-shell__brand-sub">Waiter</span>
            </span>
            <a class="btn btn--icon" href="../auth/waiter-login.html" id="layout-logout-btn" aria-label="Log out"><i data-lucide="log-out"></i></a>
          </div>
        </div>`, '');
    } else {
      const clientName = client ? client.name : 'Spice Route';
      brandHtml = safe('owner brand', () => `
        <div class="app-shell__brand">
          <span class="brand__mark"><i data-lucide="qr-code"></i></span>
          <span class="app-shell__brand-text">
            <span class="brand__name">TableTap</span>
            <span class="app-shell__brand-sub">${esc(clientName)}</span>
          </span>
        </div>`, '');

      navGroupsHtml = OWNER_NAV.map((grp) => {
        const visibleItems = grp.items.filter((item) => safe(`nav filter "${item.id}"`, () => {
          if (item.restrictionKey === 'reports') {
            return !(client && client.restrictions && client.restrictions.reports === false);
          }
          return true;
        }, true));

        return `
          <div class="app-shell__nav-group">
            <p class="app-shell__nav-label">${esc(grp.group)}</p>
            ${visibleItems.map((item) => {
              const isCurrent = activePage === item.id || (item.id === 'live-orders' && activePage === 'orders');
              const badgeCount = item.hasBadge && client
                ? safe('live orders badge', () => getLiveOrdersCount(client.id), 0)
                : 0;
              return safe(`nav item "${item.id}"`, () => `
                <a class="nav-link ${isCurrent ? 'active' : ''}" href="${item.href}" ${isCurrent ? 'aria-current="page"' : ''} data-nav-id="${item.id}">
                  <i data-lucide="${item.icon}"></i>
                  <span class="nav-link__text">${esc(item.label)}</span>
                  ${item.hasBadge ? `<span class="badge badge--warning nav-link__badge" id="nav-live-orders-badge" ${badgeCount ? '' : 'style="display:none;"'}>${badgeCount}</span>` : ''}
                </a>`, plainNavLink(item, isCurrent));
            }).join('')}
          </div>`;
      }).join('');

      footerHtml = safe('owner footer', () => `
        <div class="app-shell__sidebar-footer">
          <div class="row">
            <span class="avatar">${initials(session.name || 'Owner')}</span>
            <span class="app-shell__brand-text">
              <span class="owner-name">${esc(session.name || 'Restaurant Owner')}</span>
              <span class="app-shell__brand-sub">${session.role === 'floor' ? 'Floor Staff' : session.role === 'kitchen' ? 'Kitchen Staff' : 'Owner'}</span>
            </span>
            <a class="btn btn--icon" href="../auth/login.html" id="layout-logout-btn" aria-label="Log out"><i data-lucide="log-out"></i></a>
          </div>
        </div>`, '');
    }

    sidebarContainer.innerHTML = `
      <aside class="app-shell__sidebar" id="app-sidebar-element">
        ${brandHtml}
        <nav class="app-shell__nav" aria-label="${isAdmin ? 'Admin' : 'Owner'}">
          ${navGroupsHtml}
        </nav>
        ${footerHtml}
      </aside>`;
  }

  /* ----------------------------------------------------------- Top Bar -- */
  if (topbarContainer) safe('topbar', () => {
    const pageTitle = isWaiter ? 'My tasks' : (document.body.getAttribute('data-title') || document.title.split('—')[0].split('·')[0].trim());
    const orderingOn = client ? (client.settings?.acceptOrders !== false && client.restrictions?.ordering !== false) : true;
    const impersonating = isImpersonating();
    const isFloorPage = activePage === 'floor';

    const soundEnabled = localStorage.getItem('tqr_floor_sound') !== 'false';
    const vibrateEnabled = localStorage.getItem('tqr_floor_vibrate') === 'true';

    topbarContainer.innerHTML = `
      ${impersonating && client ? `
        <div class="banner banner--warning banner--impersonate" style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:#FEF3C7;color:#92400E;font-size:0.875rem;font-weight:500;">
          <span>Viewing as <strong>${esc(client.name)}</strong> (Super Admin Impersonation)</span>
          <button class="btn btn--xs btn--secondary" type="button" data-stop-impersonation>Exit to Admin</button>
        </div>` : ''}
      <header class="app-shell__topbar">
        <div class="app-shell__topbar-left">
          <button class="btn btn--icon nav-link--menu-toggle" type="button" id="sidebar-toggle-btn" aria-controls="app-sidebar-element" aria-expanded="false" aria-label="Open menu">
            <i data-lucide="menu"></i>
          </button>
          <span class="app-shell__title">${esc(pageTitle)}</span>
        </div>
        <div class="app-shell__topbar-right">
          ${isWaiter ? '' : `<div class="topbar-search">
            <i data-lucide="search"></i>
            <label class="sr-only" for="global-search">Search</label>
            <input class="input" id="global-search" type="search" placeholder="${isAdmin ? 'Search clients…' : 'Search orders, tables…'}">
          </div>`}
          ${isFloorPage ? `
            <button class="btn btn--icon btn--sm" id="floor-sound-toggle" type="button" aria-label="Toggle sound" title="Sound alerts">
              <i data-lucide="${soundEnabled ? 'volume-2' : 'volume-x'}"></i>
            </button>
            <button class="btn btn--icon btn--sm" id="floor-vibrate-toggle" type="button" aria-label="Toggle vibration" title="Vibration alerts">
              <i data-lucide="${vibrateEnabled ? 'vibrate' : 'smartphone'}"></i>
            </button>
          ` : ''}
          ${isWaiter ? '' : `<button class="btn btn--icon" type="button" aria-label="Notifications" id="topbar-bell-btn">
            <i data-lucide="bell"></i><span class="count-dot" id="topbar-notification-dot" style="display:none;">0</span>
          </button>`}
          ${!isAdmin && !isWaiter ? `
            <span class="status-pill ${orderingOn ? '' : 'status-pill--off'}" id="topbar-ordering-pill">
              <span class="dot" aria-hidden="true"></span> Ordering ${orderingOn ? 'ON' : 'OFF'}
            </span>` : ''}
        </div>
      </header>`;
  });

  safe('email alert', () => renderEmailAlert(topbarContainer, { isAdmin, client, session }), null);

  /* ----------------------------------------------------- Event Wiring -- */
  // Mobile drawer interaction
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.getElementById('app-sidebar-element');
  const scrim = document.querySelector('.app-shell__scrim');

  function openSidebar() {
    if (sidebar) {
      sidebar.classList.add('is-open');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    }
  }

  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.remove('is-open');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = sidebar && sidebar.classList.contains('is-open');
      if (isOpen) closeSidebar();
      else openSidebar();
    });
  }

  if (scrim) {
    scrim.addEventListener('click', closeSidebar);
  }

  // Close on link click on mobile
  if (sidebar) {
    sidebar.querySelectorAll('a.nav-link').forEach((link) => {
      link.addEventListener('click', () => {
        if (window.innerWidth < 768) closeSidebar();
      });
    });
  }

  // Close on Esc key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('is-open')) {
      closeSidebar();
    }
  });

  // Logout wiring
  const logoutBtn = document.getElementById('layout-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (isWaiter) floorLogout();
      else logout();
    });
  }

  // Impersonation exit wiring
  const stopImpBtn = document.querySelector('[data-stop-impersonation]');
  if (stopImpBtn) {
    stopImpBtn.addEventListener('click', (e) => {
      e.preventDefault();
      stopImpersonation();
      window.location.href = '../admin/dashboard.html';
    });
  }

  // Floor screen sound/vibration toggles
  const floorSoundBtn = document.getElementById('floor-sound-toggle');
  if (floorSoundBtn) {
    floorSoundBtn.addEventListener('click', () => {
      const cur = localStorage.getItem('tqr_floor_sound') !== 'false';
      const next = !cur;
      localStorage.setItem('tqr_floor_sound', String(next));
      floorSoundBtn.innerHTML = `<i data-lucide="${next ? 'volume-2' : 'volume-x'}"></i>`;
      if (window.lucide) window.lucide.createIcons();
    });
  }

  const floorVibrateBtn = document.getElementById('floor-vibrate-toggle');
  if (floorVibrateBtn) {
    floorVibrateBtn.addEventListener('click', () => {
      const cur = localStorage.getItem('tqr_floor_vibrate') === 'true';
      const next = !cur;
      localStorage.setItem('tqr_floor_vibrate', String(next));
      floorVibrateBtn.innerHTML = `<i data-lucide="${next ? 'vibrate' : 'smartphone'}"></i>`;
      if (window.lucide) window.lucide.createIcons();
    });
  }

  // Live updates for Live Orders badge
  if (client) {
    function updateBadge() {
      safe('live orders badge update', () => {
        const badge = document.getElementById('nav-live-orders-badge');
        if (badge) {
          const count = getLiveOrdersCount(client.id);
          badge.textContent = String(count);
          badge.style.display = count > 0 ? '' : 'none';
        }
      });
    }
    safe('live orders badge subscribe', () => {
      on('order:new', updateBadge);
      on('order:update', updateBadge);
      on('order:status', updateBadge);
    });
  }

  safe('icons', () => { if (window.lucide) window.lucide.createIcons(); });
  safe('shell cache', () => saveShell(sidebarContainer, topbarContainer));
}

/* Keep the drawn shell (icons already rendered) so shell-boot.js can paint it at once next page. */
function saveShell(sidebarContainer, topbarContainer) {
  if (!sidebarContainer) return;
  const body = document.body;
  // Same keys and order as shell-boot.js, so both sides compute the same stamp.
  const stamp = ['tqr_admin_session', 'tqr_session', 'tqr_floor_session', 'tqr_kitchen_session']
    .map((k) => localStorage.getItem(k) || '').join('|');

  // Saved without anything page-specific, so one copy serves every page of this role:
  // shell-boot.js marks the current link and title again.
  const side = sidebarContainer.cloneNode(true);
  side.querySelectorAll('.nav-link').forEach((a) => { a.classList.remove('active'); a.removeAttribute('aria-current'); });
  let topbar = '';
  if (topbarContainer) {
    const top = topbarContainer.cloneNode(true);
    const alert = top.querySelector('#email-alert');
    if (alert) alert.remove();
    const title = top.querySelector('.app-shell__title');
    if (title) title.textContent = '';
    topbar = top.innerHTML;
  }
  localStorage.setItem(
    'tt_shell:' + (body.getAttribute('data-role') || 'app') + ':' + (body.getAttribute('data-page') === 'floor' ? 'floor' : 'std'),
    JSON.stringify({ stamp, sidebar: side.innerHTML, topbar }),
  );
}

function runLayout() {
  safe('initLayout', initLayout);
}

// Auto-initialize when loaded as a module if DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runLayout);
} else {
  runLayout();
}

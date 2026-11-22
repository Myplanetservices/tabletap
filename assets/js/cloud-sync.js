/* ==========================================================================
   TableTap — cloud-sync.js
   Settings → Cloud & Sync card for the Neon Postgres database. store.js does
   the syncing; this module shows its state and offers a connection test and
   an immediate save.
   ========================================================================== */

import { cloudStatus, flushCloud } from './store.js';
import { toast, esc, formatDateTime } from './helpers.js';

const LABELS = {
  online: 'Connected',
  connecting: 'Connecting',
  error: 'Retrying',
  off: 'Offline (local only)',
};

function badgeClass(status) {
  if (status === 'online') return 'badge badge--success';
  if (status === 'error') return 'badge badge--warning';
  return 'badge badge--neutral';
}

function statusLine(state) {
  if (state.status === 'off') {
    return 'This page could not reach the database, so changes stay on this device until you reload.';
  }
  if (state.status === 'error') return 'Last save failed: ' + state.error + '. Retrying automatically.';
  if (state.lastSyncAt) return 'Last saved ' + formatDateTime(state.lastSyncAt) + '.';
  return 'All changes are saved automatically.';
}

export function updateDatabaseStatus() {
  const state = cloudStatus();
  const badge = document.getElementById('db-status-pill');
  if (badge) {
    badge.className = badgeClass(state.status);
    badge.innerHTML = '<span class="dot" aria-hidden="true"></span> ' + esc(LABELS[state.status] || state.status);
  }
  const line = document.getElementById('db-status-line');
  if (line) line.textContent = statusLine(state);
}

window.addEventListener('tt:cloud-status', updateDatabaseStatus);

/** GET /api/health. Resolves the parsed body, or { status: 'error' } when unreachable. */
export async function checkDatabaseHealth() {
  try {
    const res = await fetch(new URL('../../api/health', import.meta.url), { cache: 'no-store' });
    return await res.json();
  } catch (err) {
    return { status: 'error', database: { connected: false, message: err.message } };
  }
}

/** Pushes any unsaved changes now and reports the result. */
export async function saveNow() {
  const state = cloudStatus();
  if (state.status === 'off') {
    toast('The database is unreachable from this page. Reload to reconnect.', 'warning');
    return false;
  }
  const ok = await flushCloud();
  toast(ok ? 'All changes saved to the database.' : 'Saving is queued and will retry: ' + (cloudStatus().error || 'busy'), ok ? 'success' : 'warning');
  return ok;
}

export function renderDatabaseSettingsCard() {
  const state = cloudStatus();
  return `
    <div class="card mt-4">
      <div class="card__header">
        <div class="row gap-2 align-center">
          <i data-lucide="database"></i>
          <span class="card__title">Cloud database</span>
        </div>
        <span class="${badgeClass(state.status)}" id="db-status-pill">
          <span class="dot" aria-hidden="true"></span> ${esc(LABELS[state.status] || state.status)}
        </span>
      </div>
      <div class="card__body stack-3">
        <p class="muted text-sm">
          Menus, tables, orders and settings are stored in Neon Postgres. Changes made on one device
          appear on your other devices within a few seconds.
        </p>
        <p class="text-sm" id="db-status-line" role="status">${esc(statusLine(state))}</p>
        <div class="row gap-2 mt-4">
          <button class="btn btn--secondary btn--sm" type="button" id="test-db-btn">
            <i data-lucide="activity"></i> Test connection
          </button>
          <button class="btn btn--primary btn--sm" type="button" id="sync-db-btn">
            <i data-lucide="refresh-cw"></i> Save now
          </button>
        </div>
      </div>
    </div>
  `;
}

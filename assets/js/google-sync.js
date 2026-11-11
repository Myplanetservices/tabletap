/* ==========================================================================
   TableTap — google-sync.js
   Two-way sync & cloud export for Google Sheets & Google Drive.
   Auto-provisions sheets/tabs, handles OAuth 2.0 with GIS,
   and implements Google Drive resumable uploads.
   ========================================================================== */

import * as store from './store.js';
import { currentClient } from './auth.js';
import { toast } from './helpers.js';

const CLIENT_ID_KEY = 'tqr_sync_client';
const SHEET_ID_KEY = 'tqr_sync_sheet';
const SYNC_ON_KEY = 'tqr_sync_on';

export const SYNC = {
  clientId: localStorage.getItem(CLIENT_ID_KEY) || '171913026468-5378g3gj958upeo0lmdis18m0e7hf52n.apps.googleusercontent.com',
  sheetId: localStorage.getItem(SHEET_ID_KEY) || '',
  on: localStorage.getItem(SYNC_ON_KEY) === '1',
  token: null,
  expiry: 0,
  busy: false
};

export function isSyncReady() {
  return !!(SYNC.on && SYNC.clientId && SYNC.sheetId);
}

function loadGIS() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      return resolve();
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google Identity Services script failed to load'));
    document.head.appendChild(s);
  });
}

export function getToken(interactive = false) {
  return new Promise((resolve, reject) => {
    if (SYNC.token && Date.now() < SYNC.expiry - 60000) {
      return resolve(SYNC.token);
    }
    if (location.protocol === 'file:') {
      return reject(new Error("Google sign-in requires an http:// or https:// server (run 'python3 -m http.server 8000')"));
    }
    if (!SYNC.clientId) {
      return reject(new Error('No Google OAuth Client ID configured'));
    }

    loadGIS().then(() => {
      let settled = false;
      const done = (fn, val) => {
        if (settled) return;
        settled = true;
        fn(val);
      };

      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: SYNC.clientId,
          scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
          callback: (resp) => {
            if (!resp || resp.error) {
              const err = resp ? resp.error : 'unknown';
              return done(reject, new Error('Sign-in failed: ' + err));
            }
            SYNC.token = resp.access_token;
            SYNC.expiry = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3300000);
            done(resolve, SYNC.token);
          },
          error_callback: (err) => {
            done(reject, new Error(err ? (err.message || err.type) : 'OAuth popup blocked or dismissed'));
          }
        });

        client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      } catch (e) {
        done(reject, new Error('Could not open sign-in: ' + e.message));
      }
    }).catch(reject);
  });
}

function apiBase() {
  return 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(SYNC.sheetId);
}

function sheetFetch(url, opts = {}, retried = false) {
  return getToken(false).then((token) => {
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
    return fetch(url, opts).then((res) => {
      if (res.status === 401 && !retried) {
        SYNC.token = null;
        return sheetFetch(url, opts, true);
      }
      if (!res.ok) {
        return res.text().then((text) => {
          let msg = text;
          try { msg = JSON.parse(text).error.message || text; } catch (_) {}
          throw new Error(msg);
        });
      }
      return res.json();
    });
  });
}

/**
 * Auto-provisions required tabs in the target spreadsheet.
 * Prevents 400 'Unable to parse range' crashes on newly created spreadsheets.
 */
export function ensureSheetsExist() {
  return sheetFetch(apiBase() + '?fields=sheets.properties.title').then((meta) => {
    const existing = (meta.sheets || []).map((s) => s.properties && s.properties.title).filter(Boolean);
    const required = ['Orders', 'Menu', 'Tables', 'Reports', 'Meta'];
    const missing = required.filter((r) => !existing.includes(r));
    if (!missing.length) return true;

    const requests = missing.map((title) => ({
      addSheet: { properties: { title } }
    }));

    return sheetFetch(apiBase() + ':batchUpdate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    }).then(() => true);
  }).catch((err) => {
    console.warn('Could not auto-provision sheets, attempting sync anyway:', err);
    return true;
  });
}

export function formatSheetRows() {
  const client = currentClient();
  const clientId = client ? client.id : null;
  const orders = store.getAll('orders').filter((o) => !clientId || o.clientId === clientId);
  const items = store.getAll('items').filter((i) => !clientId || i.clientId === clientId);
  const tables = store.getAll('tables').filter((t) => !clientId || t.clientId === clientId);
  const categories = store.categoriesOf(clientId || 'cl_olive');

  const catMap = {};
  categories.forEach((c) => { catMap[c.id] = c.name; });

  const orderRows = [['Order #', 'Date & Time', 'Table', 'Status', 'Payment', 'Subtotal', 'Tax', 'Charges', 'Total', 'Items']];
  orders.forEach((o) => {
    const linesSummary = (o.lines || []).map((l) => `${l.name} x${l.quantity || 1}`).join('; ');
    const b = o.breakdown || {};
    orderRows.push([
      o.orderNumber || o.id,
      o.createdAt || '',
      o.tableName || ('Table ' + (o.tableId || '')),
      o.status || '',
      o.paid ? 'PAID' : 'UNPAID',
      b.subtotal || '',
      b.taxTotal || '',
      b.chargesTotal || '',
      b.total || '',
      linesSummary
    ]);
  });

  const menuRows = [['ID', 'Category', 'Name', 'Price', 'Prep Time (min)', 'Available', 'Tags', 'Description']];
  items.forEach((it) => {
    menuRows.push([
      it.id,
      catMap[it.categoryId] || it.categoryId || '',
      it.name || '',
      it.price || 0,
      it.prepTime || 10,
      it.available ? 'TRUE' : 'FALSE',
      (it.tags || []).join(', '),
      it.description || ''
    ]);
  });

  const tableRows = [['ID', 'Name', 'Number', 'Capacity', 'Section', 'Active Session']];
  tables.forEach((tb) => {
    tableRows.push([
      tb.id,
      tb.name || '',
      tb.number || '',
      tb.capacity || '',
      tb.section || 'Main Dining',
      tb.currentSessionId || 'None'
    ]);
  });

  const reportRows = [['Date', 'Gross Sales', 'Orders Count', 'Completed']];
  const byDate = {};
  orders.forEach((o) => {
    const d = (o.createdAt || '').slice(0, 10) || 'Unknown';
    if (!byDate[d]) byDate[d] = { total: 0, count: 0, done: 0 };
    byDate[d].count++;
    if (o.status === 'completed' || o.paid) byDate[d].done++;
    byDate[d].total += Number((o.breakdown && o.breakdown.total) || 0);
  });
  Object.keys(byDate).sort().reverse().forEach((d) => {
    const stat = byDate[d];
    reportRows.push([d, stat.total.toFixed(2), stat.count, stat.done]);
  });

  const metaRows = [
    ['Key', 'Value'],
    ['Restaurant', client ? client.name : 'The Olive Table'],
    ['LastSync', new Date().toISOString()],
    ['App', 'TableTap POS']
  ];

  return {
    Orders: orderRows,
    Menu: menuRows,
    Tables: tableRows,
    Reports: reportRows,
    Meta: metaRows
  };
}

export function pushToSheet(silent = false) {
  if (!isSyncReady()) return Promise.resolve(false);
  if (SYNC.busy) return Promise.resolve(false);
  SYNC.busy = true;
  updateSyncChip('is-busy', 'Syncing…');

  return ensureSheetsExist().then(() => {
    const data = formatSheetRows();
    const clears = ['Orders!A2:Z2000', 'Menu!A2:Z1000', 'Tables!A2:Z500', 'Reports!A2:Z1000', 'Meta!A1:Z100'].map((r) =>
      sheetFetch(apiBase() + '/values/' + encodeURIComponent(r) + ':clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })
    );

    return Promise.all(clears).then(() => {
      const body = {
        valueInputOption: 'RAW',
        data: [
          { range: 'Orders!A1', values: data.Orders },
          { range: 'Menu!A1', values: data.Menu },
          { range: 'Tables!A1', values: data.Tables },
          { range: 'Reports!A1', values: data.Reports },
          { range: 'Meta!A1', values: data.Meta }
        ]
      };
      return sheetFetch(apiBase() + '/values:batchUpdate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    });
  }).then(() => {
    SYNC.busy = false;
    const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    updateSyncChip('is-on', 'Sheet · ' + time);
    if (!silent) toast('Synced live orders & reports to Google Sheet', 'success');
    return true;
  }).catch((err) => {
    SYNC.busy = false;
    updateSyncChip('is-off', 'Sheet · Offline');
    if (!silent) toast('Sheet sync failed: ' + err.message, 'danger');
    return false;
  });
}

/**
 * Resumable upload of database backups or large files to Google Drive.
 */
export function uploadFileToDrive(file, onProgress) {
  return getToken(true).then((token) => {
    if (file.size < 4 * 1024 * 1024) {
      const boundary = 'tabletap_' + Date.now();
      const meta = { name: file.name, mimeType: file.type || 'application/octet-stream' };
      const body = new Blob([
        '--' + boundary + '\r\n',
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(meta) + '\r\n',
        '--' + boundary + '\r\n',
        'Content-Type: ' + (file.type || 'application/octet-stream') + '\r\n\r\n',
        file, '\r\n',
        '--' + boundary + '--'
      ], { type: 'multipart/related; boundary=' + boundary });

      return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary },
        body
      }).then((res) => {
        return res.json().then((json) => {
          if (!res.ok) throw new Error((json.error && json.error.message) || 'Upload failed');
          if (onProgress) onProgress(100);
          return json;
        });
      });
    }

    // Resumable upload for files >= 4MB
    return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': file.type || 'application/octet-stream',
        'X-Upload-Content-Length': String(file.size)
      },
      body: JSON.stringify({ name: file.name, mimeType: file.type || 'application/octet-stream' })
    }).then((res) => {
      if (!res.ok) throw new Error('Could not initiate Drive upload session (' + res.status + ')');
      const location = res.headers.get('Location');
      if (!location) throw new Error('No upload location received from Google Drive');

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', location);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        if (xhr.upload && onProgress) {
          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) {
              const pct = Math.round((evt.loaded / evt.total) * 100);
              onProgress(pct);
            }
          };
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); } catch (_) { resolve({}); }
          } else {
            reject(new Error('Resumable Drive upload failed (' + xhr.status + ')'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error during Google Drive upload'));
        xhr.send(file);
      });
    });
  });
}

export function updateSyncChip(stateClass, label) {
  const chip = document.getElementById('google-sync-chip');
  if (!chip) return;
  chip.classList.remove('is-on', 'is-busy', 'is-off');
  if (stateClass) chip.classList.add(stateClass);
  const textEl = chip.querySelector('.syncchip__text');
  if (textEl && label) textEl.textContent = label;
}

export function renderSyncDialog() {
  let modal = document.getElementById('google-sync-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'google-sync-modal';
    modal.className = 'modal';
    modal.setAttribute('hidden', '');
    modal.innerHTML = `
      <div class="modal__card" style="max-width:480px">
        <div class="modal__header">
          <span class="modal__title">Google Sheets & Drive Sync</span>
          <button class="btn btn--icon" type="button" data-modal-close aria-label="Close dialog"><i data-lucide="x"></i></button>
        </div>
        <div class="modal__body stack-3">
          <p class="muted text-sm">Sync live orders, menus, and revenue reports directly into your restaurant's Google Spreadsheet.</p>
          <div class="field">
            <label class="label" for="sync-client-id">OAuth Client ID</label>
            <input class="input" id="sync-client-id" type="text" value="${SYNC.clientId}" placeholder="123456...apps.googleusercontent.com">
            <p class="hint">Create in Google Cloud Console → APIs & Services → Credentials</p>
          </div>
          <div class="field">
            <label class="label" for="sync-sheet-id">Spreadsheet ID</label>
            <input class="input" id="sync-sheet-id" type="text" value="${SYNC.sheetId}" placeholder="e.g. 1j5siCbhaDg6RPa7knl8M9zG5k6RkWtZqtzUQDyomJUs">
            <p class="hint">The ID from your Google Sheets URL: docs.google.com/spreadsheets/d/<b>ID</b>/edit</p>
          </div>
          <div id="sync-status-msg" class="text-xs muted"></div>
        </div>
        <div class="modal__footer row justify-between">
          <button class="btn btn--secondary" type="button" id="sync-disconnect-btn">Disconnect</button>
          <div class="row gap-2">
            <button class="btn btn--secondary" type="button" id="sync-push-btn">Sync Now</button>
            <button class="btn btn--primary" type="button" id="sync-connect-btn">Connect & Authorize</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons();

    modal.querySelector('[data-modal-close]').addEventListener('click', () => {
      modal.classList.remove('is-open');
      modal.setAttribute('hidden', '');
    });

    modal.querySelector('#sync-connect-btn').addEventListener('click', () => {
      const cid = modal.querySelector('#sync-client-id').value.trim();
      const sid = modal.querySelector('#sync-sheet-id').value.trim();
      if (!cid) return toast('Please enter an OAuth Client ID', 'warning');
      if (!sid) return toast('Please enter a Google Spreadsheet ID', 'warning');

      SYNC.clientId = cid;
      SYNC.sheetId = sid;
      SYNC.on = true;
      localStorage.setItem(CLIENT_ID_KEY, cid);
      localStorage.setItem(SHEET_ID_KEY, sid);
      localStorage.setItem(SYNC_ON_KEY, '1');

      const statusEl = modal.querySelector('#sync-status-msg');
      statusEl.textContent = 'Connecting to Google…';
      getToken(true).then(() => {
        statusEl.textContent = 'Connected. Syncing data…';
        return pushToSheet(false);
      }).then(() => {
        statusEl.textContent = 'Sync successful! All tabs provisioned.';
        modal.classList.remove('is-open');
        modal.setAttribute('hidden', '');
      }).catch((err) => {
        statusEl.textContent = 'Error: ' + err.message;
        toast(err.message, 'danger');
      });
    });

    modal.querySelector('#sync-push-btn').addEventListener('click', () => {
      pushToSheet(false);
    });

    modal.querySelector('#sync-disconnect-btn').addEventListener('click', () => {
      SYNC.on = false;
      SYNC.token = null;
      localStorage.setItem(SYNC_ON_KEY, '0');
      updateSyncChip('is-off', 'Sheet · Off');
      toast('Google Sheet sync disconnected', 'neutral');
      modal.classList.remove('is-open');
      modal.setAttribute('hidden', '');
    });
  }

  modal.classList.add('is-open');
  modal.removeAttribute('hidden');
}

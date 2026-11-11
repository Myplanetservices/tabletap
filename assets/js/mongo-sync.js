/* ==========================================================================
   TableTap — mongo-sync.js
   Client-side adapter for MongoDB cluster backend & Vercel serverless API.
   Synchronizes local state with cloud MongoDB.
   ========================================================================== */

import * as store from './store.js';
import { toast } from './helpers.js';

let isMongoConnected = false;
let mongoDbInfo = null;

export async function checkMongoHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { connected: false };
    const data = await res.json();
    isMongoConnected = !!(data.mongodb && data.mongodb.connected);
    mongoDbInfo = data.mongodb || null;
    updateMongoStatusIndicator();
    return data;
  } catch (_) {
    isMongoConnected = false;
    updateMongoStatusIndicator();
    return { connected: false };
  }
}

export function updateMongoStatusIndicator() {
  const badge = document.getElementById('mongo-status-pill');
  if (badge) {
    if (isMongoConnected) {
      badge.className = 'badge badge--success';
      badge.innerHTML = '<span class="dot" aria-hidden="true"></span> MongoDB Connected';
    } else {
      badge.className = 'badge badge--neutral';
      badge.innerHTML = '<span class="dot" aria-hidden="true"></span> Local DB (Standby)';
    }
  }
}

export async function syncWithMongo(silent = false) {
  if (!silent) toast('Syncing with MongoDB cluster…', 'info');
  try {
    const currentDb = store.db();
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db: currentDb })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to sync with MongoDB');
    }

    const result = await res.json();
    if (!silent) toast('MongoDB synchronized successfully!', 'success');
    return result;
  } catch (err) {
    if (!silent) toast('MongoDB sync: ' + err.message, 'warning');
    throw err;
  }
}

export async function pushOrderToMongo(order) {
  try {
    await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });
  } catch (e) {
    console.warn('Could not push order to MongoDB API:', e);
  }
}

export function renderMongoSettingsCard() {
  return `
    <div class="card mt-4">
      <div class="card__header">
        <div class="row gap-2 align-center">
          <i data-lucide="database"></i>
          <span class="card__title">MongoDB Cluster Backend</span>
        </div>
        <span class="badge ${isMongoConnected ? 'badge--success' : 'badge--neutral'}" id="mongo-status-pill">
          ${isMongoConnected ? 'MongoDB Connected' : 'Local Storage Mode'}
        </span>
      </div>
      <div class="card__body stack-3">
        <p class="muted text-sm">
          Connect your TableTap instance to a live MongoDB Atlas cluster for multi-device cloud synchronization.
        </p>
        <div class="field">
          <label class="label" for="mongo-env-guide">Vercel Environment Variable</label>
          <input class="input" id="mongo-env-guide" type="text" readonly
            value="MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/tabletap"
            style="font-family:var(--font-mono);font-size:0.8125rem">
          <p class="hint">Configure <code>MONGODB_URI</code> in your Vercel Project Settings → Environment Variables.</p>
        </div>
        <div class="row gap-2 mt-4">
          <button class="btn btn--secondary btn--sm" type="button" id="test-mongo-btn">
            <i data-lucide="activity"></i> Test Cluster Connection
          </button>
          <button class="btn btn--primary btn--sm" type="button" id="sync-mongo-btn">
            <i data-lucide="refresh-cw"></i> Sync Data with MongoDB
          </button>
        </div>
      </div>
    </div>
  `;
}

// Auto-check on load
checkMongoHealth().catch(() => {});

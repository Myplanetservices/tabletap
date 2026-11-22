/* ==========================================================================
   TableTap — realtime.js
   Keeps tabs in sync: BroadcastChannel where available, storage events as a
   fallback. No server involved.
   ========================================================================== */

const CHANNEL = 'tqr';
const STORAGE_KEY = 'tqr_evt';

const bus = new Map();
let channel = null;

try {
  if ('BroadcastChannel' in window) channel = new BroadcastChannel(CHANNEL);
} catch (err) {
  channel = null;
}

function dispatch(event, data) {
  (bus.get(event) || []).forEach((fn) => {
    try { fn(data); } catch (err) { console.error(err); }
  });
  (bus.get('*') || []).forEach((fn) => {
    try { fn({ event, data }); } catch (err) { console.error(err); }
  });
}

export function emit(event, data = {}) {
  const payload = { event, data, at: Date.now() };
  if (channel) {
    try { channel.postMessage(payload); } catch (err) { /* ignore */ }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) { /* ignore */ }
}

export function on(event, handler) {
  if (!bus.has(event)) bus.set(event, []);
  bus.get(event).push(handler);
  return () => {
    bus.set(event, (bus.get(event) || []).filter((fn) => fn !== handler));
  };
}

const batchQueue = new Map();
let batchTimer = null;

function flushBatch() {
  batchTimer = null;
  const current = new Map(batchQueue);
  batchQueue.clear();
  current.forEach((data, event) => {
    dispatch(event, data);
  });
}

function queueDispatch(event, data) {
  // Critical alert events fire immediately; high-frequency sync batches within 150ms
  if (event.startsWith('call:') || event === 'staff:logout' || event === 'session:paid') {
    dispatch(event, data);
    return;
  }
  batchQueue.set(event, data);
  if (!batchTimer) {
    batchTimer = setTimeout(flushBatch, 150);
  }
}

if (channel) {
  channel.onmessage = (message) => {
    const payload = message.data || {};
    if (payload.event) queueDispatch(payload.event, payload.data);
  };
}

// Changes merged from Neon by store.js (made on another device) reach this tab's listeners.
window.addEventListener('tt:remote', (event) => {
  const payload = event.detail || {};
  if (payload.event) queueDispatch(payload.event, payload.data || {});
});

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const payload = JSON.parse(event.newValue);
    if (payload.event) queueDispatch(payload.event, payload.data);
  } catch (err) { /* ignore */ }
});

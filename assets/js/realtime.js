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

if (channel) {
  channel.onmessage = (message) => {
    const payload = message.data || {};
    if (payload.event) dispatch(payload.event, payload.data);
  };
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const payload = JSON.parse(event.newValue);
    if (payload.event) dispatch(payload.event, payload.data);
  } catch (err) { /* ignore */ }
});

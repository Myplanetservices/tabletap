/* ==========================================================================
   TableTap — geo.js
   Location helpers shared by the owner panel (register the restaurant) and the guest
   menu (check the guest is at the restaurant). One place, so both sides measure the
   same way.

   Precision, in plain terms:
     · A single GPS reading is often off by 20–100 m, mostly the first one. So we ask
       for a high-accuracy fix, keep listening for a few seconds and keep the BEST
       reading (the one with the smallest reported error), stopping early once it is good.
     · Every fix carries the phone's own accuracy estimate in metres. The restaurant's
       saved location stores it too, and the guest check refuses fixes that are too vague.
     · Distance is the great-circle (haversine) distance, accurate to centimetres at
       these ranges. What limits precision is the phone's GPS, not the maths.
   ========================================================================== */

export const RADIUS_OPTIONS = [30, 50, 75, 100, 150, 200, 300];
export const DEFAULT_RADIUS = 100;

/** The owner should register the restaurant from a reading at least this good (metres). */
export const OWNER_TARGET_ACCURACY = 20;
/** A guest reading vaguer than this is not used to allow or refuse an order (metres). */
export const GUEST_MAX_ACCURACY = 120;
/** How much of the phone's own error margin we give the guest the benefit of (metres). */
export const TOLERANCE_CAP = 25;

const EARTH_RADIUS_M = 6371008.8;

export function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** The restaurant's registered point, or null when the owner has not set it yet. */
export function siteOf(client) {
  const g = (client && client.settings && client.settings.geofence) || {};
  const lat = Number(g.lat);
  const lng = Number(g.lng);
  const set = g.locationSet === true && isValidCoords(lat, lng);
  return {
    enabled: g.enabled !== false,
    set,
    lat: set ? lat : null,
    lng: set ? lng : null,
    radius: Number(g.radiusMeters) > 0 ? Number(g.radiusMeters) : DEFAULT_RADIUS,
    accuracy: Number(g.accuracy) || null,
  };
}

/**
 * Best GPS fix within maxWaitMs. Resolves with { lat, lng, accuracy, samples }.
 * Rejects with an Error whose .code is 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout'.
 * @param {{target?:number, maxWaitMs?:number, onProgress?:(fix:object)=>void}} options
 */
export function bestFix({ target = 20, maxWaitMs = 12000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (code, message) => { const e = new Error(message); e.code = code; reject(e); };
    if (!window.isSecureContext) return fail('insecure', 'Location needs a secure (https) page.');
    if (!navigator.geolocation) return fail('unsupported', 'This browser cannot share its location.');

    let best = null;
    let samples = 0;
    let finished = false;
    let watchId = null;
    let timer = null;

    const done = () => {
      if (finished) return;
      finished = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if (best) resolve({ ...best, samples });
      else fail('timeout', 'Could not get a location fix in time.');
    };

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        samples += 1;
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy || 9999) };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (onProgress) onProgress({ ...best, samples });
        if (best.accuracy <= target) done();
      },
      (err) => {
        if (finished) return;
        if (best) return done(); // we already have something usable
        finished = true;
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        clearTimeout(timer);
        fail(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable', err.message || 'Location unavailable.');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );
    timer = setTimeout(done, maxWaitMs);
  });
}

/**
 * Decide whether a guest fix is at the restaurant.
 *   inside     – close enough (the phone's error margin, capped, is allowed in the guest's favour)
 *   outside    – clearly too far
 *   imprecise  – the reading is too vague to decide; ask the guest to try again
 */
export function judge(fix, site) {
  const distance = distanceMeters(fix, { lat: site.lat, lng: site.lng });
  if (fix.accuracy > GUEST_MAX_ACCURACY) return { status: 'imprecise', distance, accuracy: fix.accuracy };
  const allowance = Math.min(fix.accuracy, TOLERANCE_CAP);
  const inside = distance <= site.radius + allowance;
  return { status: inside ? 'inside' : 'outside', distance, accuracy: fix.accuracy, allowance };
}

export function formatDistance(m) {
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
}

/** Small OpenStreetMap preview URL centred on a point (no API key needed). */
export function mapEmbedUrl(lat, lng) {
  const d = 0.0025; // about 270 m each way
  const bbox = [lng - d, lat - d, lng + d, lat + d].map((n) => n.toFixed(6)).join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
}

export function mapLinkUrl(lat, lng) {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

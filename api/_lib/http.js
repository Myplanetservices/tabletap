/* Small shared helpers for the API handlers (local server.js and Vercel). */

export function cors(res, methods = 'GET,POST,OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

/** True when the request was a CORS preflight and has been answered. */
export function preflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  res.statusCode = 204;
  res.end();
  return true;
}

/** The request body as an object, whether server.js or Vercel parsed it. */
export function jsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

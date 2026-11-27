/* TableTap — the restaurant's Google review link.
   Used by the owner's settings, the guest pages and the push sender (api/),
   so only a real Google address is ever shown or sent to a guest. */

const GOOGLE_HOST = /^(?:(?:www|search|maps)\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const SHORT_HOSTS = new Set(['g.page', 'maps.app.goo.gl', 'g.co']);

export const REVIEW_DELAYS = [0, 5, 15, 20, 30];
export const DEFAULT_REVIEW_DELAY = 15;

/** The link as a safe https URL string, or '' when it is not a Google link. */
export function cleanReviewUrl(value) {
  let text = String(value || '').trim();
  if (!text || text.length > 500) return '';
  if (!/^[a-z]+:\/\//i.test(text)) text = 'https://' + text;
  let url;
  try { url = new URL(text); } catch (_) { return ''; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
  if (!GOOGLE_HOST.test(host) && !SHORT_HOSTS.has(host)) return '';
  // google.com/url forwards to any site, and a bare home page is not a review page.
  if (url.pathname === '/url' || (url.pathname === '/' && !url.search)) return '';
  return url.href;
}

/** The restaurant's review settings; `url` is '' unless the button should show. */
export function reviewSettings(client) {
  const saved = (client && client.settings && client.settings.reviews) || {};
  const delay = Number(saved.delayMinutes);
  return {
    enabled: saved.enabled === true,
    url: saved.enabled === true ? cleanReviewUrl(saved.url) : '',
    delayMinutes: REVIEW_DELAYS.includes(delay) ? delay : DEFAULT_REVIEW_DELAY,
  };
}

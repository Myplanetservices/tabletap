export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const queryCountry = url.searchParams.get('country');

    // Vercel Geolocation headers
    const vercelCountry = req.headers['x-vercel-ip-country'];
    const vercelCity = req.headers['x-vercel-ip-city'];
    const vercelRegion = req.headers['x-vercel-ip-country-region'];

    // Cloudflare Geolocation headers
    const cfCountry = req.headers['cf-ipcountry'];

    const rawCountry = queryCountry || vercelCountry || cfCountry || '';
    const country = rawCountry.toUpperCase().trim();

    return res.status(200).json({
      country: country || 'US',
      city: vercelCity ? decodeURIComponent(vercelCity) : '',
      region: vercelRegion || '',
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(200).json({
      country: 'US',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
}

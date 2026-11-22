import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const PORT = process.env.PORT || 8000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8'
};

/* Resolve /api/<route> the way Vercel does: an exact api/<route>.js file, or a
   catch-all api/<dir>/[...name].js whose segments land in req.query[name].
   Files and folders starting with "_" are helpers, never routes. */
function resolveApiRoute(apiPath) {
  const segments = apiPath.split('/').filter(Boolean);
  if (!segments.length || segments.some((s) => s.startsWith('_') || s === '..' || s === '.')) return null;
  const exact = path.join(__dirname, 'api', ...segments) + '.js';
  if (fs.existsSync(exact)) return { modulePath: `./api/${segments.join('/')}.js`, params: {} };
  for (let i = segments.length - 1; i >= 0; i--) {
    const dir = path.join(__dirname, 'api', ...segments.slice(0, i));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const catchAll = fs.readdirSync(dir).find((f) => /^\[\.\.\.\w+\]\.js$/.test(f));
    if (catchAll) {
      const name = catchAll.slice(4, -4);
      const modulePath = `./api/${[...segments.slice(0, i), catchAll].join('/')}`;
      return { modulePath, params: { [name]: segments.slice(i) } };
    }
  }
  return null;
}

async function handleApiRequest(req, res, apiPath) {
  const route = resolveApiRoute(apiPath);
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `API route /api/${apiPath} not found` }));
  }
  Object.assign(req.query, route.params);

  // Parse body if present
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    req.rawBody = body;
    try {
      req.body = body ? JSON.parse(body) : {};
    } catch (_) {
      req.body = body;
    }

    // Mock Express-like response helper for Vercel functions
    res.status = function (code) {
      res.statusCode = code;
      return res;
    };
    res.json = function (data) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return res;
    };

    try {
      const module = await import(`${route.modulePath}?t=${Date.now()}`);
      if (typeof module.default === 'function') {
        await module.default(req, res);
      } else {
        res.status(500).json({ error: 'Handler function not exported' });
      }
    } catch (err) {
      console.error(`Error in /api/${apiPath}:`, err);
      res.status(500).json({ error: err.message });
    }
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // 1. API routes
  if (pathname.startsWith('/api/')) {
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());
    const apiRoute = pathname.slice(5).replace(/\.js$/, '');
    return handleApiRequest(req, res, apiRoute);
  }

  // 2. Static files
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  let filePath = path.join(__dirname, pathname);
  // Never serve secrets or server-only files (.env, .neon, .git, node_modules, ...).
  const relative = path.relative(__dirname, filePath);
  const blocked = relative.startsWith('..') || path.isAbsolute(relative) ||
    relative.split(path.sep).some((seg) => seg.startsWith('.') || seg === 'node_modules');
  if (blocked) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    // 404 fallback
    const notFound = path.join(__dirname, '404.html');
    if (fs.existsSync(notFound)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(notFound));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`TableTap production server listening on http://localhost:${PORT}`);
  console.log(`Database: ${process.env.DATABASE_URL ? 'Neon Postgres' : 'NOT CONFIGURED (set DATABASE_URL)'}`);
  console.log(`Email: ${process.env.RESEND_API_KEY && process.env.EMAIL_FROM ? 'Resend' : 'not configured (emails stay in the outbox)'}`);
});

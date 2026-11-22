import { hasPostgres, sql } from './_lib/pg.js';
import { hasResend } from './_lib/email.js';
import { cors, preflight } from './_lib/http.js';

/* Health of the Neon Postgres database and whether email (Resend) is configured. */

export default async function handler(req, res) {
  cors(res, 'GET,OPTIONS');
  if (preflight(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const timestamp = new Date().toISOString();
  const email = { provider: 'resend', configured: hasResend() };

  if (!hasPostgres()) {
    return res.status(503).json({
      status: 'error',
      database: { provider: 'neon-postgres', connected: false, message: 'DATABASE_URL is not configured.' },
      email,
      timestamp,
    });
  }

  try {
    const started = Date.now();
    const { rows } = await sql(
      `SELECT current_database() AS db,
              (SELECT count(*)::int FROM tt_docs WHERE deleted_at IS NULL) AS docs`,
    );
    return res.status(200).json({
      status: 'ok',
      database: {
        provider: 'neon-postgres',
        connected: true,
        database: rows[0].db,
        branch: process.env.NEON_BRANCH || null,
        documents: rows[0].docs,
        latencyMs: Date.now() - started,
      },
      email,
      timestamp,
    });
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      database: { provider: 'neon-postgres', connected: false, message: err.message },
      email,
      timestamp,
    });
  }
}

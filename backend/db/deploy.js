/**
 * deploy.js — run before every deploy (Render preDeployCommand).
 *   - Empty database  -> base schema + seed (db/setup.js), then migrations.
 *   - Existing database -> migrations only (all idempotent).
 * Never re-runs setup.js on a live database: its base schema predates the
 * per-tenant unique constraints and must not be replayed over them.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { spawnSync } = require('child_process');
const path = require('path');
const { Pool } = require('pg');

function run(script) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    console.error(`[deploy] ${script} failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'sunshine',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  let fresh;
  try {
    const r = await pool.query(`SELECT to_regclass('public.room_types') IS NULL AS fresh`);
    fresh = r.rows[0].fresh;
  } finally {
    await pool.end();
  }
  if (fresh) {
    console.log('[deploy] Empty database — creating base schema and seed data…');
    run('setup.js');
  }
  console.log('[deploy] Applying migrations…');
  run('migrate.js');
  console.log('[deploy] Database ready.');
})().catch((e) => { console.error('[deploy] FAILED:', e.message); process.exit(1); });

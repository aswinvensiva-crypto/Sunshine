/**
 * db.js — PostgreSQL connection pools + tenant-scoped query helpers.
 *
 * Two pools:
 *   pool      — the application role (sunshine_app): NOT a superuser, so the
 *               Row-Level Security policies apply. Every tenant-scoped query
 *               MUST run through forTenant(tenantId) so the RLS session var
 *               (app.current_tenant_id) is set; a query on this pool without
 *               tenant context sees zero rows and cannot insert (fail closed).
 *   adminPool — the admin role from .env (typically postgres). Bypasses RLS.
 *               Reserved for: tenant resolution, platform (super_admin)
 *               routes, cron/system jobs, and migrations. Never expose it to
 *               request handlers for tenant data.
 *
 * forTenant(tenantId) returns { query, tx }:
 *   query(text, params) — checks out a client, pins the tenant var for the
 *     connection, runs the query, then RESETs the var before returning the
 *     client to the pool (connection is destroyed if the reset fails, so a
 *     stale tenant id can never leak to the next checkout).
 *   tx(fn) — runs fn(client) inside BEGIN/COMMIT with SET LOCAL, so the
 *     tenant var scope dies with the transaction.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { Pool } = require('pg');

const base = {
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'sunshine',
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

// Application pool — RLS-enforced role created by db/migrate.js.
const pool = new Pool({
  ...base,
  user:     process.env.DB_APP_USER || 'sunshine_app',
  password: process.env.DB_APP_PASSWORD || 'sunshine_app',
  max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
});

// Admin pool — RLS-bypassing role, platform/system use only.
const adminPool = new Pool({
  ...base,
  user:     process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: parseInt(process.env.DB_ADMIN_POOL_MAX, 10) || 5,
});

pool.on('error', (err) => console.error('[DB] app pool error:', err.message));
adminPool.on('error', (err) => console.error('[DB] admin pool error:', err.message));

const SET_TENANT = `SELECT set_config('app.current_tenant_id', $1, false)`;
const SET_TENANT_LOCAL = `SELECT set_config('app.current_tenant_id', $1, true)`;

function assertTenantId(tenantId) {
  const n = Number(tenantId);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid tenant id: ${tenantId}`);
  return n;
}

function forTenant(tenantId) {
  const tid = String(assertTenantId(tenantId));

  async function query(text, params) {
    const client = await pool.connect();
    let done = false;
    try {
      await client.query(SET_TENANT, [tid]);
      const result = await client.query(text, params);
      await client.query(`RESET app.current_tenant_id`);
      done = true;
      return result;
    } finally {
      // If anything failed before the RESET, destroy the connection so the
      // tenant var can never survive into another request's checkout.
      client.release(done ? undefined : true);
    }
  }

  async function tx(fn) {
    const client = await pool.connect();
    let clean = false;
    try {
      await client.query('BEGIN');
      await client.query(SET_TENANT_LOCAL, [tid]); // SET LOCAL: dies with the tx
      const result = await fn(client);
      await client.query('COMMIT');
      clean = true;
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); clean = true; } catch {}
      throw err;
    } finally {
      client.release(clean ? undefined : true);
    }
  }

  // Drop-in replacement for pool.connect() in routes that manage their own
  // BEGIN/COMMIT/ROLLBACK. The returned client is pinned to the tenant; its
  // release() resets the tenant var (or destroys the connection if it can't).
  async function connect() {
    const client = await pool.connect();
    try {
      await client.query(SET_TENANT, [tid]);
    } catch (err) {
      client.release(true);
      throw err;
    }
    const origRelease = client.release.bind(client);
    client.release = (destroy) => {
      if (destroy) return origRelease(true);
      client.query(`RESET app.current_tenant_id`)
        .then(() => origRelease())
        .catch(() => origRelease(true));
    };
    return client;
  }

  return { tenantId: Number(tid), query, tx, connect };
}

module.exports = {
  pool,
  adminPool,
  forTenant,
  // Legacy export — kept so stray pool.query callers still compile, but they
  // now run RLS-enforced with no tenant context (zero rows, inserts fail).
  query: (text, params) => pool.query(text, params),
};

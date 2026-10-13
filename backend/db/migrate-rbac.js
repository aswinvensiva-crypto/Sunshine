/**
 * migrate-rbac.js — Prompt 7.1: granular RBAC, PIN devices, approvals.
 *
 * Idempotent forward migration (up) and a reverse (down). Runs AFTER
 * migrate-tenancy.js because every new table is tenant-scoped with RLS.
 *
 * Add -> backfill -> switch -> drop discipline: the legacy `users.role`
 * column is KEPT (display + rollback); memberships are the new authority.
 * Nothing is dropped on the way up, so no existing login is locked out.
 *
 * Run `node db/migrate-rbac.js down` to reverse (drops only objects added here).
 */
const TENANT_DEFAULT_SQL = `NULLIF(current_setting('app.current_tenant_id', true), '')::int`;
const { seedPermissionCatalogue, provisionTenant } = require('../server/modules/identity/infra/rbacRepo');

const RLS_TABLES = [
  'roles', 'role_permissions', 'user_property_memberships',
  'employee_devices', 'device_enrol_codes', 'approval_requests',
];

async function up(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Global permission catalogue (platform table, no tenant_id).
    await client.query(`CREATE TABLE IF NOT EXISTS permissions (
      code        TEXT PRIMARY KEY,
      description TEXT NOT NULL
    )`);

    // 2. Roles (per tenant; system roles seeded, owners may add custom ones).
    await client.query(`CREATE TABLE IF NOT EXISTS roles (
      id         SERIAL PRIMARY KEY,
      tenant_id  INT NOT NULL DEFAULT ${TENANT_DEFAULT_SQL} REFERENCES tenants(id),
      code       TEXT NOT NULL,
      name       TEXT NOT NULL,
      is_system  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (tenant_id, code)
    )`);

    // 3. Role -> permissions.
    await client.query(`CREATE TABLE IF NOT EXISTS role_permissions (
      tenant_id       INT NOT NULL DEFAULT ${TENANT_DEFAULT_SQL} REFERENCES tenants(id),
      role_id         INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_code)
    )`);

    // 4. User <-> property membership (role per property).
    await client.query(`CREATE TABLE IF NOT EXISTS user_property_memberships (
      id         SERIAL PRIMARY KEY,
      tenant_id  INT NOT NULL DEFAULT ${TENANT_DEFAULT_SQL} REFERENCES tenants(id),
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id    INT NOT NULL REFERENCES roles(id),
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, tenant_id)
    )`);

    // 5. Credential hardening columns (add; legacy rows get safe defaults).
    for (const sql of [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INT NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS rbac_role_code TEXT`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS failed_logins INT NOT NULL DEFAULT 0`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin_hash TEXT`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin_failed INT NOT NULL DEFAULT 0`,
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ`,
    ]) await client.query(sql);
    // One WhatsApp identity per user per tenant (E.164).
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_phone
      ON users (tenant_id, phone) WHERE phone IS NOT NULL`);

    // 6. Device-bound PIN login for shared housekeeping phones.
    await client.query(`CREATE TABLE IF NOT EXISTS employee_devices (
      id             SERIAL PRIMARY KEY,
      tenant_id      INT NOT NULL DEFAULT ${TENANT_DEFAULT_SQL} REFERENCES tenants(id),
      employee_id    INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
      device_id_hash TEXT NOT NULL,
      label          TEXT,
      approved_by    INT REFERENCES users(id),
      approved_at    TIMESTAMPTZ DEFAULT now(),
      revoked_at     TIMESTAMPTZ,
      UNIQUE (employee_id, device_id_hash)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS device_enrol_codes (
      id          SERIAL PRIMARY KEY,
      tenant_id   INT NOT NULL DEFAULT ${TENANT_DEFAULT_SQL} REFERENCES tenants(id),
      employee_id INT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
      code_hash   TEXT NOT NULL,
      created_by  INT REFERENCES users(id),
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ
    )`);

    // 7. Approval requests (refunds / write-offs / below-floor overrides).
    await client.query(`CREATE TABLE IF NOT EXISTS approval_requests (
      id                SERIAL PRIMARY KEY,
      tenant_id         INT NOT NULL DEFAULT ${TENANT_DEFAULT_SQL} REFERENCES tenants(id),
      kind              TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','failed')),
      payload           JSONB NOT NULL,
      amount            NUMERIC(12,2),
      reason            TEXT,
      requested_by      INT,
      requested_by_type TEXT NOT NULL DEFAULT 'user',
      requested_by_name TEXT,
      decided_by        INT REFERENCES users(id),
      decided_at        TIMESTAMPTZ,
      decision_note     TEXT,
      result            JSONB,
      created_at        TIMESTAMPTZ DEFAULT now()
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status
      ON approval_requests (tenant_id, status, created_at DESC)`);

    // 8. RLS on every new tenant table (same policy shape as migrate-tenancy).
    for (const table of RLS_TABLES) {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table} (tenant_id)`);
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS tenant_isolation ON ${table}`);
      await client.query(`CREATE POLICY tenant_isolation ON ${table}
        USING (tenant_id = ${TENANT_DEFAULT_SQL})
        WITH CHECK (tenant_id = ${TENANT_DEFAULT_SQL})`);
    }

    // 9. Grants for the RLS-enforced app role (permissions is read-only to it).
    const appUser = (process.env.DB_APP_USER || 'sunshine_app').replace(/"/g, '""');
    const role = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [process.env.DB_APP_USER || 'sunshine_app']);
    if (role.rows[0] && (process.env.DB_APP_USER || 'sunshine_app') !== (process.env.DB_USER || 'postgres')) {
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${RLS_TABLES.join(', ')} TO "${appUser}"`);
      await client.query(`GRANT SELECT ON permissions TO "${appUser}"`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appUser}"`);
    }

    // 10. Seed catalogue + per-tenant roles, backfill memberships.
    await seedPermissionCatalogue(client);
    const tenants = await client.query(`SELECT id FROM tenants ORDER BY id`);
    for (const t of tenants.rows) {
      // admin client bypasses RLS but WITH CHECK still compares tenant_id to the
      // session var — pin it per tenant for the provisioning statements.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [String(t.id)]);
      await provisionTenant(client, t.id);
    }

    await client.query('COMMIT');

    // Integrity: every user has exactly one membership.
    const orphan = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM user_property_memberships m WHERE m.user_id = u.id AND m.tenant_id = u.tenant_id)`
    );
    return { ok: orphan.rows[0].n === 0, orphanUsers: orphan.rows[0].n };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** Reverse: drops only what `up` added. Legacy users.role is untouched. */
async function down(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of ['approval_requests', 'device_enrol_codes', 'employee_devices',
      'user_property_memberships', 'role_permissions', 'roles', 'permissions']) {
      await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    await client.query(`DROP INDEX IF EXISTS uq_users_tenant_phone`);
    for (const c of ['token_version', 'failed_logins', 'locked_until', 'phone', 'last_login_at']) {
      await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS ${c}`);
    }
    for (const c of ['rbac_role_code', 'token_version', 'failed_logins', 'locked_until',
      'pin_hash', 'pin_failed', 'pin_locked_until']) {
      await client.query(`ALTER TABLE employees DROP COLUMN IF EXISTS ${c}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { up, down, RLS_TABLES };

if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'sunshine',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  const dir = process.argv[2] === 'down' ? down : up;
  dir(pool)
    .then((r) => { console.log(`[rbac] ${process.argv[2] === 'down' ? 'rolled back' : 'migrated'}`, r || ''); return pool.end(); })
    .catch((e) => { console.error('[rbac] FAILED:', e.message); process.exitCode = 1; return pool.end(); });
}

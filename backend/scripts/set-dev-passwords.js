/**
 * set-dev-passwords.js — LOCAL DEVELOPMENT ONLY.
 * Ensures every tenant has an owner login `admin` / `admin123` (clears
 * lockouts, revokes old sessions) and sets the platform super-admin used by
 * the /platform page to the same login. Refuses to run unless the database is
 * on this machine, so it can never weaken a deployed server.
 *
 *   npm run dev:admin-logins
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { provisionTenant } = require('../server/modules/identity/infra/rbacRepo');

const USERNAME = process.env.DEV_ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.DEV_ADMIN_PASSWORD || 'admin123';

async function main() {
  const host = process.env.DB_HOST || 'localhost';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing: DB_HOST is '${host}', not a local database.`);
  }
  const pool = new Pool({
    host, port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'sunshine',
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(PASSWORD, 10);
    const tenants = await client.query('SELECT id, slug FROM tenants ORDER BY id');
    for (const t of tenants.rows) {
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [String(t.id)]);
      await provisionTenant(client, t.id);
      const u = await client.query(
        `INSERT INTO users (tenant_id, username, full_name, password_hash, role, is_blocked, failed_logins, locked_until)
         VALUES ($1, $2, 'Resort Owner', $3, 'owner', FALSE, 0, NULL)
         ON CONFLICT (tenant_id, username) WHERE username IS NOT NULL DO UPDATE
           SET password_hash = EXCLUDED.password_hash, is_blocked = FALSE, failed_logins = 0,
               locked_until = NULL, role = 'owner', token_version = users.token_version + 1
         RETURNING id`,
        [t.id, USERNAME, hash]
      );
      await client.query(
        `INSERT INTO user_property_memberships (tenant_id, user_id, role_id)
         SELECT $1, $2, id FROM roles WHERE tenant_id = $1 AND code = 'OWNER'
         ON CONFLICT (user_id, tenant_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
        [t.id, u.rows[0].id]
      );
      console.log(`  tenant '${t.slug}' (id ${t.id}): ${USERNAME} / ${PASSWORD}`);
    }

    // Platform (multi-tenant /platform page) super-admin: keep one login, renamed to the dev username.
    const pa = await client.query('SELECT id, username FROM platform_admins ORDER BY id');
    const existing = pa.rows.find((r) => r.username === USERNAME) || pa.rows[0];
    if (existing) {
      await client.query(
        'UPDATE platform_admins SET username = $1, password_hash = $2 WHERE id = $3',
        [USERNAME, hash, existing.id]
      );
    } else {
      await client.query(
        `INSERT INTO platform_admins (username, full_name, password_hash) VALUES ($1, 'Platform Admin', $2)`,
        [USERNAME, hash]
      );
    }
    console.log(`  platform (/platform): ${USERNAME} / ${PASSWORD}`);
    await client.query('COMMIT');
    console.warn('\nDEV ONLY: these credentials are weak by design. Do not use them on a deployed server.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error('set-dev-passwords failed:', e.message); process.exit(1); });

/**
 * bootstrap-owner.js — one-time creation of a resort's first OWNER login.
 * Replaces the old seeded admin/admin123 credential.
 *
 *   node scripts/bootstrap-owner.js --tenant sunshine-original --username owner [--full-name "..."]
 *
 * The password is read from BOOTSTRAP_OWNER_PASSWORD (>= 12 chars). If it is
 * not set, a random one is generated and printed ONCE. Refuses to run when
 * the tenant already has an owner, unless --reset is passed (which rotates
 * that owner's password and revokes their sessions), or --if-missing (exit
 * quietly; used by db/deploy.js when BOOTSTRAP_OWNER_* env vars are set).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { provisionTenant } = require('../server/modules/identity/infra/rbacRepo');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg('tenant') || process.env.DEFAULT_TENANT_SLUG || 'sunshine-original';
  const username = arg('username');
  const reset = process.argv.includes('--reset');
  const ifMissing = process.argv.includes('--if-missing'); // no-op (exit 0) when an owner exists
  if (!username) throw new Error('--username is required');

  let password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    generated = true;
  } else if (password.length < 12) {
    throw new Error('BOOTSTRAP_OWNER_PASSWORD must be at least 12 characters');
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'sunshine',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await client.query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    if (!t.rows[0]) throw new Error(`Unknown tenant slug: ${slug}`);
    const tenantId = t.rows[0].id;
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [String(tenantId)]);
    await provisionTenant(client, tenantId);

    const owners = await client.query(
      `SELECT u.id, u.username FROM users u
         JOIN user_property_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
         JOIN roles r ON r.id = m.role_id AND r.code = 'OWNER'
        WHERE u.tenant_id = $1`, [tenantId]);
    const hash = await bcrypt.hash(password, 12);

    if (owners.rows.length && ifMissing) {
      await client.query('ROLLBACK');
      console.log(`Tenant '${slug}' already has an owner — nothing to do.`);
      return;
    }
    if (owners.rows.length && !reset) {
      throw new Error(`Tenant '${slug}' already has an owner ('${owners.rows[0].username}'). Use --reset to rotate their password.`);
    }
    if (owners.rows.length && reset) {
      // --reset --username X: rotate the owner named X, or (if none) the first
      // owner, renaming it to X — so this also changes the login name.
      const target = owners.rows.find((o) => o.username === username) || owners.rows[0];
      const clash = await client.query(
        'SELECT 1 FROM users WHERE tenant_id = $1 AND username = $2 AND id <> $3', [tenantId, username, target.id]);
      if (clash.rows[0]) throw new Error(`Another user in '${slug}' is already called '${username}'`);
      await client.query(
        `UPDATE users SET username=$1, password_hash=$2, token_version = token_version + 1, failed_logins=0, locked_until=NULL
          WHERE id=$3 AND tenant_id=$4`, [username, hash, target.id, tenantId]);
      console.log(target.username === username
        ? `Rotated password for owner '${username}' and revoked their sessions.`
        : `Renamed owner '${target.username}' -> '${username}', set the new password and revoked their sessions.`);
    } else {
      const u = await client.query(
        `INSERT INTO users (tenant_id, username, full_name, password_hash, role)
         VALUES ($1,$2,$3,$4,'owner') RETURNING id`,
        [tenantId, username, arg('full-name') || 'Resort Owner', hash]);
      await client.query(
        `INSERT INTO user_property_memberships (tenant_id, user_id, role_id)
         SELECT $1, $2, id FROM roles WHERE tenant_id = $1 AND code = 'OWNER'`,
        [tenantId, u.rows[0].id]);
      console.log(`Created owner '${username}' for tenant '${slug}'.`);
    }
    await client.query('COMMIT');
    if (generated) {
      console.log('\nGenerated password (shown once, store it in your password manager):');
      console.log(`  ${password}\n`);
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('bootstrap-owner failed:', e.message); process.exit(1); });

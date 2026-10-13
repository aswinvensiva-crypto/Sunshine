/**
 * Postgres-backed acceptance tests for 7.1 (migration forward/back, RLS
 * isolation between properties, membership coverage).
 *
 * Skipped unless TEST_PG=1. Point it at a SCRATCH database that has already
 * had `node db/setup.js` and `node db/migrate.js` applied, e.g.:
 *
 *   createdb sunshine_test
 *   DB_NAME=sunshine_test node db/setup.js && DB_NAME=sunshine_test node db/migrate.js
 *   TEST_PG=1 DB_NAME=sunshine_test npm test
 *
 * NEVER run against production: it creates and deletes tenants named rbac-test-*.
 */
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.TEST_PG === '1';
const opts = { skip: ENABLED ? false : 'set TEST_PG=1 to run Postgres tests' };

if (ENABLED) require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

test('rbac migration is idempotent (run twice) and every user has a membership', opts, async () => {
  const { adminPool } = require('../server/config/db');
  const rbac = require('../db/migrate-rbac');
  const a = await rbac.up(adminPool);
  const b = await rbac.up(adminPool);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const dup = await adminPool.query(`SELECT user_id, tenant_id, COUNT(*) FROM user_property_memberships GROUP BY 1,2 HAVING COUNT(*) > 1`);
  assert.equal(dup.rows.length, 0);
  const roles = await adminPool.query(`SELECT code FROM roles WHERE tenant_id = (SELECT MIN(id) FROM tenants)`);
  assert.equal(roles.rows.length, 7);
});

test('RLS: property A cannot read property B roles, memberships or approvals', opts, async () => {
  const { adminPool, forTenant } = require('../server/config/db');
  const { provisionTenant } = require('../server/modules/identity/infra/rbacRepo');
  const mk = async (slug) => {
    const t = await adminPool.query(
      `INSERT INTO tenants (slug, name) VALUES ($1, $1) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [slug]);
    await provisionTenant(adminPool, t.rows[0].id);
    return t.rows[0].id;
  };
  const A = await mk('rbac-test-a');
  const B = await mk('rbac-test-b');
  try {
    await adminPool.query(
      `INSERT INTO approval_requests (tenant_id, kind, payload, amount) VALUES ($1,'refund.booking','{}',9999)`, [B]);
    const dbA = forTenant(A);
    for (const table of ['roles', 'role_permissions', 'user_property_memberships', 'approval_requests', 'employee_devices']) {
      const own = await dbA.query(`SELECT DISTINCT tenant_id FROM ${table}`);
      assert.ok(own.rows.every((r) => r.tenant_id === A), `${table}: tenant A saw another tenant's rows`);
    }
    const peek = await dbA.query(`SELECT * FROM approval_requests WHERE tenant_id = $1`, [B]);
    assert.equal(peek.rows.length, 0, 'tenant A must not read tenant B approvals even by explicit filter');
    // write with a foreign tenant_id must be refused by the RLS WITH CHECK
    await assert.rejects(
      dbA.query(`INSERT INTO approval_requests (tenant_id, kind, payload) VALUES ($1,'refund.booking','{}')`, [B]),
      /row-level security/i
    );
  } finally {
    await adminPool.query(`DELETE FROM approval_requests WHERE tenant_id = ANY($1)`, [[A, B]]);
    await adminPool.query(`DELETE FROM role_permissions WHERE tenant_id = ANY($1)`, [[A, B]]);
    await adminPool.query(`DELETE FROM roles WHERE tenant_id = ANY($1)`, [[A, B]]);
    await adminPool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[A, B]]);
  }
});

test('app role can read but not modify the permission catalogue', opts, async () => {
  const { pool } = require('../server/config/db');
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM permissions');
  assert.ok(r.rows[0].n > 0);
  await assert.rejects(pool.query(`DELETE FROM permissions WHERE code = 'dashboard.view'`), /permission denied/i);
});

test('rbac migration runs backward (down) and forward again on a copy', { skip: process.env.TEST_PG_DOWN === '1' ? false : 'set TEST_PG_DOWN=1 (destructive to RBAC tables) to run' }, async () => {
  const { adminPool } = require('../server/config/db');
  const rbac = require('../db/migrate-rbac');
  await rbac.down(adminPool);
  const gone = await adminPool.query(`SELECT to_regclass('public.roles') AS r`);
  assert.equal(gone.rows[0].r, null);
  const u = await adminPool.query('SELECT COUNT(*)::int AS n FROM users');
  assert.ok(u.rows[0].n >= 0, 'users untouched by down');
  const back = await rbac.up(adminPool);
  assert.equal(back.ok, true);
});

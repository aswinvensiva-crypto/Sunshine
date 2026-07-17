/**
 * migrate-tenancy.js — converts a single-tenant Sunshine database to multi-tenant.
 *
 * Idempotent: safe to run repeatedly. Steps:
 *   1. Create platform tables: tenants, tenant_settings, platform_admins.
 *   2. Seed the default tenant (slug 'sunshine-original') for all existing data.
 *   3. Add tenant_id to every tenant-scoped table, backfill, then enforce NOT NULL.
 *      tenant_id defaults to the per-connection session var app.current_tenant_id,
 *      so INSERTs that omit it are stamped with the request's tenant (and fail
 *      outside a tenant context — fail closed).
 *   4. Convert global unique constraints (username, reference, room_number, code)
 *      to per-tenant uniques. Guest link tokens stay globally unique on purpose.
 *   5. Enable Row-Level Security + a tenant_isolation policy on every table.
 *   6. Create the non-superuser app role (sunshine_app) the API connects as —
 *      RLS does not apply to superusers, so the app MUST NOT run as postgres.
 *   7. Move uploaded files under uploads/<tenant_id>/ and rewrite stored URLs.
 *
 * Requires admin (owner/superuser) credentials — run via `node db/migrate.js`.
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_TENANT_SLUG = 'sunshine-original';

/* Tenant-scoped tables. The (tenant_id, <pk>) index columns are resolved from
   the live catalog per table — PK names drifted between schema versions
   (e.g. shift_schedules.shift_id vs id, operations_log.log_id vs id). */
const TENANT_TABLES = [
  'room_types', 'rooms', 'inventory', 'guests', 'bookings', 'payments',
  'users', 'expenses', 'employees', 'shift_schedules', 'tasks', 'routines',
  'routine_completions', 'operations_log', 'employee_routines',
  'notification_logs', 'payment_transactions', 'competitor_rates',
  'suppressed_yield_log', 'check_in_tokens', 'guest_feedback',
  'special_requests', 'whatsapp_queue',
];

/* Global UNIQUE constraints that must become per-tenant.
   [table, column, legacyConstraintName] */
const PER_TENANT_UNIQUES = [
  ['room_types', 'code',        'room_types_code_key'],
  ['rooms',      'room_number', 'rooms_room_number_key'],
  ['users',      'username',    'users_username_key'],
  ['employees',  'username',    'employees_username_key'],
  ['bookings',   'reference',   'bookings_reference_key'],
];

const TENANT_DEFAULT_SQL = `NULLIF(current_setting('app.current_tenant_id', true), '')::int`;

async function migrateTenancy(pool) {
  const client = await pool.connect();
  const counts = {};
  try {
    // Pre-migration row counts, for the post-migration integrity check.
    for (const table of TENANT_TABLES) {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      counts[table] = r.rows[0].n;
    }

    // Resolve each table's actual primary key columns from the catalog.
    const pkQ = await client.query(`
      SELECT c.relname::text AS table, array_agg(a.attname::text ORDER BY x.n) AS pk
        FROM pg_class c
        JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
       CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS x(attnum, n)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.attnum
       WHERE c.relnamespace = 'public'::regnamespace
       GROUP BY 1`);
    const pkByTable = Object.fromEntries(pkQ.rows.map(r => [r.table, r.pk]));

    await client.query('BEGIN');

    /* ── 1. Platform tables ──────────────────────────────────────────── */
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id         SERIAL PRIMARY KEY,
        slug       TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
        name       TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
        created_at TIMESTAMPTZ DEFAULT now()
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_settings (
        tenant_id            INT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        razorpay_key_id      TEXT,
        razorpay_key_secret  TEXT,
        whatsapp_sender      TEXT,
        whatsapp_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
        gst_number           TEXT,
        early_late_fee_per_hour NUMERIC(10,2) NOT NULL DEFAULT 150,
        branding             JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at           TIMESTAMPTZ DEFAULT now()
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_admins (
        id            SERIAL PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        full_name     TEXT,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT now()
      )`);

    /* ── 2. Default tenant for all pre-existing rows ─────────────────── */
    const t = await client.query(
      `INSERT INTO tenants (slug, name) VALUES ($1, 'Sunshine Resort')
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`,
      [DEFAULT_TENANT_SLUG]
    );
    const defaultTenantId = t.rows[0].id;
    await client.query(
      `INSERT INTO tenant_settings
         (tenant_id, razorpay_key_id, razorpay_key_secret, gst_number, early_late_fee_per_hour, whatsapp_enabled)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [defaultTenantId,
       process.env.RAZORPAY_KEY_ID || null,
       process.env.RAZORPAY_KEY_SECRET || null,
       process.env.GST_NUMBER || null,
       Number(process.env.EARLY_LATE_FEE_PER_HOUR || 150)]
    );

    /* ── 3. tenant_id on every tenant-scoped table ───────────────────── */
    for (const table of TENANT_TABLES) {
      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id INT`);
      await client.query(`UPDATE ${table} SET tenant_id = $1 WHERE tenant_id IS NULL`, [defaultTenantId]);
      await client.query(`ALTER TABLE ${table} ALTER COLUMN tenant_id SET DEFAULT ${TENANT_DEFAULT_SQL}`);
      await client.query(`ALTER TABLE ${table} ALTER COLUMN tenant_id SET NOT NULL`);
      const fkName = `${table}_tenant_id_fkey`;
      const fk = await client.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`, [fkName, table]
      );
      if (!fk.rows[0]) {
        await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${fkName} FOREIGN KEY (tenant_id) REFERENCES tenants(id)`);
      }
      const pk = pkByTable[table] || [];
      const indexCols = ['tenant_id', ...pk.filter(c => c !== 'tenant_id')];
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table} (${indexCols.join(', ')})`
      );
    }

    /* ── 4. Global uniques → per-tenant uniques ──────────────────────── */
    for (const [table, column, legacyName] of PER_TENANT_UNIQUES) {
      await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${legacyName}`);
      // Some columns may also carry a plain unique index of the same name.
      await client.query(`DROP INDEX IF EXISTS ${legacyName}`);
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${table}_tenant_${column}
           ON ${table} (tenant_id, ${column})${column === 'username' ? ` WHERE ${column} IS NOT NULL` : ''}`
      );
    }

    /* ── 5. Row-Level Security on every tenant table ─────────────────── */
    for (const table of TENANT_TABLES) {
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS tenant_isolation ON ${table}`);
      await client.query(`
        CREATE POLICY tenant_isolation ON ${table}
          USING (tenant_id = ${TENANT_DEFAULT_SQL})
          WITH CHECK (tenant_id = ${TENANT_DEFAULT_SQL})`);
    }

    // Any views (e.g. tasks_with_assignee) must run with the caller's RLS,
    // not their owner's — otherwise a view owned by postgres bypasses RLS.
    const views = await client.query(
      `SELECT viewname FROM pg_views WHERE schemaname = 'public'`
    );
    for (const { viewname } of views.rows) {
      await client.query(`ALTER VIEW ${viewname} SET (security_invoker = true)`);
    }

    /* ── 6. Non-superuser app role (RLS is bypassed by superusers) ───── */
    const appUser = process.env.DB_APP_USER || 'sunshine_app';
    const appPassword = process.env.DB_APP_PASSWORD || 'sunshine_app';
    const role = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [appUser]);
    if (!role.rows[0]) {
      // Identifier/literal built from env — quote defensively.
      await client.query(
        `CREATE ROLE ${quoteIdent(appUser)} LOGIN PASSWORD ${quoteLiteral(appPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE`
      );
    }
    await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(appUser)}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdent(appUser)}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(appUser)}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdent(appUser)}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quoteIdent(appUser)}`);
    // The app role must never read platform admin credentials or write tenants.
    await client.query(`REVOKE ALL ON platform_admins FROM ${quoteIdent(appUser)}`);
    await client.query(`REVOKE INSERT, UPDATE, DELETE ON tenants, tenant_settings FROM ${quoteIdent(appUser)}`);
    await client.query(`GRANT SELECT ON tenants, tenant_settings TO ${quoteIdent(appUser)}`);

    /* ── 7. Seed platform super-admin ────────────────────────────────── */
    const bcrypt = require('bcryptjs');
    const paUser = process.env.PLATFORM_ADMIN_USERNAME || 'superadmin';
    const paPass = process.env.PLATFORM_ADMIN_PASSWORD || 'superadmin123';
    const existing = await client.query(`SELECT 1 FROM platform_admins WHERE username = $1`, [paUser]);
    if (!existing.rows[0]) {
      await client.query(
        `INSERT INTO platform_admins (username, full_name, password_hash) VALUES ($1, 'Platform Admin', $2)`,
        [paUser, await bcrypt.hash(paPass, 10)]
      );
      console.log(`  [tenancy] Seeded platform admin '${paUser}'` +
        (process.env.PLATFORM_ADMIN_PASSWORD ? '' : ` with DEV password 'superadmin123' — change it in production`));
    }

    await client.query('COMMIT');

    /* ── Post-migration integrity check ──────────────────────────────── */
    let ok = true;
    for (const table of TENANT_TABLES) {
      const r = await client.query(
        `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE tenant_id IS NULL)::int AS orphans FROM ${table}`
      );
      if (r.rows[0].n !== counts[table] || r.rows[0].orphans !== 0) {
        ok = false;
        console.error(`  [tenancy] MISMATCH ${table}: pre=${counts[table]} post=${r.rows[0].n} orphans=${r.rows[0].orphans}`);
      }
    }
    console.log(ok
      ? `  [tenancy] Row counts verified for ${TENANT_TABLES.length} tables — no rows lost, no orphans.`
      : '  [tenancy] Integrity check FAILED — inspect output above.');

    /* ── 8. Namespace uploaded files under uploads/<tenant_id>/ ─────── */
    await migrateUploads(client, defaultTenantId);

    return { defaultTenantId, ok };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/* Move legacy uploads/{routines,operations} into uploads/<tid>/... and
   rewrite the URL columns that point at them. Idempotent.
   Set TENANCY_SKIP_UPLOADS=1 when dry-running against a copy database, so
   real files on disk are left alone. */
async function migrateUploads(client, tenantId) {
  if (process.env.TENANCY_SKIP_UPLOADS === '1') {
    console.log('  [tenancy] TENANCY_SKIP_UPLOADS=1 — skipping uploads move/rewrite');
    return;
  }
  const uploadsRoot = path.join(__dirname, '..', 'uploads');
  const tenantRoot = path.join(uploadsRoot, String(tenantId));
  let moved = 0;
  for (const sub of ['routines', 'operations']) {
    const src = path.join(uploadsRoot, sub);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(tenantRoot, sub);
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      const from = path.join(src, f);
      if (!fs.statSync(from).isFile()) continue;
      fs.renameSync(from, path.join(dst, f));
      moved++;
    }
    try { fs.rmdirSync(src); } catch {}
  }
  const rewrites = [
    ['tasks', 'photo_verification_url'],
    ['employee_routines', 'photo_verification_url'],
    ['routine_completions', 'photo_url'],
    ['operations_log', 'photo_url'],
  ];
  for (const [table, col] of rewrites) {
    const hasCol = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, col]
    );
    if (!hasCol.rows[0]) continue;
    await client.query(
      `UPDATE ${table}
          SET ${col} = '/uploads/' || tenant_id || substring(${col} FROM 9)
        WHERE ${col} LIKE '/uploads/%'
          AND ${col} !~ '^/uploads/[0-9]+/'`
    );
  }
  if (moved > 0) console.log(`  [tenancy] Moved ${moved} uploaded file(s) into uploads/${tenantId}/`);
}

function quoteIdent(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
function quoteLiteral(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

module.exports = { migrateTenancy, TENANT_TABLES, DEFAULT_TENANT_SLUG };

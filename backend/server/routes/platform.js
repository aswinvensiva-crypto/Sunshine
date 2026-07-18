/**
 * platform.js — super_admin (platform operator) API. Tenant-less by design:
 * mounted WITHOUT resolveTenant, uses the adminPool, and accepts only tokens
 * of type 'platform' (minted by POST /api/platform/login). Tenant tokens are
 * rejected here, platform tokens are rejected on tenant APIs — the two auth
 * worlds never overlap.
 *
 *   POST  /api/platform/login                       { username, password }
 *   GET   /api/platform/tenants
 *   POST  /api/platform/tenants                     { slug, name, owner: { username, password, full_name? }, settings? }
 *   PATCH /api/platform/tenants/:id/status          { status: 'active' | 'suspended' }
 *   PUT   /api/platform/tenants/:id/settings        { razorpay_key_id?, ... }
 *   POST  /api/platform/tenants/:id/impersonate     → short-lived owner token for support
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { adminPool } = require('../config/db');
const { SECRET } = require('../middleware/auth');
const { invalidateTenantCache } = require('../middleware/tenant');

/* ── auth ─────────────────────────────────────────────────────────────── */

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const { rows } = await adminPool.query(
      'SELECT id, username, full_name, password_hash FROM platform_admins WHERE username = $1',
      [username]
    );
    const admin = rows[0];
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = jwt.sign(
      { id: admin.id, username: admin.username, type: 'platform', role: 'super_admin' },
      SECRET,
      { expiresIn: '4h' }
    );
    res.json({ token, admin: { username: admin.username, full_name: admin.full_name } });
  } catch (err) {
    console.error('[platform/login]', err.message);
    res.status(500).json({ error: err.message });
  }
});

function requirePlatformAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== 'platform') {
      return res.status(403).json({ error: 'Platform admin access only' });
    }
    req.platformAdmin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — please sign in again' });
  }
}

/* ── tenant CRUD ──────────────────────────────────────────────────────── */

router.get('/tenants', requirePlatformAdmin, async (req, res) => {
  try {
    const { rows } = await adminPool.query(`
      SELECT t.id, t.slug, t.name, t.status, t.created_at,
             (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count,
             (SELECT COUNT(*)::int FROM bookings b WHERE b.tenant_id = t.id) AS booking_count
        FROM tenants t ORDER BY t.id`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create tenant + seed its first owner account in one transaction.
router.post('/tenants', requirePlatformAdmin, async (req, res) => {
  const { slug, name, owner, settings } = req.body || {};
  if (!slug || !name) return res.status(400).json({ error: 'slug and name are required' });
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return res.status(400).json({ error: 'slug must be lowercase letters, digits and hyphens' });
  }
  if (!owner?.username || !owner?.password) {
    return res.status(400).json({ error: 'owner.username and owner.password are required' });
  }
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const t = await client.query(
      `INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id, slug, name, status, created_at`,
      [slug, name]
    );
    const tenant = t.rows[0];
    await client.query(
      `INSERT INTO tenant_settings (tenant_id, razorpay_key_id, razorpay_key_secret, whatsapp_sender, gst_number, early_late_fee_per_hour, branding)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 150), COALESCE($7, '{}'::jsonb))`,
      [tenant.id,
       settings?.razorpay_key_id || null,
       settings?.razorpay_key_secret || null,
       settings?.whatsapp_sender || null,
       settings?.gst_number || null,
       settings?.early_late_fee_per_hour ?? null,
       settings?.branding ? JSON.stringify(settings.branding) : null]
    );
    const hash = await bcrypt.hash(owner.password, 10);
    // adminPool bypasses RLS and the session-var default, so tenant_id is explicit.
    const u = await client.query(
      `INSERT INTO users (tenant_id, username, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'owner') RETURNING id, username, role`,
      [tenant.id, owner.username, owner.full_name || null, hash]
    );
    await client.query('COMMIT');
    invalidateTenantCache(slug);
    res.status(201).json({ tenant, owner: u.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'A tenant with that slug already exists' });
    console.error('[platform/tenants POST]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/tenants/:id/status', requirePlatformAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
  }
  try {
    const { rows } = await adminPool.query(
      `UPDATE tenants SET status = $1 WHERE id = $2 RETURNING id, slug, name, status`,
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' });
    invalidateTenantCache(rows[0].slug);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detail for one tenant: its record + user accounts (owners/managers/staff).
// Passwords are bcrypt hashes and are NEVER returned — they cannot be
// recovered, only reset via the endpoint below.
router.get('/tenants/:id', requirePlatformAdmin, async (req, res) => {
  try {
    const t = await adminPool.query(
      `SELECT id, slug, name, status, created_at FROM tenants WHERE id = $1`, [req.params.id]
    );
    if (!t.rows[0]) return res.status(404).json({ error: 'Tenant not found' });
    const users = await adminPool.query(
      `SELECT id, username, full_name, role, is_blocked, created_at
         FROM users WHERE tenant_id = $1 ORDER BY (role = 'owner') DESC, id`,
      [req.params.id]
    );
    res.json({ tenant: t.rows[0], users: users.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset a user's password within a tenant. Scoped to the tenant so a
// platform admin can't accidentally target a user in another resort by raw id.
router.patch('/tenants/:id/users/:userId/password', requirePlatformAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'password is required (min 6 characters)' });
  }
  try {
    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await adminPool.query(
      `UPDATE users SET password_hash = $1
         WHERE id = $2 AND tenant_id = $3
       RETURNING id, username, role`,
      [hash, req.params.userId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found in this resort' });
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('[platform/reset-password]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/tenants/:id/settings', requirePlatformAdmin, async (req, res) => {
  const s = req.body || {};
  try {
    const { rows } = await adminPool.query(
      `INSERT INTO tenant_settings (tenant_id, razorpay_key_id, razorpay_key_secret, whatsapp_sender, whatsapp_enabled, gst_number, early_late_fee_per_hour, branding, updated_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,false),$6,COALESCE($7,150),COALESCE($8,'{}'::jsonb),now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         razorpay_key_id     = COALESCE($2, tenant_settings.razorpay_key_id),
         razorpay_key_secret = COALESCE($3, tenant_settings.razorpay_key_secret),
         whatsapp_sender     = COALESCE($4, tenant_settings.whatsapp_sender),
         whatsapp_enabled    = COALESCE($5, tenant_settings.whatsapp_enabled),
         gst_number          = COALESCE($6, tenant_settings.gst_number),
         early_late_fee_per_hour = COALESCE($7, tenant_settings.early_late_fee_per_hour),
         branding            = COALESCE($8, tenant_settings.branding),
         updated_at          = now()
       RETURNING *`,
      [req.params.id, s.razorpay_key_id ?? null, s.razorpay_key_secret ?? null,
       s.whatsapp_sender ?? null, s.whatsapp_enabled ?? null, s.gst_number ?? null,
       s.early_late_fee_per_hour ?? null, s.branding ? JSON.stringify(s.branding) : null]
    );
    const t = await adminPool.query('SELECT slug FROM tenants WHERE id = $1', [req.params.id]);
    if (t.rows[0]) invalidateTenantCache(t.rows[0].slug);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Support impersonation: mint a short-lived owner token for the tenant.
// The token is a normal tenant token (tenant_id cross-check still applies),
// so it only works against that tenant's own subdomain/slug.
router.post('/tenants/:id/impersonate', requirePlatformAdmin, async (req, res) => {
  try {
    const { rows } = await adminPool.query(
      `SELECT id, slug, name, status FROM tenants WHERE id = $1`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' });
    if (rows[0].status !== 'active') return res.status(403).json({ error: 'Tenant is suspended' });
    const owner = await adminPool.query(
      `SELECT id, username FROM users WHERE tenant_id = $1 AND role = 'owner' ORDER BY id LIMIT 1`,
      [rows[0].id]
    );
    if (!owner.rows[0]) return res.status(404).json({ error: 'Tenant has no owner account' });
    const token = jwt.sign(
      {
        id: owner.rows[0].id,
        username: owner.rows[0].username,
        role: 'owner',
        tenant_id: rows[0].id,
        impersonated_by: req.platformAdmin.username,
      },
      SECRET,
      { expiresIn: '30m' }
    );
    res.json({ token, tenant: { slug: rows[0].slug, name: rows[0].name }, expires_in: '30m' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

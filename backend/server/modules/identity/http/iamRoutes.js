/**
 * iamRoutes.js — /api/admin/iam/*: roles, role assignment, credential resets,
 * housekeeping PINs + device codes, and the approvals inbox.
 * Mounted behind resolveTenant + requireAuth in server.js.
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { requirePermission, requireAnyPermission, can } = require('./requirePermission');
const { PERMISSIONS } = require('../domain/permissions');
const { canAssignRole } = require('../domain/delegation');
const { setUserRole } = require('../infra/rbacRepo');
const { decideApproval } = require('../application/approvals');

const E164 = /^\+[1-9]\d{7,14}$/;
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

async function rolePermissions(db, tenantId, roleCode) {
  const r = await db.query(
    `SELECT r.id, rp.permission_code FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 AND r.code = $2`,
    [tenantId, roleCode]
  );
  if (!r.rows.length) return null;
  return r.rows.map((x) => x.permission_code).filter(Boolean);
}

// GET /roles — all roles with their permissions
router.get('/roles', requirePermission('user.manage'), async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT r.code, r.name, r.is_system, COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
                FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 GROUP BY r.id ORDER BY r.id`,
      [req.tenant.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /permissions — catalogue
router.get('/permissions', requirePermission('user.manage'), (req, res) => {
  res.json(Object.entries(PERMISSIONS).map(([code, description]) => ({ code, description })));
});

// PUT /users/:id/role  { role_code }
router.put('/users/:id/role', requirePermission('user.admin'), async (req, res) => {
  const { role_code } = req.body || {};
  if (!role_code) return res.status(400).json({ error: 'role_code is required' });
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' });
  try {
    const perms = await rolePermissions(req.db, req.tenant.id, role_code);
    if (!perms) return res.status(400).json({ error: 'Unknown role', code: 'ROLE_NOT_FOUND' });
    const guard = canAssignRole(req.user.permissions, perms);
    if (!guard.ok) return res.status(403).json({ error: guard.error.message, code: guard.error.code });
    const exists = await req.db.query('SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'User not found' });
    const out = await setUserRole(req.db, req.tenant.id, req.params.id, role_code);
    if (!out.ok) return res.status(400).json({ error: out.error.message, code: out.error.code });
    res.json({ ok: true, role_code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /users/:id/reset-password  { password }
// Owner/manager reset. You cannot reset someone more powerful than you.
router.post('/users/:id/reset-password', requirePermission('user.manage'), async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const t = await req.db.query(
      `SELECT u.id, r.code AS role_code FROM users u
         LEFT JOIN user_property_memberships m ON m.user_id = u.id AND m.tenant_id = u.tenant_id
         LEFT JOIN roles r ON r.id = m.role_id
        WHERE u.id = $1 AND u.tenant_id = $2`,
      [req.params.id, req.tenant.id]
    );
    if (!t.rows[0]) return res.status(404).json({ error: 'User not found' });
    const targetPerms = t.rows[0].role_code ? await rolePermissions(req.db, req.tenant.id, t.rows[0].role_code) : [];
    const guard = canAssignRole(req.user.permissions, targetPerms || []);
    if (!guard.ok) return res.status(403).json({ error: 'You cannot reset the password of a more privileged user', code: guard.error.code });
    await req.db.query(
      `UPDATE users SET password_hash=$1, token_version = token_version + 1, failed_logins = 0, locked_until = NULL
        WHERE id=$2 AND tenant_id=$3`,
      [await bcrypt.hash(password, 10), req.params.id, req.tenant.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /users/:id/phone  { phone }  (E.164) — links a WhatsApp identity to a user
router.put('/users/:id/phone', requirePermission('user.manage'), async (req, res) => {
  const { phone } = req.body || {};
  if (phone && !E164.test(phone)) return res.status(400).json({ error: 'phone must be E.164, e.g. +919876543210' });
  try {
    const { rows } = await req.db.query(
      'UPDATE users SET phone=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id, phone',
      [phone || null, req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That phone is already linked to another user' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /employees/:id/pin  { pin }  — 4-6 digits, housekeeping only
router.put('/employees/:id/pin', requirePermission('staff.manage'), async (req, res) => {
  const { pin } = req.body || {};
  if (!/^\d{4,6}$/.test(String(pin || ''))) return res.status(400).json({ error: 'PIN must be 4 to 6 digits' });
  try {
    const { rows } = await req.db.query(
      `UPDATE employees SET pin_hash=$1, pin_failed=0, pin_locked_until=NULL, token_version = token_version + 1
        WHERE employee_id=$2 AND tenant_id=$3 RETURNING employee_id`,
      [await bcrypt.hash(String(pin), 10), req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /employees/:id/device-code — one-time 6-digit code, valid 15 minutes
router.post('/employees/:id/device-code', requirePermission('staff.manage'), async (req, res) => {
  try {
    const emp = await req.db.query('SELECT 1 FROM employees WHERE employee_id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!emp.rows[0]) return res.status(404).json({ error: 'Employee not found' });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await req.db.query(
      `INSERT INTO device_enrol_codes (tenant_id, employee_id, code_hash, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.tenant.id, req.params.id, sha256(`${req.tenant.id}:${code}`), req.user.id ?? null, expires]
    );
    res.status(201).json({ code, expires_at: expires });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/employees/:id/devices', requirePermission('staff.manage'), async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, label, approved_at, revoked_at FROM employee_devices
        WHERE employee_id=$1 AND tenant_id=$2 ORDER BY id`,
      [req.params.id, req.tenant.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/employees/:id/devices/:deviceId', requirePermission('staff.manage'), async (req, res) => {
  try {
    const { rowCount } = await req.db.query(
      `UPDATE employee_devices SET revoked_at = now()
        WHERE id=$1 AND employee_id=$2 AND tenant_id=$3`,
      [req.params.deviceId, req.params.id, req.tenant.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Device not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /approvals?status=pending — approvers see everything, others only their own
router.get('/approvals', requireAnyPermission('approval.decide', 'folio.refund', 'rate.override'), async (req, res) => {
  const status = req.query.status || null;
  try {
    const mine = !can(req, 'approval.decide');
    const { rows } = await req.db.query(
      `SELECT id, kind, status, amount, reason, payload, requested_by_name, created_at,
              decided_at, decision_note, result
         FROM approval_requests
        WHERE tenant_id = $1
          AND ($2::text IS NULL OR status = $2)
          AND (NOT $3 OR (requested_by = $4 AND requested_by_type = $5))
        ORDER BY created_at DESC LIMIT 200`,
      [req.tenant.id, status, mine, req.user.id ?? req.user.employee_id, req.user.type === 'employee' ? 'employee' : 'user']
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /approvals/:id/decide  { decision: 'approve'|'reject', note? }
router.post('/approvals/:id/decide', requirePermission('approval.decide'), async (req, res) => {
  const { decision, note } = req.body || {};
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
  try {
    const out = await decideApproval(req.db, req.tenant, req.user, req.params.id, { approve: decision === 'approve', note });
    if (!out.ok) {
      const status = { NOT_FOUND: 404, ALREADY_DECIDED: 409, SELF_APPROVAL: 403 }[out.error.code] || 422;
      return res.status(status).json({ error: out.error.message, code: out.error.code });
    }
    res.json({ ok: true, ...out.value });
  } catch (err) {
    console.error('[iam/approvals]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

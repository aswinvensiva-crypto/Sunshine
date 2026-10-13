const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { SECRET } = require('../middleware/auth');
const { makeLoginLimiter } = require('../modules/identity/http/loginRateLimit');
const { publicRoute } = require('../modules/identity/http/requirePermission');
const { checkLocked, recordFailure, recordSuccess } = require('../modules/identity/domain/lockout');
const { employeeRoleCode } = require('../modules/identity/domain/permissions');
const { loadSession } = require('../modules/identity/infra/rbacRepo');

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const PIN_RE = /^\d{4,6}$/;
const PIN_SESSION = '4h';

async function issueEmployeeSession(req, res, emp, { expiresIn, via }) {
  const rolesArr = Array.isArray(emp.roles) && emp.roles.length > 0 ? emp.roles : [emp.role || 'Front Desk'];
  const access = await loadSession(req.db, req.tenant.id, { type: 'employee', employee_id: emp.employee_id });
  const token = jwt.sign(
    { employee_id: emp.employee_id, username: emp.username, type: 'employee', tenant_id: req.tenant.id, tv: emp.token_version, via },
    SECRET,
    { expiresIn }
  );
  res.json({
    token,
    employee: {
      employee_id: emp.employee_id,
      username: emp.username,
      full_name: `${emp.first_name} ${emp.last_name || ''}`.trim(),
      role: rolesArr[0],
      roles: rolesArr,
      role_code: access.roleCode,
      permissions: [...access.permissions],
    },
    tenant: { slug: req.tenant.slug, name: req.tenant.name },
  });
}

// POST /api/employee/login  { username, password }
// Mounted behind resolveTenant — employees are looked up within this resort
// only, and the token carries the resolved tenant_id.
router.post('/login', publicRoute('credential endpoint'), makeLoginLimiter(), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const { rows } = await req.db.query(
      `SELECT employee_id, first_name, last_name, role, roles, is_active, username, password_hash,
              token_version, failed_logins, locked_until
         FROM employees WHERE username = $1 AND tenant_id = $2`,
      [username, req.tenant.id]
    );
    const emp = rows[0];
    if (!emp || !emp.password_hash) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ error: 'Invalid username or password', code: 'NOT_IN_TENANT' });
    }
    if (!emp.is_active) return res.status(403).json({ error: 'Account is inactive — contact the manager' });

    const lock = checkLocked({ failed: emp.failed_logins, lockedUntil: emp.locked_until });
    if (!lock.ok) {
      return res.status(429).json({ error: lock.error.message, code: lock.error.code, retryAfterSeconds: Math.ceil(lock.error.retryAfterMs / 1000) });
    }

    const ok = await bcrypt.compare(password, emp.password_hash);
    if (!ok) {
      const next = recordFailure({ failed: emp.failed_logins });
      await req.db.query(
        'UPDATE employees SET failed_logins=$1, locked_until=$2 WHERE employee_id=$3 AND tenant_id=$4',
        [next.failed, next.lockedUntil, emp.employee_id, req.tenant.id]
      );
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const reset = recordSuccess();
    await req.db.query(
      'UPDATE employees SET failed_logins=$1, locked_until=$2 WHERE employee_id=$3 AND tenant_id=$4',
      [reset.failed, reset.lockedUntil, emp.employee_id, req.tenant.id]
    );
    await issueEmployeeSession(req, res, emp, { expiresIn: '8h', via: 'password' });
  } catch (err) {
    console.error('[employee-auth]', err.message);
    res.status(500).json({ error: 'Sign-in failed' });
  }
});

// POST /api/employee/enrol-device  { code, device_id, label? }
// A manager issues a one-time code (POST /api/admin/iam/employees/:id/device-code);
// the housekeeper's phone redeems it once, binding that device to the employee.
router.post('/enrol-device', publicRoute('redeems a one-time manager-issued code'), makeLoginLimiter({ max: 15 }), async (req, res) => {
  const { code, device_id, label } = req.body || {};
  if (!code || !device_id || String(device_id).length < 16) {
    return res.status(400).json({ error: 'code and a valid device_id are required' });
  }
  try {
    const result = await req.db.tx(async (c) => {
      const r = await c.query(
        `SELECT id, employee_id FROM device_enrol_codes
          WHERE code_hash = $1 AND tenant_id = $2 AND used_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [sha256(`${req.tenant.id}:${code}`), req.tenant.id]
      );
      if (!r.rows[0]) return null;
      await c.query(`UPDATE device_enrol_codes SET used_at = now() WHERE id = $1`, [r.rows[0].id]);
      await c.query(
        `INSERT INTO employee_devices (tenant_id, employee_id, device_id_hash, label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_id, device_id_hash) DO UPDATE SET revoked_at = NULL, label = EXCLUDED.label`,
        [req.tenant.id, r.rows[0].employee_id, sha256(device_id), label || null]
      );
      return r.rows[0];
    });
    if (!result) return res.status(400).json({ error: 'That code is invalid or has expired' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[employee-auth/enrol]', err.message);
    res.status(500).json({ error: 'Could not enrol device' });
  }
});

// POST /api/employee/pin-login  { username, pin, device_id }
// Shared-phone login for housekeeping: device-bound, 4h session, and only for
// employees whose RBAC role is HOUSEKEEPING.
router.post('/pin-login', publicRoute('credential endpoint'), makeLoginLimiter(), async (req, res) => {
  const { username, pin, device_id } = req.body || {};
  if (!username || !pin || !device_id) return res.status(400).json({ error: 'username, pin and device_id are required' });
  if (!PIN_RE.test(String(pin))) return res.status(401).json({ error: 'Invalid username or PIN' });
  try {
    const { rows } = await req.db.query(
      `SELECT employee_id, first_name, last_name, role, roles, is_active, username, pin_hash,
              rbac_role_code, token_version, pin_failed, pin_locked_until
         FROM employees WHERE username = $1 AND tenant_id = $2`,
      [username, req.tenant.id]
    );
    const emp = rows[0];
    if (!emp || !emp.pin_hash) {
      await bcrypt.compare(String(pin), DUMMY_HASH);
      return res.status(401).json({ error: 'Invalid username or PIN' });
    }
    if (!emp.is_active) return res.status(403).json({ error: 'Account is inactive — contact the manager' });
    const roleCode = emp.rbac_role_code || employeeRoleCode(emp.roles && emp.roles.length ? emp.roles : emp.role);
    if (roleCode !== 'HOUSEKEEPING') {
      return res.status(403).json({ error: 'PIN sign-in is for housekeeping staff only', code: 'PIN_NOT_ALLOWED' });
    }

    const dev = await req.db.query(
      `SELECT 1 FROM employee_devices
        WHERE employee_id=$1 AND tenant_id=$2 AND device_id_hash=$3 AND revoked_at IS NULL`,
      [emp.employee_id, req.tenant.id, sha256(device_id)]
    );
    if (!dev.rows[0]) {
      return res.status(403).json({ error: 'This phone is not registered — ask your manager for a device code', code: 'DEVICE_NOT_ENROLLED' });
    }

    const lock = checkLocked({ failed: emp.pin_failed, lockedUntil: emp.pin_locked_until });
    if (!lock.ok) {
      return res.status(429).json({ error: lock.error.message, code: lock.error.code, retryAfterSeconds: Math.ceil(lock.error.retryAfterMs / 1000) });
    }

    const ok = await bcrypt.compare(String(pin), emp.pin_hash);
    if (!ok) {
      const next = recordFailure({ failed: emp.pin_failed });
      await req.db.query(
        'UPDATE employees SET pin_failed=$1, pin_locked_until=$2 WHERE employee_id=$3 AND tenant_id=$4',
        [next.failed, next.lockedUntil, emp.employee_id, req.tenant.id]
      );
      return res.status(401).json({ error: 'Invalid username or PIN' });
    }
    const reset = recordSuccess();
    await req.db.query(
      'UPDATE employees SET pin_failed=$1, pin_locked_until=$2 WHERE employee_id=$3 AND tenant_id=$4',
      [reset.failed, reset.lockedUntil, emp.employee_id, req.tenant.id]
    );
    await issueEmployeeSession(req, res, emp, { expiresIn: PIN_SESSION, via: 'pin' });
  } catch (err) {
    console.error('[employee-auth/pin]', err.message);
    res.status(500).json({ error: 'Sign-in failed' });
  }
});

module.exports = router;

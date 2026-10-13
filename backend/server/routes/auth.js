const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../middleware/auth');
const { makeLoginLimiter } = require('../modules/identity/http/loginRateLimit');
const { publicRoute } = require('../modules/identity/http/requirePermission');
const { checkLocked, recordFailure, recordSuccess } = require('../modules/identity/domain/lockout');
const { loadSession } = require('../modules/identity/infra/rbacRepo');

// Compared against when the username does not exist, so response time does not
// reveal which usernames are real.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// POST /api/auth/login  { username, password }
// Mounted behind resolveTenant: the user must exist in THIS resort. The JWT
// is minted with the resolved tenant_id so requireAuth can cross-check it.
router.post('/login', publicRoute('credential endpoint'), makeLoginLimiter(), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const { rows } = await req.db.query(
      `SELECT id, username, full_name, password_hash, role, is_blocked, token_version,
              failed_logins, locked_until
         FROM users WHERE username = $1 AND tenant_id = $2`,
      [username, req.tenant.id]
    );
    const user = rows[0];
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ error: 'Invalid username or password', code: 'NOT_IN_TENANT' });
    }

    const lock = checkLocked({ failed: user.failed_logins, lockedUntil: user.locked_until });
    if (!lock.ok) {
      return res.status(429).json({ error: lock.error.message, code: lock.error.code, retryAfterSeconds: Math.ceil(lock.error.retryAfterMs / 1000) });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const next = recordFailure({ failed: user.failed_logins });
      await req.db.query(
        'UPDATE users SET failed_logins = $1, locked_until = $2 WHERE id = $3 AND tenant_id = $4',
        [next.failed, next.lockedUntil, user.id, req.tenant.id]
      );
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (user.is_blocked) return res.status(403).json({ error: 'Account blocked — contact the owner' });

    const reset = recordSuccess();
    await req.db.query(
      'UPDATE users SET failed_logins = $1, locked_until = $2, last_login_at = now() WHERE id = $3 AND tenant_id = $4',
      [reset.failed, reset.lockedUntil, user.id, req.tenant.id]
    );

    const access = await loadSession(req.db, req.tenant.id, { id: user.id });
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, tenant_id: req.tenant.id, tv: user.token_version },
      SECRET,
      { expiresIn: '8h' }
    );
    res.json({
      token,
      user: {
        username: user.username,
        full_name: user.full_name,
        role: user.role, // legacy display value
        role_code: access.roleCode,
        permissions: [...access.permissions],
      },
      tenant: { slug: req.tenant.slug, name: req.tenant.name },
    });
  } catch (err) {
    console.error('[auth]', err.message);
    res.status(500).json({ error: 'Sign-in failed' });
  }
});

// GET /api/auth/me — refreshes role + permissions for the client after role changes.
const { requireAuth } = require('../middleware/auth');
const { authenticatedOnly } = require('../modules/identity/http/requirePermission');
router.get('/me', requireAuth, authenticatedOnly('returns the caller\'s own identity'), (req, res) => {
  res.json({
    username: req.user.username,
    role_code: req.user.role_code,
    permissions: [...req.user.permissions],
  });
});

module.exports = router;

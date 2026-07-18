const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../middleware/auth');

// POST /api/auth/login  { username, password }
// Mounted behind resolveTenant: the user must exist in THIS resort. The JWT
// is minted with the resolved tenant_id so requireAuth can cross-check it.
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const { rows } = await req.db.query(
      'SELECT id, username, full_name, password_hash, role, is_blocked FROM users WHERE username = $1 AND tenant_id = $2',
      [username, req.tenant.id]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password', code: 'NOT_IN_TENANT' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
    if (user.is_blocked) return res.status(403).json({ error: 'Account blocked — contact the owner' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, tenant_id: req.tenant.id },
      SECRET,
      { expiresIn: '8h' }
    );
    res.json({
      token,
      user: { username: user.username, full_name: user.full_name, role: user.role },
      tenant: { slug: req.tenant.slug, name: req.tenant.name },
    });
  } catch (err) {
    console.error('[auth]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

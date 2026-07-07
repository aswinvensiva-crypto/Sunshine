const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { SECRET } = require('../middleware/auth');

// POST /api/auth/login  { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const { rows } = await pool.query(
      'SELECT id, username, full_name, password_hash, role, is_blocked FROM users WHERE username = $1',
      [username]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
    if (user.is_blocked) return res.status(403).json({ error: 'Account blocked — contact the owner' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, user: { username: user.username, full_name: user.full_name, role: user.role } });
  } catch (err) {
    console.error('[auth]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

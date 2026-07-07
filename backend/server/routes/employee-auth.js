const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { SECRET } = require('../middleware/auth');

// POST /api/employee/login  { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const { rows } = await pool.query(
      `SELECT employee_id, first_name, last_name, role, roles, is_active, username, password_hash
         FROM employees WHERE username = $1`,
      [username]
    );
    const emp = rows[0];
    if (!emp || !emp.password_hash) return res.status(401).json({ error: 'Invalid username or password' });
    if (!emp.is_active) return res.status(403).json({ error: 'Account is inactive — contact the manager' });

    const ok = await bcrypt.compare(password, emp.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    const rolesArr = Array.isArray(emp.roles) && emp.roles.length > 0 ? emp.roles : [emp.role || 'Front Desk'];

    const token = jwt.sign(
      { employee_id: emp.employee_id, username: emp.username, type: 'employee' },
      SECRET,
      { expiresIn: '8h' }
    );
    res.json({
      token,
      employee: {
        employee_id: emp.employee_id,
        username: emp.username,
        full_name: `${emp.first_name} ${emp.last_name || ''}`.trim(),
        role: rolesArr[0],
        roles: rolesArr,
      },
    });
  } catch (err) {
    console.error('[employee-auth]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

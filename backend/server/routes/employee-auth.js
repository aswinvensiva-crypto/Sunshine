const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../middleware/auth');

// POST /api/employee/login  { username, password }
// Mounted behind resolveTenant — employees are looked up within this resort
// only, and the token carries the resolved tenant_id.
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const { rows } = await req.db.query(
      `SELECT employee_id, first_name, last_name, role, roles, is_active, username, password_hash
         FROM employees WHERE username = $1 AND tenant_id = $2`,
      [username, req.tenant.id]
    );
    const emp = rows[0];
    if (!emp || !emp.password_hash) return res.status(401).json({ error: 'Invalid username or password', code: 'NOT_IN_TENANT' });
    if (!emp.is_active) return res.status(403).json({ error: 'Account is inactive — contact the manager' });

    const ok = await bcrypt.compare(password, emp.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    const rolesArr = Array.isArray(emp.roles) && emp.roles.length > 0 ? emp.roles : [emp.role || 'Front Desk'];

    const token = jwt.sign(
      { employee_id: emp.employee_id, username: emp.username, type: 'employee', tenant_id: req.tenant.id },
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
      tenant: { slug: req.tenant.slug, name: req.tenant.name },
    });
  } catch (err) {
    console.error('[employee-auth]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

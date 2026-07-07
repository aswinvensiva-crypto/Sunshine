const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const SECRET = process.env.JWT_SECRET || 'dev-secret';

// Verifies Bearer token, rejects if user is blocked.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.type !== 'employee') {
      const { rows } = await pool.query('SELECT is_blocked FROM users WHERE id = $1', [decoded.id]);
      if (!rows[0] || rows[0].is_blocked) {
        return res.status(401).json({ error: 'Account blocked — contact the owner' });
      }
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — please sign in again' });
  }
}

// Owners and managers only.
function requireAdmin(req, res, next) {
  if (req.user && (req.user.role === 'owner' || req.user.role === 'manager')) return next();
  return res.status(403).json({ error: 'Admins only' });
}

// Owner only.
function requireOwner(req, res, next) {
  if (req.user?.role === 'owner') return next();
  return res.status(403).json({ error: 'Owner only' });
}

module.exports = { requireAuth, requireAdmin, requireOwner, SECRET };

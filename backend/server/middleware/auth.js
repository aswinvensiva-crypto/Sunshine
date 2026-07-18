const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret';

/**
 * Verifies Bearer token, rejects if user is blocked.
 *
 * Multi-tenant contract (must run AFTER resolveTenant):
 *  - every tenant token carries tenant_id, minted at login;
 *  - the token's tenant_id must equal the tenant resolved from the host —
 *    this is what stops a leaked/stale token from another resort (or a
 *    forged tenant claim) from widening scope. The JWT alone never decides
 *    the row scope; req.db is pinned to the host-resolved tenant.
 *  - platform (super_admin) tokens are rejected here; they are only valid
 *    on /api/platform routes.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const decoded = jwt.verify(token, SECRET);

    if (decoded.type === 'platform') {
      return res.status(403).json({ error: 'Platform tokens are not valid on resort APIs' });
    }
    if (!req.tenant || !req.db) {
      // Route wiring bug — refuse rather than run unscoped.
      console.error('[auth] requireAuth called without resolveTenant');
      return res.status(500).json({ error: 'Tenant context missing' });
    }
    if (Number(decoded.tenant_id) !== Number(req.tenant.id)) {
      return res.status(401).json({ error: 'This session is not valid for this resort — please sign in again', code: 'WRONG_TENANT' });
    }

    if (decoded.type !== 'employee') {
      const { rows } = await req.db.query(
        'SELECT is_blocked FROM users WHERE id = $1 AND tenant_id = $2',
        [decoded.id, req.tenant.id]
      );
      if (!rows[0] || rows[0].is_blocked) {
        return res.status(401).json({ error: 'Account blocked — contact the owner' });
      }
    }
    req.user = decoded;
    next();
  } catch (err) {
    if (err.message === 'Tenant context missing') throw err;
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

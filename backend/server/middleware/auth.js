const jwt = require('jsonwebtoken');
const { loadSession } = require('../modules/identity/infra/rbacRepo');

/**
 * JWT secret. There is NO publicly-known fallback in production: the process
 * refuses to boot without JWT_SECRET. In dev/test a clearly-labelled insecure
 * default keeps `npm run dev` working and logs a warning.
 */
function resolveSecret(env = process.env) {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 16) return env.JWT_SECRET;
  if (env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set (>= 16 chars) in production — refusing to start with a guessable signing key');
  }
  if (env.JWT_SECRET) {
    console.warn('[auth] JWT_SECRET is shorter than 16 chars — fine for dev, rejected in production');
    return env.JWT_SECRET;
  }
  console.warn('[auth] JWT_SECRET not set — using an INSECURE dev-only key. Never deploy like this.');
  return 'insecure-dev-only-signing-key';
}
const SECRET = resolveSecret();

/**
 * Verifies Bearer token, rejects if blocked / revoked, and loads the
 * principal's role + permissions.
 *
 * Multi-tenant contract (must run AFTER resolveTenant):
 *  - every tenant token carries tenant_id, minted at login;
 *  - the token's tenant_id must equal the tenant resolved from the host —
 *    this is what stops a leaked/stale token from another resort (or a
 *    forged tenant claim) from widening scope. The JWT alone never decides
 *    the row scope; req.db is pinned to the host-resolved tenant.
 *  - platform (super_admin) tokens are rejected here; they are only valid
 *    on /api/platform routes.
 *
 * RBAC contract: permissions are read from the DB on EVERY request (never
 * trusted from the token), so a role change, block or password reset takes
 * effect immediately; `tv` (token_version) revokes older tokens.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  let decoded;
  try {
    decoded = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired — please sign in again' });
  }
  try {
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

    const session = await loadSession(req.db, req.tenant.id, decoded);
    if (!session) return res.status(401).json({ error: 'Account no longer exists — please sign in again' });
    if (session.blocked) return res.status(401).json({ error: 'Account blocked — contact the owner' });
    if (Number(decoded.tv ?? 0) !== Number(session.tokenVersion ?? 0)) {
      return res.status(401).json({ error: 'Session revoked — please sign in again', code: 'SESSION_REVOKED' });
    }

    req.user = { ...decoded, role_code: session.roleCode, permissions: session.permissions };
    next();
  } catch (err) {
    console.error('[auth] session check failed:', err.message);
    return res.status(500).json({ error: 'Could not verify session' });
  }
}

/** @deprecated use requirePermission(...). Kept for back-compat only. */
function requireAdmin(req, res, next) {
  if (['OWNER', 'MANAGER', 'GROUP_MANAGER'].includes(req.user?.role_code)) return next();
  return res.status(403).json({ error: 'Admins only' });
}

/** @deprecated use requirePermission(...). Kept for back-compat only. */
function requireOwner(req, res, next) {
  if (req.user?.role_code === 'OWNER') return next();
  return res.status(403).json({ error: 'Owner only' });
}

module.exports = { requireAuth, requireAdmin, requireOwner, resolveSecret, SECRET };

/**
 * requirePermission — route-level authorisation.
 *
 * Every middleware returned here carries `.permissionCode` so the
 * route-coverage test can enumerate all routes and fail on any route that
 * has no explicit permission decision (Prompt 7.1 narrowing).
 */
const { hasPermission } = require('../domain/permissions');

function forbidden(res, required) {
  return res.status(403).json({
    error: 'You do not have permission to do that',
    code: 'FORBIDDEN',
    required,
  });
}

/** All listed permissions are required. */
function requirePermission(...codes) {
  const mw = (req, res, next) => {
    const perms = req.user && req.user.permissions;
    if (!perms) return res.status(401).json({ error: 'Not signed in' });
    if (codes.every((c) => hasPermission(perms, c))) return next();
    return forbidden(res, codes);
  };
  mw.permissionCode = codes;
  return mw;
}

/** Any one of the listed permissions suffices. */
function requireAnyPermission(...codes) {
  const mw = (req, res, next) => {
    const perms = req.user && req.user.permissions;
    if (!perms) return res.status(401).json({ error: 'Not signed in' });
    if (codes.some((c) => hasPermission(perms, c))) return next();
    return forbidden(res, codes);
  };
  mw.permissionCode = codes;
  return mw;
}

/**
 * Explicit, documented "any signed-in principal" marker — a deliberate
 * decision, not an omission. `why` is required so it shows up in review.
 */
function authenticatedOnly(why) {
  if (!why) throw new Error('authenticatedOnly() needs a justification');
  const mw = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Not signed in' }));
  mw.permissionCode = ['*authenticated*'];
  mw.justification = why;
  return mw;
}

/** Marker for routes that are public by design (guest flows, login). */
function publicRoute(why) {
  if (!why) throw new Error('publicRoute() needs a justification');
  const mw = (req, res, next) => next();
  mw.permissionCode = ['*public*'];
  mw.justification = why;
  return mw;
}

/** Inline check inside a handler for conditional rules (e.g. cancel). */
function can(req, code) {
  return !!(req.user && hasPermission(req.user.permissions, code));
}

module.exports = { requirePermission, requireAnyPermission, authenticatedOnly, publicRoute, can };

/**
 * delegation.js — privilege-escalation guard (pure).
 * An actor may only grant a role whose permissions are a subset of their own,
 * so a manager with user.manage can never mint an Owner.
 */
function canAssignRole(actorPermissions, rolePermissions) {
  const actor = actorPermissions instanceof Set ? actorPermissions : new Set(actorPermissions || []);
  const missing = [...rolePermissions].filter((p) => !actor.has(p));
  if (missing.length) {
    return { ok: false, error: { code: 'ROLE_ESCALATION', message: 'You cannot grant a role with more access than your own', missing } };
  }
  return { ok: true, value: true };
}
module.exports = { canAssignRole };

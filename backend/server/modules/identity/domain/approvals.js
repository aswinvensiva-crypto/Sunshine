/**
 * approvals.js — pure policy: does this action need the owner's approval?
 *
 * Actors holding `approval.decide` (the owner) are never gated: they are the
 * approver. Everyone else is gated when the action crosses the threshold.
 * Amounts are rupees (the legacy schema is NUMERIC rupees; the paise
 * migration is a later roadmap item).
 */
const DEFAULT_REFUND_THRESHOLD = 2000;

function requiresApproval({ kind, amount, belowFloor }, actorPermissions, policy = {}) {
  const can = (p) => (actorPermissions instanceof Set ? actorPermissions.has(p) : (actorPermissions || []).includes(p));
  if (can('approval.decide')) return { ok: true, value: false };
  switch (kind) {
    case 'refund.booking':
    case 'refund.gateway':
    case 'writeoff': {
      const threshold = Number(policy.refundThreshold ?? DEFAULT_REFUND_THRESHOLD);
      return { ok: true, value: Number(amount) > threshold };
    }
    case 'rate.override':
      return { ok: true, value: !!belowFloor };
    default:
      return { ok: false, error: { code: 'UNKNOWN_APPROVAL_KIND', message: `Unknown approval kind: ${kind}` } };
  }
}

const APPROVAL_STATUS = ['pending', 'approved', 'rejected', 'failed'];

module.exports = { requiresApproval, DEFAULT_REFUND_THRESHOLD, APPROVAL_STATUS };

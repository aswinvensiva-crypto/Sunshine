const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERMISSIONS, ROLE_DEFS, OWNER_ONLY, employeeRoleCode, legacyRoleToCode, hasPermission,
} = require('../server/modules/identity/domain/permissions');
const { checkLocked, recordFailure, recordSuccess, MAX_FAILED, BASE_LOCK_MS, MAX_LOCK_MS } = require('../server/modules/identity/domain/lockout');
const { requiresApproval, DEFAULT_REFUND_THRESHOLD } = require('../server/modules/identity/domain/approvals');
const { canAssignRole } = require('../server/modules/identity/domain/delegation');

/* ── catalogue integrity ─────────────────────────────────────────────── */
test('every permission granted to a seed role exists in the catalogue', () => {
  for (const [code, def] of Object.entries(ROLE_DEFS)) {
    for (const p of def.permissions) assert.ok(PERMISSIONS[p], `${code} grants unknown permission ${p}`);
  }
});

test('all seven required roles are seeded', () => {
  assert.deepEqual(Object.keys(ROLE_DEFS).sort(),
    ['ACCOUNTANT_RO', 'FRONT_DESK', 'GROUP_MANAGER', 'HOUSEKEEPING', 'MANAGER', 'NIGHT_AUDITOR', 'OWNER']);
});

test('OWNER holds every permission', () => {
  assert.equal(new Set(ROLE_DEFS.OWNER.permissions).size, Object.keys(PERMISSIONS).length);
});

test('MANAGER does not gain powers that used to be owner-only', () => {
  for (const p of OWNER_ONLY) assert.ok(!hasPermission(ROLE_DEFS.MANAGER.permissions, p), `MANAGER must not have ${p}`);
});

test('HOUSEKEEPING has no money, guest-data, user or audit access', () => {
  const forbidden = Object.keys(PERMISSIONS).filter((p) => /^(folio|payment|invoice|expense|guest|user|audit|report|approval|settings|reservation|rate|nightaudit)/.test(p));
  for (const p of forbidden) assert.ok(!hasPermission(ROLE_DEFS.HOUSEKEEPING.permissions, p), `HOUSEKEEPING must not have ${p}`);
});

test('ACCOUNTANT_RO is strictly read-only', () => {
  for (const p of ROLE_DEFS.ACCOUNTANT_RO.permissions) {
    assert.match(p, /\.(view)$/, `${p} is not a read permission`);
  }
});

test('NIGHT_AUDITOR can run night audit but not refund', () => {
  assert.ok(hasPermission(ROLE_DEFS.NIGHT_AUDITOR.permissions, 'nightaudit.run'));
  assert.ok(!hasPermission(ROLE_DEFS.NIGHT_AUDITOR.permissions, 'folio.refund'));
});

test('only OWNER can decide approvals', () => {
  for (const [code, def] of Object.entries(ROLE_DEFS)) {
    assert.equal(hasPermission(def.permissions, 'approval.decide'), code === 'OWNER', code);
  }
});

test('legacy role mapping never loses access nor escalates', () => {
  assert.equal(legacyRoleToCode('owner'), 'OWNER');
  assert.equal(legacyRoleToCode('manager'), 'MANAGER');
  assert.equal(legacyRoleToCode('staff'), 'FRONT_DESK');
  assert.equal(legacyRoleToCode('garbage'), 'FRONT_DESK'); // unknown -> least-privileged staff role
  assert.equal(legacyRoleToCode(undefined), 'FRONT_DESK');
});

test('employee job titles never map to an admin role', () => {
  for (const titles of [['Housekeeping'], ['Front Desk'], ['Pool Attendant'], ['Maintenance'], ['Manager'], ['Owner'], [], undefined, 'Weird']) {
    assert.ok(['HOUSEKEEPING', 'FRONT_DESK'].includes(employeeRoleCode(titles)), JSON.stringify(titles));
  }
  assert.equal(employeeRoleCode(['Housekeeping']), 'HOUSEKEEPING');
  assert.equal(employeeRoleCode(['Front Desk']), 'FRONT_DESK');
});

/* ── lockout ─────────────────────────────────────────────────────────── */
test('lockout: locks on the 5th consecutive failure and not before', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  let s = { failed: 0, lockedUntil: null };
  for (let i = 1; i < MAX_FAILED; i++) {
    s = recordFailure(s, now);
    assert.equal(s.lockedUntil, null, `locked too early at failure ${i}`);
  }
  s = recordFailure(s, now);
  assert.equal(s.failed, MAX_FAILED);
  assert.equal(s.lockedUntil.getTime(), now.getTime() + BASE_LOCK_MS);
  const c = checkLocked(s, now);
  assert.equal(c.ok, false);
  assert.equal(c.error.code, 'ACCOUNT_LOCKED');
});

test('lockout: lock expires, escalates on repeated rounds, and is capped', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  let s = { failed: MAX_FAILED, lockedUntil: new Date(t0.getTime() + BASE_LOCK_MS) };
  assert.equal(checkLocked(s, new Date(t0.getTime() + BASE_LOCK_MS + 1)).ok, true);
  // second full round doubles the lock
  s = { failed: MAX_FAILED * 2 - 1, lockedUntil: null };
  s = recordFailure(s, t0);
  assert.equal(s.lockedUntil.getTime() - t0.getTime(), BASE_LOCK_MS * 2);
  // very many rounds are capped
  s = recordFailure({ failed: MAX_FAILED * 20 - 1 }, t0);
  assert.equal(s.lockedUntil.getTime() - t0.getTime(), MAX_LOCK_MS);
});

test('lockout: success clears the counter', () => {
  assert.deepEqual(recordSuccess(), { failed: 0, lockedUntil: null });
});

/* ── approval policy ─────────────────────────────────────────────────── */
test('approval: refunds at/below threshold pass, above need approval (non-approver)', () => {
  const mgr = new Set(ROLE_DEFS.MANAGER.permissions);
  assert.deepEqual(requiresApproval({ kind: 'refund.booking', amount: DEFAULT_REFUND_THRESHOLD }, mgr), { ok: true, value: false });
  assert.deepEqual(requiresApproval({ kind: 'refund.booking', amount: DEFAULT_REFUND_THRESHOLD + 1 }, mgr), { ok: true, value: true });
});

test('approval: owner (approval.decide) is never gated', () => {
  const owner = new Set(ROLE_DEFS.OWNER.permissions);
  assert.equal(requiresApproval({ kind: 'refund.booking', amount: 1e9 }, owner).value, false);
});

test('approval: below-floor rate override needs approval; custom threshold honoured', () => {
  const mgr = new Set(ROLE_DEFS.MANAGER.permissions);
  assert.equal(requiresApproval({ kind: 'rate.override', belowFloor: true }, mgr).value, true);
  assert.equal(requiresApproval({ kind: 'rate.override', belowFloor: false }, mgr).value, false);
  assert.equal(requiresApproval({ kind: 'refund.gateway', amount: 600 }, mgr, { refundThreshold: 500 }).value, true);
});

test('approval: unknown kind is an error Result, not a throw', () => {
  const r = requiresApproval({ kind: 'nope' }, new Set());
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'UNKNOWN_APPROVAL_KIND');
});

/* ── delegation (privilege-escalation guard) ─────────────────────────── */
test('delegation: manager cannot mint an owner; can mint front desk / housekeeping', () => {
  const mgr = new Set(ROLE_DEFS.MANAGER.permissions);
  assert.equal(canAssignRole(mgr, ROLE_DEFS.OWNER.permissions).ok, false);
  assert.equal(canAssignRole(mgr, ROLE_DEFS.OWNER.permissions).error.code, 'ROLE_ESCALATION');
  assert.equal(canAssignRole(mgr, ROLE_DEFS.FRONT_DESK.permissions).ok, true);
  assert.equal(canAssignRole(mgr, ROLE_DEFS.HOUSEKEEPING.permissions).ok, true);
});

test('delegation: owner can assign any role', () => {
  const owner = new Set(ROLE_DEFS.OWNER.permissions);
  for (const def of Object.values(ROLE_DEFS)) assert.equal(canAssignRole(owner, def.permissions).ok, true);
});

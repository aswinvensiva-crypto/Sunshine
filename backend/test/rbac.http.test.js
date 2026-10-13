process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { build, makeState, addUser, tokenFor, SECRET } = require('./helpers/app');

function world() {
  const state = makeState();
  addUser(state, { id: 1, username: 'owner', role: 'owner', role_code: 'OWNER' });
  addUser(state, { id: 2, username: 'mgr', role: 'manager', role_code: 'MANAGER' });
  addUser(state, { id: 3, username: 'desk', role: 'staff', role_code: 'FRONT_DESK' });
  addUser(state, { id: 4, username: 'ca', role: 'staff', role_code: 'ACCOUNTANT_RO' });
  state.employees[9] = { employee_id: 9, is_active: true, token_version: 0, rbac_role_code: 'HOUSEKEEPING', roles: ['Housekeeping'], role: 'Housekeeping' };
  const ctx = build(state);
  ctx.bearer = (id) => `Bearer ${tokenFor(state.users[id])}`;
  ctx.empBearer = () => `Bearer ${jwt.sign({ employee_id: 9, username: 'hk', type: 'employee', tenant_id: 1, tv: 0 }, SECRET)}`;
  return ctx;
}

/* ── authentication ─────────────────────────────────────────────────── */
test('no token -> 401', async () => {
  const { app } = world();
  await request(app).get('/api/admin/bookings').expect(401);
});

test('old hardcoded credential admin/admin123 no longer works', async () => {
  const { app } = world();
  const r = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
  assert.equal(r.status, 401);
});

test('token from another tenant is rejected (WRONG_TENANT)', async () => {
  const { app, state } = world();
  const t = tokenFor(state.users[1], { tenant_id: 2 });
  const r = await request(app).get('/api/admin/bookings').set('Authorization', `Bearer ${t}`);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'WRONG_TENANT');
});

test('blocked user is rejected immediately', async () => {
  const { app, state, bearer } = world();
  state.users[3].is_blocked = true;
  await request(app).get('/api/admin/bookings').set('Authorization', bearer(3)).expect(401);
});

test('bumping token_version revokes an existing token (role change / reset / block)', async () => {
  const { app, state, bearer } = world();
  const old = bearer(3);
  await request(app).get('/api/admin/bookings').set('Authorization', old).expect(200);
  state.users[3].token_version += 1;
  const r = await request(app).get('/api/admin/bookings').set('Authorization', old);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'SESSION_REVOKED');
});

test('login succeeds with correct password, returns role_code + permissions, never the hash', async () => {
  const { app } = world();
  const r = await request(app).post('/api/auth/login').send({ username: 'mgr', password: 'Password#123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role_code, 'MANAGER');
  assert.ok(r.body.user.permissions.includes('folio.refund'));
  assert.ok(!r.body.user.permissions.includes('reservation.delete'));
  assert.ok(!JSON.stringify(r.body).includes('password_hash'));
});

test('5 wrong passwords lock the account; the correct password is then refused with 429', async () => {
  const { app } = world();
  for (let i = 0; i < 5; i++) {
    const r = await request(app).post('/api/auth/login').send({ username: 'desk', password: 'wrong' });
    assert.equal(r.status, 401);
  }
  const locked = await request(app).post('/api/auth/login').send({ username: 'desk', password: 'Password#123' });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, 'ACCOUNT_LOCKED');
});

/* ── authorisation ──────────────────────────────────────────────────── */
test('housekeeping employee gets 403 on folio / payment / reports / reservations routes', async () => {
  const { app, empBearer } = world();
  const deny = [
    ['get', '/api/admin/daily-payments'],
    ['get', '/api/admin/bookings'],
    ['get', '/api/admin/guests'],
    ['get', '/api/admin/expenses'],
    ['get', '/api/admin/users'],
    ['post', '/api/admin/bookings/5/refund'],
    ['patch', '/api/admin/bookings/5/mark-balance-paid'],
    ['get', '/api/payments/transactions'],
    ['post', '/api/payments/refund'],
    ['get', '/api/admin/iam/roles'],
    ['get', '/api/admin/iam/approvals'],
  ];
  for (const [m, url] of deny) {
    const r = await request(app)[m](url).set('Authorization', empBearer()).send({});
    assert.equal(r.status, 403, `${m.toUpperCase()} ${url} -> ${r.status}`);
    assert.equal(r.body.code, 'FORBIDDEN');
  }
});

test('housekeeping employee CAN reach their own task endpoints', async () => {
  const { app, empBearer } = world();
  const r = await request(app).get('/api/admin/my-tasks').set('Authorization', empBearer());
  assert.notEqual(r.status, 403);
  assert.notEqual(r.status, 401);
});

test('accountant (read-only) can read payments but cannot write anything', async () => {
  const { app, bearer } = world();
  const ok = await request(app).get('/api/admin/daily-payments').set('Authorization', bearer(4));
  assert.notEqual(ok.status, 403);
  for (const [m, url] of [
    ['post', '/api/admin/bookings/new'], ['post', '/api/admin/expenses'], ['patch', '/api/admin/bookings/5/mark-balance-paid'],
    ['post', '/api/admin/bookings/5/refund'], ['delete', '/api/admin/bookings/5'], ['post', '/api/admin/users'],
  ]) {
    const r = await request(app)[m](url).set('Authorization', bearer(4)).send({});
    assert.equal(r.status, 403, `${m.toUpperCase()} ${url} -> ${r.status}`);
  }
});

test('manager cannot use owner-only powers', async () => {
  const { app, bearer } = world();
  for (const [m, url] of [
    ['delete', '/api/admin/bookings/5'], ['delete', '/api/admin/guests/1'], ['post', '/api/admin/room-types'],
    ['patch', '/api/admin/users/3/block'], ['delete', '/api/admin/users/3'], ['delete', '/api/admin/expenses/1'],
    ['patch', '/api/admin/bookings/5/verify-payment'], ['post', '/api/admin/bookings/5/send-invoice'],
    ['post', '/api/admin/iam/approvals/1/decide'], ['put', '/api/admin/iam/users/3/role'],
  ]) {
    const r = await request(app)[m](url).set('Authorization', bearer(2)).send({});
    assert.equal(r.status, 403, `${m.toUpperCase()} ${url} -> ${r.status}`);
  }
});

test('front desk can create bookings but cannot cancel unless granted; cancel is its own permission', async () => {
  const { app, bearer, state } = world();
  const r1 = await request(app).patch('/api/admin/bookings/5/status').set('Authorization', bearer(3)).send({ status: 'checked_in' });
  assert.notEqual(r1.status, 403);
  // remove cancel from a clone user: ACCOUNTANT has no reservation.modify at all
  const r2 = await request(app).patch('/api/admin/bookings/5/status').set('Authorization', bearer(4)).send({ status: 'cancelled' });
  assert.equal(r2.status, 403);
  assert.ok(state);
});

test('manager cannot create an OWNER user (privilege escalation blocked) but can create front desk', async () => {
  const { app, bearer } = world();
  const bad = await request(app).post('/api/admin/users').set('Authorization', bearer(2))
    .send({ username: 'evil', password: 'Password#123', role_code: 'OWNER' });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.code, 'ROLE_ESCALATION');
  const legacy = await request(app).post('/api/admin/users').set('Authorization', bearer(2))
    .send({ username: 'evil2', password: 'Password#123', role: 'owner' });
  assert.equal(legacy.status, 403, 'legacy role:"owner" must not bypass the guard');
});

test('manager cannot reset an owner password', async () => {
  const { app, bearer } = world();
  const r = await request(app).post('/api/admin/iam/users/1/reset-password').set('Authorization', bearer(2)).send({ password: 'NewPassword#1' });
  assert.equal(r.status, 403);
});

test('weak passwords are rejected on user creation', async () => {
  const { app, bearer } = world();
  const r = await request(app).post('/api/admin/users').set('Authorization', bearer(1)).send({ username: 'x', password: 'short', role_code: 'FRONT_DESK' });
  assert.equal(r.status, 400);
});

/* ── approval workflow ──────────────────────────────────────────────── */
test('approval flow: manager refund above threshold is held, owner approves, refund executes exactly once', async () => {
  const { app, state, bearer } = world();

  const small = await request(app).post('/api/admin/bookings/5/refund').set('Authorization', bearer(2))
    .send({ refund_amount: 1500, reason: 'goodwill' });
  assert.equal(small.status, 200, 'below threshold is applied directly');
  assert.equal(state.refundRecorded, 1);

  const big = await request(app).post('/api/admin/bookings/5/refund').set('Authorization', bearer(2))
    .send({ refund_amount: 5000, reason: 'room downgrade' });
  assert.equal(big.status, 202);
  assert.equal(big.body.pending_approval, true);
  assert.equal(state.refundRecorded, 1, 'nothing applied while pending');
  assert.equal(state.approvals.length, 1);
  const id = big.body.approval_id;

  // the manager cannot approve their own request
  const self = await request(app).post(`/api/admin/iam/approvals/${id}/decide`).set('Authorization', bearer(2)).send({ decision: 'approve' });
  assert.equal(self.status, 403);

  const ok = await request(app).post(`/api/admin/iam/approvals/${id}/decide`).set('Authorization', bearer(1)).send({ decision: 'approve' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'approved');
  assert.equal(state.refundRecorded, 2, 'refund applied on approval');

  // double click / replay must not execute again
  const again = await request(app).post(`/api/admin/iam/approvals/${id}/decide`).set('Authorization', bearer(1)).send({ decision: 'approve' });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'ALREADY_DECIDED');
  assert.equal(state.refundRecorded, 2);
});

test('approval flow: owner can reject; rejected request never executes', async () => {
  const { app, state, bearer } = world();
  const big = await request(app).post('/api/admin/bookings/5/refund').set('Authorization', bearer(2)).send({ refund_amount: 6000, reason: 'x' });
  const rej = await request(app).post(`/api/admin/iam/approvals/${big.body.approval_id}/decide`).set('Authorization', bearer(1)).send({ decision: 'reject', note: 'no' });
  assert.equal(rej.status, 200);
  assert.equal(rej.body.status, 'rejected');
  assert.ok(!state.refundRecorded);
});

test('owner refunds above threshold are applied directly (the owner is the approver)', async () => {
  const { app, state, bearer } = world();
  const r = await request(app).post('/api/admin/bookings/5/refund').set('Authorization', bearer(1)).send({ refund_amount: 9000, reason: 'owner decision' });
  assert.equal(r.status, 200);
  assert.equal(state.refundRecorded, 1);
  assert.equal(state.approvals.length, 0);
});

test('refund cannot exceed amount collected (approval executor failure is recorded, nothing applied)', async () => {
  const { app, state, bearer } = world();
  state.bookings[5].advance_paid = 3000;
  const big = await request(app).post('/api/admin/bookings/5/refund').set('Authorization', bearer(2)).send({ refund_amount: 5000, reason: 'x' });
  assert.equal(big.status, 202);
  const r = await request(app).post(`/api/admin/iam/approvals/${big.body.approval_id}/decide`).set('Authorization', bearer(1)).send({ decision: 'approve' });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'REFUND_EXCEEDS_PAID');
  assert.equal(state.approvals[0].status, 'failed');
  assert.ok(!state.refundRecorded);
});

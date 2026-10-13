/**
 * Test harness: mounts the REAL routers + REAL requireAuth, with the database
 * replaced by a tiny SQL-pattern fake. This exercises authentication, tenant
 * pinning, permission gates and handler wiring without needing Postgres
 * (the Postgres-backed suite lives in test/rbac.pg.test.js).
 */
process.env.NODE_ENV = 'test';
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { SECRET, requireAuth } = require('../../server/middleware/auth');
const { ROLE_DEFS } = require('../../server/modules/identity/domain/permissions');

function makeState() {
  return {
    tenantId: 1,
    users: {},        // id -> { id, username, role, role_code, is_blocked, token_version, password_hash, failed_logins, locked_until }
    employees: {},    // id -> { employee_id, ..., rbac_role_code, is_active, token_version }
    approvals: [],
    bookings: { 5: { id: 5, advance_paid: 10000 } },
    log: [],          // every SQL text seen (for assertions)
  };
}

function makeFakeDb(state) {
  const roleRows = (code) => {
    const def = ROLE_DEFS[code];
    if (!def) return [];
    return def.permissions.map((p) => ({ role_code: code, permission_code: p }));
  };

  async function query(text, params = []) {
    state.log.push(text);
    const t = text.replace(/\s+/g, ' ');
    // requireAuth -> loadSession
    if (/FROM users WHERE id = \$1 AND tenant_id = \$2/.test(t) && /is_blocked, token_version, role/.test(t)) {
      const u = state.users[params[0]];
      return { rows: u ? [{ is_blocked: u.is_blocked, token_version: u.token_version, role: u.role }] : [] };
    }
    if (/FROM user_property_memberships m JOIN roles r/.test(t)) {
      const u = state.users[params[0]];
      return { rows: u && u.role_code ? roleRows(u.role_code) : [] };
    }
    if (/FROM employees WHERE employee_id = \$1 AND tenant_id = \$2/.test(t) && /rbac_role_code, roles, role/.test(t)) {
      const e = state.employees[params[0]];
      return { rows: e ? [e] : [] };
    }
    if (/FROM roles r LEFT JOIN role_permissions rp .* WHERE r.tenant_id = \$1 AND r.code = \$2/.test(t)) {
      return { rows: roleRows(params[1]) };
    }
    if (/SELECT u.id, r.code AS role_code FROM users u/.test(t)) {
      const u = state.users[params[0]];
      return { rows: u ? [{ id: u.id, role_code: u.role_code }] : [] };
    }
    // login
    if (/FROM users WHERE username = \$1 AND tenant_id = \$2/.test(t)) {
      const u = Object.values(state.users).find((x) => x.username === params[0]);
      return { rows: u ? [u] : [] };
    }
    if (/^UPDATE users SET failed_logins/.test(t)) {
      const id = params[params.length - 2];
      if (state.users[id]) { state.users[id].failed_logins = params[0]; state.users[id].locked_until = params[1]; }
      return { rows: [], rowCount: 1 };
    }
    // approvals
    if (/^INSERT INTO approval_requests/.test(t)) {
      const row = { id: state.approvals.length + 1, kind: params[1], status: 'pending', payload: JSON.parse(params[2]), amount: params[3], reason: params[4], requested_by: params[5], requested_by_type: params[6], requested_by_name: params[7] };
      state.approvals.push(row);
      return { rows: [{ id: row.id, kind: row.kind, status: row.status, amount: row.amount }] };
    }
    if (/FROM approval_requests WHERE id=\$1 AND tenant_id=\$2 FOR UPDATE/.test(t)) {
      return { rows: state.approvals.filter((a) => a.id === Number(params[0])) };
    }
    if (/^UPDATE approval_requests SET status='(approved|rejected|failed)'/.test(t)) {
      const m = t.match(/status='(\w+)'/);
      const a = state.approvals.find((x) => x.id === Number(params[params.length - 1]));
      a.status = m[1]; a.decision = params;
      return { rows: [], rowCount: 1 };
    }
    // refund executor
    if (/SELECT \* FROM bookings WHERE id=\$1 AND tenant_id=\$2 FOR UPDATE/.test(t)) {
      const b = state.bookings[params[0]];
      return { rows: b ? [b] : [] };
    }
    if (/^UPDATE bookings SET refund_amount/.test(t)) { state.refundRecorded = (state.refundRecorded || 0) + 1; return { rows: [] }; }
    if (/^INSERT INTO payments/.test(t)) { state.paymentsInserted = (state.paymentsInserted || 0) + 1; return { rows: [] }; }
    if (/SAVEPOINT|ROLLBACK TO SAVEPOINT/.test(t)) return { rows: [] };
    return { rows: [], rowCount: 0 };
  }
  const db = { tenantId: state.tenantId, query };
  db.tx = async (fn) => fn({ query });
  db.connect = async () => ({ query, release() {} });
  return db;
}

function build(state = makeState()) {
  const db = makeFakeDb(state);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.tenant = { id: state.tenantId, slug: 't1', name: 'Test Resort', settings: {} }; req.db = db; next(); });
  app.use('/api/auth', require('../../server/routes/auth'));
  app.use('/api/employee', require('../../server/routes/employee-auth'));
  app.use('/api/admin/calendar', requireAuth, require('../../server/routes/calendar'));
  app.use('/api/admin/iam', requireAuth, require('../../server/modules/identity/http/iamRoutes'));
  app.use('/api/admin', requireAuth, require('../../server/routes/admin'));
  app.use('/api/payments', require('../../server/routes/payments'));
  return { app, state, db };
}

function addUser(state, { id, username, role_code, role = 'staff', tenant = state.tenantId, password = 'Password#123' }) {
  state.users[id] = {
    id, username, full_name: username, role, role_code, is_blocked: false, token_version: 0,
    password_hash: bcrypt.hashSync(password, 4), failed_logins: 0, locked_until: null,
  };
  return state.users[id];
}

function tokenFor(user, overrides = {}) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, tenant_id: 1, tv: user.token_version, ...overrides }, SECRET, { expiresIn: '1h' });
}

module.exports = { build, makeState, addUser, tokenFor, SECRET };

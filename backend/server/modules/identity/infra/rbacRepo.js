/**
 * rbacRepo.js — Postgres adapter for roles / permissions / memberships.
 * All functions take a pg client-like { query } so callers choose the scope
 * (req.db for request work, an admin client for tenant provisioning).
 */
const { PERMISSIONS, ROLE_DEFS, legacyRoleToCode, employeeRoleCode } = require('../domain/permissions');

const LEGACY_ROLE_FROM_CODE = {
  OWNER: 'owner', MANAGER: 'manager', GROUP_MANAGER: 'manager',
};
const legacyRoleName = (code) => LEGACY_ROLE_FROM_CODE[code] || 'staff';

/** Upsert the global permission catalogue (idempotent). Needs admin scope. */
async function seedPermissionCatalogue(db) {
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await db.query(
      `INSERT INTO permissions (code, description) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`,
      [code, description]
    );
  }
}

/**
 * Seed the system roles for one tenant. New permissions added to the code
 * matrix are granted to system roles on re-run; permissions an owner removed
 * from a system role are NOT re-added if `preserveCustom` is true.
 */
async function seedTenantRoles(db, tenantId, { preserveCustom = true } = {}) {
  for (const [code, def] of Object.entries(ROLE_DEFS)) {
    const r = await db.query(
      `INSERT INTO roles (tenant_id, code, name, is_system) VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, (xmax = 0) AS inserted`,
      [tenantId, code, def.name]
    );
    const { id, inserted } = r.rows[0];
    if (!inserted && preserveCustom) continue;
    for (const perm of def.permissions) {
      await db.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_code) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [tenantId, id, perm]
      );
    }
  }
}

/** Map every legacy users.role to a membership; idempotent. */
async function backfillMemberships(db, tenantId) {
  const users = await db.query(`SELECT id, role FROM users WHERE tenant_id = $1`, [tenantId]);
  for (const u of users.rows) {
    await db.query(
      `INSERT INTO user_property_memberships (tenant_id, user_id, role_id)
       SELECT $1, $2, r.id FROM roles r WHERE r.tenant_id = $1 AND r.code = $3
       ON CONFLICT (user_id, tenant_id) DO NOTHING`,
      [tenantId, u.id, legacyRoleToCode(u.role)]
    );
  }
  const emps = await db.query(`SELECT employee_id, role, roles FROM employees WHERE tenant_id = $1 AND rbac_role_code IS NULL`, [tenantId]);
  for (const e of emps.rows) {
    await db.query(
      `UPDATE employees SET rbac_role_code = $1 WHERE employee_id = $2 AND tenant_id = $3`,
      [employeeRoleCode(e.roles && e.roles.length ? e.roles : e.role), e.employee_id, tenantId]
    );
  }
}

/** Provision everything RBAC for a tenant (used by migration + tenant creation). */
async function provisionTenant(db, tenantId) {
  await seedTenantRoles(db, tenantId);
  await backfillMemberships(db, tenantId);
}

/** Role code + permission set for a dashboard user in this tenant. */
async function loadUserAccess(db, tenantId, userId) {
  const { rows } = await db.query(
    `SELECT r.code AS role_code, rp.permission_code
       FROM user_property_memberships m
       JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
      WHERE m.user_id = $1 AND m.tenant_id = $2`,
    [userId, tenantId]
  );
  if (!rows.length) return null;
  return { roleCode: rows[0].role_code, permissions: new Set(rows.filter((r) => r.permission_code).map((r) => r.permission_code)) };
}

/** Role code + permission set for an employee (staff portal) login. */
async function loadEmployeeAccess(db, tenantId, rbacRoleCode) {
  const { rows } = await db.query(
    `SELECT r.code AS role_code, rp.permission_code
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 AND r.code = $2`,
    [tenantId, rbacRoleCode || 'HOUSEKEEPING']
  );
  if (!rows.length) return null;
  return { roleCode: rows[0].role_code, permissions: new Set(rows.filter((r) => r.permission_code).map((r) => r.permission_code)) };
}


/**
 * One round-trip session check used by requireAuth: account state + role +
 * permissions. Returns null when the principal no longer exists in this tenant.
 */
async function loadSession(db, tenantId, decoded) {
  if (decoded.type === 'employee') {
    const e = await db.query(
      `SELECT is_active, token_version, rbac_role_code, roles, role
         FROM employees WHERE employee_id = $1 AND tenant_id = $2`,
      [decoded.employee_id, tenantId]
    );
    const emp = e.rows[0];
    if (!emp) return null;
    const code = emp.rbac_role_code || employeeRoleCode(emp.roles && emp.roles.length ? emp.roles : emp.role);
    const access = await loadEmployeeAccess(db, tenantId, code);
    return { blocked: !emp.is_active, tokenVersion: emp.token_version, roleCode: code, permissions: access ? access.permissions : new Set() };
  }
  const u = await db.query(
    `SELECT is_blocked, token_version, role FROM users WHERE id = $1 AND tenant_id = $2`,
    [decoded.id, tenantId]
  );
  const user = u.rows[0];
  if (!user) return null;
  let access = await loadUserAccess(db, tenantId, decoded.id);
  // Fail-safe for a user created before memberships existed: derive from the legacy role.
  if (!access) access = await loadEmployeeAccess(db, tenantId, legacyRoleToCode(user.role));
  return {
    blocked: user.is_blocked, tokenVersion: user.token_version,
    roleCode: access ? access.roleCode : null,
    permissions: access ? access.permissions : new Set(),
  };
}


/**
 * WhatsApp admin identity: an E.164 sender maps to exactly one user in this
 * tenant (users.phone). Unknown numbers return null and get the guest flow
 * only. Nothing in the message body can widen the result.
 */
async function resolveWhatsAppActor(db, tenantId, e164) {
  if (!/^\+[1-9]\d{7,14}$/.test(String(e164 || ''))) return null;
  const u = await db.query(
    `SELECT id, username, is_blocked FROM users WHERE tenant_id = $1 AND phone = $2`,
    [tenantId, e164]
  );
  const user = u.rows[0];
  if (!user || user.is_blocked) return null;
  const access = await loadUserAccess(db, tenantId, user.id);
  if (!access) return null;
  return { userId: user.id, username: user.username, roleCode: access.roleCode, permissions: access.permissions };
}

async function setUserRole(db, tenantId, userId, roleCode) {
  const role = await db.query(`SELECT id FROM roles WHERE tenant_id = $1 AND code = $2`, [tenantId, roleCode]);
  if (!role.rows[0]) return { ok: false, error: { code: 'ROLE_NOT_FOUND', message: 'Unknown role' } };
  await db.query(
    `INSERT INTO user_property_memberships (tenant_id, user_id, role_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
    [tenantId, userId, role.rows[0].id]
  );
  // keep the legacy display column and invalidate live sessions
  await db.query(
    `UPDATE users SET role = $1, token_version = token_version + 1 WHERE id = $2 AND tenant_id = $3`,
    [legacyRoleName(roleCode), userId, tenantId]
  );
  return { ok: true, value: true };
}

module.exports = {
  seedPermissionCatalogue, seedTenantRoles, backfillMemberships, provisionTenant,
  loadUserAccess, loadEmployeeAccess, loadSession, resolveWhatsAppActor, setUserRole, legacyRoleName,
};

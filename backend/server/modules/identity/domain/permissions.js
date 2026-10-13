/**
 * permissions.js — permission catalogue + seed role matrix (pure, no I/O).
 *
 * Single source of truth for "who may do what". The DB seeds `permissions`,
 * `roles` and `role_permissions` from this file (db/migrate-rbac.js); the
 * runtime reads the DB so an owner can later tune roles without a deploy.
 */

const PERMISSIONS = {
  // overview / reporting
  'dashboard.view':          'See the live dashboard',
  'report.view':             'See daily payments and financial reports',
  // reservations
  'reservation.view':        'View bookings and the tape chart',
  'reservation.create':      'Create bookings',
  'reservation.modify':      'Edit bookings, move rooms, change status',
  'reservation.cancel':      'Cancel bookings',
  'reservation.delete':      'Permanently delete bookings',
  'reservation.extend':      'Extend a stay',
  'reservation.checkout':    'Early checkout and checkout notices',
  'specialrequest.manage':   'Approve / deny early check-in and late checkout requests',
  'dispute.view':            'Export the chargeback dispute package',
  // guests
  'guest.view':              'View guests',
  'guest.edit':              'Create and edit guests',
  'guest.delete':            'Delete guests',
  'guestdoc.view':           'View guest identity documents',
  // rooms
  'room.view':               'View rooms and availability',
  'room.status':             'Change a room status',
  'room.manage':             'Create / edit / delete room types and physical rooms',
  // rates
  'rate.edit':               'Edit room rates',
  'rate.override':           'Override rates below floor / record yield overrides',
  'restriction.override':    'Override booking restrictions',
  'pricing.view':            'View competitor rates and pricing hub',
  'pricing.audit':           'View suppressed-yield audit',
  // money
  'folio.view':              'View payment transactions and folios',
  'folio.post':              'Post payments and collect balances',
  'folio.refund':            'Create refunds',
  'folio.refund_process':    'Mark a refund as paid out',
  'folio.writeoff':          'Write off balances',
  'payment.verify':          'Verify advance payments',
  'invoice.issue':           'Issue and send invoices',
  'expense.view':            'View expenses',
  'expense.post':            'Add expenses',
  'expense.delete':          'Delete expenses',
  // staff & operations
  'staff.view':              'View employees',
  'staff.manage':            'Create / edit employees',
  'staff.delete':            'Delete employees',
  'shift.view':              'View shifts',
  'shift.manage':            'Assign shifts',
  'shift.master':            'Edit shift templates',
  'task.view':               'View tasks and routines',
  'task.own':                'See and complete own tasks',
  'task.update':             'Update tasks',
  'task.manage':             'Create tasks and routines',
  'task.delete':             'Delete tasks',
  'routine.manage':          'Edit and delete routines',
  'operations.log':          'Log operations checklists',
  'feedback.view':           'View guest feedback',
  'notification.view':       'View notification log',
  'notification.clear':      'Clear notification log',
  'whatsapp.view':           'See WhatsApp connection status',
  'whatsapp.manage':         'Retry / manage WhatsApp delivery',
  // platform / governance
  'user.manage':             'List and create users, set credentials, reset passwords',
  'user.admin':              'Block and delete users, change roles',
  'settings.edit':           'Edit resort settings',
  'audit.view':              'View the audit trail',
  'nightaudit.run':          'Run night audit',
  'approval.decide':         'Approve or reject approval requests',
};

const ALL = Object.keys(PERMISSIONS);

/* Powers that used to be `requireOwner` — managers must NOT gain them. */
const OWNER_ONLY = [
  'reservation.delete', 'guest.delete', 'dispute.view', 'room.manage',
  'expense.delete', 'staff.delete', 'shift.master', 'task.delete',
  'routine.manage', 'payment.verify', 'invoice.issue', 'notification.clear',
  'folio.refund_process', 'folio.writeoff', 'pricing.audit', 'user.admin',
  'settings.edit', 'audit.view', 'approval.decide', 'guestdoc.view',
];

const MANAGER = ALL.filter((p) => !OWNER_ONLY.includes(p));

const ROLE_DEFS = {
  OWNER: { name: 'Owner', permissions: ALL },
  MANAGER: { name: 'Manager', permissions: MANAGER },
  GROUP_MANAGER: {
    name: 'Group Manager',
    permissions: [...MANAGER, 'audit.view'],
  },
  FRONT_DESK: {
    name: 'Front Desk',
    permissions: [
      'dashboard.view', 'reservation.view', 'reservation.create', 'reservation.modify',
      'reservation.cancel', 'guest.view', 'guest.edit', 'room.view', 'room.status',
      'expense.view', 'expense.post', 'staff.view', 'shift.view', 'task.view',
      'task.own', 'task.update', 'task.manage', 'operations.log',
      'notification.view', 'whatsapp.view',
    ],
  },
  HOUSEKEEPING: {
    name: 'Housekeeping',
    permissions: [
      'dashboard.view', 'room.view', 'room.status', 'task.view', 'task.own',
      'task.update', 'operations.log',
    ],
  },
  NIGHT_AUDITOR: {
    name: 'Night Auditor',
    permissions: [
      'dashboard.view', 'report.view', 'reservation.view', 'guest.view', 'room.view',
      'folio.view', 'folio.post', 'expense.view', 'nightaudit.run',
    ],
  },
  ACCOUNTANT_RO: {
    name: 'Accountant (read-only)',
    permissions: [
      'dashboard.view', 'report.view', 'reservation.view', 'guest.view',
      'folio.view', 'expense.view',
    ],
  },
};

/** Legacy users.role value -> seeded role code (migration + fallback). */
const LEGACY_ROLE_MAP = { owner: 'OWNER', manager: 'MANAGER', staff: 'FRONT_DESK' };

/** employees.roles[] (free-text job titles) -> RBAC role. Never maps to an admin role. */
function employeeRoleCode(jobTitles) {
  const titles = (Array.isArray(jobTitles) ? jobTitles : [jobTitles]).map((t) => String(t || '').toLowerCase());
  if (titles.some((t) => t.includes('housekeep'))) return 'HOUSEKEEPING';
  if (titles.some((t) => t.includes('front'))) return 'FRONT_DESK';
  // Pool attendant, maintenance, etc.: operational tasks only.
  return 'HOUSEKEEPING';
}

function legacyRoleToCode(role) {
  return LEGACY_ROLE_MAP[String(role || '').toLowerCase()] || 'FRONT_DESK';
}

function hasPermission(permissionSet, code) {
  return permissionSet instanceof Set ? permissionSet.has(code) : Array.isArray(permissionSet) && permissionSet.includes(code);
}

module.exports = {
  PERMISSIONS, ROLE_DEFS, OWNER_ONLY, LEGACY_ROLE_MAP,
  employeeRoleCode, legacyRoleToCode, hasPermission,
};

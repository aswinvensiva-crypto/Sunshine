/**
 * Route-coverage test (Prompt 7.1 narrowing): no route without an explicit
 * permission decision. Walks the Express router stacks of every protected
 * router and fails on any route lacking a requirePermission/authenticatedOnly/
 * publicRoute marker, on any permission code not in the catalogue, and on any
 * protected router that server.js mounts without requireAuth.
 */
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PERMISSIONS } = require('../server/modules/identity/domain/permissions');

const routers = {
  'routes/admin': require('../server/routes/admin'),
  'routes/calendar': require('../server/routes/calendar'),
  'routes/payments': require('../server/routes/payments'),
  'routes/auth': require('../server/routes/auth'),
  'routes/employee-auth': require('../server/routes/employee-auth'),
  'modules/identity/http/iamRoutes': require('../server/modules/identity/http/iamRoutes'),
};

/* Public by design: guest-facing booking flow + availability. These are the
   ONLY routers allowed to carry no marker, and the list is explicit. */
const PUBLIC_ROUTERS = ['rooms', 'availability', 'bookings', 'checkin', 'feedback'];

function enumerate(router) {
  const out = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
    const markers = layer.route.stack.map((l) => l.handle.permissionCode).filter(Boolean).flat();
    out.push({ route: `${methods.join(',')} ${layer.route.path}`, markers });
  }
  return out;
}

for (const [name, router] of Object.entries(routers)) {
  test(`every route in ${name} has an explicit permission decision`, () => {
    const routes = enumerate(router);
    assert.ok(routes.length > 0, 'router has no routes?');
    const missing = routes.filter((r) => r.markers.length === 0).map((r) => r.route);
    assert.deepEqual(missing, [], `Routes with no permission marker:\n  ${missing.join('\n  ')}`);
  });

  test(`every permission code used in ${name} exists in the catalogue`, () => {
    for (const r of enumerate(router)) {
      for (const code of r.markers) {
        if (code.startsWith('*')) continue; // *public* / *authenticated*
        assert.ok(PERMISSIONS[code], `${r.route} uses unknown permission "${code}"`);
      }
    }
  });
}

test('admin router: no route is marked public', () => {
  for (const name of ['routes/admin', 'routes/calendar', 'modules/identity/http/iamRoutes']) {
    for (const r of enumerate(routers[name])) {
      assert.ok(!r.markers.includes('*public*'), `${name}: ${r.route} must not be public`);
    }
  }
});

test('catalogue has no dead permissions (every code is used by a route or granted via inline can())', () => {
  const used = new Set();
  for (const router of Object.values(routers)) for (const r of enumerate(router)) r.markers.forEach((c) => used.add(c));
  const src = ['routes/admin.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8')).join('\n');
  // codes only referenced from application code / policies, not a route gate
  const allowedUnrouted = new Set([
    'reservation.cancel',      // inline can() in PATCH /bookings/:id/status
    'approval.decide',         // iam decide route + policy
    'restriction.override', 'rate.override', 'folio.writeoff', 'guestdoc.view', 'audit.view',
    'settings.edit', 'nightaudit.run',   // reserved for 1.3 / 3.2 / 3.4 / 6.1 / 7.2 features
  ]);
  for (const code of Object.keys(PERMISSIONS)) {
    if (used.has(code) || allowedUnrouted.has(code)) continue;
    assert.ok(src.includes(`'${code}'`), `permission "${code}" is in the catalogue but unused anywhere`);
  }
});

test('server.js mounts every protected router behind requireAuth', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  for (const mount of ["'/api/admin/calendar'", "'/api/admin/iam'", "'/api/admin',"]) {
    const line = server.split('\n').find((l) => l.includes(`app.use(${mount}`));
    assert.ok(line, `server.js does not mount ${mount}`);
    assert.match(line, /requireAuth/, `${mount} is mounted without requireAuth`);
  }
  // /api/payments authenticates per-route; every payments route must use requireAuth.
  const pay = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'payments.js'), 'utf8');
  const routeLines = pay.split('\n').filter((l) => /^router\.(get|post|put|patch|delete)\(/.test(l));
  assert.ok(routeLines.length > 0);
  for (const l of routeLines) assert.match(l, /requireAuth/, `payments route lacks requireAuth: ${l}`);
});

test('public routers are the explicit allow-list (they must not touch admin data paths)', () => {
  for (const name of PUBLIC_ROUTERS) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', `${name}.js`), 'utf8');
    assert.ok(!/req\.user/.test(src), `${name}.js is public but reads req.user`);
  }
});

test('no hardcoded default credentials remain in backend source', () => {
  const roots = ['db', 'scripts', 'server'];
  const hits = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      // set-dev-passwords.js is the one sanctioned exception: it refuses to run against a non-local DB_HOST.
      else if (/\.(js|sql)$/.test(f.name) && f.name !== 'set-dev-passwords.js') {
        const t = fs.readFileSync(p, 'utf8');
        // bootstrap-owner.js and this check mention the old value only in comments
        const code = t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        if (/['"]admin123['"]|['"]staff123['"]|['"]dev-secret['"]/.test(code)) hits.push(path.relative(path.join(__dirname, '..'), p));
      }
    }
  };
  roots.forEach((r) => walk(path.join(__dirname, '..', r)));
  assert.deepEqual(hits, [], `hardcoded credentials found in: ${hits.join(', ')}`);
});

test('JWT secret: refuses to start in production without a strong JWT_SECRET', () => {
  const { resolveSecret } = require('../server/middleware/auth');
  assert.throws(() => resolveSecret({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => resolveSecret({ NODE_ENV: 'production', JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.equal(resolveSecret({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) }), 'x'.repeat(32));
  assert.notEqual(resolveSecret({ NODE_ENV: 'development' }), 'dev-secret');
});

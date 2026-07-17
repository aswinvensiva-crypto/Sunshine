/**
 * verify-tenancy.js — end-to-end cross-tenant isolation checks (Phase 4).
 *
 * Run with the API up:  node scripts/verify-tenancy.js  [--api http://localhost:5001]
 *
 * What it proves:
 *   1. A tenant-A admin token is rejected on tenant B's host/slug (and vice versa).
 *   2. A tenant-A admin cannot read or mutate a tenant-B booking by direct ID.
 *   3. Tenant listings only ever contain the tenant's own rows.
 *   4. RLS is the backstop: an app-role query that "forgets" WHERE tenant_id
 *      still cannot see another tenant's rows.
 *   5. Uploads are not servable across tenants.
 *   6. Socket.IO: tenant B's dashboard receives no events from tenant A
 *      (and unauthenticated sockets are refused).
 *
 * Creates (idempotently) a scratch tenant 'verify-resort-b' with one room
 * type + booking, via the platform API + adminPool.
 */
require('dotenv').config();
const path = require('path');
const { adminPool, forTenant } = require('../server/config/db');

const API = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : `http://localhost:${process.env.PORT || 5000}`;
const SLUG_A = 'sunshine-original';
const SLUG_B = 'verify-resort-b';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

async function req(method, p, { slug, token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(slug ? { 'X-Tenant-Slug': slug } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function main() {
  console.log(`\nVerifying tenant isolation against ${API}\n`);

  /* ── setup: platform login, scratch tenant B, tokens ─────────────── */
  const plat = await req('POST', '/api/platform/login', {
    body: {
      username: process.env.PLATFORM_ADMIN_USERNAME || 'superadmin',
      password: process.env.PLATFORM_ADMIN_PASSWORD || 'superadmin123',
    },
  });
  if (plat.status !== 200) throw new Error('platform login failed: ' + JSON.stringify(plat.json));
  const platToken = plat.json.token;

  let tenants = (await req('GET', '/api/platform/tenants', { token: platToken })).json;
  let tenantB = tenants.find(t => t.slug === SLUG_B);
  if (!tenantB) {
    const created = await req('POST', '/api/platform/tenants', {
      token: platToken,
      body: { slug: SLUG_B, name: 'Verify Resort B', owner: { username: 'owner-b', password: 'owner-b-pass' } },
    });
    if (created.status !== 201) throw new Error('tenant B create failed: ' + JSON.stringify(created.json));
    tenantB = created.json.tenant;
  }
  const tenantA = tenants.find(t => t.slug === SLUG_A) ||
    (await req('GET', '/api/platform/tenants', { token: platToken })).json.find(t => t.slug === SLUG_A);
  if (!tenantA) throw new Error(`default tenant '${SLUG_A}' not found`);

  // Seed tenant B data directly (adminPool, explicit tenant_id).
  let bBooking = (await adminPool.query(
    `SELECT id, reference FROM bookings WHERE tenant_id = $1 LIMIT 1`, [tenantB.id])).rows[0];
  if (!bBooking) {
    const rt = await adminPool.query(
      `INSERT INTO room_types (tenant_id, code, name, max_occupancy, base_rate, total_rooms)
       VALUES ($1, 'STD', 'Standard', 2, 4000, 2) ON CONFLICT DO NOTHING RETURNING id`, [tenantB.id]);
    const rtId = rt.rows[0]?.id ||
      (await adminPool.query(`SELECT id FROM room_types WHERE tenant_id=$1 LIMIT 1`, [tenantB.id])).rows[0].id;
    const g = await adminPool.query(
      `INSERT INTO guests (tenant_id, full_name, phone) VALUES ($1, 'B Guest', '9999999999') RETURNING id`, [tenantB.id]);
    bBooking = (await adminPool.query(
      `INSERT INTO bookings (tenant_id, reference, guest_id, room_type_id, check_in, check_out,
                             num_guests, nights, total_amount, status)
       VALUES ($1, 'VERIFY-B-001', $2, $3, CURRENT_DATE, CURRENT_DATE + 2, 2, 2, 8000, 'confirmed')
       ON CONFLICT (tenant_id, reference) DO UPDATE SET status = 'confirmed'
       RETURNING id, reference`, [tenantB.id, g.rows[0].id, rtId])).rows[0];
  }

  const tokenA = (await req('POST', `/api/platform/tenants/${tenantA.id}/impersonate`, { token: platToken })).json.token;
  const tokenB = (await req('POST', `/api/platform/tenants/${tenantB.id}/impersonate`, { token: platToken })).json.token;
  if (!tokenA || !tokenB) throw new Error('impersonation failed');

  /* ── 1. token/host cross-checks ──────────────────────────────────── */
  let r = await req('GET', '/api/admin/bookings', { slug: SLUG_B, token: tokenA });
  check('tenant A token rejected on tenant B slug', r.status === 401, `got ${r.status}`);
  r = await req('GET', '/api/admin/bookings', { slug: SLUG_A, token: tokenB });
  check('tenant B token rejected on tenant A slug', r.status === 401, `got ${r.status}`);
  r = await req('GET', '/api/admin/bookings', { slug: SLUG_A, token: tokenA });
  check('tenant A token accepted on tenant A slug', r.status === 200, `got ${r.status}`);

  /* ── 2. direct ID probing across tenants ─────────────────────────── */
  r = await req('GET', `/api/admin/bookings/${bBooking.id}`, { slug: SLUG_A, token: tokenA });
  check('tenant A cannot read tenant B booking by ID', r.status === 404, `got ${r.status}`);
  r = await req('PATCH', `/api/admin/bookings/${bBooking.id}/status`, {
    slug: SLUG_A, token: tokenA, body: { status: 'cancelled' } });
  check('tenant A cannot mutate tenant B booking by ID', r.status === 404, `got ${r.status}`);
  const still = await adminPool.query(`SELECT status FROM bookings WHERE id=$1`, [bBooking.id]);
  check('tenant B booking untouched after mutation attempt', still.rows[0]?.status === 'confirmed');

  /* ── 3. listings contain only own rows ───────────────────────────── */
  r = await req('GET', '/api/admin/bookings', { slug: SLUG_A, token: tokenA });
  const leakedRef = Array.isArray(r.json) && r.json.some(b => b.reference === bBooking.reference);
  check("tenant A booking list omits tenant B's rows", !leakedRef);
  r = await req('GET', '/api/rooms', { slug: SLUG_B });
  const bRoomsOnly = Array.isArray(r.json) && r.json.every(x => x.code === 'STD');
  check('public /api/rooms for B shows only B room types', bRoomsOnly, JSON.stringify(r.json).slice(0, 120));

  /* ── 4. RLS backstop for a "forgotten" WHERE clause ──────────────── */
  const dbA = forTenant(tenantA.id);
  const noWhere = await dbA.query(`SELECT id FROM bookings WHERE reference = $1`, [bBooking.reference]);
  check('RLS hides tenant B row from unfiltered tenant A query', noWhere.rows.length === 0);
  let insertBlocked = false;
  try {
    await dbA.query(`INSERT INTO expenses (tenant_id, category, amount) VALUES ($1, 'x', 1)`, [tenantB.id]);
  } catch { insertBlocked = true; }
  check('RLS blocks tenant A inserting a row stamped for tenant B', insertBlocked);

  /* ── 5. uploads cross-tenant ─────────────────────────────────────── */
  const fsMod = require('fs');
  const upA = path.join(__dirname, '..', 'uploads', String(tenantA.id));
  let sample = null;
  if (fsMod.existsSync(upA)) {
    for (const sub of fsMod.readdirSync(upA)) {
      const dir = path.join(upA, sub);
      if (!fsMod.statSync(dir).isDirectory()) continue;
      const f = fsMod.readdirSync(dir)[0];
      if (f) { sample = `/uploads/${tenantA.id}/${sub}/${f}`; break; }
    }
  }
  if (sample) {
    const own = await fetch(API + sample, { headers: { 'X-Tenant-Slug': SLUG_A } });
    const cross = await fetch(API + sample, { headers: { 'X-Tenant-Slug': SLUG_B } });
    check('tenant A upload servable to tenant A', own.status === 200, `got ${own.status}`);
    check('tenant A upload NOT servable to tenant B', cross.status === 404, `got ${cross.status}`);
  } else {
    console.log('  SKIP  uploads check (no uploaded files on tenant A)');
  }

  /* ── 6. socket isolation ─────────────────────────────────────────── */
  let ioc = null;
  try { ioc = require(path.join(__dirname, '..', '..', 'client', 'node_modules', 'socket.io-client')); } catch {}
  if (ioc) {
    await new Promise((resolve) => {
      const socketB = ioc.io(API, { auth: { token: tokenB }, transports: ['websocket'] });
      const socketNoAuth = ioc.io(API, { transports: ['websocket'] });
      let bGotEvent = false, noAuthRejected = false;
      socketB.on('ROOM_SWAP_BROADCAST', () => { bGotEvent = true; });
      socketNoAuth.on('connect_error', () => { noAuthRejected = true; });
      const socketA = ioc.io(API, { auth: { token: tokenA }, transports: ['websocket'] });
      socketA.on('connect', () => {
        // An invalid swap still exercises the tenant-scoped handler; the
        // point is that B must hear nothing at all.
        socketA.emit('ROOM_SWAP_REQUEST', {
          bookingId: 999999, newRoomId: 999999,
          newCheckIn: '2030-01-01', newCheckOut: '2030-01-02',
        });
      });
      setTimeout(() => {
        check('unauthenticated socket rejected', noAuthRejected);
        check('tenant B socket received no tenant A events', !bGotEvent);
        socketA.close(); socketB.close(); socketNoAuth.close();
        resolve();
      }, 2500);
    });
  } else {
    console.log('  SKIP  socket checks (socket.io-client not found)');
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await adminPool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('verify-tenancy error:', e); process.exit(1); });

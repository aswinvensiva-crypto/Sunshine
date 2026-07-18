/**
 * server.js — Express API entry point for Sunshine (multi-tenant).
 *
 * Every tenant-facing route is mounted behind resolveTenant, which resolves
 * the resort from the subdomain (or X-Tenant-Slug header) and attaches the
 * RLS-pinned req.db. Platform (super_admin) routes live at /api/platform and
 * are the only tenant-less API surface.
 *
 * Schema migrations no longer run at boot — run `node db/migrate.js` instead.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { requireAuth, SECRET } = require('./middleware/auth');
const { resolveTenant } = require('./middleware/tenant');

const path = require('path');
const fs = require('fs');
const app = express();
const httpServer = http.createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

/* ── Socket.IO: authenticate every connection and confine it to its tenant
   room. Tokens are the same tenant JWTs the REST API uses; sockets without a
   valid tenant token never join a room and receive no broadcasts. ── */
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('unauthorized'));
    const decoded = jwt.verify(token, SECRET);
    if (decoded.type === 'platform' || !decoded.tenant_id) return next(new Error('unauthorized'));
    socket.data.tenantId = Number(decoded.tenant_id);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
io.on('connection', (socket) => {
  socket.join(`tenant:${socket.data.tenantId}`);
});

// Make io accessible to routes that need it. Routes must emit into
// io.to(`tenant:${req.tenant.id}`) — never io.emit — so events stay inside
// the tenant. emitToTenant is the convenience wrapper for that.
app.set('io', io);
app.set('emitToTenant', (tenantId, event, payload) =>
  io.to(`tenant:${tenantId}`).emit(event, payload));

app.use(cors());
app.use(express.json({ limit: '10mb' }));

/* ── Uploads: files live under uploads/<tenant_id>/... and are only served to
   requests whose resolved tenant matches the path prefix. ── */
const uploadsRoot = path.join(__dirname, '..', 'uploads');
app.use('/uploads', resolveTenant, (req, res, next) => {
  const m = req.path.match(/^\/(\d+)(\/|$)/);
  if (!m || Number(m[1]) !== Number(req.tenant.id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}, express.static(uploadsRoot));

// Health check — visit http://localhost:5000/api/health
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'sunshine-api' }));

// Platform (super_admin) API — tenant-less, separate auth world.
app.use('/api/platform', require('./routes/platform'));

// Public (guest-facing) endpoints — per-property via subdomain
app.use('/api/rooms',        resolveTenant, require('./routes/rooms'));
app.use('/api/availability', resolveTenant, require('./routes/availability'));
app.use('/api/bookings',     resolveTenant, require('./routes/bookings'));
app.use('/api/check-in',     resolveTenant, require('./routes/checkin'));
app.use('/api/feedback',     resolveTenant, require('./routes/feedback'));

// Auth + admin (admin endpoints require a valid login token)
app.use('/api/auth',     resolveTenant, require('./routes/auth'));
app.use('/api/employee', resolveTenant, require('./routes/employee-auth'));

// Tape Chart — must be registered before the generic /api/admin router
// so Express matches /api/admin/calendar here, not the occupancy route in admin.js
const calendarRouter = require('./routes/calendar');
app.use('/api/admin/calendar', resolveTenant, requireAuth, calendarRouter);
calendarRouter.initCalendarSocket(io);

app.use('/api/admin',    resolveTenant, requireAuth, require('./routes/admin'));
app.use('/api/payments', resolveTenant, require('./routes/payments'));

const cron = require('node-cron');
const { sendCheckInSMS } = require('./services/notify');
const { initWhatsApp }   = require('./services/whatsapp');
const { runRateShop }    = require('./services/rateShop');
const { adminPool } = require('./config/db');

/* Cron jobs run on the adminPool (system scope, RLS bypassed) and iterate
   tenants explicitly so per-tenant config applies and suspended resorts are
   skipped. */

function checkInUrlFor(slug, token) {
  const template = process.env.CHECK_IN_URL_TEMPLATE; // e.g. https://{slug}.sunshine.app/check-in
  if (template) return `${template.replace('{slug}', slug)}/${token}`;
  const base = process.env.CHECK_IN_BASE_URL || 'http://localhost:5173/check-in';
  return `${base}/${token}`;
}

async function sendPendingCheckInSMS() {
  try {
    // Find bookings with check_in 47–49 hours from now that haven't had SMS sent
    const { rows } = await adminPool.query(
      `SELECT cit.id AS token_id, cit.token, cit.booking_id, b.tenant_id,
              t.slug AS tenant_slug,
              g.full_name, g.phone, b.reference, b.check_in
         FROM check_in_tokens cit
         JOIN bookings b ON b.id = cit.booking_id AND b.tenant_id = cit.tenant_id
         JOIN guests g ON g.id = b.guest_id AND g.tenant_id = b.tenant_id
         JOIN tenants t ON t.id = b.tenant_id AND t.status = 'active'
        WHERE cit.used_at IS NULL
          AND cit.expires_at > NOW()
          AND b.status IN ('confirmed', 'checked_in')
          AND b.check_in BETWEEN (NOW() + INTERVAL '47 hours') AND (NOW() + INTERVAL '49 hours')
          AND NOT EXISTS (
            SELECT 1 FROM notification_logs nl
             WHERE nl.booking_ref = b.reference AND nl.tenant_id = b.tenant_id
               AND nl.type = 'checkin_sms' AND nl.status = 'sent'
          )`
    );
    for (const row of rows) {
      if (!row.phone) continue;
      const url = checkInUrlFor(row.tenant_slug, row.token);
      await sendCheckInSMS(row.phone, row.full_name, url, row.reference, row.tenant_id);
    }
    if (rows.length > 0) console.log(`[cron] Sent check-in SMS for ${rows.length} booking(s)`);
  } catch (e) {
    console.error('[cron] sendPendingCheckInSMS error:', e.message);
  }
}

// Run every hour
cron.schedule('0 * * * *', sendPendingCheckInSMS);

async function autoCheckoutExpired() {
  try {
    // Pure maintenance across all tenants — no data crosses tenant boundaries.
    const { rowCount } = await adminPool.query(`
      UPDATE bookings
         SET status = 'checked_out'
       WHERE status = 'checked_in'
         AND check_out::date < CURRENT_DATE
    `);
    if (rowCount > 0) console.log(`[cron] Auto-checked-out ${rowCount} overdue booking(s)`);
  } catch (e) {
    console.error('[cron] autoCheckoutExpired error:', e.message);
  }
}

// Run once a day at midnight
cron.schedule('0 0 * * *', autoCheckoutExpired);

// Rate shopping: twice daily at 08:00 and 20:00 (per active tenant)
cron.schedule('0 8,20 * * *', runRateShop);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, async () => {
  console.log(`\n  Sunshine API running -> http://localhost:${PORT}`);
  console.log(`  Health check            -> http://localhost:${PORT}/api/health\n`);

  /* Start WhatsApp Web session — QR printed to console on first boot.
     NOTE: one process-wide session (shared sender) — see services/whatsapp.js
     for the multi-tenant policy. */
  initWhatsApp();

  // Sanity check: refuse to serve with an unmigrated database.
  try {
    await adminPool.query('SELECT 1 FROM tenants LIMIT 1');
  } catch {
    console.error('\n  [FATAL] Database is not migrated for multi-tenancy.');
    console.error('  Run:  cd backend && node db/migrate.js\n');
    process.exit(1);
  }
  fs.mkdirSync(uploadsRoot, { recursive: true });
});

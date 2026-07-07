/**
 * server.js — Express API entry point for Sunshine.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const cors = require('cors');
const { requireAuth } = require('./middleware/auth');

const path = require('path');
const app = express();
const httpServer = http.createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
// Make io accessible to routes that need it
app.set('io', io);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Health check — visit http://localhost:5000/api/health
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'sunshine-api' }));

// Public (guest-facing) endpoints
app.use('/api/rooms',        require('./routes/rooms'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/bookings',     require('./routes/bookings'));
app.use('/api/check-in',     require('./routes/checkin'));
app.use('/api/feedback',     require('./routes/feedback'));

// Auth + admin (admin endpoints require a valid login token)
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/employee', require('./routes/employee-auth'));

// Tape Chart — must be registered before the generic /api/admin router
// so Express matches /api/admin/calendar here, not the occupancy route in admin.js
const calendarRouter = require('./routes/calendar');
app.use('/api/admin/calendar', requireAuth, calendarRouter);
calendarRouter.initCalendarSocket(io);

app.use('/api/admin',    requireAuth, require('./routes/admin'));
app.use('/api/payments', require('./routes/payments'));

const cron = require('node-cron');
const { sendCheckInSMS } = require('./services/notify');
const { initWhatsApp }   = require('./services/whatsapp');
const { runRateShop }    = require('./services/rateShop');

async function sendPendingCheckInSMS() {
  const { pool } = require('./config/db');
  const baseUrl = process.env.CHECK_IN_BASE_URL || 'http://localhost:5173/check-in';
  try {
    // Find bookings with check_in 47–49 hours from now that haven't had SMS sent
    const { rows } = await pool.query(
      `SELECT cit.id AS token_id, cit.token, cit.booking_id,
              g.full_name, g.phone, b.reference, b.check_in
         FROM check_in_tokens cit
         JOIN bookings b ON b.id = cit.booking_id
         JOIN guests g ON g.id = b.guest_id
        WHERE cit.used_at IS NULL
          AND cit.expires_at > NOW()
          AND b.status IN ('confirmed', 'checked_in')
          AND b.check_in BETWEEN (NOW() + INTERVAL '47 hours') AND (NOW() + INTERVAL '49 hours')
          AND NOT EXISTS (
            SELECT 1 FROM notification_logs nl
             WHERE nl.booking_ref = b.reference AND nl.type = 'checkin_sms' AND nl.status = 'sent'
          )`
    );
    for (const row of rows) {
      if (!row.phone) continue;
      const url = `${baseUrl}/${row.token}`;
      await sendCheckInSMS(row.phone, row.full_name, url, row.reference);
    }
    if (rows.length > 0) console.log(`[cron] Sent check-in SMS for ${rows.length} booking(s)`);
  } catch (e) {
    console.error('[cron] sendPendingCheckInSMS error:', e.message);
  }
}

// Run every hour
cron.schedule('0 * * * *', sendPendingCheckInSMS);

async function autoCheckoutExpired() {
  const { pool } = require('./config/db');
  try {
    const { rowCount } = await pool.query(`
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

// Rate shopping: twice daily at 08:00 and 20:00
cron.schedule('0 8,20 * * *', runRateShop);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, async () => {
  console.log(`\n  Sunshine API running -> http://localhost:${PORT}`);
  console.log(`  Health check            -> http://localhost:${PORT}/api/health\n`);

  /* Start WhatsApp Web session — QR printed to console on first boot */
  initWhatsApp();

  // Migrate: add is_blocked column to users if missing
  try {
    const { pool: _pool } = require('./config/db');
    await _pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE`);
    console.log('  [migrate] users.is_blocked column ready');
  } catch (e) {
    console.warn('  [migrate] users.is_blocked:', e.message);
  }

  // Migrate: checkout reminder notification tracking
  try {
    const { pool: _pool } = require('./config/db');
    await _pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkout_notification_sent_at TIMESTAMPTZ DEFAULT NULL`);
    console.log('  [migrate] bookings.checkout_notification_sent_at column ready');
  } catch (e) {
    console.warn('  [migrate] checkout_notification_sent_at:', e.message);
  }

  // Migrate: add default shift time columns if they don't exist yet
  try {
    const { pool: _pool } = require('./config/db');
    await _pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_start_time TIME`);
    await _pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_end_time TIME`);
  } catch (e) {
    console.warn('  [migrate] shift master columns:', e.message);
  }

  // Migrate: create special_requests table for early check-in / late checkout tracking
  try {
    const { pool: _pool } = require('./config/db');
    await _pool.query(`
      CREATE TABLE IF NOT EXISTS special_requests (
        id             SERIAL PRIMARY KEY,
        booking_id     INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        request_type   VARCHAR(20) NOT NULL CHECK (request_type IN ('early_checkin', 'late_checkout')),
        requested_time TIME NOT NULL,
        standard_time  TIME NOT NULL,
        hours_delta    NUMERIC(4,2),
        fee_per_hour   NUMERIC(10,2) NOT NULL DEFAULT 150,
        total_fee      NUMERIC(10,2),
        status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','denied','waived')),
        notes          TEXT,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        resolved_at    TIMESTAMPTZ,
        resolved_by    INTEGER REFERENCES users(id)
      )
    `);
    console.log('  [migrate] special_requests table ready');
  } catch (e) {
    console.warn('  [migrate] special_requests:', e.message);
  }

  // Migrate: new tables for check-in tokens, guest feedback, pre_checkin_data
  try {
    const { pool: _pool } = require('./config/db');
    await _pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pre_checkin_data JSONB`);
    await _pool.query(`
      CREATE TABLE IF NOT EXISTS check_in_tokens (
        id          SERIAL PRIMARY KEY,
        booking_id  INT REFERENCES bookings(id) ON DELETE CASCADE,
        token       TEXT UNIQUE NOT NULL,
        used_at     TIMESTAMPTZ,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await _pool.query(`
      CREATE TABLE IF NOT EXISTS guest_feedback (
        id             SERIAL PRIMARY KEY,
        booking_id     INT REFERENCES bookings(id) ON DELETE CASCADE,
        guest_id       INT REFERENCES guests(id),
        token          TEXT UNIQUE NOT NULL,
        rating_overall INT CHECK (rating_overall BETWEEN 1 AND 5),
        rating_room    INT CHECK (rating_room BETWEEN 1 AND 5),
        rating_service INT CHECK (rating_service BETWEEN 1 AND 5),
        nps_score      INT CHECK (nps_score BETWEEN 0 AND 10),
        comments       TEXT,
        submitted_at   TIMESTAMPTZ,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  [migrate] check_in_tokens, guest_feedback, pre_checkin_data ready');
  } catch (e) {
    console.warn('  [migrate] new feature tables:', e.message);
  }

  // Migrate: Pillar 1-3 new tables + columns
  try {
    const { pool: _pool } = require('./config/db');
    await _pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS booking_id INT REFERENCES bookings(id)`);
    await _pool.query(`ALTER TABLE employee_routines ADD COLUMN IF NOT EXISTS booking_id INT REFERENCES bookings(id)`);
    await _pool.query(`ALTER TABLE employee_routines ADD COLUMN IF NOT EXISTS room_id    INT REFERENCES rooms(id)`);
    await _pool.query(`CREATE TABLE IF NOT EXISTS payment_transactions (
      id                      SERIAL PRIMARY KEY,
      booking_id              INT REFERENCES bookings(id),
      amount                  NUMERIC(10,2) NOT NULL,
      gst_amount              NUMERIC(10,2) NOT NULL DEFAULT 0,
      payment_method          TEXT NOT NULL DEFAULT 'cash',
      gateway_reference_token TEXT,
      status                  TEXT NOT NULL DEFAULT 'initiated',
      created_at              TIMESTAMPTZ DEFAULT now()
    )`);
    await _pool.query(`CREATE TABLE IF NOT EXISTS competitor_rates (
      id SERIAL PRIMARY KEY, resort_name TEXT NOT NULL, room_type TEXT,
      rate NUMERIC(10,2) NOT NULL, fetched_at TIMESTAMPTZ DEFAULT now()
    )`);
    await _pool.query(`CREATE TABLE IF NOT EXISTS suppressed_yield_log (
      id SERIAL PRIMARY KEY, unconstrained_price NUMERIC(10,2) NOT NULL,
      applied_price NUMERIC(10,2) NOT NULL DEFAULT 7499, delta NUMERIC(10,2) NOT NULL,
      booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
      room_id INT REFERENCES rooms(id), created_at TIMESTAMPTZ DEFAULT now()
    )`);
    console.log('  [migrate] Pillar 1-3 tables ready');
  } catch (e) {
    console.warn('  [migrate] Pillar 1-3 tables:', e.message);
  }

  // Migrate: persistent WhatsApp retry queue for messages that timed out before client was ready
  try {
    const { pool: _pool } = require('./config/db');
    await _pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_queue (
        id           SERIAL PRIMARY KEY,
        chat_id      TEXT NOT NULL,
        message_text TEXT NOT NULL,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('  [migrate] whatsapp_queue table ready');
  } catch (e) {
    console.warn('  [migrate] whatsapp_queue:', e.message);
  }

  // Seed a default staff portal account if none exists yet
  try {
    const bcrypt = require('bcryptjs');
    const { pool } = require('./config/db');
    const hash = await bcrypt.hash('staff123', 10);
    await pool.query(
      `INSERT INTO employees (first_name, last_name, role, roles, phone, username, password_hash, is_active)
       VALUES ('Default', 'Staff', 'Front Desk', ARRAY['Front Desk'], '0000000000', 'staff', $1, true)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true`,
      [hash]
    );
    console.log('  Default staff account ready  -> staff / staff123');
  } catch (e) {
    console.warn('  [seed] Could not create default staff account:', e.message);
  }
});

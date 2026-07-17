/**
 * migrate.js — apply incremental schema changes to an existing DB.
 * Run with: node db/migrate.js   (uses admin credentials from .env)
 *
 * Order matters:
 *   1. Legacy single-tenant steps (idempotent CREATE/ALTER IF NOT EXISTS),
 *      including the migrations that used to run inline at server boot.
 *   2. Multi-tenancy conversion (see migrate-tenancy.js): tenants table,
 *      tenant_id on every table, per-tenant uniques, RLS policies, app role.
 */
require('dotenv').config();
const { Pool } = require('pg');
const { migrateTenancy } = require('./migrate-tenancy');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT, 10) || 5432,
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME     || 'sunshine',
});

async function run() {
  const steps = [
    `CREATE TABLE IF NOT EXISTS employee_routines (
        routine_id             SERIAL PRIMARY KEY,
        employee_id            INT REFERENCES employees(employee_id) ON DELETE CASCADE,
        task_name              TEXT NOT NULL,
        scheduled_time         TIMESTAMPTZ NOT NULL,
        status                 TEXT NOT NULL DEFAULT 'Pending',
        started_at             TIMESTAMPTZ,
        completed_at           TIMESTAMPTZ,
        photo_verification_url TEXT,
        created_at             TIMESTAMPTZ DEFAULT now()
      )`,
    `ALTER TABLE tasks      ADD COLUMN IF NOT EXISTS room_id                INT REFERENCES rooms(id)`,
    `ALTER TABLE tasks      ADD COLUMN IF NOT EXISTS photo_verification_url TEXT`,
    `ALTER TABLE rooms      ADD COLUMN IF NOT EXISTS floor             TEXT`,
    `ALTER TABLE rooms      ADD COLUMN IF NOT EXISTS maintenance_until  DATE`,
    `ALTER TABLE room_types ADD COLUMN IF NOT EXISTS amenities         TEXT[] NOT NULL DEFAULT '{}'`,
    `ALTER TABLE bookings          ADD COLUMN IF NOT EXISTS balance_paid_at    TIMESTAMPTZ`,
    `ALTER TABLE tasks             ADD COLUMN IF NOT EXISTS photo_required      BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE employee_routines ADD COLUMN IF NOT EXISTS photo_required      BOOLEAN NOT NULL DEFAULT FALSE`,
    `CREATE TABLE IF NOT EXISTS notification_logs (
       id          SERIAL PRIMARY KEY,
       booking_ref TEXT,
       guest_name  TEXT,
       email       TEXT,
       phone       TEXT,
       type        TEXT,
       status      TEXT,
       message     TEXT,
       error       TEXT,
       sent_at     TIMESTAMPTZ DEFAULT NOW()
     )`,
    // Remove the manually-added check constraint that blocks valid type values
    `ALTER TABLE notification_logs DROP CONSTRAINT IF EXISTS notification_logs_type_check`,

    /* ── steps moved out of server.js startup ─────────────────────────── */
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkout_notification_sent_at TIMESTAMPTZ DEFAULT NULL`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_start_time TIME`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_end_time TIME`,
    `CREATE TABLE IF NOT EXISTS special_requests (
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
     )`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pre_checkin_data JSONB`,
    `CREATE TABLE IF NOT EXISTS check_in_tokens (
       id          SERIAL PRIMARY KEY,
       booking_id  INT REFERENCES bookings(id) ON DELETE CASCADE,
       token       TEXT UNIQUE NOT NULL,
       used_at     TIMESTAMPTZ,
       expires_at  TIMESTAMPTZ NOT NULL,
       created_at  TIMESTAMPTZ DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS guest_feedback (
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
     )`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS booking_id INT REFERENCES bookings(id)`,
    `ALTER TABLE employee_routines ADD COLUMN IF NOT EXISTS booking_id INT REFERENCES bookings(id)`,
    `ALTER TABLE employee_routines ADD COLUMN IF NOT EXISTS room_id    INT REFERENCES rooms(id)`,
    `CREATE TABLE IF NOT EXISTS payment_transactions (
       id                      SERIAL PRIMARY KEY,
       booking_id              INT REFERENCES bookings(id),
       amount                  NUMERIC(10,2) NOT NULL,
       gst_amount              NUMERIC(10,2) NOT NULL DEFAULT 0,
       payment_method          TEXT NOT NULL DEFAULT 'cash',
       gateway_reference_token TEXT,
       status                  TEXT NOT NULL DEFAULT 'initiated',
       created_at              TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE TABLE IF NOT EXISTS competitor_rates (
       id SERIAL PRIMARY KEY, resort_name TEXT NOT NULL, room_type TEXT,
       rate NUMERIC(10,2) NOT NULL, fetched_at TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE TABLE IF NOT EXISTS suppressed_yield_log (
       id SERIAL PRIMARY KEY, unconstrained_price NUMERIC(10,2) NOT NULL,
       applied_price NUMERIC(10,2) NOT NULL DEFAULT 7499, delta NUMERIC(10,2) NOT NULL,
       booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
       room_id INT REFERENCES rooms(id), created_at TIMESTAMPTZ DEFAULT now()
     )`,
    `CREATE TABLE IF NOT EXISTS whatsapp_queue (
       id           SERIAL PRIMARY KEY,
       chat_id      TEXT NOT NULL,
       message_text TEXT NOT NULL,
       created_at   TIMESTAMPTZ DEFAULT NOW()
     )`,
  ];

  for (const sql of steps) {
    try {
      await pool.query(sql);
      console.log('OK:', sql.trim().slice(0, 70).replace(/\s+/g, ' '));
    } catch (err) {
      console.error('FAIL:', err.message);
      process.exitCode = 1;
    }
  }

  try {
    console.log('\n[tenancy] Converting to multi-tenant…');
    const { defaultTenantId, ok } = await migrateTenancy(pool);
    console.log(`[tenancy] Done. Default tenant id=${defaultTenantId}${ok ? '' : ' (WITH ERRORS)'}`);
    if (!ok) process.exitCode = 1;
  } catch (err) {
    console.error('[tenancy] FAILED:', err.message);
    process.exitCode = 1;
  }

  await pool.end();
  console.log('Migration done.');
}
run();

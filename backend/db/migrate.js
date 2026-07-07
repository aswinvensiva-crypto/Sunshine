/**
 * migrate.js — apply incremental schema changes to an existing DB.
 * Run with: node db/migrate.js
 */
require('dotenv').config();
const { Pool } = require('pg');

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
       created_at  TIMESTAMPTZ DEFAULT NOW()
     )`,
    // Remove the manually-added check constraint that blocks valid type values
    `ALTER TABLE notification_logs DROP CONSTRAINT IF EXISTS notification_logs_type_check`,
  ];

  for (const sql of steps) {
    try {
      await pool.query(sql);
      console.log('OK:', sql.trim().slice(0, 70));
    } catch (err) {
      console.error('FAIL:', err.message);
      process.exitCode = 1;
    }
  }

  await pool.end();
  console.log('Migration done.');
}
run();

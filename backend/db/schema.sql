-- Sunshine — schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS room_types (
  id            SERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  max_occupancy INT  NOT NULL,
  base_rate     NUMERIC(10,2) NOT NULL,
  total_rooms   INT  NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id           SERIAL PRIMARY KEY,
  room_type_id INT REFERENCES room_types(id),
  room_number  TEXT UNIQUE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'available'   -- available | maintenance | unavailable
);

CREATE TABLE IF NOT EXISTS inventory (
  room_type_id INT  REFERENCES room_types(id),
  stay_date    DATE NOT NULL,
  total_units  INT  NOT NULL,
  booked_units INT  NOT NULL DEFAULT 0,
  rate         NUMERIC(10,2) NOT NULL,
  is_closed    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (room_type_id, stay_date)
);

CREATE TABLE IF NOT EXISTS guests (
  id         SERIAL PRIMARY KEY,
  full_name  TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  address    TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id            SERIAL PRIMARY KEY,
  reference     TEXT UNIQUE NOT NULL,
  guest_id      INT REFERENCES guests(id),
  room_type_id  INT REFERENCES room_types(id),
  check_in      DATE NOT NULL,
  check_out     DATE NOT NULL,
  num_guests    INT  NOT NULL,
  nights        INT  NOT NULL DEFAULT 1,
  base_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount  NUMERIC(10,2) NOT NULL,
  advance_paid  NUMERIC(10,2) NOT NULL DEFAULT 0,
  pending_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending',  -- pending | partial | paid
  payment_method TEXT NOT NULL DEFAULT 'cash',      -- cash | card | upi
  status        TEXT NOT NULL,                      -- confirmed | checked_in | checked_out | cancelled
  source        TEXT NOT NULL DEFAULT 'direct',
  ota_ref       TEXT,
  room_id       INT REFERENCES rooms(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  booking_id  INT REFERENCES bookings(id),
  provider    TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  status      TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',
  is_blocked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL,
  description TEXT,
  amount      NUMERIC(10,2) NOT NULL,
  spent_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id         SERIAL PRIMARY KEY,
  first_name          TEXT NOT NULL,
  last_name           TEXT,
  role                TEXT NOT NULL DEFAULT 'Front Desk',
  phone               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT now(),
  default_start_time  TIME,
  default_end_time    TIME
);

CREATE TABLE IF NOT EXISTS shift_schedules (
  id          SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(employee_id) ON DELETE CASCADE,
  shift_date  DATE NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, shift_date)
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id     SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT,
  priority    TEXT NOT NULL DEFAULT 'Medium',
  status      TEXT NOT NULL DEFAULT 'Pending',
  due_at      TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  photo_verification_url TEXT
);

CREATE TABLE IF NOT EXISTS routines (
  routine_id  SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT,
  frequency   TEXT NOT NULL DEFAULT 'Daily',
  area        TEXT,
  photo_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routine_completions (
  id          SERIAL PRIMARY KEY,
  routine_id  INT REFERENCES routines(routine_id) ON DELETE CASCADE,
  completed_by TEXT,
  notes       TEXT,
  photo_url   TEXT,
  completed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations_log (
  id           SERIAL PRIMARY KEY,
  frequency    TEXT NOT NULL,
  task_category TEXT NOT NULL,
  task_name    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'Completed',
  metric_data  JSONB,
  photo_url    TEXT,
  logged_at    TIMESTAMPTZ DEFAULT now()
);
-- Migration: ALTER TABLE operations_log ADD COLUMN IF NOT EXISTS photo_url TEXT;

CREATE TABLE IF NOT EXISTS employee_routines (
  routine_id             SERIAL PRIMARY KEY,
  employee_id            INT REFERENCES employees(employee_id) ON DELETE CASCADE,
  task_name              TEXT NOT NULL,
  scheduled_time         TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'Pending',  -- Pending | Active | Verified | Flagged
  started_at             TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  photo_verification_url TEXT,
  created_at             TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_logs (
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
);

-- ---- Pillar 1–3 additions ----
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS booking_id INT REFERENCES bookings(id);
ALTER TABLE employee_routines ADD COLUMN IF NOT EXISTS booking_id INT REFERENCES bookings(id);
ALTER TABLE employee_routines ADD COLUMN IF NOT EXISTS room_id    INT REFERENCES rooms(id);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id                      SERIAL PRIMARY KEY,
  booking_id              INT REFERENCES bookings(id),
  amount                  NUMERIC(10,2) NOT NULL,
  gst_amount              NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method          TEXT NOT NULL DEFAULT 'cash',
  gateway_reference_token TEXT,
  status                  TEXT NOT NULL DEFAULT 'initiated',  -- initiated | captured | failed | refunded
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competitor_rates (
  id          SERIAL PRIMARY KEY,
  resort_name TEXT NOT NULL,
  room_type   TEXT,
  rate        NUMERIC(10,2) NOT NULL,
  fetched_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppressed_yield_log (
  id                  SERIAL PRIMARY KEY,
  unconstrained_price NUMERIC(10,2) NOT NULL,
  applied_price       NUMERIC(10,2) NOT NULL DEFAULT 7499,
  delta               NUMERIC(10,2) NOT NULL,
  booking_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  room_id             INT REFERENCES rooms(id),
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ---- Upgrades for databases created with an older version ----
ALTER TABLE guests   ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS nights         INT           NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS base_amount    NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tax_amount     NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS advance_paid   NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pending_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT          NOT NULL DEFAULT 'pending';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method TEXT          NOT NULL DEFAULT 'cash';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_id        INT REFERENCES rooms(id);
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS room_id        INT REFERENCES rooms(id);
ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS floor           TEXT;
ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS maintenance_until DATE;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS amenities    TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE employees  ADD COLUMN IF NOT EXISTS username      TEXT UNIQUE;
ALTER TABLE employees  ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE shift_schedules ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE shift_schedules ADD COLUMN IF NOT EXISTS end_time   TIME;
ALTER TABLE shift_schedules DROP COLUMN IF EXISTS shift_type;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS photo_verification_url TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS roles TEXT[];
UPDATE employees SET roles = ARRAY[COALESCE(role, 'Front Desk')] WHERE roles IS NULL;

-- Guest extended address & KYC fields
ALTER TABLE guests ADD COLUMN IF NOT EXISTS addr1    TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS addr2    TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS state    TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS pincode  TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS kyc_type         TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS kyc_number       TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS nationality      TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS corporate_gstin  TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS corporate_address TEXT;

ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS room_type  TEXT;
ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS base_price NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS base_rate            NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gst_rate             NUMERIC(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ota_source           TEXT NOT NULL DEFAULT 'Direct';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_form_c_submitted  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS owner_payment_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pre_checkin_data JSONB;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS balance_paid_at TIMESTAMPTZ;

-- Refund support
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS actual_checkout     DATE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS actual_nights       INT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_amount       NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_status       TEXT NOT NULL DEFAULT 'none';  -- none | pending | processed | waived
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_reason       TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_method       TEXT;                           -- cash | card | upi | ota
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_processed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_processed_by INT REFERENCES users(id);

-- Activate payments table as a full transaction ledger
ALTER TABLE payments ALTER COLUMN provider    SET DEFAULT '';
ALTER TABLE payments ALTER COLUMN provider_id SET DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS type         TEXT NOT NULL DEFAULT 'charge';  -- charge | refund
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes        TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS processed_by INT REFERENCES users(id);

CREATE TABLE IF NOT EXISTS check_in_tokens (
  id          SERIAL PRIMARY KEY,
  booking_id  INT REFERENCES bookings(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  used_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

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
);

-- ---- Multi-tenancy (platform tables) ----
-- NOTE: after applying this schema, run `node db/migrate.js`. It adds
-- tenant_id to every tenant-scoped table, converts global uniques to
-- per-tenant uniques, enables Row-Level Security, and creates the
-- non-superuser application role. migrate.js is the source of truth for
-- tenancy enforcement; this file only declares the platform tables.

CREATE TABLE IF NOT EXISTS tenants (
  id         SERIAL PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id            INT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  razorpay_key_id      TEXT,
  razorpay_key_secret  TEXT,
  whatsapp_sender      TEXT,
  whatsapp_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  gst_number           TEXT,
  early_late_fee_per_hour NUMERIC(10,2) NOT NULL DEFAULT 150,
  branding             JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_admins (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

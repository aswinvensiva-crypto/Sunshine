/**
 * setup.js — creates tables, loads seed data, creates the first admin user,
 * and adds a little sample data so the admin dashboard isn't empty.
 *
 * Run from the backend folder with:  npm run db:setup
 * Requires the database (DB_NAME) to already exist (see README step 2).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT, 10) || 5432,
  user:     process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'sunshine',
});

async function run() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const seed   = fs.readFileSync(path.join(__dirname, 'seed.sql'),   'utf8');

    console.log('Creating tables...');
    await pool.query(schema);

    console.log('Loading seed data (15 rooms + 365 days of inventory)...');
    await pool.query(seed);

    // ---- Create the first admin user (username + password from .env) ----
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (username, full_name, password_hash, role)
       VALUES ($1, 'Resort Owner', $2, 'owner')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [username, hash]
    );
    console.log(`Admin user ready -> username: "${username}"  password: "${password}"`);

    // ---- Create default staff employee (only if no employees with credentials exist) ----
    const { rows: ec } = await pool.query(`SELECT COUNT(*)::int AS n FROM employees WHERE username IS NOT NULL`);
    if (ec[0].n === 0) {
      const staffUser = process.env.STAFF_USERNAME || 'staff';
      const staffPass = process.env.STAFF_PASSWORD || 'staff123';
      const staffHash = await bcrypt.hash(staffPass, 10);
      await pool.query(
        `INSERT INTO employees (first_name, last_name, role, roles, is_active, username, password_hash)
         VALUES ('Priya', 'Kumar', 'Front Desk', ARRAY['Front Desk'], true, $1, $2)
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [staffUser, staffHash]
      );
      console.log(`Default staff user ready -> username: "${staffUser}"  password: "${staffPass}"`);
    }

    // ---- Sample data for the dashboard (only if there are no bookings yet) ----
    const { rows: bc } = await pool.query('SELECT COUNT(*)::int AS n FROM bookings');
    if (bc[0].n === 0) {
      console.log('Adding sample guests, bookings and expenses...');

      const rt = await pool.query('SELECT id, base_rate FROM room_types ORDER BY id');
      const g = await pool.query(
        `INSERT INTO guests (full_name, email, phone) VALUES
           ('Aarav Mehta','aarav@example.com','+91 90000 11111'),
           ('Sofia Laurent','sofia@example.com','+33 6 12 34 56 78'),
           ('Ravi Iyer','ravi@example.com','+91 90000 22222')
         RETURNING id`
      );

      const mkRef = () => 'AZ-' + new Date().getFullYear() + '-' +
        Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
      const d = (off) => { const t = new Date(); t.setDate(t.getDate() + off); return t.toISOString().slice(0, 10); };

      const samples = [
        { gi: 0, rt: 0, ci: d(0),  co: d(2),  st: 'checked_in', src: 'direct' },
        { gi: 1, rt: 1, ci: d(0),  co: d(3),  st: 'checked_in', src: 'booking.com' },
        { gi: 2, rt: 2, ci: d(3),  co: d(6),  st: 'confirmed',  src: 'direct' },
      ];
      for (const s of samples) {
        const rate = Number(rt.rows[s.rt].base_rate);
        const nights = Math.round((new Date(s.co) - new Date(s.ci)) / 86400000);
        const total = rate * nights;
        const adv = s.st === 'checked_in' ? Math.round(total / 2) : 0;
        const pay = adv <= 0 ? 'pending' : (total - adv <= 0 ? 'paid' : 'partial');
        await pool.query(
          `INSERT INTO bookings (reference, guest_id, room_type_id, check_in, check_out, num_guests,
             nights, base_amount, tax_amount, total_amount, advance_paid, pending_amount, payment_status, status, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8,$9,$10,$11,$12,$13)`,
          [mkRef(), g.rows[s.gi].id, rt.rows[s.rt].id, s.ci, s.co, 2,
           nights, total, adv, total - adv, pay, s.st, s.src]
        );
        await pool.query(
          `UPDATE inventory SET booked_units = booked_units + 1
            WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3`,
          [rt.rows[s.rt].id, s.ci, s.co]
        );
      }

      await pool.query(
        `INSERT INTO expenses (category, description, amount, spent_on) VALUES
          ('Pool',      'Chlorine and pH chemicals',   3200,  CURRENT_DATE),
          ('Salaries',  'Front office + housekeeping', 85000, CURRENT_DATE - 2),
          ('Utilities', 'Electricity & water',         18500, CURRENT_DATE - 5),
          ('Supplies',  'Linen and toiletries',        9400,  CURRENT_DATE - 8),
          ('Marketing', 'Instagram promotion',         5000,  CURRENT_DATE - 10)`
      );
    }

    const inv = await pool.query('SELECT COUNT(*)::int AS n FROM inventory');
    console.log(`Done. Inventory rows: ${inv.rows[0].n}`);
    console.log('Database is ready.');
  } catch (err) {
    console.error('Setup failed:', err.message);
    console.error('Check your .env values and that the database exists.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
run();

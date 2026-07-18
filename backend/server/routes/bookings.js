const router = require('express').Router();
const { sendBookingNotifications, sendAdvanceReceiptEmail } = require('../services/notify');

/**
 * POST /api/bookings
 * Body: { room_type_id, check_in, check_out, num_guests, guest:{full_name,email,phone} }
 *
 * The whole point of this file: confirm a booking WITHOUT ever selling the
 * same room twice. The check (is a room free?) and the decrement (take a room)
 * happen as one atomic, row-locked transaction. SELECT ... FOR UPDATE makes a
 * second concurrent request wait, then correctly see "sold out".
 *
 * Tenancy: every query runs on req.db (RLS pinned to the resolved resort) and
 * carries an explicit tenant_id filter as the second defense layer.
 */
router.post('/', async (req, res) => {
  const { room_type_id, check_in, check_out, num_guests, guest } = req.body || {};
  if (!room_type_id || !check_in || !check_out || !guest || !guest.full_name) {
    return res.status(400).json({ error: 'room_type_id, check_in, check_out and guest.full_name are required' });
  }

  const nights = Math.round((new Date(check_out) - new Date(check_in)) / 86400000);
  if (!(nights > 0)) return res.status(400).json({ error: 'check_out must be after check_in' });

  const tenantId = req.tenant.id;
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');

    // Lock every night of the stay and read capacity in one shot.
    const { rows } = await client.query(
      `SELECT stay_date, total_units, booked_units, is_closed, rate
         FROM inventory
        WHERE room_type_id = $1 AND tenant_id = $4
          AND stay_date >= $2 AND stay_date < $3
        FOR UPDATE`,
      [room_type_id, check_in, check_out, tenantId]
    );

    if (rows.length !== nights) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'NO_INVENTORY', message: 'Some nights are not open for sale.' });
    }
    const soldOut = rows.some(r => r.is_closed || r.booked_units >= r.total_units);
    if (soldOut) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'NO_AVAILABILITY', message: 'This room type is sold out for those dates.' });
    }

    const total = rows.reduce((sum, r) => sum + Number(r.rate), 0);

    // Take one unit on every night.
    await client.query(
      `UPDATE inventory SET booked_units = booked_units + 1
        WHERE room_type_id = $1 AND tenant_id = $4 AND stay_date >= $2 AND stay_date < $3`,
      [room_type_id, check_in, check_out, tenantId]
    );

    const g = await client.query(
      `INSERT INTO guests (full_name, email, phone, tenant_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [guest.full_name, guest.email || null, guest.phone || null, tenantId]
    );

    const reference =
      'AZ-' + new Date().getFullYear() + '-' +
      Math.floor(Math.random() * 1e6).toString().padStart(6, '0');

    const b = await client.query(
      `INSERT INTO bookings
         (reference, guest_id, room_type_id, check_in, check_out, num_guests, nights,
          base_amount, tax_amount, total_amount, advance_paid, pending_amount, payment_status, status, source, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8,0,$8,'pending','confirmed','direct',$9)
       RETURNING reference, check_in, check_out, total_amount, status`,
      [reference, g.rows[0].id, room_type_id, check_in, check_out, num_guests || 2, nights, total, tenantId]
    );

    await client.query('COMMIT');

    // Fetch full booking detail for notifications
    const full = await req.db.query(
      `SELECT b.*, g.full_name AS guest, g.email, g.phone,
              rt.name AS room, rt.code
         FROM bookings b
         JOIN guests g ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
        WHERE b.reference = $1 AND b.tenant_id = $2`, [reference, tenantId]
    );
    // Fire notifications without blocking the response
    sendBookingNotifications(full.rows[0]).catch(() => {});
    // Send advance receipt email only — WA PDF is already sent by sendBookingNotifications
    sendAdvanceReceiptEmail(full.rows[0], { skipWa: true }).catch(err => console.error('[bookings] Advance receipt failed:', err.message));
    req.db.query('UPDATE bookings SET invoice_sent_at = now() WHERE reference = $1 AND tenant_id = $2', [reference, tenantId]).catch(() => {});

    // Generate check-in token (expires 24h before check_in)
    const checkInToken = require('crypto').randomUUID();
    const checkInExpires = new Date(check_in);
    checkInExpires.setDate(checkInExpires.getDate() - 1);
    req.db.query(
      `INSERT INTO check_in_tokens (booking_id, token, expires_at, tenant_id) VALUES ($1, $2, $3, $4)`,
      [full.rows[0].id, checkInToken, checkInExpires.toISOString(), tenantId]
    ).catch(() => {});

    res.status(201).json({ ok: true, booking: b.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[bookings]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/bookings  → recent bookings (handy for a future admin screen)
router.get('/', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.reference, g.full_name, rt.name AS room, b.check_in, b.check_out,
              b.total_amount, b.status, b.source, b.created_at
         FROM bookings b
         JOIN guests g     ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
        WHERE b.tenant_id = $1
        ORDER BY b.created_at DESC
        LIMIT 50`,
      [req.tenant.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

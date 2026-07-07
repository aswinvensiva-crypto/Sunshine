/**
 * calendar.js — Tape Chart API + Socket.io ROOM_SWAP handler.
 *
 * REST endpoints (mounted at /api/admin/calendar via server.js):
 *   GET  /           → rooms + bookings for a 14-day window
 *   POST /swap       → fallback REST swap when socket unavailable
 *
 * Socket.io events (registered from initCalendarSocket(io)):
 *   client → server : ROOM_SWAP_REQUEST  { bookingId, newRoomId, newCheckIn, newCheckOut }
 *   server → client : ROOM_SWAP_BROADCAST { booking }
 *   server → sender : ROOM_SWAP_ERROR    { message }
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

/* ─────────────────────────────────────────────────────────────
   GET /api/admin/calendar
   Query params: start (ISO date), days (default 14)
   Returns rooms with live status + bookings with guest info
   ───────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  const { start, days = 14 } = req.query;
  const startDate = start || new Date().toISOString().split('T')[0];
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + parseInt(days, 10));
  const endISO = endDate.toISOString().split('T')[0];

  try {
    // Fetch all physical rooms, resolving room_type from the room_types table if the
    // text column is unpopulated (seed.sql only sets room_type_id).
    const roomsResult = await pool.query(`
      SELECT
        r.id,
        r.room_number,
        COALESCE(NULLIF(r.room_type, ''), rt.name) AS room_type,
        COALESCE(r.base_price, rt.base_rate)        AS base_price,
        COALESCE(rs.status, 'Vacant Clean')         AS status
      FROM rooms r
      LEFT JOIN room_types rt ON rt.id = r.room_type_id
      LEFT JOIN LATERAL (
        SELECT status
        FROM room_status_log
        WHERE room_id = r.id
        ORDER BY updated_at DESC
        LIMIT 1
      ) rs ON true
      WHERE COALESCE(r.status, 'available') <> 'unavailable'
      ORDER BY
        COALESCE(r.room_type_id, 0),
        r.room_number
    `);

    // Fetch bookings overlapping the view window with guest data + approved special request
    const bookingsResult = await pool.query(`
      SELECT
        b.id,
        b.room_id,
        b.guest_id,
        b.check_in::text   AS check_in,
        b.check_out::text  AS check_out,
        b.status,
        b.base_rate,
        b.gst_rate,
        b.total_amount,
        b.ota_source,
        b.reference,
        b.is_form_c_submitted,
        COALESCE(b.total_amount - COALESCE(
          (SELECT SUM(pt.amount) FROM payment_transactions pt WHERE pt.booking_id = b.id AND pt.status = 'paid'),
          0
        ), 0) AS ledger_balance,
        g.full_name       AS guest_name,
        g.nationality,
        g.phone,
        g.email,
        g.corporate_gstin,
        g.corporate_address,
        sr.request_type   AS sr_type,
        sr.requested_time AS sr_time,
        sr.total_fee      AS sr_fee,
        sr.notes          AS sr_notes
      FROM bookings b
      JOIN guests g ON g.id = b.guest_id
      LEFT JOIN LATERAL (
        SELECT request_type, requested_time, total_fee, notes
        FROM special_requests
        WHERE booking_id = b.id AND status = 'approved'
        ORDER BY created_at DESC LIMIT 1
      ) sr ON true
      WHERE b.status NOT IN ('cancelled')
        AND b.check_in  < $2
        AND b.check_out > $1
      ORDER BY b.check_in, b.id
    `, [startDate, endISO]);

    // Build room status map keyed by room id
    const roomStatusMap = {};
    roomsResult.rows.forEach(r => {
      roomStatusMap[r.id] = r.status;
    });

    return res.json({
      rooms:       roomsResult.rows,
      bookings:    bookingsResult.rows,
      roomStatuses: roomStatusMap,
    });
  } catch (err) {
    // If room_status_log table doesn't exist, fall back to simple query
    if (err.code === '42P01') {
      try {
        const roomsSimple = await pool.query(`
          SELECT r.id, r.room_number,
            COALESCE(NULLIF(r.room_type,''), rt.name) AS room_type,
            COALESCE(r.base_price, rt.base_rate) AS base_price
          FROM rooms r
          LEFT JOIN room_types rt ON rt.id = r.room_type_id
          WHERE COALESCE(r.status, 'available') <> 'unavailable'
          ORDER BY COALESCE(r.room_type_id,0), r.room_number
        `);
        const bookingsSimple = await pool.query(`
          SELECT
            b.id, b.room_id, b.guest_id,
            b.check_in::text AS check_in,
            b.check_out::text AS check_out,
            b.status, b.base_rate, b.gst_rate, b.total_amount,
            b.ota_source, b.reference, b.is_form_c_submitted,
            0 AS ledger_balance,
            g.full_name AS guest_name, g.nationality, g.phone,
            g.email, g.corporate_gstin, g.corporate_address
          FROM bookings b
          JOIN guests g ON g.id = b.guest_id
          WHERE b.status NOT IN ('cancelled')
            AND b.check_in < $2 AND b.check_out > $1
          ORDER BY b.check_in, b.id
        `, [startDate, endISO]);

        const statusMap = {};
        roomsSimple.rows.forEach(r => { statusMap[r.id] = 'Vacant Clean'; });
        // Override rooms that have active bookings as Dirty or Stay-Over
        bookingsSimple.rows.forEach(b => {
          if (b.status === 'checked_in') statusMap[b.room_id] = 'Stay-Over Refresh';
        });

        return res.json({
          rooms: roomsSimple.rows,
          bookings: bookingsSimple.rows,
          roomStatuses: statusMap,
        });
      } catch (fallbackErr) {
        return res.status(500).json({ error: fallbackErr.message });
      }
    }
    console.error('[calendar] GET /:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/admin/calendar/swap
   REST fallback when socket.io unavailable on the client.
   Body: { bookingId, newRoomId, newCheckIn, newCheckOut }
   ───────────────────────────────────────────────────────────── */
router.post('/swap', async (req, res) => {
  const { bookingId, newRoomId, newCheckIn, newCheckOut } = req.body;
  if (!bookingId || !newRoomId || !newCheckIn || !newCheckOut) {
    return res.status(400).json({ error: 'bookingId, newRoomId, newCheckIn, newCheckOut are required' });
  }
  const result = await executeSwap({ bookingId, newRoomId, newCheckIn, newCheckOut });
  if (result.error) return res.status(409).json({ error: result.error });
  return res.json({ booking: result.booking });
});

/* ─────────────────────────────────────────────────────────────
   Core swap transaction — shared by REST endpoint + socket handler.
   Uses SERIALIZABLE isolation to prevent race-condition overbooking.
   ───────────────────────────────────────────────────────────── */
async function executeSwap({ bookingId, newRoomId, newCheckIn, newCheckOut }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // Overlap check: any OTHER active booking in the target room during this span?
    const overlap = await client.query(`
      SELECT id FROM bookings
      WHERE room_id   = $1
        AND id       != $2
        AND status NOT IN ('cancelled', 'checked_out')
        AND check_in  < $4
        AND check_out > $3
      FOR UPDATE
    `, [newRoomId, bookingId, newCheckIn, newCheckOut]);

    if (overlap.rows.length > 0) {
      await client.query('ROLLBACK');
      return { error: `Room conflict: ${overlap.rows.length} overlapping booking(s) found in target room for this period.` };
    }

    // Execute the move
    const { rows } = await client.query(`
      UPDATE bookings
         SET room_id   = $1,
             check_in  = $2,
             check_out = $3
       WHERE id = $4
      RETURNING id, room_id, check_in::text AS check_in, check_out::text AS check_out,
                status, ota_source, reference, guest_id
    `, [newRoomId, newCheckIn, newCheckOut, bookingId]);

    await client.query('COMMIT');
    return { booking: rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[calendar] executeSwap error:', err.message);
    return { error: err.message };
  } finally {
    client.release();
  }
}

/* ─────────────────────────────────────────────────────────────
   Socket.io handler — call once from server.js after io is created.
   initCalendarSocket(io) registers the ROOM_SWAP_REQUEST listener.
   ───────────────────────────────────────────────────────────── */
function initCalendarSocket(io) {
  io.on('connection', socket => {
    socket.on('ROOM_SWAP_REQUEST', async payload => {
      const { bookingId, newRoomId, newCheckIn, newCheckOut } = payload || {};

      if (!bookingId || !newRoomId || !newCheckIn || !newCheckOut) {
        socket.emit('ROOM_SWAP_ERROR', { message: 'Invalid payload — all four fields are required.' });
        return;
      }

      const result = await executeSwap({ bookingId, newRoomId, newCheckIn, newCheckOut });

      if (result.error) {
        socket.emit('ROOM_SWAP_ERROR', { message: result.error });
        return;
      }

      // Broadcast updated booking coordinates to ALL connected dashboards
      io.emit('ROOM_SWAP_BROADCAST', { booking: result.booking });
    });
  });
}


module.exports = router;
module.exports.initCalendarSocket = initCalendarSocket;

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const { requireAdmin, requireOwner } = require('../middleware/auth');
const { sendBookingNotifications, sendInvoiceEmail, sendAdvanceReceiptEmail, sendBalancePaymentAlert, sendCancellationAlert, sendOverbookingAlert, sendSpecialRequestUpdate, sendCheckoutReceipt, sendFeedbackEmail, sendCheckInSMS, sendCheckoutReminder } = require('../services/notify');
const { sendWhatsApp } = require('../services/whatsapp');
const multer = require('multer');

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', String(req.tenant.id), 'routines');
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `routine_${req.params.id}_${Date.now()}${path.extname(file.originalname)}`);
  },
});
const uploadPhoto = multer({ storage: photoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

/* All routes here are already behind requireAuth (mounted in server.js). */

/* ---------------- DASHBOARD ---------------- */
// GET /api/admin/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const totalRoomsQ = await req.db.query('SELECT COALESCE(SUM(total_rooms),0)::int AS n FROM room_types');
    const totalRooms = totalRoomsQ.rows[0].n || 1;

    const occQ = await req.db.query(
      `SELECT COALESCE(SUM(booked_units),0)::int AS occupied
         FROM inventory WHERE stay_date = CURRENT_DATE`
    );
    const occupiedToday = occQ.rows[0].occupied;

    const flowQ = await req.db.query(
      `SELECT
        COUNT(*) FILTER (WHERE check_in = CURRENT_DATE AND status <> 'cancelled')  AS arrivals,
        COUNT(*) FILTER (WHERE check_out = CURRENT_DATE AND status <> 'cancelled') AS departures,
        COUNT(*) FILTER (WHERE check_in = CURRENT_DATE AND status = 'checked_in')  AS checked_in_today,
        COUNT(*) FILTER (WHERE check_out = CURRENT_DATE AND status = 'checked_out') AS checked_out_today,
        COUNT(*) FILTER (WHERE check_in <= CURRENT_DATE AND check_out > CURRENT_DATE
                          AND status IN ('confirmed','checked_in'))               AS in_house
       FROM bookings`
    );

    const arrivalsByTypeQ = await req.db.query(
      `SELECT rt.name,
         COUNT(*) FILTER (WHERE b.status <> 'cancelled') AS expected,
         COUNT(*) FILTER (WHERE b.status = 'checked_in') AS checked_in
       FROM bookings b
       JOIN room_types rt ON rt.id = b.room_type_id
       WHERE b.check_in = CURRENT_DATE
       GROUP BY rt.name`
    );

    const departuresByTypeQ = await req.db.query(
      `SELECT rt.name,
         COUNT(*) FILTER (WHERE b.status <> 'cancelled') AS expected,
         COUNT(*) FILTER (WHERE b.status = 'checked_out') AS checked_out
       FROM bookings b
       JOIN room_types rt ON rt.id = b.room_type_id
       WHERE b.check_out = CURRENT_DATE
       GROUP BY rt.name`
    );

    const monthQ = await req.db.query(
      `SELECT
         COALESCE(SUM(total_amount),0)                       AS revenue,
         COALESCE(SUM(check_out - check_in),0)::int          AS room_nights,
         COUNT(*)                                            AS bookings
       FROM bookings
       WHERE status <> 'cancelled'
         AND check_in >= date_trunc('month', CURRENT_DATE)`
    );
    const monthRevenue = Number(monthQ.rows[0].revenue);
    const roomNights   = monthQ.rows[0].room_nights;

    const expQ = await req.db.query(
      `SELECT COALESCE(SUM(amount),0) AS total
         FROM expenses WHERE spent_on >= date_trunc('month', CURRENT_DATE)`
    );
    const monthExpenses = Number(expQ.rows[0].total);

    const srcQ = await req.db.query(
      `SELECT source, COALESCE(SUM(total_amount),0) AS revenue, COUNT(*) AS bookings
         FROM bookings
        WHERE status <> 'cancelled' AND check_in >= date_trunc('month', CURRENT_DATE)
        GROUP BY source ORDER BY revenue DESC`
    );

    const recentQ = await req.db.query(
      `SELECT b.id, b.reference, g.full_name AS guest, rt.name AS room, rm.room_number,
              b.check_in, b.check_out, b.total_amount, b.status, b.source
         FROM bookings b
         JOIN guests g     ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
         LEFT JOIN rooms rm ON rm.id = b.room_id
        ORDER BY b.created_at DESC LIMIT 8`
    );

    const daysSoFar = new Date().getDate();
    const adr    = roomNights ? monthRevenue / roomNights : 0;
    const revpar = monthRevenue / (totalRooms * daysSoFar);

    res.json({
      totalRooms,
      occupiedToday,
      occupancyPct: Math.round((occupiedToday / totalRooms) * 100),
      arrivals: Number(flowQ.rows[0].arrivals),
      departures: Number(flowQ.rows[0].departures),
      checkedInToday: Number(flowQ.rows[0].checked_in_today),
      checkedOutToday: Number(flowQ.rows[0].checked_out_today),
      inHouse: Number(flowQ.rows[0].in_house),
      arrivalsByType: arrivalsByTypeQ.rows.map(r => ({ name: r.name, expected: Number(r.expected), in: Number(r.checked_in) })),
      departuresByType: departuresByTypeQ.rows.map(r => ({ name: r.name, expected: Number(r.expected), out: Number(r.checked_out) })),
      monthRevenue,
      monthExpenses,
      monthProfit: monthRevenue - monthExpenses,
      monthBookings: Number(monthQ.rows[0].bookings),
      adr: Math.round(adr),
      revpar: Math.round(revpar),
      bySource: srcQ.rows.map(r => ({ source: r.source, revenue: Number(r.revenue), bookings: Number(r.bookings) })),
      recent: recentQ.rows,
    });
  } catch (err) {
    console.error('[admin/dashboard]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- BOOKINGS ---------------- */
// GET /api/admin/bookings?status=&from=&to=
router.get('/bookings', async (req, res) => {
  // Auto-checkout any checked_in bookings whose check_out date has passed
  await req.db.query(`
    UPDATE bookings SET status = 'checked_out'
     WHERE status = 'checked_in' AND check_out::date < CURRENT_DATE
  `).catch(() => {});

  const { status, from, to } = req.query;
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`b.status = $${params.length}`); }
  if (from)   { params.push(from);   where.push(`b.check_out >= $${params.length}`); }
  if (to)     { params.push(to);     where.push(`b.check_in  <= $${params.length}`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await req.db.query(
      `SELECT b.id, b.reference, g.full_name AS guest, g.email, g.phone,
              rt.name AS room, rm.room_number, b.check_in, b.check_out, b.num_guests, b.nights,
              b.total_amount, b.advance_paid, b.pending_amount, b.payment_status, b.payment_method,
              b.status, b.source, b.created_at, b.guest_id,
              b.refund_amount, b.refund_status, b.refund_reason, b.refund_method,
              b.actual_checkout, b.actual_nights, b.refund_processed_at
         FROM bookings b
         JOIN guests g           ON g.id = b.guest_id
         LEFT JOIN room_types rt ON rt.id = b.room_type_id
         LEFT JOIN rooms rm      ON rm.id = b.room_id
        ${clause}
        ORDER BY b.check_in DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/bookings/:id/status  { status }
// Cancelling releases the held inventory.
router.patch('/bookings/:id/status', async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['confirmed', 'checked_in', 'checked_out', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [req.params.id, req.tenant.id]);
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    const bk = cur.rows[0];

    let refundFields = {};
    if (status === 'cancelled' && bk.status !== 'cancelled') {
      await client.query(
        `UPDATE inventory SET booked_units = GREATEST(booked_units - 1, 0)
          WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3`,
        [bk.room_type_id, bk.check_in, bk.check_out]
      );
      // Refund amount is decided manually by the owner — flag as pending for review
      if (Number(bk.advance_paid) > 0) {
        refundFields = { refund_amount: 0, refund_status: 'pending', refund_reason: 'cancellation' };
      }
    }
    const upd = await client.query(
      `UPDATE bookings
          SET status        = $1,
              refund_amount = CASE WHEN $3::text IS NOT NULL THEN $3::numeric     ELSE refund_amount END,
              refund_status = CASE WHEN $4::text IS NOT NULL THEN $4             ELSE refund_status END,
              refund_reason = CASE WHEN $5::text IS NOT NULL THEN $5             ELSE refund_reason END
        WHERE id = $2
        RETURNING id, reference, status, room_id, refund_amount, refund_status`,
      [
        status,
        req.params.id,
        refundFields.refund_amount != null ? String(refundFields.refund_amount) : null,
        refundFields.refund_status || null,
        refundFields.refund_reason || null,
      ]
    );

    // Case 1: auto-task + room lock when guest checks out
    let dispatchedEmployee = null;
    if (status === 'checked_out' && bk.room_id) {
      await client.query(
        'UPDATE rooms SET status = $1, maintenance_until = NULL WHERE id = $2',
        ['maintenance', bk.room_id]
      );
      const rmQ = await client.query('SELECT room_number FROM rooms WHERE id=$1', [bk.room_id]);
      const roomNum = rmQ.rows[0]?.room_number || bk.room_id;
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 0, 0);
      await client.query(
        `INSERT INTO tasks (title, description, priority, status, due_at, room_id, booking_id)
         VALUES ($1,$2,'Urgent','Pending',$3,$4,$5)`,
        [
          `Room ${roomNum} post-checkout inspection`,
          'Room vacated. Complete inspection and cleaning before marking vacant & clean.',
          endOfDay.toISOString(),
          bk.room_id,
          req.params.id,
        ]
      );

      // Find active housekeeping employee on shift today
      const hkQ = await client.query(
        `SELECT e.employee_id, e.first_name, e.last_name, e.phone
           FROM employees e
           JOIN shift_schedules ss ON ss.employee_id = e.employee_id
          WHERE e.is_active = true
            AND 'Housekeeping' = ANY(e.roles)
            AND ss.shift_date = CURRENT_DATE
          ORDER BY ss.start_time ASC
          LIMIT 1`
      );
      if (hkQ.rows[0]) {
        const emp = hkQ.rows[0];
        dispatchedEmployee = emp;
        const scheduledTime = new Date();
        scheduledTime.setMinutes(scheduledTime.getMinutes() + 15);
        await client.query(
          `INSERT INTO employee_routines (employee_id, task_name, scheduled_time, status, booking_id, room_id)
           VALUES ($1,$2,$3,'Pending',$4,$5)`,
          [
            emp.employee_id,
            `Room Turnaround & Cleaning — Room ${roomNum}`,
            scheduledTime.toISOString(),
            req.params.id,
            bk.room_id,
          ]
        );
      }
    }

    await client.query('COMMIT');

    // WhatsApp dispatch notification (after commit, non-blocking)
    if (status === 'checked_out' && dispatchedEmployee?.phone) {
      const rmQ2 = await req.db.query('SELECT room_number FROM rooms WHERE id=$1', [bk.room_id]);
      const roomNum2 = rmQ2.rows[0]?.room_number || bk.room_id;
      sendWhatsApp(
        dispatchedEmployee.phone,
        `🏨 *Sunshine Resort — Housekeeping Task*\n\nRoom *${roomNum2}* just checked out. Please complete Room Turnaround & Cleaning and mark it ready.\n\nPriority: 🔴 Urgent`
      ).catch(() => {});
    }

    if (status === 'checked_in') {
      req.db.query(
        `SELECT b.*, g.full_name AS guest, g.email, g.phone,
                rt.name AS room, rt.code
           FROM bookings b
           JOIN guests g ON g.id = b.guest_id
           JOIN room_types rt ON rt.id = b.room_type_id
          WHERE b.id = $1 AND b.invoice_sent_at IS NULL`,
        [req.params.id]
      ).then(async r => {
        const booking = r.rows[0];
        if (!booking) return; // already sent at booking confirmation — skip
        await sendAdvanceReceiptEmail(booking).catch(err => console.error('[admin] Advance receipt on check-in failed:', err.message));
        await req.db.query('UPDATE bookings SET invoice_sent_at = now() WHERE id = $1', [req.params.id]).catch(() => {});
      }).catch(() => {});
    }

    if (status === 'cancelled') {
      req.db.query(
        `SELECT g.full_name, rt.name AS room_type_name
           FROM bookings b
           JOIN guests g ON g.id = b.guest_id
           JOIN room_types rt ON rt.id = b.room_type_id
          WHERE b.id = $1`,
        [req.params.id]
      ).then(r => sendCancellationAlert({
        tenant_id: req.tenant.id,
        bookingRef: upd.rows[0].reference,
        guestName: r.rows[0]?.full_name || 'Guest',
        roomTypeName: r.rows[0]?.room_type_name || '',
        checkIn: bk.check_in,
        checkOut: bk.check_out,
        nights: bk.nights || Math.round((new Date(bk.check_out) - new Date(bk.check_in)) / 86400000),
        cancelledBy: req.user?.username || 'staff',
        cancelledAt: new Date().toISOString(),
      })).catch(() => {});
    }

    if (status === 'checked_out') {
      req.db.query(
        `SELECT b.*, g.full_name AS guest, g.email, g.phone,
                rt.name AS room, rt.code, b.guest_id
           FROM bookings b
           JOIN guests g ON g.id = b.guest_id
           JOIN room_types rt ON rt.id = b.room_type_id
          WHERE b.id = $1`,
        [req.params.id]
      ).then(async r => {
        const booking = r.rows[0];
        if (!booking) return;
        // Send digital receipt
        sendCheckoutReceipt(booking).catch(err => console.error('[admin] Receipt email failed:', err.message));
        // Create feedback row and send feedback email
        const feedbackToken = require('crypto').randomUUID();
        const baseUrl = process.env.FEEDBACK_BASE_URL || 'http://localhost:5173/feedback';
        try {
          await req.db.query(
            `INSERT INTO guest_feedback (booking_id, guest_id, token)
             VALUES ($1, $2, $3) ON CONFLICT (token) DO NOTHING`,
            [booking.id, booking.guest_id, feedbackToken]
          );
          const feedbackUrl = `${baseUrl}/${feedbackToken}`;
          sendFeedbackEmail(booking.email, booking.guest, feedbackUrl, booking.phone, booking.reference, req.tenant.id)
            .catch(err => console.error('[admin] Feedback email failed:', err.message));
        } catch (e) {
          console.error('[admin] Feedback row insert failed:', e.message);
        }
      }).catch(() => {});
    }

    res.json({
      ...upd.rows[0],
      dispatched_employee: dispatchedEmployee
        ? `${dispatchedEmployee.first_name} ${dispatchedEmployee.last_name || ''}`.trim()
        : null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ---------------- ROOM TASKS (for Dashboard overlays) ---------------- */
// GET /api/admin/rooms/tasks  → pending/in-progress tasks grouped by room_id
router.get('/rooms/tasks', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT t.room_id, t.task_id, t.title, t.status, t.priority,
              e.first_name || ' ' || COALESCE(e.last_name,'') AS assigned_name
         FROM tasks t
         LEFT JOIN employees e ON e.first_name || ' ' || COALESCE(e.last_name,'') = t.assigned_to
        WHERE t.room_id IS NOT NULL
          AND t.status IN ('Pending','In-Progress')
        ORDER BY t.created_at DESC`
    );
    const byRoom = {};
    rows.forEach(r => {
      if (!byRoom[r.room_id]) byRoom[r.room_id] = [];
      byRoom[r.room_id].push(r);
    });
    res.json(byRoom);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- EMPLOYEE ROUTINES — My Tasks (staff) ---------------- */
// GET /api/admin/my-tasks?employee_id=  → routines assigned to employee
router.get('/my-tasks', async (req, res) => {
  const empId = req.query.employee_id || req.user?.employee_id;
  if (!empId) return res.status(400).json({ error: 'employee_id required' });
  try {
    const { rows } = await req.db.query(
      `SELECT er.routine_id, er.task_name, er.scheduled_time, er.status,
              er.photo_verification_url, er.booking_id, er.room_id,
              r.room_number, g.full_name AS guest_name
         FROM employee_routines er
         LEFT JOIN rooms r   ON r.id = er.room_id
         LEFT JOIN bookings b ON b.id = er.booking_id
         LEFT JOIN guests g   ON g.id = b.guest_id
        WHERE er.employee_id = $1
          AND er.scheduled_time::date >= CURRENT_DATE - INTERVAL '1 day'
        ORDER BY er.scheduled_time DESC`,
      [empId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/my-tasks/:id/complete  { photo_url? }
router.patch('/my-tasks/:id/complete', async (req, res) => {
  const { photo_url } = req.body || {};
  try {
    const { rows } = await req.db.query(
      `UPDATE employee_routines
          SET status = 'Verified', completed_at = now(), photo_verification_url = COALESCE($1, photo_verification_url)
        WHERE routine_id = $2 AND tenant_id = $3
        RETURNING routine_id, status, room_id`,
      [photo_url || null, req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    // Mark room back to available when housekeeping completes
    if (rows[0].room_id) {
      await req.db.query(
        `UPDATE tasks SET status = 'Completed', completed_at = now()
          WHERE room_id = $1 AND status IN ('Pending','In-Progress')`,
        [rows[0].room_id]
      );
      await req.db.query('UPDATE rooms SET status = $1 WHERE id = $2', ['available', rows[0].room_id]);
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- DISPUTE PACKAGE PDF ---------------- */
// GET /api/admin/bookings/:id/dispute-package  → PDF download
router.get('/bookings/:id/dispute-package', requireOwner, async (req, res) => {
  try {
    const bkQ = await req.db.query(
      `SELECT b.*, g.full_name, g.phone, g.email, g.kyc_type, g.kyc_number,
              g.addr1, g.addr2, g.state, g.pincode,
              rt.name AS room_type, rm.room_number,
              er.photo_verification_url AS cleaning_photo, er.completed_at AS cleaned_at
         FROM bookings b
         JOIN guests g     ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
         LEFT JOIN rooms rm ON rm.id = b.room_id
         LEFT JOIN employee_routines er ON er.booking_id = b.id AND er.status = 'Verified'
        WHERE b.id = $1 AND b.tenant_id = $2
        ORDER BY er.completed_at DESC
        LIMIT 1`,
      [req.params.id, req.tenant.id]
    );
    if (!bkQ.rows[0]) return res.status(404).json({ error: 'Booking not found' });
    const bk = bkQ.rows[0];

    const ptQ = await req.db.query(
      `SELECT amount, gst_amount, payment_method, gateway_reference_token, status, created_at
         FROM payment_transactions WHERE booking_id=$1 ORDER BY created_at`,
      [req.params.id]
    );

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DisputePackage-${bk.reference}.pdf"`);
    doc.pipe(res);

    doc.fontSize(20).font('Helvetica-Bold').text('Chargeback Dispute Evidence Package', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica').text(`Booking Reference: ${bk.reference}   |   Generated: ${new Date().toLocaleString('en-IN')}`, { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(13).font('Helvetica-Bold').text('1. Guest Identity (KYC)');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${bk.full_name}`);
    doc.text(`Phone: ${bk.phone || '-'}   Email: ${bk.email || '-'}`);
    doc.text(`Address: ${[bk.addr1, bk.addr2, bk.state, bk.pincode].filter(Boolean).join(', ') || '-'}`);
    doc.text(`ID Type: ${bk.kyc_type || '-'}   ID Number: ${bk.kyc_number ? '****' + bk.kyc_number.slice(-4) : '-'}`);
    doc.text(`Check-In Recorded: ${bk.created_at ? new Date(bk.created_at).toLocaleString('en-IN') : '-'}`);
    doc.moveDown(1);

    doc.fontSize(13).font('Helvetica-Bold').text('2. Booking Ledger');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Room: ${bk.room_type}${bk.room_number ? ' (Room ' + bk.room_number + ')' : ''}`);
    doc.text(`Stay: ${bk.check_in ? new Date(bk.check_in).toLocaleDateString('en-IN') : '?'} to ${bk.check_out ? new Date(bk.check_out).toLocaleDateString('en-IN') : '?'} (${bk.nights} nights)`);
    doc.text(`Base Amount: Rs ${Number(bk.base_amount || 0).toLocaleString('en-IN')}`);
    doc.text(`GST (${Number(bk.base_amount) > 7500 ? '18' : '5'}%): Rs ${Number(bk.tax_amount || 0).toLocaleString('en-IN')}`);
    doc.text(`Total Charged: Rs ${Number(bk.total_amount || 0).toLocaleString('en-IN')}`);
    doc.text(`Payment Method: ${bk.payment_method || '-'}   Status: ${bk.status}`);
    doc.moveDown(1);

    if (ptQ.rows.length > 0) {
      doc.fontSize(13).font('Helvetica-Bold').text('3. Payment Transaction Log');
      doc.moveDown(0.3);
      ptQ.rows.forEach((tx, i) => {
        doc.fontSize(10).font('Helvetica').text(
          `[${i + 1}] ${tx.status.toUpperCase()} - Rs ${Number(tx.amount).toLocaleString('en-IN')} via ${tx.payment_method}` +
          (tx.gateway_reference_token ? `  | Token: ${tx.gateway_reference_token}` : '') +
          `  | ${new Date(tx.created_at).toLocaleString('en-IN')}`
        );
      });
      doc.moveDown(1);
    }

    doc.fontSize(13).font('Helvetica-Bold').text('4. Room Delivery Proof');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica');
    if (bk.cleaning_photo) {
      doc.text(`Turnaround Completed: ${bk.cleaned_at ? new Date(bk.cleaned_at).toLocaleString('en-IN') : 'Yes'}`);
      doc.text(`Verification Photo: ${bk.cleaning_photo}`);
    } else {
      doc.text('No photo verification on file for this booking.');
    }
    doc.moveDown(1.5);
    doc.fontSize(9).font('Helvetica').fillColor('#888888')
      .text('Auto-generated by Sunshine PMS for dispute resolution. All timestamps are IST.', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[dispute-package]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* ---------------- CALENDAR ---------------- */
// GET /api/admin/calendar?month=YYYY-MM   → occupancy per day
router.get('/calendar', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const first = month + '-01';
  try {
    const { rows } = await req.db.query(
      `SELECT stay_date,
              SUM(total_units)::int  AS total,
              SUM(booked_units)::int AS booked
         FROM inventory
        WHERE stay_date >= $1::date
          AND stay_date <  ($1::date + INTERVAL '1 month')
        GROUP BY stay_date ORDER BY stay_date`,
      [first]
    );
    res.json({ month, days: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- ROOMS ---------------- */
// GET /api/admin/rooms  â†' room types (with today's metrics) + physical rooms
router.get('/rooms', async (req, res) => {
  try {
    const types = await req.db.query(
      `SELECT rt.id, rt.code, rt.name, rt.description, rt.base_rate, rt.total_rooms,
              rt.max_occupancy, rt.amenities,
              inv.rate AS rate_today,
              (inv.total_units - inv.booked_units) AS available_today
         FROM room_types rt
         LEFT JOIN inventory inv ON inv.room_type_id = rt.id AND inv.stay_date = CURRENT_DATE
        ORDER BY rt.base_rate`
    );
    const physical = await req.db.query(
      `SELECT r.id, r.room_number, r.floor, r.status, r.maintenance_until,
              r.room_type_id, rt.name AS type
         FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
        ORDER BY r.room_number`
    );

    // Derive live occupancy from today's active bookings per room type
    const occQ = await req.db.query(
      `SELECT room_type_id,
              COUNT(*) FILTER (WHERE check_in < CURRENT_DATE)  AS stay_over,
              COUNT(*) FILTER (WHERE check_in = CURRENT_DATE)  AS checked_in_today
         FROM bookings
        WHERE status = 'checked_in'
          AND check_in  <= CURRENT_DATE
          AND check_out  > CURRENT_DATE
        GROUP BY room_type_id`
    );
    const occByType = {};
    occQ.rows.forEach(r => {
      occByType[r.room_type_id] = {
        stay_over: Number(r.stay_over),
        checked_in_today: Number(r.checked_in_today),
      };
    });

    // Assign derived statuses: physical rooms that are 'available' get annotated
    // with stay_over / occupied based on today's booking counts, in room-number order.
    const typeCounter = {};
    const rooms = physical.rows.map(r => {
      if (r.status !== 'available') return r;
      const tid = r.room_type_id;
      if (!typeCounter[tid]) typeCounter[tid] = 0;
      const occ = occByType[tid] || { stay_over: 0, checked_in_today: 0 };
      const idx = typeCounter[tid]++;
      let status = 'available';
      if (idx < occ.stay_over) status = 'stay_over';
      else if (idx < occ.stay_over + occ.checked_in_today) status = 'occupied';
      return { ...r, status };
    });

    res.json({ types: types.rows, rooms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/rooms/available?room_type_id=&check_in=&check_out=
// Physical rooms of a type that are NOT already booked (non-cancelled) on any
// night overlapping [check_in, check_out), and not in maintenance/unavailable.
router.get('/rooms/available', async (req, res) => {
  const { room_type_id, check_in, check_out } = req.query;
  if (!room_type_id || !check_in || !check_out)
    return res.status(400).json({ error: 'room_type_id, check_in and check_out are required' });
  try {
    const { rows } = await req.db.query(
      `SELECT r.id, r.room_number
         FROM rooms r
        WHERE r.room_type_id = $1
          AND r.status = 'available'
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
             WHERE b.room_id = r.id
               AND b.status <> 'cancelled'
               AND b.check_in < $3
               AND b.check_out > $2
          )
        ORDER BY r.room_number`,
      [room_type_id, check_in, check_out]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/rooms/rate/pattern  { room_type_id, from, to, slots:[{days:[0..6], rate}] }
router.post('/rooms/rate/pattern', async (req, res) => {
  const { room_type_id, from, to, slots } = req.body || {};
  if (!room_type_id || !from || !to || !Array.isArray(slots) || !slots.length)
    return res.status(400).json({ error: 'room_type_id, from, to and slots are required' });
  try {
    let totalUpdated = 0;
    const start = new Date(from); const end = new Date(to);
    for (const slot of slots) {
      if (!slot.days?.length || slot.rate == null) continue;
      const dayNums = slot.days.map(Number);
      const dates = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (dayNums.includes(d.getDay())) dates.push(d.toISOString().slice(0, 10));
      }
      if (!dates.length) continue;
      const { rowCount } = await req.db.query(
        `UPDATE inventory SET rate = $1 WHERE room_type_id = $2 AND stay_date = ANY($3::date[])`,
        [slot.rate, room_type_id, dates]
      );
      totalUpdated += rowCount;
    }
    res.json({ updated: totalUpdated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/admin/rooms/rate  { room_type_id, from, to, rate }
router.patch('/rooms/rate', async (req, res) => {
  const { room_type_id, from, to, rate } = req.body || {};
  if (!room_type_id || !from || !to || rate == null) return res.status(400).json({ error: 'room_type_id, from, to and rate are required' });
  try {
    const { rowCount } = await req.db.query(
      `UPDATE inventory SET rate = $1
        WHERE room_type_id = $2 AND stay_date >= $3 AND stay_date <= $4`,
      [rate, room_type_id, from, to]
    );
    res.json({ updated: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/rooms/:id/status  { status, maintenance_until? }
router.patch('/rooms/:id/status', async (req, res) => {
  let { status, maintenance_until } = req.body || {};
  // Accept UI display values and map to DB values
  if (status === 'vacant_clean') status = 'available';
  const allowed = ['available', 'maintenance', 'unavailable'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const until = status === 'maintenance' ? (maintenance_until || null) : null;
    const { rows } = await req.db.query(
      'UPDATE rooms SET status = $1, maintenance_until = $2 WHERE id = $3 AND tenant_id = $4 RETURNING id, room_number, status, maintenance_until',
      [status, until, req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Room not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- ROOM TYPES CRUD (owner only) ---------------- */
// POST /api/admin/room-types  { code, name, description, max_occupancy, base_rate, amenities }
router.post('/room-types', requireOwner, async (req, res) => {
  const { code, name, description, max_occupancy, base_rate, amenities } = req.body || {};
  if (!code || !name || !max_occupancy || base_rate == null)
    return res.status(400).json({ error: 'code, name, max_occupancy and base_rate are required' });
  try {
    const { rows } = await req.db.query(
      `INSERT INTO room_types (code, name, description, max_occupancy, base_rate, total_rooms, amenities)
       VALUES ($1,$2,$3,$4,$5,0,$6) RETURNING *`,
      [code, name, description || null, max_occupancy, base_rate, amenities || []]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Room type code already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/room-types/:id  { name, description, max_occupancy, base_rate, amenities }
router.put('/room-types/:id', requireOwner, async (req, res) => {
  const { name, description, max_occupancy, base_rate, amenities } = req.body || {};
  try {
    const { rows } = await req.db.query(
      `UPDATE room_types SET name=$1, description=$2, max_occupancy=$3, base_rate=$4, amenities=$5
       WHERE id=$6 AND tenant_id=$7 RETURNING *`,
      [name, description || null, max_occupancy, base_rate, amenities || [], req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Room type not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/room-types/:id  (owner only, only if no rooms attached)
router.delete('/room-types/:id', requireOwner, async (req, res) => {
  try {
    const check = await req.db.query('SELECT COUNT(*)::int AS n FROM rooms WHERE room_type_id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    if (check.rows[0].n > 0)
      return res.status(409).json({ error: 'Remove all rooms in this category first' });
    const { rowCount } = await req.db.query('DELETE FROM room_types WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'Room type not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- PHYSICAL ROOMS CRUD (owner only) ---------------- */
// POST /api/admin/rooms-physical  { room_type_id, room_number, floor }
router.post('/rooms-physical', requireOwner, async (req, res) => {
  const { room_type_id, room_number, floor } = req.body || {};
  if (!room_type_id || !room_number)
    return res.status(400).json({ error: 'room_type_id and room_number are required' });
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO rooms (room_type_id, room_number, floor, status)
       VALUES ($1,$2,$3,'available') RETURNING *`,
      [room_type_id, room_number, floor || null]
    );
    await client.query(
      'UPDATE room_types SET total_rooms = total_rooms + 1 WHERE id = $1',
      [room_type_id]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Room number already exists' });
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// DELETE /api/admin/rooms-physical/:id  (owner only)
router.delete('/rooms-physical/:id', requireOwner, async (req, res) => {
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM rooms WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.tenant.id]);
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Room not found' }); }
    const activeBookings = await client.query(
      `SELECT 1 FROM bookings WHERE room_id=$1 AND status IN ('confirmed','checked_in') LIMIT 1`,
      [req.params.id]
    );
    if (activeBookings.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Room has active bookings — cannot delete' });
    }
    await client.query('DELETE FROM rooms WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    await client.query(
      'UPDATE room_types SET total_rooms = GREATEST(total_rooms - 1, 0) WHERE id = $1',
      [cur.rows[0].room_type_id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

/* ---------------- GUESTS / CUSTOMERS ---------------- */
// GET /api/admin/guests
router.get('/guests', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT g.id, g.full_name, g.email, g.phone, g.address,
              g.addr1, g.addr2, g.state, g.pincode,
              g.kyc_type, g.kyc_number, g.created_at,
              COUNT(b.id)::int AS stays,
              MAX(b.check_out) AS last_stay,
              COALESCE(SUM(b.total_amount) FILTER (WHERE b.status <> 'cancelled'),0) AS lifetime_value
         FROM guests g
         LEFT JOIN bookings b ON b.guest_id = g.id
        GROUP BY g.id ORDER BY g.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/guests/by-kyc?kyc_number=XXX — find a guest by KYC number
router.get('/guests/by-kyc', async (req, res) => {
  const { kyc_number } = req.query;
  if (!kyc_number) return res.status(400).json({ error: 'kyc_number is required' });
  try {
    const { rows } = await req.db.query(
      `SELECT g.id, g.full_name, g.email, g.phone, g.address,
              g.addr1, g.addr2, g.state, g.pincode,
              g.kyc_type, g.kyc_number,
              COUNT(b.id)::int AS stays,
              MAX(b.check_out) AS last_stay,
              COALESCE(SUM(b.total_amount) FILTER (WHERE b.status <> 'cancelled'),0) AS lifetime_value
         FROM guests g
         LEFT JOIN bookings b ON b.guest_id = g.id
        WHERE UPPER(REPLACE(g.kyc_number,' ','')) = UPPER(REPLACE($1,' ',''))
        GROUP BY g.id
        LIMIT 1`,
      [kyc_number]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No guest found with that KYC number' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- EXPENSES ---------------- */
// GET /api/admin/expenses
router.get('/expenses', async (req, res) => {
  try {
    const { rows } = await req.db.query('SELECT * FROM expenses ORDER BY spent_on DESC, id DESC LIMIT 200');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/expenses  (owner only) — delete ALL expenses
router.delete('/expenses', requireOwner, async (req, res) => {
  try {
    await req.db.query('DELETE FROM expenses WHERE tenant_id=$1', [req.tenant.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/admin/expenses/:id  (owner only)
router.delete('/expenses/:id', requireOwner, async (req, res) => {
  try {
    const { rowCount } = await req.db.query('DELETE FROM expenses WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'Expense not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/expenses  { category, description, amount, spent_on }
router.post('/expenses', async (req, res) => {
  const { category, description, amount, spent_on } = req.body || {};
  if (!category || amount == null) return res.status(400).json({ error: 'category and amount are required' });
  try {
    const { rows } = await req.db.query(
      `INSERT INTO expenses (category, description, amount, spent_on)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE)) RETURNING *`,
      [category, description || null, amount, spent_on || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- STAFF USERS (admin only) ---------------- */
// GET /api/admin/users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      'SELECT id, username, full_name, role, is_blocked, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:id/block  { is_blocked }  (owner only)
router.patch('/users/:id/block', requireOwner, async (req, res) => {
  const { is_blocked } = req.body || {};
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot block yourself' });
  try {
    const { rows } = await req.db.query(
      'UPDATE users SET is_blocked=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id, username, is_blocked',
      [!!is_blocked, req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/admin/users/:id  (owner only)
router.delete('/users/:id', requireOwner, async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    const { rowCount } = await req.db.query('DELETE FROM users WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/users  { username, full_name, password, role }
router.post('/users', requireAdmin, async (req, res) => {
  const { username, full_name, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await req.db.query(
      `INSERT INTO users (username, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role`,
      [username, full_name || null, hash, role || 'staff']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    res.status(500).json({ error: err.message });
  }
});


/* ---------- CONFLICT CHECK (advisory, read-only) ---------- */
// POST /api/admin/bookings/check-conflict
router.post('/bookings/check-conflict', async (req, res) => {
  const { room_type_id, check_in, check_out } = req.body || {};
  if (!room_type_id || !check_in || !check_out)
    return res.status(400).json({ error: 'room_type_id, check_in and check_out are required' });
  try {
    const { rows } = await req.db.query(
      `SELECT stay_date, total_units, booked_units, is_closed
         FROM inventory
        WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3
          AND (is_closed = true OR booked_units >= total_units)
        ORDER BY stay_date`,
      [room_type_id, check_in, check_out]
    );
    res.json({ conflicts: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- CONFLICT LOG (last 10 overbooking attempts) ---------- */
// GET /api/admin/conflict-log
router.get('/conflict-log', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, guest_name AS triggered_by, message, status, sent_at
         FROM notification_logs
        WHERE type = 'overbooking_attempt'
        ORDER BY sent_at DESC LIMIT 10`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- CREATE BOOKING (front desk / walk-in) ---------- */
// POST /api/admin/bookings/new
// Body: { guest_id?, guest:{full_name,phone,email,address}?, room_type_id, room_id, check_in,
//         check_out, num_guests, advance_paid, tax_percentage, status }
router.post('/bookings/new', async (req, res) => {
  const b = req.body || {};
  const { room_type_id, check_in, check_out, room_id } = b;
  if (!room_type_id || !check_in || !check_out || !room_id)
    return res.status(400).json({ error: 'room_type_id, room_id, check_in and check_out are required' });

  const nights = Math.round((new Date(check_out) - new Date(check_in)) / 86400000);
  if (!(nights > 0)) return res.status(400).json({ error: 'check_out must be after check_in' });

  const client = await req.db.connect();
  try {
    await client.query('BEGIN');

    // Resolve guest: use existing id, or create a new guest.
    let guestId = b.guest_id;
    if (!guestId) {
      const g = b.guest || {};
      if (!g.full_name) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Guest name is required' }); }
      const gr = await client.query(
        `INSERT INTO guests (full_name, phone, email, addr1, addr2, state, pincode)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [g.full_name, g.phone || null, g.email || null,
         g.addr1 || null, g.addr2 || null, g.state || null, g.pincode || null]
      );
      guestId = gr.rows[0].id;
    }

    // Lock & verify the nights.
    const inv = await client.query(
      `SELECT total_units, booked_units, is_closed, rate FROM inventory
        WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3 FOR UPDATE`,
      [room_type_id, check_in, check_out]
    );
    if (inv.rows.length !== nights) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'NO_INVENTORY' }); }
    if (inv.rows.some(r => r.is_closed || r.booked_units >= r.total_units)) {
      await client.query('ROLLBACK');
      sendOverbookingAlert({ tenantId: req.tenant.id, roomTypeId: room_type_id, checkIn: check_in, checkOut: check_out, triggeredBy: req.user?.username || 'staff' }).catch(() => {});
      return res.status(409).json({ error: 'NO_AVAILABILITY', message: 'Sold out for those dates.' });
    }

    // If a specific room number was chosen, re-verify (under lock) that it
    // belongs to this room type and isn't already booked for these dates.
    let roomId = b.room_id ? Number(b.room_id) : null;
    if (roomId) {
      const roomCheck = await client.query(
        `SELECT r.id FROM rooms r
          WHERE r.id = $1 AND r.room_type_id = $2 AND r.status = 'available'
            AND NOT EXISTS (
              SELECT 1 FROM bookings bk
               WHERE bk.room_id = r.id AND bk.status <> 'cancelled'
                 AND bk.check_in < $4 AND bk.check_out > $3
            )
          FOR UPDATE OF r`,
        [roomId, room_type_id, check_in, check_out]
      );
      if (!roomCheck.rows[0]) {
        await client.query('ROLLBACK');
        sendOverbookingAlert({ tenantId: req.tenant.id, roomTypeId: room_type_id, checkIn: check_in, checkOut: check_out, triggeredBy: req.user?.username || 'staff' }).catch(() => {});
        return res.status(409).json({ error: 'ROOM_TAKEN', message: 'That room is already booked for those dates.' });
      }
    }

    const baseAmount = inv.rows.reduce((s, r) => s + Number(r.rate), 0);
    const taxPct = Number(b.tax_percentage || 0);
    const taxAmount = Math.round(baseAmount * taxPct) / 100;
    const totalAmount = baseAmount + taxAmount;
    const advance = Number(b.advance_paid || 0);
    const pending = Math.max(totalAmount - advance, 0);
    const payStatus = advance <= 0 ? 'pending' : (pending <= 0 ? 'paid' : 'partial');

    await client.query(
      `UPDATE inventory SET booked_units = booked_units + 1
        WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3`,
      [room_type_id, check_in, check_out]
    );

    const reference = 'AZ-' + new Date().getFullYear() + '-' +
      Math.floor(Math.random() * 1e6).toString().padStart(6, '0');

    const r = await client.query(
      `INSERT INTO bookings
        (reference, guest_id, room_type_id, room_id, check_in, check_out, num_guests, nights,
         base_amount, tax_amount, total_amount, advance_paid, pending_amount, payment_status, payment_method, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'walk_in')
       RETURNING id, reference`,
      [reference, guestId, room_type_id, roomId, check_in, check_out, b.num_guests || 2, nights,
       baseAmount, taxAmount, totalAmount, advance, pending, payStatus, b.payment_method || 'cash', b.status || 'confirmed']
    );

    await client.query('COMMIT');

    // Return full detail for the receipt.
    const full = await req.db.query(
      `SELECT b.*, g.full_name AS guest, g.phone, g.email, g.address,
              rt.name AS room, rt.code, rm.room_number
         FROM bookings b
         JOIN guests g ON g.id=b.guest_id
         JOIN room_types rt ON rt.id=b.room_type_id
         LEFT JOIN rooms rm ON rm.id=b.room_id
        WHERE b.id=$1`, [r.rows[0].id]
    );
    // Fire notifications without blocking the response
    sendBookingNotifications(full.rows[0]).catch(() => {});
    // Send advance receipt PDF immediately on booking confirmation (covers both confirmed & walk-in check-in)
    sendAdvanceReceiptEmail(full.rows[0], { skipWa: true }).catch(err => console.error('[admin] Advance receipt on booking failed:', err.message));
    req.db.query('UPDATE bookings SET invoice_sent_at = now() WHERE id = $1', [r.rows[0].id]).catch(() => {});

    res.status(201).json({ ok: true, booking: full.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/bookings/new]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ---------- GET ONE BOOKING ---------- */
router.get('/bookings/:id', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.*, g.full_name AS guest, g.phone, g.email, g.address,
              g.addr1, g.addr2, g.state, g.pincode,
              rt.name AS room, rt.code, rt.id AS room_type_id, rm.room_number
         FROM bookings b
         JOIN guests g ON g.id=b.guest_id
         JOIN room_types rt ON rt.id=b.room_type_id
         LEFT JOIN rooms rm ON rm.id=b.room_id
        WHERE b.id=$1 AND b.tenant_id=$2`, [req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------- DELETE ALL BOOKINGS (owner only) ---------- */
router.delete('/bookings', requireOwner, async (req, res) => {
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    // Release inventory for all non-cancelled bookings
    await client.query(`
      UPDATE inventory i
      SET booked_units = GREATEST(i.booked_units - sub.cnt, 0)
      FROM (
        SELECT room_type_id, stay_date::date AS d, COUNT(*) AS cnt
        FROM bookings b, generate_series(b.check_in, b.check_out - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
        WHERE b.status != 'cancelled'
        GROUP BY room_type_id, stay_date::date
      ) sub
      WHERE i.room_type_id = sub.room_type_id AND i.stay_date = sub.d
    `);
    await client.query('DELETE FROM bookings WHERE tenant_id=$1', [req.tenant.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

/* ---------- DELETE BOOKING (owner only) ---------- */
router.delete('/bookings/:id', requireOwner, async (req, res) => {
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM bookings WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.tenant.id]);
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    const bk = cur.rows[0];
    if (bk.status !== 'cancelled') {
      await client.query(
        `UPDATE inventory SET booked_units = GREATEST(booked_units - 1, 0)
          WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3`,
        [bk.room_type_id, bk.check_in, bk.check_out]
      );
    }
    await client.query('DELETE FROM bookings WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

/* ---------- EDIT BOOKING (dates, payment, status) ---------- */
// PUT /api/admin/bookings/:id  { check_in, check_out, additional_payment, tax_percentage, status }
router.put('/bookings/:id', async (req, res) => {
  const body = req.body || {};
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM bookings WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.tenant.id]);
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    const bk = cur.rows[0];

    const newIn  = body.check_in  || bk.check_in.toISOString().slice(0,10);
    const newOut = body.check_out || bk.check_out.toISOString().slice(0,10);
    const oldIn  = bk.check_in.toISOString().slice(0,10);
    const oldOut = bk.check_out.toISOString().slice(0,10);
    const datesChanged = newIn !== oldIn || newOut !== oldOut;
    const nights = Math.round((new Date(newOut) - new Date(newIn)) / 86400000);
    if (!(nights > 0)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'check_out must be after check_in' }); }

    let baseAmount = Number(bk.base_amount) || Number(bk.total_amount);

    if (datesChanged && bk.status !== 'cancelled') {
      // release old nights
      await client.query(
        `UPDATE inventory SET booked_units = GREATEST(booked_units-1,0)
          WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3`,
        [bk.room_type_id, oldIn, oldOut]
      );
      // lock & verify new nights
      const inv = await client.query(
        `SELECT total_units, booked_units, is_closed, rate FROM inventory
          WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3 FOR UPDATE`,
        [bk.room_type_id, newIn, newOut]
      );
      if (inv.rows.length !== nights || inv.rows.some(r=>r.is_closed || r.booked_units>=r.total_units)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'NO_AVAILABILITY', message: 'New dates are not available.' });
      }
      if (bk.room_id) {
        const roomCheck = await client.query(
          `SELECT 1 FROM bookings bk
            WHERE bk.room_id = $1 AND bk.id <> $2 AND bk.status <> 'cancelled'
              AND bk.check_in < $4 AND bk.check_out > $3`,
          [bk.room_id, bk.id, newIn, newOut]
        );
        if (roomCheck.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'ROOM_TAKEN', message: 'This room is already booked for the new dates.' });
        }
      }
      await client.query(
        `UPDATE inventory SET booked_units = booked_units+1
          WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3`,
        [bk.room_type_id, newIn, newOut]
      );
      baseAmount = inv.rows.reduce((s,r)=>s+Number(r.rate),0);
    }

    const taxPct = body.tax_percentage != null ? Number(body.tax_percentage)
                  : (Number(bk.base_amount) ? Math.round(Number(bk.tax_amount)/Number(bk.base_amount)*100) : 0);
    const taxAmount = Math.round(baseAmount * taxPct) / 100;
    const totalAmount = baseAmount + taxAmount;
    const advance = Number(bk.advance_paid) + Number(body.additional_payment || 0);
    const pending = Math.max(totalAmount - advance, 0);
    const payStatus = advance <= 0 ? 'pending' : (pending <= 0 ? 'paid' : 'partial');
    const status = body.status || bk.status;
    const paymentMethod = body.payment_method || bk.payment_method;

    const upd = await client.query(
      `UPDATE bookings SET check_in=$1, check_out=$2, nights=$3, base_amount=$4, tax_amount=$5,
              total_amount=$6, advance_paid=$7, pending_amount=$8, payment_status=$9, payment_method=$10, status=$11
        WHERE id=$12
        RETURNING id, reference, status, total_amount, advance_paid, pending_amount, payment_status, payment_method`,
      [newIn, newOut, nights, baseAmount, taxAmount, totalAmount, advance, pending, payStatus, paymentMethod, status, req.params.id]
    );
    await client.query('COMMIT');

    if (Number(body.additional_payment) > 0) {
      req.db.query(
        `SELECT g.full_name, g.phone FROM bookings b JOIN guests g ON g.id = b.guest_id WHERE b.id = $1`,
        [req.params.id]
      ).then(r => sendBalancePaymentAlert({
        tenant_id: req.tenant.id,
        bookingRef: upd.rows[0].reference,
        guestName: r.rows[0]?.full_name || 'Guest',
        amountCollected: Number(body.additional_payment),
        paymentMethod,
        newPaymentStatus: payStatus,
        pendingAmount: pending,
        collectedBy: req.user?.username || 'staff',
        guestPhone: r.rows[0]?.phone,
      })).catch(() => {});
    }

    res.json(upd.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/bookings PUT]', err.message);
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

/* ---------- CREATE / EDIT GUEST ---------- */
router.post('/guests', async (req, res) => {
  const g = req.body || {};
  if (!g.full_name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await req.db.query(
      `INSERT INTO guests (full_name, phone, email, address, addr1, addr2, state, pincode, kyc_type, kyc_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [g.full_name, g.phone || null, g.email || null, g.address || null,
       g.addr1 || null, g.addr2 || null, g.state || null, g.pincode || null,
       g.kyc_type || null, g.kyc_number || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/guests/:id', requireOwner, async (req, res) => {
  try {
    const { rows: bookings } = await req.db.query(
      'SELECT id FROM bookings WHERE guest_id=$1 AND tenant_id=$2 LIMIT 1', [req.params.id, req.tenant.id]
    );
    if (bookings.length > 0) {
      return res.status(409).json({ error: 'Cannot delete a guest who has bookings. Remove their bookings first.' });
    }
    const { rowCount } = await req.db.query('DELETE FROM guests WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!rowCount) return res.status(404).json({ error: 'Guest not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/guests/:id/bookings', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.id, b.reference, b.check_in, b.check_out, b.num_guests,
              b.total_amount, b.status, b.created_at,
              rt.name AS room_type, r.room_number
         FROM bookings b
         LEFT JOIN room_types rt ON rt.id = b.room_type_id
         LEFT JOIN rooms r ON r.id = b.room_id
        WHERE b.guest_id = $1 AND b.tenant_id = $2
        ORDER BY b.check_in DESC`,
      [req.params.id, req.tenant.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/guests/:id', async (req, res) => {
  const g = req.body || {};
  try {
    const { rows } = await req.db.query(
      `UPDATE guests SET full_name=$1, phone=$2, email=$3, address=$4,
              addr1=$5, addr2=$6, state=$7, pincode=$8,
              kyc_type=$9, kyc_number=$10
        WHERE id=$11 AND tenant_id=$12 RETURNING *`,
      [g.full_name, g.phone || null, g.email || null, g.address || null,
       g.addr1 || null, g.addr2 || null, g.state || null, g.pincode || null,
       g.kyc_type || null, g.kyc_number || null,
       req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Guest not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


/* ---------------- EMPLOYEES ---------------- */
router.get('/employees', async (req, res) => {
  try {
    const { rows } = await req.db.query('SELECT * FROM employees ORDER BY first_name, last_name');
    // Normalise: ensure every row has a `roles` array
    rows.forEach(r => {
      if (!r.roles || r.roles.length === 0) r.roles = [r.role || 'Front Desk'];
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/employees', async (req, res) => {
  const { first_name, last_name, roles, role, phone, is_active } = req.body || {};
  if (!first_name) return res.status(400).json({ error: 'first_name is required' });
  const rolesArr = Array.isArray(roles) && roles.length > 0 ? roles : [role || 'Front Desk'];
  try {
    const { rows } = await req.db.query(
      `INSERT INTO employees (first_name, last_name, role, roles, phone, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [first_name, last_name || null, rolesArr[0], rolesArr, phone || null, is_active !== false]
    );
    const row = rows[0];
    if (!row.roles || row.roles.length === 0) row.roles = [row.role];
    res.status(201).json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/employees/:id', async (req, res) => {
  const { first_name, last_name, roles, role, phone, is_active } = req.body || {};
  const rolesArr = Array.isArray(roles) && roles.length > 0 ? roles : [role || 'Front Desk'];
  try {
    const { rows } = await req.db.query(
      `UPDATE employees SET first_name=$1, last_name=$2, role=$3, roles=$4, phone=$5, is_active=$6
       WHERE employee_id=$7 AND tenant_id=$8 RETURNING *`,
      [first_name, last_name || null, rolesArr[0], rolesArr, phone || null, is_active !== false, req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
    const row = rows[0];
    if (!row.roles || row.roles.length === 0) row.roles = [row.role];
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/employees/:id', requireOwner, async (req, res) => {
  try {
    const { rows } = await req.db.query('DELETE FROM employees WHERE employee_id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, req.tenant.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Set or update portal login credentials for an employee (owner/manager only)
router.put('/employees/:id/credentials', requireAdmin, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { username, password } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username is required' });
  try {
    const updates = { username };
    if (password) {
      updates.password_hash = await bcrypt.hash(password, 10);
    }
    const { rows } = await req.db.query(
      `UPDATE employees SET username=$1 ${password ? ', password_hash=$4' : ''}
         WHERE employee_id=$2 AND tenant_id=$3 RETURNING employee_id, username`,
      password
        ? [username, req.params.id, req.tenant.id, updates.password_hash]
        : [username, req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
    res.json({ ok: true, username: rows[0].username });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- SHIFTS ---------------- */
router.get('/shifts', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT s.shift_id AS id, s.employee_id, s.shift_date, s.start_time, s.end_time, s.created_at,
              e.first_name, e.last_name, e.role
         FROM shift_schedules s JOIN employees e ON e.employee_id = s.employee_id
        WHERE s.shift_date >= CURRENT_DATE - 3 AND s.shift_date <= CURRENT_DATE + 4
        ORDER BY s.shift_date, s.start_time`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/shifts', async (req, res) => {
  const { employee_id, shift_date, start_time, end_time } = req.body || {};
  if (!employee_id || !shift_date) return res.status(400).json({ error: 'employee_id and shift_date are required' });
  if (!start_time || !end_time) return res.status(400).json({ error: 'start_time and end_time are required' });
  try {
    const { rows } = await req.db.query(
      `INSERT INTO shift_schedules (employee_id, shift_date, start_time, end_time)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
       RETURNING *`,
      [employee_id, shift_date, start_time, end_time]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/shifts', async (req, res) => {
  const { employee_id, shift_date } = req.body || {};
  if (!employee_id || !shift_date) return res.status(400).json({ error: 'employee_id and shift_date are required' });
  try {
    await req.db.query(
      `DELETE FROM shift_schedules WHERE employee_id=$1 AND shift_date=$2`,
      [employee_id, shift_date]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- SHIFT MASTER ---------------- */
// GET /api/admin/shift-master — list all employees with their default shift times
router.get('/shift-master', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT employee_id, first_name, last_name, role, phone, is_active,
              default_start_time, default_end_time
         FROM employees ORDER BY first_name, last_name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/admin/shift-master/:id — update default shift times (owner only)
router.put('/shift-master/:id', requireOwner, async (req, res) => {
  const { default_start_time, default_end_time } = req.body || {};
  try {
    const { rows } = await req.db.query(
      `UPDATE employees SET default_start_time=$1, default_end_time=$2
         WHERE employee_id=$3 AND tenant_id=$4
       RETURNING employee_id, first_name, last_name, default_start_time, default_end_time`,
      [default_start_time || null, default_end_time || null, req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- TASKS ---------------- */
router.get('/tasks', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT t.*,
              CASE WHEN e.employee_id IS NOT NULL
                   THEN e.first_name || ' ' || COALESCE(e.last_name, '')
                   ELSE NULL END AS assigned_name
         FROM tasks t
         LEFT JOIN employees e ON e.employee_id = t.assigned_to::integer
        ORDER BY t.due_at ASC NULLS LAST, t.task_id DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tasks', async (req, res) => {
  const { title, description, assigned_to, priority, status, due_at, photo_required } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    const { rows } = await req.db.query(
      `INSERT INTO tasks (title, description, assigned_to, priority, status, due_at, photo_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, description || null, assigned_to || null, priority || 'Medium', status || 'Pending', due_at || null, photo_required ?? false]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tasks/:id', async (req, res) => {
  const body = req.body || {};
  const has = (k) => k in body;
  const { title, description, assigned_to, priority, status, due_at, photo_verification_url, photo_required } = body;
  try {
    // Enforce photo requirement when completing
    if (has('status') && status === 'Completed') {
      const { rows: tr } = await req.db.query('SELECT photo_required FROM tasks WHERE task_id=$1', [req.params.id]);
      if (tr[0]?.photo_required && !photo_verification_url) {
        return res.status(400).json({ error: 'Photo evidence is required to complete this task.' });
      }
    }
    const { rows } = await req.db.query(
      `UPDATE tasks SET
         title                  = CASE WHEN $1::boolean THEN $2 ELSE title END,
         description            = CASE WHEN $3::boolean THEN $4 ELSE description END,
         assigned_to            = CASE WHEN $5::boolean THEN NULLIF($6, '')::integer ELSE assigned_to END,
         priority               = CASE WHEN $7::boolean THEN $8 ELSE priority END,
         status                 = CASE WHEN $9::boolean THEN $10 ELSE status END,
         due_at                 = CASE WHEN $11::boolean THEN $12::timestamptz ELSE due_at END,
         completed_at           = CASE WHEN $9::boolean AND $10 = 'Completed' THEN now()
                                       WHEN $9::boolean AND $10 != 'Completed' THEN NULL
                                       ELSE completed_at END,
         photo_verification_url = CASE WHEN $13::boolean THEN $14 ELSE photo_verification_url END,
         photo_required         = CASE WHEN $16::boolean THEN $17 ELSE photo_required END
       WHERE task_id = $15 AND tenant_id = $18 RETURNING *`,
      [
        has('title'),                    title                    || null,
        has('description'),              description              || null,
        has('assigned_to'),              assigned_to != null ? String(assigned_to) : '',
        has('priority'),                 priority                 || null,
        has('status'),                   status                   || null,
        has('due_at'),                   due_at                   || null,
        has('photo_verification_url'),   photo_verification_url   || null,
        req.params.id,
        has('photo_required'),           photo_required ?? false,
        req.tenant.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });

    // Case 5: unlock room when linked task is marked Completed
    if (rows[0].status === 'Completed' && rows[0].room_id) {
      await req.db.query(
        'UPDATE rooms SET status = $1, maintenance_until = NULL WHERE id = $2',
        ['available', rows[0].room_id]
      );
    }

    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- ROUTINES ---------------- */
router.delete('/tasks/:id', requireOwner, async (req, res) => {
  try {
    const { rows } = await req.db.query('DELETE FROM tasks WHERE task_id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, req.tenant.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/routines', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT r.*,
              e.first_name || ' ' || COALESCE(e.last_name, '') AS employee_name
         FROM employee_routines r
         JOIN employees e ON e.employee_id = r.employee_id
        ORDER BY r.scheduled_time DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/routines', async (req, res) => {
  const { employee_id, task_name, scheduled_time, photo_required } = req.body || {};
  if (!employee_id || !task_name || !scheduled_time)
    return res.status(400).json({ error: 'employee_id, task_name and scheduled_time are required' });
  try {
    const { rows } = await req.db.query(
      `INSERT INTO employee_routines (employee_id, task_name, scheduled_time, photo_required)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [employee_id, task_name, scheduled_time, photo_required ?? false]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/routines/:id', requireOwner, async (req, res) => {
  const { employee_id, task_name, scheduled_time, photo_required } = req.body || {};
  if (!employee_id || !task_name || !scheduled_time)
    return res.status(400).json({ error: 'employee_id, task_name and scheduled_time are required' });
  try {
    const { rows } = await req.db.query(
      `UPDATE employee_routines
          SET employee_id = $1, task_name = $2, scheduled_time = $3,
              photo_required = COALESCE($5, photo_required)
        WHERE routine_id = $4 AND tenant_id = $6
        RETURNING *`,
      [employee_id, task_name, scheduled_time, req.params.id, photo_required ?? null, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Routine not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/routines/:id', requireOwner, async (req, res) => {
  try {
    const { rows } = await req.db.query('DELETE FROM employee_routines WHERE routine_id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, req.tenant.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Routine not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/routines/:id/complete', uploadPhoto.single('photo'), async (req, res) => {
  let photoUrl = null;
  if (req.file) {
    photoUrl = `/uploads/${req.tenant.id}/routines/${req.file.filename}`;
  } else if (req.body && req.body.photo_verification_url) {
    photoUrl = req.body.photo_verification_url;
  }
  try {
    const { rows: rr } = await req.db.query(
      'SELECT photo_required FROM employee_routines WHERE routine_id=$1 AND tenant_id=$2',
      [req.params.id, req.tenant.id]
    );
    if (!rr[0]) return res.status(404).json({ error: 'Routine not found' });
    if (rr[0].photo_required && !photoUrl) {
      return res.status(400).json({ error: 'Photo evidence is required to complete this routine.' });
    }
    const { rows } = await req.db.query(
      `UPDATE employee_routines
          SET status = CASE
                WHEN started_at IS NOT NULL
                     AND EXTRACT(EPOCH FROM (now() - started_at)) / 60 < 15
                THEN 'Flagged'
                ELSE 'Verified'
              END,
              completed_at           = now(),
              photo_verification_url = $1
        WHERE routine_id = $2 AND tenant_id = $3
        RETURNING *`,
      [photoUrl, req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Routine not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- OPERATIONS LOG ---------------- */
const opsPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', String(req.tenant.id), 'operations');
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `ops_${Date.now()}_${safe}`);
  },
});
const uploadOpsPhoto = multer({ storage: opsPhotoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/operations', uploadOpsPhoto.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A photo is required to complete a task or routine.' });
  const { frequency, task_category, task_name, status, metric_data } = req.body || {};
  if (!frequency || !task_name) return res.status(400).json({ error: 'frequency and task_name are required' });
  try {
    const photoPath = `/uploads/${req.tenant.id}/operations/${req.file.filename}`;
    const { rows } = await req.db.query(
      `INSERT INTO operations_log (frequency, task_category, task_name, status, metric_data, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [frequency, task_category || 'General', task_name, status || 'Completed',
       metric_data ? JSON.stringify(JSON.parse(metric_data)) : null, photoPath]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- DAILY PAYMENTS ---------------- */
// GET /api/admin/daily-payments?date=YYYY-MM-DD
router.get('/daily-payments', requireAdmin, async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await req.db.query(
      `SELECT b.id, b.reference, b.check_in, b.check_out, b.nights, b.num_guests,
              b.base_amount, b.tax_amount, b.total_amount, b.advance_paid, b.pending_amount,
              b.payment_status, b.payment_method, b.status, b.source, b.created_at,
              b.owner_payment_verified, b.invoice_sent_at, b.balance_paid_at,
              b.refund_amount, b.refund_status, b.refund_reason, b.refund_method,
              b.refund_processed_at, b.actual_checkout, b.actual_nights,
              CASE
                WHEN DATE(b.refund_processed_at AT TIME ZONE 'Asia/Kolkata') = $1 THEN 'refund'
                WHEN DATE(b.balance_paid_at AT TIME ZONE 'Asia/Kolkata') = $1 THEN 'balance'
                ELSE 'new'
              END AS payment_entry_type,
              g.full_name AS guest, g.email, g.phone,
              rt.name AS room, rm.room_number
         FROM bookings b
         JOIN guests g      ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
         LEFT JOIN rooms rm ON rm.id = b.room_id
        WHERE DATE(b.created_at AT TIME ZONE 'Asia/Kolkata') = $1
           OR DATE(b.balance_paid_at AT TIME ZONE 'Asia/Kolkata') = $1
           OR DATE(b.refund_processed_at AT TIME ZONE 'Asia/Kolkata') = $1
        ORDER BY GREATEST(b.created_at, COALESCE(b.balance_paid_at, b.refund_processed_at, b.created_at)) DESC`,
      [date]
    );
    res.json(rows);
  } catch (err) {
    console.error('[admin/daily-payments]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/bookings/:id/mark-balance-paid  — record remaining balance as collected
router.patch('/bookings/:id/mark-balance-paid', requireAdmin, async (req, res) => {
  try {
    // Fetch full booking details before updating so we have the original pending_amount
    const before = await req.db.query(
      `SELECT b.*, g.full_name AS guest, g.phone, g.email,
              rt.name AS room, rm.room_number
         FROM bookings b
         JOIN guests g      ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
         LEFT JOIN rooms rm ON rm.id = b.room_id
        WHERE b.id = $1 AND b.tenant_id = $2 AND b.pending_amount > 0`,
      [req.params.id, req.tenant.id]
    );
    if (!before.rows[0]) return res.status(404).json({ error: 'Booking not found or balance already cleared' });
    const booking = before.rows[0];
    const amountCollected = Number(booking.pending_amount);

    const { rows } = await req.db.query(
      `UPDATE bookings
          SET advance_paid    = total_amount,
              pending_amount  = 0,
              payment_status  = 'paid',
              balance_paid_at = now(),
              invoice_sent_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING id, reference, advance_paid, pending_amount, payment_status, balance_paid_at`,
      [req.params.id, req.tenant.id]
    );

    res.json(rows[0]);

    // Send invoice to guest and alert owner in background
    const updatedBooking = { ...booking, advance_paid: booking.total_amount, pending_amount: 0 };
    const collectedBy = req.user?.name || req.user?.email || 'Staff';

    sendInvoiceEmail(updatedBooking).catch(err =>
      console.error('[mark-balance-paid] Invoice email failed:', err.message)
    );
    sendBalancePaymentAlert({
      tenant_id: req.tenant.id,
      bookingRef: booking.reference,
      guestName: booking.guest,
      amountCollected,
      paymentMethod: booking.payment_method || 'cash',
      newPaymentStatus: 'paid',
      pendingAmount: 0,
      collectedBy,
      guestPhone: booking.phone,
    }).catch(err =>
      console.error('[mark-balance-paid] Owner alert failed:', err.message)
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/bookings/:id/verify-payment  (owner only)
router.patch('/bookings/:id/verify-payment', requireOwner, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE bookings SET owner_payment_verified = TRUE WHERE id = $1 AND tenant_id = $2
       RETURNING id, reference, owner_payment_verified`,
      [req.params.id, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/bookings/:id/send-invoice  (owner only)
router.post('/bookings/:id/send-invoice', requireOwner, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.*, g.full_name AS guest, g.phone, g.email,
              rt.name AS room, rm.room_number
         FROM bookings b
         JOIN guests g      ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
         LEFT JOIN rooms rm ON rm.id = b.room_id
        WHERE b.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found' });
    const booking = rows[0];
    await sendInvoiceEmail(booking);
    const upd = await req.db.query(
      `UPDATE bookings SET invoice_sent_at = now() WHERE id = $1 AND tenant_id = $2
       RETURNING id, reference, invoice_sent_at`,
      [req.params.id, req.tenant.id]
    );
    res.json({ ok: true, invoice_sent_at: upd.rows[0].invoice_sent_at });
  } catch (err) {
    console.error('[admin/send-invoice]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- NOTIFICATION LOGS ---------------- */
router.get('/notifications', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM notification_logs ORDER BY sent_at DESC LIMIT 300`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/notifications', requireOwner, async (req, res) => {
  try {
    await req.db.query(`DELETE FROM notification_logs WHERE tenant_id=$1`, [req.tenant.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- SPECIAL REQUESTS (early check-in / late checkout) ---------------- */

// GET /api/admin/special-requests?status=pending
router.get('/special-requests', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE sr.status = $${params.length}`; }
  try {
    const { rows } = await req.db.query(
      `SELECT sr.*, b.reference, b.check_in, b.check_out,
              g.full_name AS guest_name, g.email AS guest_email, g.phone AS guest_phone,
              rt.name AS room_name, rm.room_number,
              u.username AS resolved_by_name
         FROM special_requests sr
         JOIN bookings b ON b.id = sr.booking_id
         JOIN guests g ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
         LEFT JOIN rooms rm ON rm.id = b.room_id
         LEFT JOIN users u ON u.id = sr.resolved_by
        ${where}
        ORDER BY sr.created_at DESC LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/special-requests  { booking_id, request_type, requested_time, notes? }
router.post('/special-requests', async (req, res) => {
  const { booking_id, request_type, requested_time, notes } = req.body || {};
  if (!booking_id || !request_type || !requested_time)
    return res.status(400).json({ error: 'booking_id, request_type and requested_time are required' });
  if (!['early_checkin', 'late_checkout'].includes(request_type))
    return res.status(400).json({ error: "request_type must be 'early_checkin' or 'late_checkout'" });

  const standardTime = request_type === 'early_checkin' ? '11:00' : '10:00';
  const feePerHour = Number(req.tenant.settings?.early_late_fee_per_hour ?? process.env.EARLY_LATE_FEE_PER_HOUR ?? 150);

  const [rh, rm] = requested_time.split(':').map(Number);
  const [sh, sm] = standardTime.split(':').map(Number);
  const deltaMinutes = Math.abs((rh * 60 + rm) - (sh * 60 + sm));
  const hoursDelta = Math.round(deltaMinutes / 60 * 100) / 100;
  const totalFee = Math.round(hoursDelta * feePerHour * 100) / 100;

  try {
    const { rows } = await req.db.query(
      `INSERT INTO special_requests
         (booking_id, request_type, requested_time, standard_time, hours_delta, fee_per_hour, total_fee, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [booking_id, request_type, requested_time, standardTime, hoursDelta, feePerHour, totalFee, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/special-requests/:id  { status, notes? }
router.patch('/special-requests/:id', requireAdmin, async (req, res) => {
  const { status, notes } = req.body || {};
  const allowed = ['pending', 'approved', 'denied', 'waived'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE special_requests
         SET status=$1, notes=COALESCE($2, notes), resolved_at=NOW(), resolved_by=$3
        WHERE id=$4 AND tenant_id=$5 RETURNING *`,
      [status, notes || null, req.user.id, req.params.id, req.tenant.id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Request not found' }); }

    if (status === 'approved' && Number(rows[0].total_fee) > 0) {
      await client.query(
        `UPDATE bookings
           SET total_amount = total_amount + $1,
               pending_amount = pending_amount + $1,
               payment_status = CASE
                 WHEN advance_paid >= (total_amount + $1) THEN 'paid'
                 WHEN advance_paid > 0 THEN 'partial'
                 ELSE 'pending'
               END
          WHERE id = $2`,
        [rows[0].total_fee, rows[0].booking_id]
      );
    }

    await client.query('COMMIT');

    req.db.query(
      `SELECT b.reference, g.full_name, g.email, g.phone
         FROM bookings b JOIN guests g ON g.id = b.guest_id
        WHERE b.id = $1`,
      [rows[0].booking_id]
    ).then(r => {
      if (r.rows[0]) {
        sendSpecialRequestUpdate({
          tenant_id: req.tenant.id,
          guestEmail: r.rows[0].email,
          guestName: r.rows[0].full_name,
          guestPhone: r.rows[0].phone,
          bookingRef: r.rows[0].reference,
          requestType: rows[0].request_type,
          requestedTime: rows[0].requested_time,
          status,
          totalFee: rows[0].total_fee,
        }).catch(() => {});
      }
    }).catch(() => {});

    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ---------------- REFUNDS ---------------- */

// POST /api/admin/bookings/:id/early-checkout
// Guest leaves before original check_out. Releases remaining inventory and calculates refund.
router.post('/bookings/:id/early-checkout', requireAdmin, async (req, res) => {
  const { actual_checkout, refund_method, waive_refund, refund_amount: requestedRefund, manual_refund_amount, notes } = req.body || {};
  if (!actual_checkout) return res.status(400).json({ error: 'actual_checkout is required' });

  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM bookings WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.tenant.id]);
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    const bk = cur.rows[0];

    if (bk.status !== 'checked_in') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Booking must be checked_in to perform early checkout' });
    }

    const checkIn     = bk.check_in.toISOString().slice(0, 10);
    const origCheckOut = bk.check_out.toISOString().slice(0, 10);

    if (actual_checkout <= checkIn) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'actual_checkout must be after check_in' });
    }
    if (actual_checkout >= origCheckOut) {
      // No early checkout — treat as normal checkout
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'actual_checkout must be before original check_out; use regular checkout instead' });
    }

    const actualNights  = Math.round((new Date(actual_checkout) - new Date(checkIn)) / 86400000);
    const advancePaid   = Number(bk.advance_paid);

    // Auto-calculate refund from inventory rates (same logic as preview)
    const autoRateQ = await client.query(
      `SELECT COALESCE(SUM(rate), 0)::numeric AS base_for_actual FROM inventory
        WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3`,
      [bk.room_type_id, checkIn, actual_checkout]
    );
    const origTaxPct    = Number(bk.base_amount) > 0 ? (Number(bk.tax_amount) / Number(bk.base_amount)) * 100 : 0;
    const baseForActual = Number(autoRateQ.rows[0].base_for_actual);
    const taxForActual  = Math.round(baseForActual * origTaxPct) / 100;
    const amountForActual = Math.round((baseForActual + taxForActual) * 100) / 100;
    const autoRefund    = Math.round(Math.max(advancePaid - amountForActual, 0) * 100) / 100;

    // manual_refund_amount overrides auto; fall back to requestedRefund (legacy) then auto
    const isManualOverride = manual_refund_amount != null;
    const rawOverride = isManualOverride ? Number(manual_refund_amount)
                      : requestedRefund != null ? Number(requestedRefund)
                      : autoRefund;
    const refundAmount  = waive_refund ? 0 : Math.min(Math.max(rawOverride, 0), advancePaid);
    const refundStatus  = waive_refund ? 'waived' : 'pending';

    // Release inventory for the unused nights
    await client.query(
      `UPDATE inventory SET booked_units = GREATEST(booked_units - 1, 0)
        WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3`,
      [bk.room_type_id, actual_checkout, origCheckOut]
    );

    // Mark room for cleaning after actual checkout
    if (bk.room_id) {
      await client.query('UPDATE rooms SET status=$1, maintenance_until=NULL WHERE id=$2', ['maintenance', bk.room_id]);
      const rmQ = await client.query('SELECT room_number FROM rooms WHERE id=$1', [bk.room_id]);
      const roomNum = rmQ.rows[0]?.room_number || bk.room_id;
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 0, 0);
      await client.query(
        `INSERT INTO tasks (title, description, priority, status, due_at, room_id)
         VALUES ($1,$2,'Urgent','Pending',$3,$4)`,
        [`Room ${roomNum} post-checkout inspection`,
         'Room vacated early. Complete inspection and cleaning before marking vacant & clean.',
         endOfDay.toISOString(), bk.room_id]
      );
    }

    await client.query(
      `UPDATE bookings SET
          status          = 'checked_out',
          actual_checkout = $1,
          actual_nights   = $2,
          refund_amount   = $3,
          refund_status   = $4,
          refund_method   = $5,
          refund_reason   = 'early_checkout'
        WHERE id = $6`,
      [actual_checkout, actualNights, refundAmount, refundStatus, refund_method || 'cash', req.params.id]
    );

    if (!waive_refund && refundAmount > 0) {
      const paymentNotes = isManualOverride
        ? JSON.stringify({ manual_override: true, auto_refund: autoRefund, staff_notes: notes || null })
        : (notes || null);
      await client.query(
        `INSERT INTO payments (booking_id, type, amount, status, notes, processed_by)
         VALUES ($1, 'refund', $2, 'pending', $3, $4)`,
        [req.params.id, refundAmount, paymentNotes, req.user.id]
      );
    }

    await client.query('COMMIT');

    // Create feedback row and send receipt async
    req.db.query(
      `SELECT b.*, g.full_name AS guest, g.email, g.phone, rt.name AS room, rt.code, b.guest_id
         FROM bookings b
         JOIN guests g ON g.id=b.guest_id
         JOIN room_types rt ON rt.id=b.room_type_id
        WHERE b.id=$1 AND b.tenant_id=$2`, [req.params.id, req.tenant.id]
    ).then(async r => {
      const booking = r.rows[0];
      if (!booking) return;
      sendCheckoutReceipt({ ...booking, check_out: actual_checkout }).catch(() => {});
      const feedbackToken = require('crypto').randomUUID();
      const baseUrl = process.env.FEEDBACK_BASE_URL || 'http://localhost:5173/feedback';
      try {
        await req.db.query(
          `INSERT INTO guest_feedback (booking_id, guest_id, token) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING`,
          [booking.id, booking.guest_id, feedbackToken]
        );
        sendFeedbackEmail(booking.email, booking.guest, `${baseUrl}/${feedbackToken}`, booking.phone, booking.reference, req.tenant.id).catch(() => {});
      } catch {}
    }).catch(() => {});

    res.json({ ok: true, refund_amount: refundAmount, refund_status: refundStatus, actual_nights: actualNights });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/early-checkout]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/admin/bookings/:id/refund
// Generic refund: overpayment, room downgrade, manual cancellation adjustment.
router.post('/bookings/:id/refund', requireAdmin, async (req, res) => {
  const { refund_amount, refund_method, reason, notes } = req.body || {};
  if (refund_amount == null || Number(refund_amount) <= 0)
    return res.status(400).json({ error: 'refund_amount must be a positive number' });
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM bookings WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.tenant.id]);
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    const bk = cur.rows[0];

    const advancePaid = Number(bk.advance_paid);
    const requested   = Number(refund_amount);
    if (requested > advancePaid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Refund (${requested}) cannot exceed amount collected (${advancePaid})` });
    }

    await client.query(
      `UPDATE bookings SET
          refund_amount = $1,
          refund_status = 'pending',
          refund_reason = $2,
          refund_method = $3
        WHERE id = $4`,
      [requested, reason, refund_method || 'cash', req.params.id]
    );
    await client.query(
      `INSERT INTO payments (booking_id, type, amount, status, notes, processed_by)
       VALUES ($1, 'refund', $2, 'pending', $3, $4)`,
      [req.params.id, requested, notes || null, req.user.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, refund_amount: requested, refund_status: 'pending' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/refund]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/bookings/:id/refund-processed  (owner only)
// Marks a pending refund as physically handed back to the guest.
router.patch('/bookings/:id/refund-processed', requireOwner, async (req, res) => {
  const { notes, refund_amount, refund_method } = req.body || {};
  try {
    const { rows } = await req.db.query(
      `UPDATE bookings
          SET refund_status       = 'processed',
              refund_processed_at = now(),
              refund_processed_by = $1,
              refund_amount       = CASE WHEN $3::numeric IS NOT NULL THEN $3::numeric ELSE refund_amount END,
              refund_method       = CASE WHEN $4::text    IS NOT NULL THEN $4          ELSE refund_method END
        WHERE id = $2 AND tenant_id = $5 AND refund_status = 'pending'
        RETURNING id, reference, refund_amount, refund_status, refund_processed_at`,
      [req.user.id, req.params.id,
       refund_amount != null ? Number(refund_amount) : null,
       refund_method || null, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found or refund not in pending state' });
    if (notes) {
      await req.db.query(
        `UPDATE payments SET notes = COALESCE(notes || ' | ' || $1, $1)
          WHERE booking_id = $2 AND type = 'refund' AND status = 'pending'`,
        [notes, req.params.id]
      );
      await req.db.query(
        `UPDATE payments SET status = 'processed' WHERE booking_id = $1 AND type = 'refund'`,
        [req.params.id]
      );
    } else {
      await req.db.query(
        `UPDATE payments SET status = 'processed' WHERE booking_id = $1 AND type = 'refund'`,
        [req.params.id]
      );
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[admin/refund-processed]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- EARLY CHECKOUT PREVIEW ---------- */
// GET /api/admin/bookings/:id/early-checkout/preview?actual_checkout=YYYY-MM-DD
router.get('/bookings/:id/early-checkout/preview', requireAdmin, async (req, res) => {
  const { actual_checkout } = req.query;
  if (!actual_checkout) return res.status(400).json({ error: 'actual_checkout query param is required' });
  try {
    const { rows } = await req.db.query('SELECT * FROM bookings WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Booking not found' });
    const bk = rows[0];
    if (bk.status !== 'checked_in') return res.status(400).json({ error: 'Booking must be checked_in' });
    const checkIn      = bk.check_in.toISOString().slice(0, 10);
    const origCheckOut = bk.check_out.toISOString().slice(0, 10);
    if (actual_checkout <= checkIn)      return res.status(400).json({ error: 'actual_checkout must be after check_in' });
    if (actual_checkout >= origCheckOut) return res.status(400).json({ error: 'actual_checkout must be before original check_out' });
    const actualNights = Math.round((new Date(actual_checkout) - new Date(checkIn)) / 86400000);
    const unusedNights = bk.nights - actualNights;
    const advancePaid  = Number(bk.advance_paid);
    const origTaxPct   = Number(bk.base_amount) > 0 ? (Number(bk.tax_amount) / Number(bk.base_amount)) * 100 : 0;
    const rateQ = await req.db.query(
      `SELECT stay_date::date AS date, rate FROM inventory
        WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3 ORDER BY stay_date`,
      [bk.room_type_id, checkIn, actual_checkout]
    );
    const nightRows     = rateQ.rows;
    const baseForActual = nightRows.reduce((s, r) => s + Number(r.rate), 0);
    const nightsBreakdown = nightRows.map(r => {
      const rate = Number(r.rate);
      const tax  = Math.round(rate * origTaxPct) / 100;
      return { date: String(r.date).slice(0, 10), rate, tax, total: rate + tax };
    });
    const taxForActual    = Math.round(baseForActual * origTaxPct) / 100;
    const amountForActual = Math.round((baseForActual + taxForActual) * 100) / 100;
    const refundAmount    = Math.round(Math.max(advancePaid - amountForActual, 0) * 100) / 100;
    const balanceDue      = Math.round(Math.max(amountForActual - advancePaid, 0) * 100) / 100;
    res.json({
      original_nights:    bk.nights,
      actual_nights:      actualNights,
      nights_unused:      unusedNights,
      nights_breakdown:   nightsBreakdown,
      amount_for_actual:  amountForActual,
      advance_paid:       advancePaid,
      auto_refund_amount: refundAmount,
      refund_amount:      refundAmount,   // backward compat with existing modal
      balance_due:        balanceDue,
      tax_pct:            Math.round(origTaxPct * 100) / 100,
    });
  } catch (err) {
    console.error('[early-checkout/preview]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- EXTEND STAY AVAILABILITY ---------- */
// GET /api/admin/bookings/:id/extend/availability?new_checkout=YYYY-MM-DD
router.get('/bookings/:id/extend/availability', requireAdmin, async (req, res) => {
  const { new_checkout } = req.query;
  if (!new_checkout) return res.status(400).json({ error: 'new_checkout query param is required' });
  try {
    const bkQ = await req.db.query(
      `SELECT b.*, rt.name AS room_type_name FROM bookings b JOIN room_types rt ON rt.id = b.room_type_id WHERE b.id=$1`,
      [req.params.id]
    );
    if (!bkQ.rows[0]) return res.status(404).json({ error: 'Booking not found' });
    const bk = bkQ.rows[0];
    if (bk.status !== 'checked_in') return res.status(400).json({ error: 'Booking must be checked_in to extend' });
    const origCheckOut    = bk.check_out.toISOString().slice(0, 10);
    if (new_checkout <= origCheckOut) return res.status(400).json({ error: 'new_checkout must be after current checkout' });
    const extensionNights = Math.round((new Date(new_checkout) - new Date(origCheckOut)) / 86400000);
    // Same room type inventory for extension nights
    const sameTypeQ = await req.db.query(
      `SELECT stay_date::date AS date, total_units, booked_units, rate, is_closed
         FROM inventory WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3 ORDER BY stay_date`,
      [bk.room_type_id, origCheckOut, new_checkout]
    );
    const sameTypeDates  = sameTypeQ.rows;
    const availNights    = sameTypeDates.filter(r => !r.is_closed && Number(r.booked_units) < Number(r.total_units));
    const rateSum        = sameTypeDates.reduce((s, r) => s + Number(r.rate), 0);
    const origTaxPct     = Number(bk.base_amount) > 0 ? (Number(bk.tax_amount) / Number(bk.base_amount)) * 100 : 0;
    // Physical room conflict check
    let sameRoomAvailable = true;
    if (bk.room_id) {
      const conflict = await req.db.query(
        `SELECT 1 FROM bookings WHERE room_id=$1 AND id<>$2 AND status<>'cancelled' AND check_in<$4 AND check_out>$3 LIMIT 1`,
        [bk.room_id, bk.id, origCheckOut, new_checkout]
      );
      sameRoomAvailable = conflict.rows.length === 0;
    }
    // Alternative room types
    const altQ = await req.db.query(
      `SELECT rt.id, rt.name, rt.code,
              COUNT(*)::int AS inv_nights,
              COUNT(*) FILTER (WHERE inv.booked_units < inv.total_units AND NOT inv.is_closed)::int AS avail_nights,
              COALESCE(SUM(inv.rate), 0)::numeric AS rate_sum
         FROM room_types rt
         JOIN inventory inv ON inv.room_type_id = rt.id
        WHERE rt.id <> $1 AND inv.stay_date >= $2 AND inv.stay_date < $3
        GROUP BY rt.id, rt.name, rt.code
       HAVING COUNT(*) = $4
        ORDER BY rt.id`,
      [bk.room_type_id, origCheckOut, new_checkout, extensionNights]
    );
    res.json({
      extension_nights:    extensionNights,
      extension_from:      origCheckOut,
      extension_to:        new_checkout,
      original_tax_pct:    Math.round(origTaxPct * 100) / 100,
      same_type: {
        room_type_id:     bk.room_type_id,
        name:             bk.room_type_name,
        available_all:    sameTypeDates.length === extensionNights && availNights.length === extensionNights,
        available_count:  availNights.length,
        total_count:      extensionNights,
        nights:           sameTypeDates.map(r => ({
          date:            String(r.date).slice(0, 10),
          available:       !r.is_closed && Number(r.booked_units) < Number(r.total_units),
          available_units: Math.max(Number(r.total_units) - Number(r.booked_units), 0),
          rate:            Number(r.rate),
        })),
        rate_sum:         rateSum,
        additional_base:  rateSum,
        additional_tax:   Math.round(rateSum * origTaxPct) / 100,
        additional_total: rateSum + Math.round(rateSum * origTaxPct) / 100,
      },
      same_room_available: sameRoomAvailable,
      ota_source:          bk.source !== 'direct' ? bk.source : null,
      ota_warning:         bk.source !== 'direct',
      alternatives: altQ.rows.map(r => {
        const base = Number(r.rate_sum);
        const tax  = Math.round(base * origTaxPct) / 100;
        return {
          room_type_id:     r.id,
          name:             r.name,
          code:             r.code,
          available_nights: r.avail_nights,
          fully_available:  r.avail_nights === extensionNights,
          rate_sum:         base,
          additional_base:  base,
          additional_tax:   tax,
          additional_total: base + tax,
        };
      }),
    });
  } catch (err) {
    console.error('[extend/availability]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- EXTEND STAY ---------- */
// POST /api/admin/bookings/:id/extend
// Body: { new_checkout, room_type_id?, room_id?, additional_payment?, payment_method?, notes? }
router.post('/bookings/:id/extend', requireAdmin, async (req, res) => {
  const { new_checkout, room_type_id: newTypeId, room_id: newRoomId, additional_payment, payment_method, notes } = req.body || {};
  if (!new_checkout) return res.status(400).json({ error: 'new_checkout is required' });
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM bookings WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.tenant.id]);
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found' }); }
    const bk = cur.rows[0];
    if (bk.status !== 'checked_in') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Booking must be checked_in to extend' });
    }
    const origCheckOut = bk.check_out.toISOString().slice(0, 10);
    if (new_checkout <= origCheckOut) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'new_checkout must be after current checkout' });
    }
    const extNights      = Math.round((new Date(new_checkout) - new Date(origCheckOut)) / 86400000);
    const roomTypeId     = newTypeId || bk.room_type_id;
    const roomTypeChanged = roomTypeId !== bk.room_type_id;
    // If type changed, clear room assignment; otherwise keep/update it
    const useRoomId = roomTypeChanged ? null : (newRoomId != null ? Number(newRoomId) : bk.room_id);
    // Lock & verify inventory
    const inv = await client.query(
      `SELECT stay_date, total_units, booked_units, is_closed, rate FROM inventory
        WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3 FOR UPDATE`,
      [roomTypeId, origCheckOut, new_checkout]
    );
    if (inv.rows.length !== extNights) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'NO_INVENTORY', message: 'Inventory not found for all extension nights.' });
    }
    if (inv.rows.some(r => r.is_closed || Number(r.booked_units) >= Number(r.total_units))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'NO_AVAILABILITY', message: 'Room not available for some extension nights.' });
    }
    // Verify physical room not double-booked
    if (useRoomId) {
      const roomConflict = await client.query(
        `SELECT 1 FROM bookings WHERE room_id=$1 AND id<>$2 AND status<>'cancelled' AND check_in<$4 AND check_out>$3 LIMIT 1`,
        [useRoomId, bk.id, origCheckOut, new_checkout]
      );
      if (roomConflict.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'ROOM_TAKEN', message: 'The assigned room is booked on some extension nights.' });
      }
    }
    const extBase      = inv.rows.reduce((s, r) => s + Number(r.rate), 0);
    const origTaxPct   = Number(bk.base_amount) > 0 ? (Number(bk.tax_amount) / Number(bk.base_amount)) * 100 : 0;
    const extTax       = Math.round(extBase * origTaxPct) / 100;
    const extTotal     = extBase + extTax;
    const payNow       = Math.max(Number(additional_payment || 0), 0);
    const newNights    = bk.nights + extNights;
    const newBase      = Number(bk.base_amount)  + extBase;
    const newTax       = Number(bk.tax_amount)   + extTax;
    const newTotal     = Number(bk.total_amount) + extTotal;
    const newAdvance   = Number(bk.advance_paid) + payNow;
    const newPending   = Math.max(newTotal - newAdvance, 0);
    const newPayStatus = newAdvance <= 0 ? 'pending' : (newPending <= 0 ? 'paid' : 'partial');
    // Increment inventory for extension nights
    await client.query(
      `UPDATE inventory SET booked_units = booked_units + 1 WHERE room_type_id=$1 AND stay_date>=$2 AND stay_date<$3`,
      [roomTypeId, origCheckOut, new_checkout]
    );
    // Update booking
    await client.query(
      `UPDATE bookings SET
          check_out       = $1,  nights         = $2,  base_amount    = $3,
          tax_amount      = $4,  total_amount   = $5,  advance_paid   = $6,
          pending_amount  = $7,  payment_status = $8,  room_type_id   = $9,
          room_id         = $10,
          payment_method  = COALESCE($11, payment_method),
          balance_paid_at = CASE WHEN $12::numeric > 0 THEN now() ELSE balance_paid_at END
        WHERE id = $13`,
      [new_checkout, newNights, newBase, newTax, newTotal,
       newAdvance, newPending, newPayStatus, roomTypeId, useRoomId,
       payment_method || null, payNow, bk.id]
    );
    if (payNow > 0) {
      await client.query(
        `INSERT INTO payments (booking_id, type, amount, status, notes, processed_by)
         VALUES ($1, 'charge', $2, 'paid', $3, $4)`,
        [bk.id, payNow, notes || `Stay extension: ${origCheckOut} → ${new_checkout}`, req.user.id]
      );
    }
    await client.query('COMMIT');
    const full = await req.db.query(
      `SELECT b.*, g.full_name AS guest, g.phone, g.email, rt.name AS room, rt.code, rm.room_number
         FROM bookings b
         JOIN guests g ON g.id=b.guest_id
         JOIN room_types rt ON rt.id=b.room_type_id
         LEFT JOIN rooms rm ON rm.id=b.room_id
        WHERE b.id=$1`, [bk.id]
    );
    res.json({ ok: true, booking: full.rows[0], extension_amount: extTotal, extension_nights: extNights });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[extend-stay]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ---------------- FEEDBACK (admin) ---------------- */
// GET /api/admin/feedback
router.get('/feedback', requireAdmin, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT gf.id, gf.token, gf.rating_overall, gf.rating_room, gf.rating_service,
              gf.nps_score, gf.comments, gf.submitted_at, gf.created_at,
              g.full_name AS guest_name, g.email AS guest_email,
              b.reference, b.check_in, b.check_out
         FROM guest_feedback gf
         JOIN bookings b ON b.id = gf.booking_id
         JOIN guests g ON g.id = gf.guest_id
        ORDER BY gf.created_at DESC
        LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/bookings/due-checkout-today
router.get('/bookings/due-checkout-today', requireAdmin, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.id, b.reference, b.check_in, b.check_out, b.nights,
              b.checkout_notification_sent_at,
              g.full_name AS guest, g.phone, g.email,
              rt.name AS room, rt.code,
              r.room_number
         FROM bookings b
         JOIN guests g ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
    LEFT JOIN rooms r ON r.id = b.room_id
        WHERE b.status = 'checked_in'
          AND b.check_out::date = CURRENT_DATE
        ORDER BY b.check_out ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/bookings/:id/notify-checkout
router.post('/bookings/:id/notify-checkout', requireAdmin, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.id, b.reference, b.check_in, b.check_out, b.nights, b.status,
              b.checkout_notification_sent_at,
              g.full_name AS guest, g.phone, g.email,
              rt.name AS room, rt.code,
              r.room_number
         FROM bookings b
         JOIN guests g ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
    LEFT JOIN rooms r ON r.id = b.room_id
        WHERE b.id = $1`,
      [req.params.id]
    );
    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status !== 'checked_in') return res.status(400).json({ error: 'Booking is not checked in' });

    const today = new Date().toISOString().slice(0, 10);
    if (booking.check_out?.slice(0, 10) !== today) {
      return res.status(400).json({ error: 'Checkout date is not today' });
    }

    const result = await sendCheckoutReminder(booking);

    await req.db.query(
      'UPDATE bookings SET checkout_notification_sent_at = now() WHERE id = $1',
      [req.params.id]
    );

    res.json({ ok: true, sent_at: new Date().toISOString(), channel: result.channel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/feedback/stats
router.get('/feedback/stats', requireAdmin, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT
         COUNT(*) FILTER (WHERE submitted_at IS NOT NULL)::int AS total_responses,
         ROUND(AVG(rating_overall) FILTER (WHERE submitted_at IS NOT NULL), 2) AS avg_overall,
         ROUND(AVG(rating_room) FILTER (WHERE submitted_at IS NOT NULL), 2) AS avg_room,
         ROUND(AVG(rating_service) FILTER (WHERE submitted_at IS NOT NULL), 2) AS avg_service,
         ROUND(AVG(nps_score) FILTER (WHERE submitted_at IS NOT NULL), 2) AS avg_nps
       FROM guest_feedback`
    );
    const npsRows = await req.db.query(
      `SELECT nps_score, COUNT(*)::int AS cnt
         FROM guest_feedback WHERE submitted_at IS NOT NULL AND nps_score IS NOT NULL
        GROUP BY nps_score ORDER BY nps_score`
    );
    res.json({ summary: rows[0], nps_distribution: npsRows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- COMPETITOR RATES ---------------- */
// GET /api/admin/competitor-rates/latest  → latest rate for each resort
router.get('/competitor-rates/latest', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT DISTINCT ON (resort_name) resort_name, room_type, rate, fetched_at
         FROM competitor_rates
        ORDER BY resort_name, fetched_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- SUPPRESSED YIELD LOG ---------------- */
// GET /api/admin/suppressed-yield?from=&to=
router.get('/suppressed-yield', requireOwner, async (req, res) => {
  const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to   = req.query.to   || new Date().toISOString().slice(0, 10);
  try {
    const totalQ = await req.db.query(
      `SELECT COALESCE(SUM(delta),0) AS total_delta, COUNT(*) AS events
         FROM suppressed_yield_log
        WHERE booking_date >= $1 AND booking_date <= $2`,
      [from, to]
    );
    const dailyQ = await req.db.query(
      `SELECT booking_date, SUM(delta)::numeric AS suppressed
         FROM suppressed_yield_log
        WHERE booking_date >= $1 AND booking_date <= $2
        GROUP BY booking_date ORDER BY booking_date`,
      [from, to]
    );
    res.json({
      total_suppressed: Number(totalQ.rows[0].total_delta),
      events:           Number(totalQ.rows[0].events),
      daily:            dailyQ.rows,
      from, to,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/suppressed-yield  (called when surge is capped)
router.post('/suppressed-yield', async (req, res) => {
  const { unconstrained_price, applied_price, delta, room_id } = req.body || {};
  if (!unconstrained_price || !delta) return res.status(400).json({ error: 'unconstrained_price and delta required' });
  try {
    await req.db.query(
      `INSERT INTO suppressed_yield_log (unconstrained_price, applied_price, delta, room_id)
       VALUES ($1, $2, $3, $4)`,
      [unconstrained_price, applied_price || 7499, delta, room_id || null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- WHATSAPP STATUS + RETRY ---------------- */

// GET /api/admin/whatsapp/status
// Returns whether the WhatsApp client is ready and how many messages are queued in DB.
router.get('/whatsapp/status', async (req, res) => {
  try {
    const { getWhatsAppStatus } = require('../services/whatsapp');
    const { ready, initializing } = getWhatsAppStatus();
    const { rows } = await req.db.query(`SELECT COUNT(*) AS count FROM whatsapp_queue`);
    res.json({ ready, initializing, pending_count: parseInt(rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/whatsapp/retry
// Manually trigger a drain of the DB queue (in case you don't want to wait for the heartbeat).
router.post('/whatsapp/retry', async (req, res) => {
  try {
    const { getWhatsAppStatus, drainDbQueue } = require('../services/whatsapp');
    const { ready } = getWhatsAppStatus();
    if (!ready) return res.status(503).json({ error: 'WhatsApp client is not ready — scan the QR code in the server console first.' });
    await drainDbQueue();
    const { rows } = await req.db.query(`SELECT COUNT(*) AS count FROM whatsapp_queue`);
    res.json({ ok: true, remaining: parseInt(rows[0].count, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



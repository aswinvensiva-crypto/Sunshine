const router = require('express').Router();
// Tenant-scoped: mounted behind resolveTenant. Tokens are globally unique but
// req.db pins RLS to the resort resolved from the subdomain, so a token opened
// on the wrong resort's domain 404s instead of leaking another tenant's data.

// GET /api/check-in/:token — validate token, return booking/guest info
router.get('/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const { rows } = await req.db.query(
      `SELECT cit.id, cit.token, cit.expires_at, cit.used_at,
              b.id AS booking_id, b.reference, b.check_in, b.check_out,
              b.num_guests, b.status, b.pre_checkin_data,
              g.full_name, g.email, g.phone, g.address,
              rt.name AS room_type
         FROM check_in_tokens cit
         JOIN bookings b ON b.id = cit.booking_id
         JOIN guests g ON g.id = b.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
        WHERE cit.token = $1 AND cit.tenant_id = $2`,
      [token, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invalid or expired link' });
    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This check-in link has expired' });
    }
    if (!['confirmed', 'checked_in'].includes(row.status)) {
      return res.status(400).json({ error: 'Booking is not active' });
    }
    // Mark used_at on first access
    if (!row.used_at) {
      await req.db.query(`UPDATE check_in_tokens SET used_at = NOW() WHERE token = $1 AND tenant_id = $2`, [token, req.tenant.id]);
    }
    res.json({
      booking: {
        reference: row.reference,
        check_in: row.check_in,
        check_out: row.check_out,
        num_guests: row.num_guests,
        room_type: row.room_type,
      },
      guest: {
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        address: row.address,
      },
      pre_checkin_data: row.pre_checkin_data || null,
      already_submitted: !!row.pre_checkin_data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/check-in/:token — save pre-filled details
router.post('/:token', async (req, res) => {
  const { token } = req.params;
  const { id_type, id_number, address, estimated_arrival } = req.body || {};
  if (!id_type || !id_number) {
    return res.status(400).json({ error: 'id_type and id_number are required' });
  }
  try {
    const { rows } = await req.db.query(
      `SELECT cit.booking_id, cit.expires_at, b.status
         FROM check_in_tokens cit
         JOIN bookings b ON b.id = cit.booking_id
        WHERE cit.token = $1 AND cit.tenant_id = $2`,
      [token, req.tenant.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invalid link' });
    if (new Date(rows[0].expires_at) < new Date()) {
      return res.status(410).json({ error: 'Link has expired' });
    }
    if (!['confirmed', 'checked_in'].includes(rows[0].status)) {
      return res.status(400).json({ error: 'Booking is not active' });
    }
    const data = { id_type, id_number, address: address || null, estimated_arrival: estimated_arrival || null, submitted_at: new Date().toISOString() };
    await req.db.query(
      `UPDATE bookings SET pre_checkin_data = $1 WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(data), rows[0].booking_id, req.tenant.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

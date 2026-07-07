const router = require('express').Router();
const { pool } = require('../config/db');

// GET /api/feedback/:token — return booking summary for display
router.get('/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT gf.id, gf.submitted_at, gf.rating_overall, gf.rating_room,
              gf.rating_service, gf.nps_score, gf.comments,
              b.reference, b.check_in, b.check_out,
              g.full_name, rt.name AS room_type
         FROM guest_feedback gf
         JOIN bookings b ON b.id = gf.booking_id
         JOIN guests g ON g.id = gf.guest_id
         JOIN room_types rt ON rt.id = b.room_type_id
        WHERE gf.token = $1`,
      [token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invalid feedback link' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/feedback/:token — save ratings + comments
router.post('/:token', async (req, res) => {
  const { token } = req.params;
  const { rating_overall, rating_room, rating_service, nps_score, comments } = req.body || {};

  const inRange = (v, min, max) => v === undefined || v === null || (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max);
  if (!inRange(rating_overall, 1, 5) || !inRange(rating_room, 1, 5) || !inRange(rating_service, 1, 5) || !inRange(nps_score, 0, 10)) {
    return res.status(400).json({ error: 'Rating values out of range' });
  }

  try {
    const { rows } = await pool.query(`SELECT id, submitted_at FROM guest_feedback WHERE token = $1`, [token]);
    if (!rows[0]) return res.status(404).json({ error: 'Invalid feedback link' });
    if (rows[0].submitted_at) return res.status(409).json({ error: 'Feedback already submitted' });

    await pool.query(
      `UPDATE guest_feedback
          SET rating_overall = $1, rating_room = $2, rating_service = $3,
              nps_score = $4, comments = $5, submitted_at = NOW()
        WHERE token = $6`,
      [rating_overall || null, rating_room || null, rating_service || null,
       nps_score !== undefined ? nps_score : null,
       comments || null, token]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

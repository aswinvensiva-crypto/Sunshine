const router = require('express').Router();
const { pool } = require('../config/db');

// GET /api/rooms  → all room categories
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, description, max_occupancy, base_rate, total_rooms
         FROM room_types
        ORDER BY base_rate ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[rooms]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

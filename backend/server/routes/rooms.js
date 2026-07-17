const router = require('express').Router();

// GET /api/rooms  → all room categories for this resort (req.db is tenant-scoped)
router.get('/', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, code, name, description, max_occupancy, base_rate, total_rooms
         FROM room_types
        WHERE tenant_id = $1
        ORDER BY base_rate ASC`,
      [req.tenant.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[rooms]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

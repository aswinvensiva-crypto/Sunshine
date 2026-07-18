const router = require('express').Router();

// GET /api/availability?check_in=YYYY-MM-DD&check_out=YYYY-MM-DD&guests=2
router.get('/', async (req, res) => {
  const { check_in, check_out, guests = 1 } = req.query;
  if (!check_in || !check_out) {
    return res.status(400).json({ error: 'check_in and check_out are required' });
  }

  const nights = Math.round(
    (new Date(check_out) - new Date(check_in)) / 86400000
  );
  if (!(nights > 0)) return res.status(400).json({ error: 'check_out must be after check_in' });

  try {
    // For each room type, look at every night in the range. A type is bookable
    // only if EVERY night has inventory, none is closed, and the tightest night
    // still has at least one unit free.
    const { rows } = await req.db.query(
      `SELECT rt.id, rt.code, rt.name, rt.description, rt.max_occupancy, rt.base_rate,
              MIN(inv.total_units - inv.booked_units) AS available_units,
              ROUND(AVG(inv.rate), 2)                 AS avg_rate,
              bool_or(inv.is_closed)                  AS any_closed,
              COUNT(*)                                AS nights_covered
         FROM room_types rt
         JOIN inventory inv ON inv.room_type_id = rt.id AND inv.tenant_id = rt.tenant_id
        WHERE inv.stay_date >= $1
          AND inv.stay_date <  $2
          AND rt.max_occupancy >= $3
          AND rt.tenant_id = $4
        GROUP BY rt.id`,
      [check_in, check_out, guests, req.tenant.id]
    );

    const room_types = rows
      .filter(r => Number(r.nights_covered) === nights && !r.any_closed && Number(r.available_units) > 0)
      .map(r => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        max_occupancy: r.max_occupancy,
        available_units: Number(r.available_units),
        avg_rate: Number(r.avg_rate),
        total_for_stay: Math.round(Number(r.avg_rate) * nights),
      }));

    res.json({ check_in, check_out, nights, room_types });
  } catch (err) {
    console.error('[availability]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

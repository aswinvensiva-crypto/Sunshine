/**
 * ai.js — Express-side gateway to the FastAPI AI service (8001).
 *
 * Responsibilities:
 *   1. Sign short-lived service tokens containing { tenant_id, scope, exp }.
 *      The tenant comes from req.tenant (host-resolved), never from the body.
 *   2. Provide per-module timeout-wrapped fetch wrappers.
 *   3. Route handlers for AI admin routes:
 *      GET  /api/admin/ai/risk/:bookingId       — get risk score for a booking
 *      POST /api/admin/ai/forecast              — trigger forecast run
 *      GET  /api/admin/ai/forecast              — get latest forecasts
 *      POST /api/admin/ai/pricing/suggest       — get pricing suggestions
 *      GET  /api/admin/ai/pricing/suggestions   — list suggestions
 *      POST /api/admin/ai/pricing/suggestions/:id/decide — accept/reject/edit
 *      POST /api/admin/concierge/ingest         — ingest docs
 *      GET  /api/admin/concierge/conversations  — list conversations
 *      POST /api/admin/concierge/conversations/:id/rate — rate a message
 *      POST /api/admin/concierge/conversations/:id/handoff — close conversation
 *      POST /api/admin/ai/training/:module      — trigger training
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { adminPool, forTenant } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const SERVICE_TOKEN_SECRET = process.env.SERVICE_TOKEN_SECRET || 'dev-service-secret';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

/**
 * Mint a short-lived HMAC service token for calling the FastAPI AI service.
 * The tenant_id claim is the single source of truth for the Python service.
 */
function signServiceToken(tenantId, scope) {
  return jwt.sign(
    { tenant_id: tenantId, scope, iat: Math.floor(Date.now() / 1000) },
    SERVICE_TOKEN_SECRET,
    { expiresIn: '60s' }
  );
}

/**
 * Fetch wrapper for communicating with FastAPI AI service with timeout & auth header.
 */
async function aiFetch(path, tenantId, body, timeoutMs = 10000) {
  const token = signServiceToken(tenantId, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(
        new Error(data?.detail?.message || data?.error || 'AI service error'),
        { status: res.status, code: data?.detail?.code }
      );
    }
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('AI service timeout'), { code: 'AI_TIMEOUT' });
    }
    throw err;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   1. RISK ROUTES
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/admin/ai/risk/:bookingId — get risk score for a booking (from DB)
 */
router.get('/ai/risk/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { rows } = await req.db.query(
      `SELECT r.*, b.reference, b.check_in, b.check_out, b.total_amount,
              g.full_name AS guest_name
         FROM risk_scores r
         JOIN bookings b ON b.id = r.booking_id
         JOIN guests g ON g.id = b.guest_id
        WHERE r.booking_id = $1 AND r.tenant_id = $2`,
      [bookingId, req.tenant.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Risk score not found for this booking' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[ai/risk]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/ai/risk-summary — risk distribution counts & recent high-risk bookings
 */
router.get('/ai/risk-summary', async (req, res) => {
  try {
    const distQ = await req.db.query(
      `SELECT
         COUNT(*) FILTER (WHERE band = 'high')::int AS high,
         COUNT(*) FILTER (WHERE band = 'medium')::int AS medium,
         COUNT(*) FILTER (WHERE band = 'low')::int AS low,
         COUNT(*) FILTER (WHERE band = 'unscored')::int AS unscored,
         COUNT(*)::int AS total
       FROM risk_scores
      WHERE tenant_id = $1`,
      [req.tenant.id]
    );

    const highRiskQ = await req.db.query(
      `SELECT r.*, b.reference, b.check_in, b.check_out, b.total_amount, b.status AS booking_status,
              g.full_name AS guest_name, g.phone AS guest_phone
         FROM risk_scores r
         JOIN bookings b ON b.id = r.booking_id
         JOIN guests g ON g.id = b.guest_id
        WHERE r.tenant_id = $1 AND r.band = 'high'
        ORDER BY r.scored_at DESC
        LIMIT 20`,
      [req.tenant.id]
    );

    res.json({
      distribution: distQ.rows[0] || { high: 0, medium: 0, low: 0, unscored: 0, total: 0 },
      recent_high_risk: highRiskQ.rows || [],
    });
  } catch (err) {
    console.error('[ai/risk-summary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ────────────────────────────────────────────────────────────────────────────
   2. FORECAST ROUTES
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/admin/ai/forecast — trigger forecast run (calls FastAPI, 60s timeout)
 */
router.post('/ai/forecast', requireAdmin, async (req, res) => {
  try {
    const result = await aiFetch('/v1/forecast/run', req.tenant.id, req.body || {}, 60000);
    res.json(result);
  } catch (err) {
    console.error('[ai/forecast/run]', err.message);
    const status = err.status || (err.code === 'AI_TIMEOUT' ? 504 : 502);
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/**
 * GET /api/admin/ai/forecast — get latest forecasts for next 60 days
 */
router.get('/ai/forecast', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT f.*, rt.name AS room_type_name, rt.code AS room_type_code,
              COALESCE(inv.total_units, rt.total_rooms) AS total_units,
              COALESCE(inv.booked_units, 0) AS booked_units,
              COALESCE(inv.rate, rt.base_rate) AS current_rate
         FROM forecasts f
         JOIN room_types rt ON rt.id = f.room_type_id
         LEFT JOIN inventory inv ON inv.room_type_id = f.room_type_id 
                                AND inv.stay_date = f.forecast_date
                                AND inv.tenant_id = f.tenant_id
        WHERE f.tenant_id = $1
          AND f.forecast_date >= CURRENT_DATE
          AND f.forecast_date <= CURRENT_DATE + INTERVAL '60 days'
        ORDER BY f.forecast_date ASC, f.room_type_id ASC`,
      [req.tenant.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[ai/forecast/get]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ────────────────────────────────────────────────────────────────────────────
   3. PRICING ROUTES
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/admin/ai/pricing/suggest — trigger pricing suggestions (FastAPI, 30s)
 */
router.post('/ai/pricing/suggest', requireAdmin, async (req, res) => {
  try {
    const result = await aiFetch('/v1/pricing/suggest', req.tenant.id, req.body || {}, 30000);
    res.json(result);
  } catch (err) {
    console.error('[ai/pricing/suggest]', err.message);
    const status = err.status || (err.code === 'AI_TIMEOUT' ? 504 : 502);
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/**
 * GET /api/admin/ai/pricing/suggestions — list suggestions (default: 'pending')
 */
router.get('/ai/pricing/suggestions', async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const params = [req.tenant.id];
    let whereClause = 'ps.tenant_id = $1';

    if (status !== 'all') {
      params.push(status);
      whereClause += ` AND ps.status = $${params.length}`;
    }

    const { rows } = await req.db.query(
      `SELECT ps.*, rt.name AS room_type_name, rt.code AS room_type_code,
              inv.rate AS current_rate,
              u.full_name AS decided_by_name
         FROM price_suggestions ps
         JOIN room_types rt ON rt.id = ps.room_type_id
         LEFT JOIN inventory inv ON inv.room_type_id = ps.room_type_id 
                                AND inv.stay_date = ps.suggestion_date
                                AND inv.tenant_id = ps.tenant_id
         LEFT JOIN users u ON u.id = ps.decided_by
        WHERE ${whereClause}
        ORDER BY ps.suggestion_date ASC, ps.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[ai/pricing/suggestions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/ai/pricing/suggestions/:id/decide — accept/reject/edit
 * Body: { decision: 'accepted'|'rejected'|'edited', decided_rate?: number, reason?: string }
 */
router.post('/ai/pricing/suggestions/:id/decide', requireAdmin, async (req, res) => {
  const { decision, decided_rate, reason } = req.body || {};
  const allowedDecisions = ['accepted', 'rejected', 'edited'];

  if (!allowedDecisions.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${allowedDecisions.join(', ')}` });
  }

  const client = await req.db.connect();
  try {
    await client.query('BEGIN');

    // Lock price suggestion row
    const cur = await client.query(
      `SELECT * FROM price_suggestions WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [req.params.id, req.tenant.id]
    );

    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Price suggestion not found' });
    }

    const suggestion = cur.rows[0];
    let finalRate = null;

    if (decision === 'accepted') {
      finalRate = decided_rate != null ? Number(decided_rate) : Number(suggestion.suggested_rate);
    } else if (decision === 'edited') {
      if (decided_rate == null || isNaN(Number(decided_rate))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'decided_rate is required when decision is edited' });
      }
      finalRate = Number(decided_rate);
    }

    // 1. Update price_suggestions row
    const upd = await client.query(
      `UPDATE price_suggestions
          SET status = $1,
              decided_rate = $2,
              decided_by = $3,
              decided_at = NOW()
        WHERE id = $4 AND tenant_id = $5
        RETURNING *`,
      [decision, finalRate, req.user?.id || null, req.params.id, req.tenant.id]
    );

    // 2. If accepted or edited, update inventory rate (existing rate-update path)
    if (finalRate !== null) {
      await client.query(
        `UPDATE inventory
            SET rate = $1
          WHERE room_type_id = $2
            AND stay_date = $3
            AND tenant_id = $4`,
        [finalRate, suggestion.room_type_id, suggestion.suggestion_date, req.tenant.id]
      );

      // 3. Write suppressed_yield_log if there's a delta from unconstrained suggested_rate
      const unconstrainedPrice = Number(suggestion.suggested_rate);
      const delta = unconstrainedPrice - finalRate;

      if (Math.abs(delta) > 0.001) {
        await client.query(
          `INSERT INTO suppressed_yield_log
             (unconstrained_price, applied_price, delta, booking_date, tenant_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [unconstrainedPrice, finalRate, delta, suggestion.suggestion_date, req.tenant.id]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, suggestion: upd.rows[0], applied_rate: finalRate });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ai/pricing/decide]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ────────────────────────────────────────────────────────────────────────────
   4. CONCIERGE ADMIN ROUTES
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/admin/concierge/ingest — trigger document ingestion into vector store
 */
router.post('/concierge/ingest', requireAdmin, async (req, res) => {
  try {
    const result = await aiFetch('/v1/concierge/ingest', req.tenant.id, req.body || {}, 60000);
    res.json(result);
  } catch (err) {
    console.error('[concierge/ingest]', err.message);
    const status = err.status || (err.code === 'AI_TIMEOUT' ? 504 : 502);
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/**
 * GET /api/admin/concierge/conversations — list conversations with latest message
 */
router.get('/concierge/conversations', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT c.*,
              m.id AS latest_message_id,
              m.role AS latest_message_role,
              m.content AS latest_message_content,
              m.confidence AS latest_message_confidence,
              m.handoff AS latest_message_handoff,
              m.staff_rating AS latest_message_rating,
              m.created_at AS latest_message_at,
              (SELECT COUNT(*)::int 
                 FROM concierge_messages cm 
                WHERE cm.conversation_id = c.id AND cm.tenant_id = c.tenant_id) AS message_count
         FROM concierge_conversations c
         LEFT JOIN LATERAL (
           SELECT id, role, content, confidence, handoff, staff_rating, created_at
             FROM concierge_messages
            WHERE conversation_id = c.id AND tenant_id = c.tenant_id
            ORDER BY created_at DESC
            LIMIT 1
         ) m ON true
        WHERE c.tenant_id = $1
        ORDER BY c.updated_at DESC
        LIMIT 100`,
      [req.tenant.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[concierge/conversations]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/concierge/conversations/:id/messages — get message thread for a conversation
 */
router.get('/concierge/conversations/:id/messages', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM concierge_messages
        WHERE conversation_id = $1 AND tenant_id = $2
        ORDER BY created_at ASC`,
      [req.params.id, req.tenant.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[concierge/conversation/messages]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/concierge/conversations/:id/rate — rate a message
 * Body: { message_id, rating: 1-5 }
 */
router.post('/concierge/conversations/:id/rate', async (req, res) => {
  const { message_id, rating } = req.body || {};
  const numRating = parseInt(rating, 10);

  if (!message_id || isNaN(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: 'message_id and rating (1-5) are required' });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE concierge_messages
          SET staff_rating = $1
        WHERE id = $2 AND conversation_id = $3 AND tenant_id = $4
        RETURNING *`,
      [numRating, message_id, req.params.id, req.tenant.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Message not found in this conversation' });
    }
    res.json({ ok: true, message: rows[0] });
  } catch (err) {
    console.error('[concierge/rate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/concierge/conversations/:id/handoff — close conversation
 */
router.post('/concierge/conversations/:id/handoff', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE concierge_conversations
          SET status = 'closed', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [req.params.id, req.tenant.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ ok: true, conversation: rows[0] });
  } catch (err) {
    console.error('[concierge/handoff]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ────────────────────────────────────────────────────────────────────────────
   5. AI TRAINING ROUTES
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/admin/ai/training/:module — trigger training run
 * Module must be 'risk' | 'forecast' | 'pricing' | 'rag' (timeout 300s)
 */
router.post('/ai/training/:module', requireAdmin, async (req, res) => {
  const { module: mod } = req.params;
  const validModules = ['risk', 'forecast', 'pricing', 'rag'];

  if (!validModules.includes(mod)) {
    return res.status(400).json({
      error: `Invalid module '${mod}'. Must be one of: ${validModules.join(', ')}`
    });
  }

  try {
    const result = await aiFetch(`/v1/training/${mod}`, req.tenant.id, req.body || {}, 300000);
    res.json(result);
  } catch (err) {
    console.error(`[ai/training/${mod}]`, err.message);
    const status = err.status || (err.code === 'AI_TIMEOUT' ? 504 : 502);
    res.status(status).json({ error: err.message, code: err.code });
  }
});

/* ────────────────────────────────────────────────────────────────────────────
   6. BOOKING RISK HOOK (called post-booking creation)
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * scoreBookingRisk — evaluates guest no-show / cancellation risk.
 *
 * Requirements:
 * 1. Checks if risk module is enabled for tenant
 * 2. Calls aiFetch with timeout 5000ms
 * 3. On success: inserts into risk_scores table
 * 4. On timeout/error: inserts an 'unscored' row into risk_scores and logs
 * 5. NEVER throws - always returns without blocking the booking
 */
async function scoreBookingRisk(tenantId, bookingId, db) {
  try {
    const queryDb = db || forTenant(tenantId);

    // 1. Check if risk module is enabled for tenant (always-on by default)
    try {
      const { rows } = await queryDb.query(
        `SELECT branding FROM tenant_settings WHERE tenant_id = $1`,
        [tenantId]
      );
      const aiFeatures = rows[0]?.branding?.ai_features;
      if (aiFeatures && aiFeatures.risk === false) {
        console.log(`[scoreBookingRisk] Risk scoring disabled for tenant ${tenantId}`);
        return null;
      }
    } catch {
      // Ignore settings lookup error; proceed with default enabled
    }

    // 2. Call aiFetch with timeout 5000ms
    let result;
    try {
      result = await aiFetch('/v1/risk/score', tenantId, { booking_id: bookingId }, 5000);
    } catch (aiErr) {
      console.warn(`[scoreBookingRisk] AI risk call failed for booking ${bookingId} (${aiErr.message}) — failing open`);

      // 4. On timeout/error: insert an 'unscored' row into risk_scores
      await queryDb.query(
        `INSERT INTO risk_scores
           (tenant_id, booking_id, band, status, factors, scored_at)
         VALUES
           ($1, $2, 'unscored', 'unscored', '[]'::jsonb, NOW())
         ON CONFLICT (tenant_id, booking_id) DO UPDATE SET
           band = 'unscored', status = 'unscored', scored_at = NOW()`,
        [tenantId, bookingId]
      ).catch(e => console.error('[scoreBookingRisk] Fail-open insert error:', e.message));

      return { booking_id: bookingId, band: 'unscored', status: 'unscored' };
    }

    // 3. On success: insert into risk_scores table
    const {
      cancel_prob = null,
      noshow_prob = null,
      band = 'unscored',
      factors = [],
      recommended_advance = null,
      model_version = null,
      data_source = 'synthetic'
    } = result || {};

    const { rows } = await queryDb.query(
      `INSERT INTO risk_scores
         (tenant_id, booking_id, cancel_prob, noshow_prob, band, factors,
          recommended_advance, model_version, data_source, status, scored_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scored', NOW())
       ON CONFLICT (tenant_id, booking_id) DO UPDATE SET
         cancel_prob = EXCLUDED.cancel_prob,
         noshow_prob = EXCLUDED.noshow_prob,
         band = EXCLUDED.band,
         factors = EXCLUDED.factors,
         recommended_advance = EXCLUDED.recommended_advance,
         model_version = EXCLUDED.model_version,
         data_source = EXCLUDED.data_source,
         status = 'scored',
         scored_at = NOW()
       RETURNING *`,
      [
        tenantId,
        bookingId,
        cancel_prob != null ? Number(cancel_prob) : null,
        noshow_prob != null ? Number(noshow_prob) : null,
        band,
        JSON.stringify(factors),
        recommended_advance != null ? Number(recommended_advance) : null,
        model_version,
        data_source,
      ]
    );

    return rows[0] || result;
  } catch (err) {
    // 5. NEVER throws - always returns without blocking the booking
    console.error(`[scoreBookingRisk] Unexpected failure for booking ${bookingId}:`, err.message);
    return null;
  }
}

router.scoreBookingRisk = scoreBookingRisk;
router.signServiceToken = signServiceToken;
router.aiFetch = aiFetch;

module.exports = router;
module.exports.scoreBookingRisk = scoreBookingRisk;
module.exports.signServiceToken = signServiceToken;
module.exports.aiFetch = aiFetch;

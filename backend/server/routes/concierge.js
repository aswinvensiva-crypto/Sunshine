/**
 * concierge.js — Public guest-facing AI concierge endpoint.
 *
 * Responsibilities:
 *   1. Mounted under resolveTenant, so req.tenant and req.db are pinned.
 *   2. Rate-limited to protect against automated spam or scraping.
 *   3. Accepts guest questions, logs conversations and messages in DB.
 *   4. Calls the FastAPI AI service via aiFetch.
 *   5. Handles AI degradation/fail-open gracefully with fallback handoff.
 */

const router = require('express').Router();
const { aiFetch } = require('./ai');

/* ── In-memory IP rate limiter for public concierge endpoint ────────────── */
const ipRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30;     // 30 requests / minute

function rateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = ipRequests.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  } else {
    entry.count++;
  }
  ipRequests.set(ip, entry);

  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      error: 'Too many requests. Please wait a moment before sending another message.',
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }
  next();
}

// Clean up expired rate limiter entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipRequests.entries()) {
    if (now > data.resetAt) ipRequests.delete(ip);
  }
}, 10 * 60 * 1000).unref();

/**
 * Handle asking a question (shared for POST /ask and POST /)
 */
async function handleAsk(req, res) {
  const { question, message, prompt, conversation_id, channel = 'web', external_id } = req.body || {};
  const queryText = (question || message || prompt || '').trim();

  if (!queryText) {
    return res.status(400).json({ error: 'question is required' });
  }

  const validChannels = ['web', 'whatsapp'];
  const convChannel = validChannels.includes(channel) ? channel : 'web';

  try {
    let convId = conversation_id ? parseInt(conversation_id, 10) : null;

    // 1. Resolve or create conversation
    if (convId) {
      const existing = await req.db.query(
        `SELECT id, status FROM concierge_conversations WHERE id = $1 AND tenant_id = $2`,
        [convId, req.tenant.id]
      );
      if (!existing.rows[0] || existing.rows[0].status === 'closed') {
        convId = null; // Stale or closed conversation, create a fresh one
      }
    }

    if (!convId) {
      const newConv = await req.db.query(
        `INSERT INTO concierge_conversations (tenant_id, channel, external_id, status)
         VALUES ($1, $2, $3, 'open')
         RETURNING id`,
        [req.tenant.id, convChannel, external_id || null]
      );
      convId = newConv.rows[0].id;
    }

    // 2. Persist guest query
    await req.db.query(
      `INSERT INTO concierge_messages (tenant_id, conversation_id, role, content)
       VALUES ($1, $2, 'guest', $3)`,
      [req.tenant.id, convId, queryText]
    );

    // 3. Fetch recent message history for context
    const historyQ = await req.db.query(
      `SELECT role, content
         FROM concierge_messages
        WHERE conversation_id = $1 AND tenant_id = $2
        ORDER BY created_at ASC
        LIMIT 10`,
      [convId, req.tenant.id]
    );

    // 4. Call FastAPI AI concierge service
    let aiRes;
    try {
      aiRes = await aiFetch(
        '/v1/concierge/ask',
        req.tenant.id,
        {
          conversation_id: convId,
          question: queryText,
          channel: convChannel,
          history: historyQ.rows,
        },
        20000 // 20s timeout
      );
    } catch (aiErr) {
      console.warn(`[concierge/ask] AI service failed for tenant ${req.tenant.id} (${aiErr.message}) — graceful fallback`);

      const fallbackAnswer = "I'm having a little trouble checking that right now. Our front desk team is notified and happy to assist you directly!";
      
      await req.db.query(
        `INSERT INTO concierge_messages
           (tenant_id, conversation_id, role, content, handoff)
         VALUES ($1, $2, 'assistant', $3, true)`,
        [req.tenant.id, convId, fallbackAnswer]
      );

      await req.db.query(
        `UPDATE concierge_conversations
            SET status = 'handoff', updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [convId, req.tenant.id]
      );

      return res.json({
        conversation_id: convId,
        answer: fallbackAnswer,
        sources: [],
        confidence: 0,
        handoff: true,
        degraded: true,
      });
    }

    // 5. Persist assistant response
    const {
      answer = '',
      sources = [],
      confidence = 1.0,
      handoff = false,
      model_version = null,
    } = aiRes || {};

    const msgInsert = await req.db.query(
      `INSERT INTO concierge_messages
         (tenant_id, conversation_id, role, content, sources, confidence, handoff, model_version)
       VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        req.tenant.id,
        convId,
        answer,
        JSON.stringify(sources),
        confidence != null ? Number(confidence) : null,
        Boolean(handoff),
        model_version,
      ]
    );

    // 6. Update conversation status & timestamp
    const newStatus = handoff ? 'handoff' : 'open';
    await req.db.query(
      `UPDATE concierge_conversations
          SET status = CASE WHEN status = 'handoff' THEN 'handoff' ELSE $1 END,
              updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3`,
      [newStatus, convId, req.tenant.id]
    );

    res.json({
      conversation_id: convId,
      message_id: msgInsert.rows[0].id,
      answer,
      sources,
      confidence,
      handoff: Boolean(handoff),
    });
  } catch (err) {
    console.error('[concierge/ask]', err.message);
    res.status(500).json({ error: 'Internal concierge error. Please try again later.' });
  }
}

/**
 * POST /api/concierge/ask — public guest-facing concierge query
 */
router.post('/ask', rateLimiter, handleAsk);
router.post('/', rateLimiter, handleAsk);

/**
 * GET /api/concierge/conversations/:id — retrieve conversation thread for guest widget
 */
router.get('/conversations/:id', rateLimiter, async (req, res) => {
  try {
    const convQ = await req.db.query(
      `SELECT id, channel, status, created_at, updated_at
         FROM concierge_conversations
        WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenant.id]
    );

    if (!convQ.rows[0]) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const msgsQ = await req.db.query(
      `SELECT id, role, content, sources, confidence, handoff, created_at
         FROM concierge_messages
        WHERE conversation_id = $1 AND tenant_id = $2
        ORDER BY created_at ASC`,
      [req.params.id, req.tenant.id]
    );

    res.json({
      conversation: convQ.rows[0],
      messages: msgsQ.rows,
    });
  } catch (err) {
    console.error('[concierge/get-conversation]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

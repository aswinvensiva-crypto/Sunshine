/**
 * whatsapp.js — self-hosted WhatsApp messaging via @whiskeysockets/baileys.
 *
 * Replaces the old whatsapp-web.js/Puppeteer approach with a lightweight
 * WebSocket-based connection — no Chromium required.
 *
 * Auth: stored in .baileys_auth/ (multi-file JSON). Scan QR once on first boot;
 *       subsequent restarts restore the session automatically.
 *
 * Reliability: messages are held in an in-memory queue for up to 10 minutes
 * while the socket is initialising. On timeout, text payloads are persisted to
 * the whatsapp_queue DB table and auto-retried on the 2-minute heartbeat.
 *
 * MULTI-TENANT POLICY (explicit Phase-2 decision, option b of the plan):
 * this remains ONE process-wide session — every message is sent from the
 * shared sender number. Messages always go to the correct guest/owner phone
 * for their own booking, so no tenant's data is sent to another tenant; but
 * new resorts share the sender identity until per-tenant sessions land.
 * Follow-up for per-tenant senders: one Baileys auth folder per tenant under
 * .baileys_auth/<tenant_id>/ keyed off tenant_settings.whatsapp_sender.
 * The retry queue writes run on the adminPool with tenant_id NULL (system
 * scope): those rows are invisible to every tenant under RLS.
 */

'use strict';

const path = require('path');
const pino = require('pino');
const qrTerminal = require('qrcode-terminal');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

/* ── constants ────────────────────────────────────────────────────────── */
const AUTH_DIR        = path.join(__dirname, '..', '..', '.baileys_auth');
const QUEUE_TIMEOUT   = 600_000; // 10 minutes
const RECONNECT_DELAY = 5_000;
const RETRY_DELAY     = 10_000;

/* ── module state ─────────────────────────────────────────────────────── */
let sock         = null;
let ready        = false;
let initializing = false;
let pendingQueue = []; // { jid, payload, resolve, timer }

/* ── lazy DB pool (admin: queue writes are system-scope, see header) ──── */
let _pool = null;
const getPool = () => { if (!_pool) _pool = require('../config/db').adminPool; return _pool; };

/* ── silent pino logger (keeps Baileys noise off the console) ────────── */
const logger = pino({ level: 'silent' });

/* ─────────────────────────────────────────────────────────────────────
   Phone → WhatsApp JID
   Handles Indian 10-digit numbers, leading 0, or E.164 strings.
   Baileys uses @s.whatsapp.net (not @c.us used by the old library).
   ───────────────────────────────────────────────────────────────────── */
function toJid(phone) {
  let n = String(phone).replace(/\D/g, '');
  if (n.startsWith('0'))    n = '91' + n.slice(1);
  else if (n.length === 10) n = '91' + n;
  return `${n}@s.whatsapp.net`;
}

/* ─────────────────────────────────────────────────────────────────────
   In-memory queue helpers
   ───────────────────────────────────────────────────────────────────── */
function drainQueue() {
  const items = pendingQueue.splice(0);
  for (const { jid, payload, resolve, timer } of items) {
    clearTimeout(timer);
    sock.sendMessage(jid, payload)
      .then(() => resolve({ ok: true }))
      .catch(err => resolve({ ok: false, reason: err.message }));
  }
}

function flushQueueWithError(reason) {
  const items = pendingQueue.splice(0);
  for (const { resolve, timer } of items) {
    clearTimeout(timer);
    resolve({ ok: false, reason });
  }
}

/* ─────────────────────────────────────────────────────────────────────
   DB queue helpers — text-only fallback; PDF is too large for DB
   ───────────────────────────────────────────────────────────────────── */
async function saveToDbQueue(jid, text) {
  try {
    await getPool().query(
      `INSERT INTO whatsapp_queue (chat_id, message_text) VALUES ($1, $2)`,
      [jid, text],
    );
    console.log(`[whatsapp] Saved to DB queue → ${jid}`);
  } catch (err) {
    console.error('[whatsapp] DB queue write failed:', err.message);
  }
}

async function drainDbQueue() {
  if (!ready || !sock) return;
  let rows = [];
  try {
    const r = await getPool().query(
      `SELECT id, chat_id, message_text FROM whatsapp_queue ORDER BY created_at ASC LIMIT 50`,
    );
    rows = r.rows;
  } catch (err) {
    console.error('[whatsapp] DB queue read failed:', err.message);
    return;
  }
  if (!rows.length) return;

  console.log(`[whatsapp] Draining ${rows.length} queued message(s)…`);
  for (const row of rows) {
    // Convert legacy @c.us JIDs (old whatsapp-web.js format) to @s.whatsapp.net
    const jid = row.chat_id.replace('@c.us', '@s.whatsapp.net');
    try {
      await sock.sendMessage(jid, { text: row.message_text });
      await getPool().query(`DELETE FROM whatsapp_queue WHERE id = $1`, [row.id]);
      console.log(`[whatsapp] DB queue sent id=${row.id} → ${jid}`);
    } catch (err) {
      console.error(`[whatsapp] DB queue send failed id=${row.id}:`, err.message);
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────
   initWhatsApp — creates a Baileys socket and wires all events.
   Called once at server boot; reconnects automatically on drop.
   ───────────────────────────────────────────────────────────────────── */
async function initWhatsApp() {
  if (initializing) {
    console.log('[whatsapp] Init already in progress — skipping');
    return;
  }
  initializing = true;
  ready        = false;

  try {
    const { state, saveCreds }            = await useMultiFileAuthState(AUTH_DIR);
    const { version }                     = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth:              state,
      logger,
      printQRInTerminal: false,        // we display QR ourselves
      browser:           ['Sunshine PMS', 'Safari', '1.0'],
      connectTimeoutMs:  60_000,
      keepAliveIntervalMs: 30_000,
      retryRequestDelayMs: 2_000,
    });

    /* ── persist auth credentials on every update ─────────────────── */
    sock.ev.on('creds.update', saveCreds);

    /* ── connection lifecycle ─────────────────────────────────────── */
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log('\n[whatsapp] Scan this QR code with the owner\'s WhatsApp:\n');
        qrTerminal.generate(qr, { small: true });
        console.log('\n[whatsapp] Waiting for QR scan…\n');
      }

      if (connection === 'open') {
        ready        = true;
        initializing = false;
        console.log('[whatsapp] ✅ Connected — messages will be sent from the owner\'s number.');
        drainQueue();
        await drainDbQueue();
      }

      if (connection === 'close') {
        ready        = false;
        initializing = false;

        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const badSession = code === DisconnectReason.badSession;

        if (loggedOut || badSession) {
          const hint = loggedOut ? 'Logged out by WhatsApp.' : 'Bad session — corrupted credentials.';
          console.error(`[whatsapp] ${hint} Delete .baileys_auth/ and restart to re-scan QR.`);
          flushQueueWithError(loggedOut ? 'whatsapp_logged_out' : 'bad_session');
          return;
        }

        console.warn(`[whatsapp] Connection closed (code: ${code ?? 'unknown'}). Reconnecting in ${RECONNECT_DELAY / 1000}s…`);
        setTimeout(initWhatsApp, RECONNECT_DELAY);
      }
    });

  } catch (err) {
    console.error('[whatsapp] Init error:', err.message);
    initializing = false;
    console.log(`[whatsapp] Retrying in ${RETRY_DELAY / 1000}s…`);
    setTimeout(initWhatsApp, RETRY_DELAY);
  }
}

/* ── 2-minute heartbeat: drain DB queue whenever socket is alive ────── */
setInterval(() => { if (ready) drainDbQueue(); }, 120_000);

/* ─────────────────────────────────────────────────────────────────────
   sendWhatsApp — send a plain-text message. Never throws.
   Returns { ok: true } or { ok: false, reason: string }.
   ───────────────────────────────────────────────────────────────────── */
async function sendWhatsApp(phone, message) {
  if (!phone)                       return { ok: false, reason: 'no_phone' };
  if (String(phone).includes('@'))  return { ok: false, reason: 'invalid_phone_is_email' };

  const jid = toJid(phone);

  if (!ready || !sock) {
    console.warn('[whatsapp] Not ready — queuing text to', phone);
    return new Promise(resolve => {
      const timer = setTimeout(async () => {
        const idx = pendingQueue.findIndex(i => i.resolve === resolve);
        if (idx !== -1) pendingQueue.splice(idx, 1);
        console.warn(`[whatsapp] Queue timeout for ${phone} — persisting to DB queue`);
        await saveToDbQueue(jid, message);
        resolve({ ok: false, reason: 'client_not_ready_timeout' });
      }, QUEUE_TIMEOUT);
      pendingQueue.push({ jid, payload: { text: message }, resolve, timer });
    });
  }

  try {
    await sock.sendMessage(jid, { text: message });
    console.log(`[whatsapp] ✉ Sent → ${phone}`);
    return { ok: true };
  } catch (err) {
    console.error(`[whatsapp] Send failed → ${phone}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

/* ─────────────────────────────────────────────────────────────────────
   sendWhatsAppDocument — send a PDF as a WhatsApp document. Never throws.
   Falls back to a caption text message if the document upload fails.
   ───────────────────────────────────────────────────────────────────── */
async function sendWhatsAppDocument(phone, pdfBuffer, filename, caption) {
  if (!phone)                       return { ok: false, reason: 'no_phone' };
  if (String(phone).includes('@'))  return { ok: false, reason: 'invalid_phone_is_email' };

  const jid = toJid(phone);
  const buf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);

  const docPayload = {
    document: buf,
    fileName: filename,
    mimetype: 'application/pdf',
    caption:  caption || '',
  };

  if (!ready || !sock) {
    console.warn('[whatsapp] Not ready — queuing PDF to', phone);
    return new Promise(resolve => {
      const timer = setTimeout(async () => {
        const idx = pendingQueue.findIndex(i => i.resolve === resolve);
        if (idx !== -1) pendingQueue.splice(idx, 1);
        console.warn(`[whatsapp] Queue timeout for PDF to ${phone} — saving caption as text fallback to DB queue`);
        if (caption) await saveToDbQueue(jid, caption);
        resolve({ ok: false, reason: 'client_not_ready_timeout' });
      }, QUEUE_TIMEOUT);
      pendingQueue.push({ jid, payload: docPayload, resolve, timer });
    });
  }

  try {
    await sock.sendMessage(jid, docPayload);
    console.log(`[whatsapp] 📄 PDF sent → ${phone}: ${filename}`);
    return { ok: true };
  } catch (err) {
    console.error(`[whatsapp] PDF send failed → ${phone}:`, err.message);
    // Fallback: send the caption as plain text so the guest is still notified
    try {
      const fallback = caption || `Your document (${filename}) is ready. Please contact us if you need a copy.`;
      await sock.sendMessage(jid, { text: fallback });
      console.log(`[whatsapp] Fallback text sent → ${phone}`);
      return { ok: false, reason: `pdf_failed_text_sent: ${err.message}` };
    } catch (fallbackErr) {
      console.error(`[whatsapp] Fallback text also failed → ${phone}:`, fallbackErr.message);
      return { ok: false, reason: err.message };
    }
  }
}

/* ── status helper used by the admin health-check endpoint ──────────── */
function getWhatsAppStatus() {
  return { ready, initializing };
}

module.exports = { initWhatsApp, sendWhatsApp, sendWhatsAppDocument, getWhatsAppStatus, drainDbQueue };

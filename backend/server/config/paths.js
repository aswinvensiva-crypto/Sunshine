/**
 * paths.js — where the server keeps files that must survive a redeploy.
 * Locally they live inside backend/. On Render, point them at the mounted
 * persistent disk (e.g. UPLOADS_DIR=/var/data/uploads,
 * WHATSAPP_AUTH_DIR=/var/data/baileys_auth) or every deploy wipes them.
 */
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(BACKEND_ROOT, 'uploads');
const WHATSAPP_AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || path.join(BACKEND_ROOT, '.baileys_auth');
// Built React app (client/dist). Served by Express when present, so one
// service hosts both the API and the website on the same origin.
const CLIENT_DIST = process.env.CLIENT_DIST || path.join(BACKEND_ROOT, '..', 'client', 'dist');

module.exports = { UPLOADS_DIR, WHATSAPP_AUTH_DIR, CLIENT_DIST };

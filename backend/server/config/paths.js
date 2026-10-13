/**
 * paths.js — where the server keeps files that must survive a redeploy.
 * Locally they live inside backend/. On Render, point them at the mounted
 * persistent disk (e.g. UPLOADS_DIR=/var/data/uploads,
 * WHATSAPP_AUTH_DIR=/var/data/baileys_auth) or every deploy wipes them.
 *
 * If a configured directory can't be created (e.g. the disk isn't attached,
 * or the plan has no disk), fall back to the local folder with a loud warning
 * instead of crashing — the app runs, but those files won't survive a deploy.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..');

function writableDir(configured, fallback, label) {
  if (!configured) return fallback;
  try {
    fs.mkdirSync(configured, { recursive: true });
    fs.accessSync(configured, fs.constants.W_OK);
    return configured;
  } catch (err) {
    console.warn(`[paths] ${label} '${configured}' is not writable (${err.code || err.message}) — ` +
      `using '${fallback}' instead. Attach a persistent disk there or these files are lost on every deploy.`);
    return fallback;
  }
}

const UPLOADS_DIR = writableDir(process.env.UPLOADS_DIR, path.join(BACKEND_ROOT, 'uploads'), 'UPLOADS_DIR');
const WHATSAPP_AUTH_DIR = writableDir(process.env.WHATSAPP_AUTH_DIR, path.join(BACKEND_ROOT, '.baileys_auth'), 'WHATSAPP_AUTH_DIR');
// Built React app (client/dist). Served by Express when present, so one
// service hosts both the API and the website on the same origin.
const CLIENT_DIST = process.env.CLIENT_DIST || path.join(BACKEND_ROOT, '..', 'client', 'dist');

module.exports = { UPLOADS_DIR, WHATSAPP_AUTH_DIR, CLIENT_DIST };

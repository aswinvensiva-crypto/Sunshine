/**
 * reset-platform-admin.js — set the password of the /platform (multi-resort)
 * super-admin. Reads the new password from PLATFORM_NEW_PASSWORD (>= 12 chars)
 * so it never appears in shell history as an argument.
 *
 *   $env:PLATFORM_NEW_PASSWORD="..."; npm run reset-platform-admin -- --username admin
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const username = arg('username') || 'admin';
  const password = process.env.PLATFORM_NEW_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set PLATFORM_NEW_PASSWORD (at least 12 characters) first');

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'sunshine',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  try {
    const r = await pool.query(
      'UPDATE platform_admins SET password_hash = $1 WHERE username = $2 RETURNING id',
      [await bcrypt.hash(password, 12), username]
    );
    if (!r.rows[0]) throw new Error(`No platform admin named '${username}'`);
    console.log(`Platform admin '${username}' password updated.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('reset-platform-admin failed:', e.message); process.exit(1); });

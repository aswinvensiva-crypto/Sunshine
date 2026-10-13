/**
 * tenant.js — resolves which resort (tenant) a request belongs to.
 *
 * Resolution order:
 *   1. X-Tenant-Slug header (dev / API testing convenience).
 *   2. Subdomain of the Host header: <slug>.sunshine.app or <slug>.localhost.
 *   3. DEFAULT_TENANT_SLUG env (dev fallback so plain http://localhost keeps
 *      working; defaults to 'sunshine-original' outside production, and is
 *      used in production only when set explicitly).
 *   TENANT_HOST_ROUTING=off: skip step 2 entirely (tunnels, single resort).
 *   BASE_DOMAIN (optional; on Render defaults to RENDER_EXTERNAL_HOSTNAME):
 *   only <slug>.<BASE_DOMAIN> hosts carry a slug.
 *
 * On success attaches:
 *   req.tenant — { id, slug, name, status, settings } (settings from
 *                 tenant_settings, may be {})
 *   req.db     — forTenant(tenant.id): { query, tx, connect } — the ONLY way
 *                 route handlers should touch tenant data. Queries through it
 *                 run under the RLS session var; anything else fails closed.
 *
 * 404 if the slug is unknown, 403 if the tenant is suspended.
 *
 * The tenant lookup runs on the adminPool (tenants is a platform table) and
 * is cached for CACHE_TTL_MS to keep it off the per-request hot path.
 */
const { adminPool, forTenant } = require('../config/db');

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // slug -> { tenant, expires }

function slugFromHost(hostname, baseDomain = process.env.BASE_DOMAIN || process.env.RENDER_EXTERNAL_HOSTNAME) {
  if (!hostname) return null;
  const host = String(hostname).toLowerCase().split(':')[0];
  // With BASE_DOMAIN set (e.g. sunshine.onrender.com or sunshine.app), only
  // <slug>.<BASE_DOMAIN> carries a slug; the bare domain itself has none.
  if (baseDomain) {
    const base = String(baseDomain).toLowerCase();
    if (host === base) return null;
    if (host.endsWith(`.${base}`)) {
      const sub = host.slice(0, -(base.length + 1));
      return sub.includes('.') ? null : sub;
    }
    return null;
  }
  const parts = host.split('.');
  // slug.localhost (dev) or slug.example.com (prod) — bare domains have no slug
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
    return parts.length >= 2 && parts[0] !== 'localhost' ? parts[0] : null;
  }
  if (parts.length >= 3) return parts[0];
  return null;
}

async function lookupTenant(slug) {
  const hit = cache.get(slug);
  if (hit && hit.expires > Date.now()) return hit.tenant;
  const { rows } = await adminPool.query(
    `SELECT t.id, t.slug, t.name, t.status,
            COALESCE(row_to_json(s), '{}'::json) AS settings
       FROM tenants t
       LEFT JOIN tenant_settings s ON s.tenant_id = t.id
      WHERE t.slug = $1`,
    [slug]
  );
  const tenant = rows[0] || null;
  cache.set(slug, { tenant, expires: Date.now() + CACHE_TTL_MS });
  return tenant;
}

/** Invalidate the cache after platform-side tenant changes (suspend etc.). */
function invalidateTenantCache(slug) {
  if (slug) cache.delete(slug); else cache.clear();
}

async function resolveTenant(req, res, next) {
  try {
    const headerSlug = (req.headers['x-tenant-slug'] || '').trim().toLowerCase();
    // TENANT_HOST_ROUTING=off: ignore the web address (tunnels / single-resort
    // hosting where the hostname is random), so DEFAULT_TENANT_SLUG decides.
    const hostSlug = process.env.TENANT_HOST_ROUTING === 'off'
      ? null
      : slugFromHost(req.hostname || req.headers.host);
    // Production only falls back when DEFAULT_TENANT_SLUG is set explicitly
    // (single-resort deployments); dev falls back to the original resort.
    const devFallback =
      process.env.NODE_ENV === 'production'
        ? (process.env.DEFAULT_TENANT_SLUG || null)
        : (process.env.DEFAULT_TENANT_SLUG || 'sunshine-original');

    const slug = headerSlug || hostSlug || devFallback;
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      return res.status(404).json({ error: 'Unknown resort', code: 'TENANT_NOT_FOUND' });
    }

    const tenant = await lookupTenant(slug);
    if (!tenant) {
      return res.status(404).json({ error: 'Unknown resort', code: 'TENANT_NOT_FOUND' });
    }
    if (tenant.status === 'suspended') {
      return res.status(403).json({ error: 'This resort is currently suspended', code: 'TENANT_SUSPENDED' });
    }

    req.tenant = tenant;
    req.db = forTenant(tenant.id);
    next();
  } catch (err) {
    console.error('[tenant] resolve error:', err.message);
    res.status(500).json({ error: 'Could not resolve resort' });
  }
}

module.exports = { resolveTenant, invalidateTenantCache, slugFromHost };

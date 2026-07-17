/**
 * tenant.js — which resort is this browser talking to?
 *
 * The slug is derived from the hostname (<slug>.sunshine.app in production,
 * <slug>.localhost in dev). A localStorage override ('tenant_slug') exists for
 * local API testing on plain http://localhost, where there is no subdomain;
 * without an override the backend's dev fallback (sunshine-original) applies.
 *
 * Importing this module (done first in main.jsx) installs a fetch interceptor
 * that stamps every same-origin /api and /uploads request with X-Tenant-Slug,
 * so the backend's resolveTenant always has an explicit slug to match against
 * the JWT's tenant. Note: <img src="/uploads/..."> requests don't go through
 * fetch — they rely on the subdomain (or the dev fallback) instead.
 */

export const getTenantSlug = () => {
  const stored = localStorage.getItem('tenant_slug');
  if (stored) return stored;
  const parts = window.location.hostname.toLowerCase().split('.');
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost' && parts[0] !== 'localhost') {
    return parts[0]; // slug.localhost (dev)
  }
  if (parts.length >= 3) return parts[0]; // slug.example.com
  return null; // bare host — backend dev fallback decides
};

export const setTenantSlug = (slug) => {
  if (slug) localStorage.setItem('tenant_slug', slug);
  else localStorage.removeItem('tenant_slug');
};

const origFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url.startsWith('/api') || url.startsWith('/uploads')) {
    const slug = getTenantSlug();
    if (slug) {
      init = { ...(init || {}) };
      init.headers = { ...(init.headers || {}), 'X-Tenant-Slug': slug };
    }
  }
  return origFetch(input, init);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugFromHost } = require('../server/middleware/tenant');

test('without BASE_DOMAIN: subdomain and .localhost behaviour unchanged', () => {
  assert.equal(slugFromHost('sunshine-original.localhost:5173', ''), 'sunshine-original');
  assert.equal(slugFromHost('localhost:5173', ''), null);
  assert.equal(slugFromHost('resort.sunshine.app', ''), 'resort');
});

test('with BASE_DOMAIN: the bare deploy host has no slug (falls back to DEFAULT_TENANT_SLUG)', () => {
  assert.equal(slugFromHost('sunshine-pms.onrender.com', 'sunshine-pms.onrender.com'), null);
});

test('with BASE_DOMAIN: only <slug>.<BASE_DOMAIN> carries a slug', () => {
  assert.equal(slugFromHost('beach.sunshine.app', 'sunshine.app'), 'beach');
  assert.equal(slugFromHost('a.b.sunshine.app', 'sunshine.app'), null);
  assert.equal(slugFromHost('evil.example.com', 'sunshine.app'), null);
  assert.equal(slugFromHost('BEACH.Sunshine.App:443', 'sunshine.app'), 'beach');
});

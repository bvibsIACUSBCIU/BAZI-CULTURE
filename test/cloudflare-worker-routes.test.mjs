import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.js';

const env = {
  DB: {},
  AUTH_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  ENVIRONMENT: 'production',
  ALLOWED_ORIGIN: 'https://app.example.test',
  SESSION_COOKIE_NAME: 'liangyi_session',
  SESSION_TTL_SECONDS: '21600',
};

test('Worker exposes health and protects authenticated routes with production security headers', async () => {
  const health = await worker.fetch(new Request('https://app.example.test/api/health'), env, {});
  const me = await worker.fetch(new Request('https://app.example.test/api/auth/me', { headers: { origin: 'https://evil.example' } }), env, {});

  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal(me.status, 401);
  assert.match(health.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.equal(me.headers.get('access-control-allow-origin'), null);
});

test('Worker preserves public chart API behavior while routing through the same security boundary', async () => {
  const response = await worker.fetch(new Request('https://app.example.test/api/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ consent: false }),
  }), env, {});

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'CONSENT_REQUIRED');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
});

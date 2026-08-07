import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handleQuotaRequest } from '../api/quota.js';
import { createRepositories } from '../lib/cloudflare/repositories/index.js';
import { createSessionService } from '../lib/auth/session-service.js';
import { createD1TestDatabase } from './helpers/d1-test-db.mjs';

const ORIGIN = 'https://app.example.test';
const WALLET = `0x${'4'.repeat(40)}`;

function createHarness() {
  const db = createD1TestDatabase();
  db.exec(readFileSync(new URL('../migrations/0001_wallet_account.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0002_daily_checkins.sql', import.meta.url), 'utf8'));
  const repositories = createRepositories(db, { now: () => '2026-08-08T00:00:00.000Z' });
  const sessions = createSessionService({ sessions: repositories.sessions, environment: 'production', now: () => Date.parse('2026-08-08T00:00:00.000Z') });
  return {
    db,
    repositories,
    sessions,
    env: {
      DB: db,
      AUTH_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
      ENVIRONMENT: 'production', ALLOWED_ORIGIN: ORIGIN,
      SESSION_COOKIE_NAME: 'liangyi_session', SESSION_TTL_SECONDS: '21600',
    },
  };
}

function request({ method = 'GET', body, cookie } = {}) {
  return new Request(`${ORIGIN}/api/quota`, {
    method,
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('quota uses the session owner ledger and records a daily check-in once', async (t) => {
  const { db, repositories, sessions, env } = createHarness();
  t.after(() => db.close());
  const user = await repositories.users.findOrCreate(WALLET);
  await repositories.credits.recordOnce({ userId: user.id, amount: 100, reason: 'welcome', idempotencyKey: `welcome:${user.id}` });
  const issued = await sessions.issue({ userId: user.id });
  const cookie = issued.cookie.split(';')[0];

  const initial = await handleQuotaRequest(request({ cookie }), { env });
  const checkin = await handleQuotaRequest(request({ method: 'POST', cookie, body: { action: 'checkin' } }), { env });
  const repeated = await handleQuotaRequest(request({ method: 'POST', cookie, body: { action: 'checkin' } }), { env });

  assert.equal((await initial.json()).points, 100);
  assert.equal((await checkin.json()).points, 200);
  assert.equal(repeated.status, 400);
  assert.equal(await repositories.credits.getBalance(user.id), 200);
});

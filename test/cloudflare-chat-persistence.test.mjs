import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handleChatRequest } from '../api/chat.js';
import handleSessionHistoryRequest from '../api/session-history.js';
import { createRepositories } from '../lib/cloudflare/repositories/index.js';
import { createSessionService } from '../lib/auth/session-service.js';
import { createD1TestDatabase } from './helpers/d1-test-db.mjs';

const ORIGIN = 'https://app.example.test';
const WALLET = `0x${'3'.repeat(40)}`;

function createHarness() {
  const db = createD1TestDatabase();
  db.exec(readFileSync(new URL('../migrations/0001_wallet_account.sql', import.meta.url), 'utf8'));
  const repositories = createRepositories(db);
  const sessions = createSessionService({ sessions: repositories.sessions, environment: 'production' });
  return {
    db,
    repositories,
    sessions,
    env: {
      DB: db,
      AUTH_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
      ENVIRONMENT: 'production',
      ALLOWED_ORIGIN: ORIGIN,
      SESSION_COOKIE_NAME: 'liangyi_session',
      SESSION_TTL_SECONDS: '21600',
    },
  };
}

function request(path, { method = 'GET', body, cookie } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const runPipeline = async ({ onEvent }) => {
  onEvent({ type: 'phase_start', phase: 'chart' });
  onEvent({ type: 'phase_done', phase: 'chart' });
  return {
    topics: [{ topic: 'career' }],
    summary: '基于本次确定命盘，事业节奏宜稳步推进。',
    report: '# 事业报告\n本报告由本次实际排盘与事业问题生成。',
    evidencePayload: { facts: [] },
    service: { degraded: false },
  };
};

test('authenticated chat persists one dynamic report and debits credits once per request id', async (t) => {
  const { db, repositories, sessions, env } = createHarness();
  t.after(() => db.close());
  const user = await repositories.users.findOrCreate(WALLET);
  await repositories.credits.recordOnce({ userId: user.id, amount: 100, reason: 'welcome', idempotencyKey: `welcome:${user.id}` });
  const profile = await repositories.profiles.create(user.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const issued = await sessions.issue({ userId: user.id });
  const cookie = issued.cookie.split(';')[0];
  const body = { profileId: profile.id, question: '如何推进事业', requestId: 'chat-1' };

  const first = await handleChatRequest(request('/api/chat', { method: 'POST', cookie, body }), { env, runPipeline });
  const second = await handleChatRequest(request('/api/chat', { method: 'POST', cookie, body }), { env, runPipeline });
  await first.text();
  await second.text();
  const history = await handleSessionHistoryRequest(request('/api/session-history', { cookie }), { env });
  const sessionsList = (await history.json()).sessions;

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(sessionsList.length, 1);
  assert.equal(sessionsList[0].reportMarkdown, '# 事业报告\n本报告由本次实际排盘与事业问题生成。');
  assert.equal(await repositories.credits.getBalance(user.id), 90);
  assert.equal(await repositories.credits.countByIdempotencyKey(user.id, 'chat-1'), 1);
});

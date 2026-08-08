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
  db.exec(readFileSync(new URL('../migrations/0003_threaded_conversation_versions.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0004_conversation_turn_requests.sql', import.meta.url), 'utf8'));
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

test('a second question appends transcript messages and creates report version 2 in one owned thread', async (t) => {
  const { db, repositories, sessions, env } = createHarness();
  t.after(() => db.close());
  const user = await repositories.users.findOrCreate(WALLET);
  await repositories.credits.recordOnce({ userId: user.id, amount: 100, reason: 'welcome', idempotencyKey: `welcome:${user.id}` });
  const profile = await repositories.profiles.create(user.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const cookie = (await sessions.issue({ userId: user.id })).cookie.split(';')[0];

  const first = await handleChatRequest(request('/api/chat', {
    method: 'POST', cookie, body: { profileId: profile.id, question: '第一问', requestId: 'turn-1' },
  }), { env, runPipeline });
  await first.text();
  const thread = (await repositories.conversations.list(user.id))[0];
  const second = await handleChatRequest(request('/api/chat', {
    method: 'POST', cookie, body: { profileId: profile.id, conversationId: thread.id, question: '第二问', requestId: 'turn-2' },
  }), { env, runPipeline });
  const secondEvents = await readEvents(second);

  assert.equal(second.status, 200);
  assert.deepEqual((await repositories.messages.list(user.id, thread.id)).map((message) => message.role), ['user', 'assistant', 'user', 'assistant']);
  assert.deepEqual((await repositories.reports.listByConversation(user.id, thread.id)).map((report) => report.versionNumber), [1, 2]);
  assert.deepEqual(secondEvents.find((event) => event.type === 'report'), {
    type: 'report', markdown: '# 事业报告\n本报告由本次实际排盘与事业问题生成。', conversationId: thread.id, reportVersion: 2,
  });

  const replay = await handleChatRequest(request('/api/chat', {
    method: 'POST', cookie, body: { profileId: profile.id, conversationId: thread.id, question: '第二问', requestId: 'turn-2' },
  }), { env, runPipeline });
  await replay.text();
  assert.equal((await repositories.messages.list(user.id, thread.id)).length, 4);
  assert.equal((await repositories.reports.listByConversation(user.id, thread.id)).length, 2);
  assert.equal(await repositories.credits.countByIdempotencyKey(user.id, 'turn-2'), 1);
});

test('replaying an earlier turn request returns its original report without appending or debiting again', async (t) => {
  const { db, repositories, sessions, env } = createHarness();
  t.after(() => db.close());
  const user = await repositories.users.findOrCreate(WALLET);
  await repositories.credits.recordOnce({ userId: user.id, amount: 100, reason: 'welcome', idempotencyKey: `welcome:${user.id}` });
  const profile = await repositories.profiles.create(user.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const cookie = (await sessions.issue({ userId: user.id })).cookie.split(';')[0];
  let pipelineCalls = 0;
  const countedPipeline = async (input) => {
    pipelineCalls += 1;
    return runPipeline(input);
  };

  await (await handleChatRequest(request('/api/chat', {
    method: 'POST', cookie, body: { profileId: profile.id, question: '第一问', requestId: 'turn-1' },
  }), { env, runPipeline: countedPipeline })).text();
  const thread = (await repositories.conversations.list(user.id))[0];
  await (await handleChatRequest(request('/api/chat', {
    method: 'POST', cookie, body: { profileId: profile.id, conversationId: thread.id, question: '第二问', requestId: 'turn-2' },
  }), { env, runPipeline: countedPipeline })).text();
  const replayEvents = await readEvents(await handleChatRequest(request('/api/chat', {
    method: 'POST', cookie, body: { profileId: profile.id, conversationId: thread.id, question: '第一问', requestId: 'turn-1' },
  }), { env, runPipeline: countedPipeline }));

  assert.equal((await repositories.messages.list(user.id, thread.id)).length, 4);
  assert.deepEqual((await repositories.reports.listByConversation(user.id, thread.id)).map((report) => report.versionNumber), [1, 2]);
  assert.equal(await repositories.credits.getBalance(user.id), 80);
  assert.equal(await repositories.credits.countByIdempotencyKey(user.id, 'turn-1'), 1);
  assert.equal(await repositories.credits.countByIdempotencyKey(user.id, 'turn-2'), 1);
  assert.equal(pipelineCalls, 2);
  assert.equal(replayEvents.find((event) => event.type === 'report').reportVersion, 1);
});

test('a foreign wallet cannot append to another wallet thread', async (t) => {
  const { db, repositories, sessions, env } = createHarness();
  t.after(() => db.close());
  const owner = await repositories.users.findOrCreate(WALLET);
  const foreign = await repositories.users.findOrCreate(`0x${'4'.repeat(40)}`);
  const profile = await repositories.profiles.create(owner.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const foreignProfile = await repositories.profiles.create(foreign.id, {
    name: '外来者', date: '1992-05-06', time: '09:00', gender: 'male', timeKnown: true,
  });
  const thread = await repositories.conversations.create(owner.id, {
    profileId: profile.id, requestId: 'owner-turn', question: '所有者问题', title: '所有者问题', topic: 'overview',
  });
  const foreignCookie = (await sessions.issue({ userId: foreign.id })).cookie.split(';')[0];

  const response = await handleChatRequest(request('/api/chat', {
    method: 'POST', cookie: foreignCookie, body: { profileId: foreignProfile.id, conversationId: thread.id, question: '越权', requestId: 'foreign-turn' },
  }), { env, runPipeline });

  assert.equal(response.status, 404);
  assert.equal((await repositories.messages.list(owner.id, thread.id)).length, 0);
});

async function readEvents(response) {
  return (await response.text()).trim().split('\n\n').filter(Boolean).map((entry) => JSON.parse(entry.slice('data: '.length)));
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handleProfileRequest } from '../api/profile.js';
import handleSessionHistoryRequest from '../api/session-history.js';
import handlePreferencesRequest from '../api/preferences.js';
import { createRepositories } from '../lib/cloudflare/repositories/index.js';
import { createSessionService } from '../lib/auth/session-service.js';
import { createD1TestDatabase } from './helpers/d1-test-db.mjs';

const ORIGIN = 'https://app.example.test';
const OWNER_WALLET = `0x${'1'.repeat(40)}`;
const OTHER_WALLET = `0x${'2'.repeat(40)}`;

function createHarness() {
  const db = createD1TestDatabase();
  db.exec(readFileSync(new URL('../migrations/0001_wallet_account.sql', import.meta.url), 'utf8'));
  const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
  const repositories = createRepositories(db);
  const sessions = createSessionService({ sessions: repositories.sessions, environment: 'production' });
  return {
    db,
    repositories,
    sessions,
    env: {
      DB: db,
      AUTH_KV: kv,
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

async function cookieFor(repositories, sessions, wallet) {
  const user = await repositories.users.findOrCreate(wallet);
  const issued = await sessions.issue({ userId: user.id });
  return issued.cookie.split(';')[0];
}

test('profile and conversation APIs ignore wallet parameters and enforce session ownership', async (t) => {
  const { db, repositories, sessions, env } = createHarness();
  t.after(() => db.close());
  const ownerCookie = await cookieFor(repositories, sessions, OWNER_WALLET);
  const otherCookie = await cookieFor(repositories, sessions, OTHER_WALLET);

  const createdProfileResponse = await handleProfileRequest(request('/api/profile', {
    method: 'POST', cookie: ownerCookie,
    body: { action: 'add', wallet: OTHER_WALLET, name: '青木', date: '1994-03-08', time: '08:00', gender: 'female' },
  }), { env });
  const profile = (await createdProfileResponse.json()).profile;
  const foreignDelete = await handleProfileRequest(request('/api/profile', {
    method: 'DELETE', cookie: otherCookie, body: { profileId: profile.id, wallet: OWNER_WALLET },
  }), { env });
  const ownerConversationResponse = await handleSessionHistoryRequest(request('/api/session-history', {
    method: 'POST', cookie: ownerCookie,
    body: { action: 'add', wallet: OTHER_WALLET, profileId: profile.id, title: '事业', question: '如何推进事业', topic: 'career' },
  }), { env });
  const ownerConversation = await ownerConversationResponse.clone().json();
  const ownerDetail = await handleSessionHistoryRequest(request(`/api/session-history?sessionId=${ownerConversation.session.id}`, {
    cookie: ownerCookie,
  }), { env });
  const foreignDetail = await handleSessionHistoryRequest(request(`/api/session-history?sessionId=${ownerConversation.session.id}`, {
    cookie: otherCookie,
  }), { env });
  const ownerProfiles = await handleProfileRequest(request('/api/profile', { cookie: ownerCookie }), { env });
  const otherProfiles = await handleProfileRequest(request('/api/profile', { cookie: otherCookie }), { env });
  const ownerList = await handleSessionHistoryRequest(request('/api/session-history', { cookie: ownerCookie }), { env });
  const otherList = await handleSessionHistoryRequest(request('/api/session-history', { cookie: otherCookie }), { env });

  assert.equal(createdProfileResponse.status, 200);
  assert.equal(foreignDelete.status, 404);
  assert.equal(ownerConversationResponse.status, 200);
  assert.equal(ownerDetail.status, 200);
  assert.equal((await ownerDetail.json()).session.id, ownerConversation.session.id);
  assert.equal(foreignDetail.status, 404);
  assert.equal((await ownerProfiles.json()).profiles.length, 1);
  assert.equal((await otherProfiles.json()).profiles.length, 0);
  assert.equal((await ownerList.json()).sessions.length, 1);
  assert.deepEqual((await otherList.json()).sessions, []);
});

test('protected profile and conversation APIs require a valid session', async (t) => {
  const { db, env } = createHarness();
  t.after(() => db.close());

  const profileResponse = await handleProfileRequest(request('/api/profile?wallet=0x123'), { env });
  const conversationResponse = await handleSessionHistoryRequest(request('/api/session-history?wallet=0x123'), { env });

  assert.equal(profileResponse.status, 401);
  assert.equal(conversationResponse.status, 401);
});

test('preferences synchronize only to the wallet that owns the signed session', async (t) => {
  const { db, repositories, sessions, env } = createHarness();
  t.after(() => db.close());
  const ownerCookie = await cookieFor(repositories, sessions, OWNER_WALLET);
  const otherCookie = await cookieFor(repositories, sessions, OTHER_WALLET);
  const profile = await repositories.profiles.create((await repositories.users.findByWallet(OWNER_WALLET)).id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });

  const saved = await handlePreferencesRequest(request('/api/preferences', {
    method: 'PATCH', cookie: ownerCookie,
    body: { activeProfileId: profile.id, settings: { sidebarCollapsed: true, density: 'compact' } },
  }), { env });
  const other = await handlePreferencesRequest(request('/api/preferences', { cookie: otherCookie }), { env });

  assert.deepEqual((await saved.json()).preferences, {
    activeProfileId: profile.id,
    settings: { sidebarCollapsed: true, density: 'compact' },
  });
  assert.deepEqual((await other.json()).preferences, { activeProfileId: null, settings: {} });
});

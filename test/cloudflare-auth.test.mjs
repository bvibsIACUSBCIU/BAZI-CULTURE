import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Wallet } from 'ethers';

import { createChallengeService } from '../lib/auth/challenge-service.js';
import { createSessionService } from '../lib/auth/session-service.js';
import { createRepositories } from '../lib/cloudflare/repositories/index.js';
import { handleAuthRequest } from '../api/auth.js';
import { createD1TestDatabase } from './helpers/d1-test-db.mjs';

const ORIGIN = 'https://app.example.test';

function createHarness() {
  const db = createD1TestDatabase();
  db.exec(readFileSync(new URL('../migrations/0001_wallet_account.sql', import.meta.url), 'utf8'));
  const kv = new MemoryKv();
  let id = 0;
  const createId = (prefix) => `${prefix}-${++id}`;
  const now = () => '2026-08-08T00:00:00.000Z';
  return {
    db,
    kv,
    repositories: createRepositories(db, { now, createId }),
    challengeService: createChallengeService({ kv, canonicalOrigin: ORIGIN, now: () => Date.parse(now()), createId }),
    sessionService: createSessionService({ sessions: createRepositories(db, { now, createId }).sessions, environment: 'production', now: () => Date.parse(now()) }),
  };
}

function request(path, { method = 'GET', body, cookie } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async delete(key) {
    this.values.delete(key);
  }
}

test('a verified wallet challenge is consumed once and creates a hashed HttpOnly session', async (t) => {
  const { db, repositories, challengeService, sessionService } = createHarness();
  t.after(() => db.close());
  const wallet = Wallet.createRandom();
  const challenge = await challengeService.issue({ walletAddress: wallet.address, operation: 'register', origin: ORIGIN });
  const signature = await wallet.signMessage(challenge.message);

  const verified = await challengeService.consume({
    challengeId: challenge.challengeId,
    walletAddress: wallet.address,
    signature,
    operation: 'register',
    origin: ORIGIN,
  });
  const user = await repositories.users.findOrCreate(verified.walletAddress);
  const issued = await sessionService.issue({ userId: user.id });
  const resolved = await sessionService.resolve(new Request('https://app.example.test/api/auth/me', {
    headers: { cookie: issued.cookie.split(';')[0] },
  }));

  assert.equal(verified.walletAddress, wallet.address.toLowerCase());
  assert.equal(resolved.userId, user.id);
  assert.match(issued.cookie, /HttpOnly/);
  assert.match(issued.cookie, /Secure/);
  assert.match(issued.cookie, /SameSite=Lax/);
  const stored = await db.prepare('SELECT secret_hash FROM auth_sessions WHERE id = ?').bind(issued.session.id).first();
  assert.notEqual(stored.secret_hash, issued.token);
});

test('replayed, wrong-operation, and wrong-origin challenges never verify', async (t) => {
  const { db, challengeService } = createHarness();
  t.after(() => db.close());
  const wallet = Wallet.createRandom();
  const challenge = await challengeService.issue({ walletAddress: wallet.address, operation: 'login', origin: ORIGIN });
  const signature = await wallet.signMessage(challenge.message);

  await assert.rejects(
    challengeService.consume({ challengeId: challenge.challengeId, walletAddress: wallet.address, signature, operation: 'register', origin: ORIGIN }),
    { code: 'SIGNATURE_VERIFICATION_FAILED' },
  );
  await assert.rejects(
    challengeService.consume({ challengeId: challenge.challengeId, walletAddress: wallet.address, signature, operation: 'login', origin: 'https://other.example.test' }),
    { code: 'SIGNATURE_VERIFICATION_FAILED' },
  );
  await challengeService.consume({ challengeId: challenge.challengeId, walletAddress: wallet.address, signature, operation: 'login', origin: ORIGIN });
  await assert.rejects(
    challengeService.consume({ challengeId: challenge.challengeId, walletAddress: wallet.address, signature, operation: 'login', origin: ORIGIN }),
    { code: 'SIGNATURE_VERIFICATION_FAILED' },
  );
});

test('Cloudflare auth endpoint authorizes /me from its signed session rather than a wallet parameter', async (t) => {
  const { db, kv } = createHarness();
  t.after(() => db.close());
  const wallet = Wallet.createRandom();
  const env = {
    DB: db,
    AUTH_KV: kv,
    ENVIRONMENT: 'production',
    ALLOWED_ORIGIN: ORIGIN,
    SESSION_COOKIE_NAME: 'liangyi_session',
    SESSION_TTL_SECONDS: '21600',
  };
  const query = new URLSearchParams({ wallet: wallet.address, operation: 'register' });
  const challengeResponse = await handleAuthRequest(request(`/api/auth/challenge?${query}`), { env });
  const challenge = await challengeResponse.json();
  const signature = await wallet.signMessage(challenge.message);
  const loginResponse = await handleAuthRequest(request('/api/auth/register', {
    method: 'POST', body: { wallet: wallet.address, challengeId: challenge.challengeId, signature },
  }), { env });
  const login = await loginResponse.json();
  const cookie = loginResponse.headers.get('set-cookie').split(';')[0];
  const meResponse = await handleAuthRequest(request(`/api/auth/me?wallet=${'0x'.padEnd(42, 'f')}`, { cookie }), { env });

  assert.equal(loginResponse.status, 200);
  assert.equal(login.account.walletAddress, wallet.address.toLowerCase());
  assert.equal(meResponse.status, 200);
  assert.equal((await meResponse.json()).account.walletAddress, wallet.address.toLowerCase());
});

test('Cloudflare wallet authentication creates once and grants welcome credit once without a username', async (t) => {
  const { db, kv } = createHarness();
  t.after(() => db.close());
  const wallet = Wallet.createRandom();
  const env = {
    DB: db,
    AUTH_KV: kv,
    ENVIRONMENT: 'production',
    ALLOWED_ORIGIN: ORIGIN,
    SESSION_COOKIE_NAME: 'liangyi_session',
    SESSION_TTL_SECONDS: '21600',
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const query = new URLSearchParams({ wallet: wallet.address, operation: 'authenticate' });
    const challengeResponse = await handleAuthRequest(request(`/api/auth/challenge?${query}`), { env });
    assert.equal(challengeResponse.status, 200);
    const challenge = await challengeResponse.json();
    const signature = await wallet.signMessage(challenge.message);
    const authResponse = await handleAuthRequest(request('/api/auth/authenticate', {
      method: 'POST', body: { wallet: wallet.address, challengeId: challenge.challengeId, signature },
    }), { env });
    assert.equal(authResponse.status, 200);
    const payload = await authResponse.json();
    assert.equal(payload.account.walletAddress, wallet.address.toLowerCase());
    assert.equal(payload.account.username, null);
  }

  const users = await db.prepare('SELECT COUNT(*) AS count FROM users WHERE wallet_address = ?').bind(wallet.address.toLowerCase()).first();
  const welcomeCredits = await db.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE reason = 'welcome'").first();
  assert.equal(users.count, 1);
  assert.equal(welcomeCredits.count, 1);
});

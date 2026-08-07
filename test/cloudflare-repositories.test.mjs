import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createRepositories } from '../lib/cloudflare/repositories/index.js';
import { createD1TestDatabase } from './helpers/d1-test-db.mjs';

const OWNER_WALLET = `0x${'1'.repeat(40)}`;
const OTHER_WALLET = `0x${'2'.repeat(40)}`;

function createHarness() {
  const db = createD1TestDatabase();
  db.exec(readFileSync(new URL('../migrations/0001_wallet_account.sql', import.meta.url), 'utf8'));
  return { db, repositories: createRepositories(db, { now: () => '2026-08-08T00:00:00.000Z', createId: nextId() }) };
}

function nextId() {
  let number = 0;
  return (prefix) => `${prefix}-${++number}`;
}

test('repositories isolate profiles and conversations by authenticated user id', async (t) => {
  const { db, repositories } = createHarness();
  t.after(() => db.close());
  const owner = await repositories.users.findOrCreate(OWNER_WALLET);
  const other = await repositories.users.findOrCreate(OTHER_WALLET);
  const profile = await repositories.profiles.create(owner.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true, birthplace: '杭州',
  });
  const conversation = await repositories.conversations.create(owner.id, {
    profileId: profile.id, requestId: 'chat-one', title: '事业', question: '如何推进事业', topic: 'career',
  });

  assert.equal(await repositories.profiles.findById(other.id, profile.id), null);
  assert.equal(await repositories.conversations.findById(other.id, conversation.id), null);
  assert.equal((await repositories.conversations.list(other.id)).length, 0);
});

test('preferences upsert for one user without changing another user settings', async (t) => {
  const { db, repositories } = createHarness();
  t.after(() => db.close());
  const owner = await repositories.users.findOrCreate(OWNER_WALLET);
  const other = await repositories.users.findOrCreate(OTHER_WALLET);
  const profile = await repositories.profiles.create(owner.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });

  await repositories.preferences.save(owner.id, { activeProfileId: profile.id, settings: { density: 'compact' } });
  assert.deepEqual(await repositories.preferences.get(owner.id), { activeProfileId: profile.id, settings: { density: 'compact' } });
  assert.deepEqual(await repositories.preferences.get(other.id), { activeProfileId: null, settings: {} });
});

test('credit ledger grants and debits only once for the same idempotency key', async (t) => {
  const { db, repositories } = createHarness();
  t.after(() => db.close());
  const user = await repositories.users.findOrCreate(OWNER_WALLET);

  await repositories.credits.recordOnce({ userId: user.id, amount: 100, reason: 'welcome', idempotencyKey: 'welcome-1' });
  const firstDebit = await repositories.credits.recordOnce({ userId: user.id, amount: -10, reason: 'chat', idempotencyKey: 'chat-1' });
  const replayedDebit = await repositories.credits.recordOnce({ userId: user.id, amount: -10, reason: 'chat', idempotencyKey: 'chat-1' });

  assert.equal(firstDebit.balance, 90);
  assert.equal(replayedDebit.balance, 90);
  assert.equal(await repositories.credits.getBalance(user.id), 90);
  assert.equal(await repositories.credits.countByIdempotencyKey(user.id, 'chat-1'), 1);
});

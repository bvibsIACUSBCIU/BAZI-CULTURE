import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = new URL('../migrations/0001_wallet_account.sql', import.meta.url);

test('wallet account migration defines every durable ownership table and key constraint', () => {
  assert.equal(existsSync(migrationPath), true, 'D1 migration must exist');

  const migration = readFileSync(migrationPath, 'utf8');
  for (const table of [
    'users',
    'profiles',
    'conversations',
    'conversation_messages',
    'reports',
    'user_preferences',
    'credit_ledger',
    'auth_sessions',
    'audit_events',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
  }

  assert.match(migration, /UNIQUE \(user_id, request_id\)/);
  assert.match(migration, /UNIQUE \(user_id, idempotency_key\)/);
  assert.match(migration, /secret_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /deleted_at TEXT/);
});

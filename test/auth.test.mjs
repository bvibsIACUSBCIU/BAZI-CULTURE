import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthRequest } from '../api/auth.js';
import { defaultAuthService } from '../lib/runtime/auth-service.js';

test('Auth API - GET /api/auth/challenge requires wallet', async () => {
  const req = new Request('http://localhost/api/auth/challenge', { method: 'GET' });
  const res = await handleAuthRequest(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'MISSING_WALLET_ADDRESS');
});

test('Auth API - GET /api/auth/challenge success', async () => {
  const req = new Request('http://localhost/api/auth/challenge?wallet=0xTestAuth', { method: 'GET' });
  const res = await handleAuthRequest(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.ok(json.challenge);
});

test('Auth Service - Account registration & master profile', async () => {
  const wallet = '0xTestAuthAccount';
  const account = defaultAuthService.loginOrRegister(wallet, '127.0.0.1');
  assert.equal(account.walletAddress, wallet.toLowerCase());
  assert.equal(account.credits, 100);

  defaultAuthService.setMasterProfile(wallet, {
    name: '测试命主',
    gender: 'male',
    birthYear: 1990,
    birthMonth: 6,
    birthDay: 15,
    birthHour: 14
  });

  const updated = defaultAuthService.getAccount(wallet);
  assert.equal(updated.masterProfile.name, '测试命主');
  assert.equal(updated.masterProfile.birthYear, 1990);
});

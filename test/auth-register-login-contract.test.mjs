import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Wallet } from 'ethers';
import { handleAuthRequest } from '../api/auth.js';
import { defaultAuthService } from '../lib/runtime/auth-service.js';

function resetAuthState() {
  defaultAuthService.accounts.clear();
  defaultAuthService.challenges.clear();
  defaultAuthService.ipToWallets.clear();
  defaultAuthService.usernameToWallets?.clear();
}

function request(url, { method = 'GET', body, origin = 'http://app.example.test' } = {}) {
  return new Request(url, {
    method,
    headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function jsonResponse(req) {
  const response = await handleAuthRequest(req);
  return { status: response.status, body: await response.json() };
}

async function challengeFor({ wallet, operation, username, origin }) {
  const query = new URLSearchParams({ wallet: wallet.address, operation });
  if (username !== undefined) query.set('username', username);
  const challenge = await jsonResponse(request(`http://api.example.test/api/auth/challenge?${query}`, { origin }));
  assert.equal(challenge.status, 200);
  return {
    wallet: wallet.address,
    username,
    challengeId: challenge.body.challengeId,
    signature: await wallet.signMessage(challenge.body.challenge)
  };
}

test('auth API authenticates a wallet without a username', async () => {
  resetAuthState();
  const wallet = Wallet.createRandom();
  const origin = 'http://app.example.test';
  const payload = await challengeFor({ wallet, operation: 'authenticate', origin });

  const result = await jsonResponse(request('http://api.example.test/api/auth/authenticate', {
    method: 'POST', origin, body: payload,
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.account.walletAddress, wallet.address.toLowerCase());
  assert.equal(result.body.account.username, null);
});

test('auth API registers a username and wallet only through a register-bound signature', async () => {
  resetAuthState();
  const wallet = Wallet.createRandom();
  const origin = 'http://app.example.test';
  const payload = await challengeFor({ wallet, operation: 'register', username: '青木', origin });

  const result = await jsonResponse(request('http://api.example.test/api/auth/register', {
    method: 'POST', origin, body: payload
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.account.walletAddress, wallet.address.toLowerCase());
  assert.equal(result.body.account.username, '青木');
});

test('auth API rejects login unless its username and wallet match an existing registration', async () => {
  resetAuthState();
  const wallet = Wallet.createRandom();
  const origin = 'http://app.example.test';
  const registerPayload = await challengeFor({ wallet, operation: 'register', username: '青木', origin });
  await jsonResponse(request('http://api.example.test/api/auth/register', { method: 'POST', origin, body: registerPayload }));

  const mismatchedPayload = await challengeFor({ wallet, operation: 'login', username: '白芷', origin });
  const rejected = await jsonResponse(request('http://api.example.test/api/auth/login', {
    method: 'POST', origin, body: mismatchedPayload
  }));
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, 'USERNAME_WALLET_MISMATCH');

  const loginPayload = await challengeFor({ wallet, operation: 'login', username: '青木', origin });
  const accepted = await jsonResponse(request('http://api.example.test/api/auth/login', {
    method: 'POST', origin, body: loginPayload
  }));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.account.username, '青木');
});

test('auth API keeps registered usernames unique across wallets', async () => {
  resetAuthState();
  const origin = 'http://app.example.test';
  const firstWallet = Wallet.createRandom();
  const firstPayload = await challengeFor({ wallet: firstWallet, operation: 'register', username: '青木', origin });
  await jsonResponse(request('http://api.example.test/api/auth/register', { method: 'POST', origin, body: firstPayload }));

  const secondWallet = Wallet.createRandom();
  const duplicatePayload = await challengeFor({ wallet: secondWallet, operation: 'register', username: '青木', origin });
  const duplicate = await jsonResponse(request('http://api.example.test/api/auth/register', {
    method: 'POST', origin, body: duplicatePayload
  }));
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.error, 'USERNAME_TAKEN');
});

test('auth API challenge cannot be used for another operation or origin', async () => {
  resetAuthState();
  const wallet = Wallet.createRandom();
  const payload = await challengeFor({ wallet, operation: 'register', username: '青木', origin: 'http://app.example.test' });

  const wrongOperation = await jsonResponse(request('http://api.example.test/api/auth/login', {
    method: 'POST', origin: 'http://app.example.test', body: payload
  }));
  assert.equal(wrongOperation.status, 401);
  assert.equal(wrongOperation.body.error, 'SIGNATURE_VERIFICATION_FAILED');

  const freshPayload = await challengeFor({ wallet, operation: 'register', username: '青木', origin: 'http://app.example.test' });
  const wrongOrigin = await jsonResponse(request('http://api.example.test/api/auth/register', {
    method: 'POST', origin: 'http://other.example.test', body: freshPayload
  }));
  assert.equal(wrongOrigin.status, 401);
  assert.equal(wrongOrigin.body.error, 'SIGNATURE_VERIFICATION_FAILED');
});

test('frontend exposes an auth modal and never signs while checking eth_accounts at startup', () => {
  const appJs = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const appHtml = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

  assert.match(appHtml, /id="auth-modal"/);
  assert.match(appHtml, /id="auth-submit-btn"/);
  assert.doesNotMatch(appHtml, /id="auth-username"/);
  assert.doesNotMatch(appHtml, /id="auth-register-btn"/);
  assert.doesNotMatch(appHtml, /id="auth-login-btn"/);
  assert.match(appJs, /operation[\s=:]+['"]authenticate['"]/);
  assert.doesNotMatch(appJs, /window\.prompt\(/);
  assert.match(appJs, /function checkWalletConnection\(\)[\s\S]*?eth_accounts[\s\S]*?setWalletCandidate/);
  assert.doesNotMatch(appJs, /function checkWalletConnection\(\)[\s\S]*?connectWallet\(/);
  assert.match(appJs, /accountsChanged[\s\S]*?disconnectWallet/);
});

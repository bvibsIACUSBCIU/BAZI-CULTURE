import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../lib/runtime/auth-service.js';

test('AuthService - challenge generation and signature validation', () => {
  const auth = new AuthService();
  const wallet = '0x1234567890abcdef1234567890abcdef12345678';
  
  const challengeData = auth.generateChallenge(wallet);
  assert.equal(typeof challengeData.challengeId, 'string');
  assert.ok(challengeData.challenge.includes(wallet.toLowerCase()));

  // 验证错误钱包地址
  const verifiedInvalidWallet = auth.verifySignature(challengeData.challengeId, '0x0000000000000000000000000000000000000000', '0x1234567890abcdef');
  assert.equal(verifiedInvalidWallet, false);

  // 验证有效签名
  const verifiedValid = auth.verifySignature(challengeData.challengeId, wallet, '0x1234567890abcdef');
  assert.equal(verifiedValid, true);

  // 校验一次性防重放
  const verifiedReplay = auth.verifySignature(challengeData.challengeId, wallet, '0x1234567890abcdef');
  assert.equal(verifiedReplay, false);
});

test('AuthService - IP registration limit enforcement (max 3 wallets per IP)', () => {
  const auth = new AuthService();
  const testIp = '192.168.1.100';

  const w1 = '0x1111111111111111111111111111111111111111';
  const w2 = '0x2222222222222222222222222222222222222222';
  const w3 = '0x3333333333333333333333333333333333333333';
  const w4 = '0x4444444444444444444444444444444444444444';

  // 允许前 3 个注册
  const acc1 = auth.loginOrRegister(w1, testIp);
  const acc2 = auth.loginOrRegister(w2, testIp);
  const acc3 = auth.loginOrRegister(w3, testIp);

  assert.equal(acc1.credits, 100);
  assert.equal(acc2.credits, 100);
  assert.equal(acc3.credits, 100);

  // 重复登录已存在的账户不受限制
  const reAcc1 = auth.loginOrRegister(w1, testIp);
  assert.equal(reAcc1.walletAddress, w1.toLowerCase());

  // 第 4 个钱包注册时因超过 3 个上限而被拦截
  assert.throws(
    () => auth.loginOrRegister(w4, testIp),
    (err) => err.code === 'IP_REGISTRATION_LIMIT_EXCEEDED'
  );
});

test('AuthService - master profile setting and 100 credits initialization', () => {
  const auth = new AuthService();
  const wallet = '0xaabbccddeeff00112233445566778899aabbccdd';
  
  const acc = auth.loginOrRegister(wallet, '10.0.0.1');
  assert.equal(acc.masterProfile, null);
  assert.equal(acc.credits, 100);

  // 设置唯一命主
  auth.setMasterProfile(wallet, {
    name: '张三',
    gender: 'male',
    birthYear: 1995,
    birthMonth: 8,
    birthDay: 18,
    birthHour: 10
  });

  const updatedAcc = auth.getAccount(wallet);
  assert.ok(updatedAcc.masterProfile);
  assert.equal(updatedAcc.masterProfile.name, '张三');
  assert.equal(updatedAcc.masterProfile.birthYear, 1995);
});

test('AuthService - credit deduction (10 credits per dialogue, max 10 times)', () => {
  const auth = new AuthService();
  const wallet = '0x99887766554433221100fedcba98765432100000';
  auth.loginOrRegister(wallet, '127.0.0.1');

  // 连续进行 10 次分析对话，每次扣减 10 积分
  for (let i = 1; i <= 10; i++) {
    const res = auth.deductCredits(wallet, 10);
    assert.equal(res.remainingCredits, 100 - i * 10);
    assert.equal(res.remainingDialogues, 10 - i);
  }

  // 此时积分为 0
  const emptyAccount = auth.getAccount(wallet);
  assert.equal(emptyAccount.credits, 0);

  // 第 11 次调用抛出积分不足异常
  assert.throws(
    () => auth.deductCredits(wallet, 10),
    (err) => err.code === 'INSUFFICIENT_CREDITS'
  );
});

test('handleAuthRequest - HTTP Endpoint challenge, login and account query', async () => {
  const { handleAuthRequest } = await import('./auth.js');

  // 1. GET challenge
  const req1 = {
    method: 'GET',
    url: 'http://localhost/api/auth/challenge?wallet=0x8888888888888888888888888888888888888888',
    headers: {}
  };
  const res1 = await handleAuthRequest(req1);
  const data1 = await res1.json();
  assert.equal(data1.success, true);
  assert.ok(data1.challengeId);

  // 2. POST login
  const req2 = {
    method: 'POST',
    url: 'http://localhost/api/auth/login',
    headers: {},
    body: {
      challengeId: data1.challengeId,
      wallet: '0x8888888888888888888888888888888888888888',
      signature: '0xmock_signature'
    }
  };
  const res2 = await handleAuthRequest(req2);
  const data2 = await res2.json();
  assert.equal(data2.success, true);
  assert.equal(data2.account.credits, 100);

  // 3. GET account
  const req3 = {
    method: 'GET',
    url: 'http://localhost/api/auth/account?wallet=0x8888888888888888888888888888888888888888',
    headers: {}
  };
  const res3 = await handleAuthRequest(req3);
  const data3 = await res3.json();
  assert.equal(data3.success, true);
  assert.equal(data3.account.walletAddress, '0x8888888888888888888888888888888888888888');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChatRequest } from '../api/chat.js';
import { defaultProfileService } from '../lib/runtime/profile-service.js';

test('Chat API - POST /api/chat requires wallet', async () => {
  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const res = await handleChatRequest(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'Missing wallet');
});

test('Chat API - POST /api/chat profile not found for unknown unauthenticated wallet', async () => {
  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: '0xUnknownWallet1234' })
  });

  const res = await handleChatRequest(req);
  assert.equal(res.status, 404);
  const json = await res.json();
  assert.equal(json.error, 'Profile not found');
});

test('Chat API - POST /api/chat 6-Stage Pipeline SSE stream execution', async () => {
  const wallet = '0xTestChatStream';
  const profile = defaultProfileService.addProfile(wallet, {
    name: '韩立',
    date: '1990-06-15',
    time: '14:30',
    gender: '男'
  });

  const req = new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet,
      profileId: profile.id,
      question: '我的事业发展模式如何？'
    })
  });

  const res = await handleChatRequest(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let allText = '';

  while (!done) {
    const { value, done: d } = await reader.read();
    if (value) {
      allText += decoder.decode(value);
      if (allText.includes('session_end')) break;
    }
    done = d;
  }

  assert.ok(allText.includes('session_start'), 'Should have session_start');
  assert.ok(allText.includes('plan'), 'Should have plan');
  assert.ok(allText.includes('group_start'), 'Should have group_start');
  assert.ok(allText.includes('group_done'), 'Should have group_done');
  assert.ok(allText.includes('report_done'), 'Should have report_done');
  assert.ok(allText.includes('recommend'), 'Should have recommend');
  assert.ok(allText.includes('session_end'), 'Should have session_end');
});

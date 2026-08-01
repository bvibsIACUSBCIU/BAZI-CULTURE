import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProfileRequest } from './profile.js';
import { handleQuotaRequest } from './quota.js';
import { handleSessionHistoryRequest } from './session-history.js';

test('Profile API - list, add and switch profiles', async () => {
  // 1. GET list
  const req1 = new Request('http://localhost/api/profile', { method: 'GET' });
  const res1 = await handleProfileRequest(req1);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.equal(data1.activeProfileId, 'prof-hanli');
  assert.equal(data1.profiles.length >= 1, true);

  // 2. POST add
  const req2 = new Request('http://localhost/api/profile/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '厉飞雨', date: '1992-05-10', time: '08:00' })
  });
  const res2 = await handleProfileRequest(req2);
  const data2 = await res2.json();
  assert.equal(data2.ok, true);
  assert.equal(data2.profile.name, '厉飞雨');
  assert.equal(data2.activeProfileId, data2.profile.id);

  // 3. POST switch
  const req3 = new Request('http://localhost/api/profile/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: 'prof-hanli' })
  });
  const res3 = await handleProfileRequest(req3);
  const data3 = await res3.json();
  assert.equal(data3.ok, true);
  assert.equal(data3.activeProfileId, 'prof-hanli');
});

test('Quota API - query points and daily checkin', async () => {
  // 1. GET quota
  const req1 = new Request('http://localhost/api/quota', { method: 'GET' });
  const res1 = await handleQuotaRequest(req1);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.equal(data1.points, 1580);
  assert.equal(data1.checkedInToday, false);

  // 2. POST checkin
  const req2 = new Request('http://localhost/api/quota/checkin', { method: 'POST' });
  const res2 = await handleQuotaRequest(req2);
  const data2 = await res2.json();
  assert.equal(data2.ok, true);
  assert.equal(data2.points, 1680);
  assert.equal(data2.checkinTaskProgress, 4);
  assert.equal(data2.checkedInToday, true);

  // 3. Duplicate checkin rejected
  const req3 = new Request('http://localhost/api/quota/checkin', { method: 'POST' });
  const res3 = await handleQuotaRequest(req3);
  assert.equal(res3.status, 400);
});

test('Session History API - list sessions and toggle bookmark', async () => {
  // 1. GET session history
  const req1 = new Request('http://localhost/api/session-history', { method: 'GET' });
  const res1 = await handleSessionHistoryRequest(req1);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.equal(data1.sessions.length >= 2, true);

  // 2. Toggle bookmark
  const req2 = new Request('http://localhost/api/session-history/bookmark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-002' })
  });
  const res2 = await handleSessionHistoryRequest(req2);
  const data2 = await res2.json();
  assert.equal(data2.ok, true);
  assert.equal(data2.session.bookmarked, true);
});

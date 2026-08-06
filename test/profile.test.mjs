import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProfileRequest } from '../api/profile.js';

test('Profile API - GET profiles for new wallet returns empty list', async () => {
  const req = new Request('http://localhost/api/profile?wallet=0xTestProfileNew', { method: 'GET' });
  const res = await handleProfileRequest(req);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(Array.isArray(json.profiles));
  assert.equal(json.profiles.length, 0);
  assert.equal(json.activeProfile, null);
});

test('Profile API - POST add new profile', async () => {
  const wallet = '0xTestProfileAdd';
  const req = new Request('http://localhost/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet,
      action: 'add',
      name: '王领',
      date: '2001-01-01',
      time: '08:00',
      gender: 'male',
      birthplace: '北京'
    })
  });
  const res = await handleProfileRequest(req);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.profile.name, '王领');
  assert.equal(json.profile.date, '2001-01-01');
  assert.equal(json.activeProfile.name, '王领');
});

test('Profile API - POST switch profile', async () => {
  const wallet = '0xTestProfileSwitch';
  // 1. 先添加一个命主
  const addReq = new Request('http://localhost/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet,
      action: 'add',
      name: '撑伞',
      date: '2010-02-02',
      time: '12:00',
      gender: 'female'
    })
  });
  const addRes = await handleProfileRequest(addReq);
  const addJson = await addRes.json();
  const newProfId = addJson.profile.id;

  // 2. 切换到新添加的命主
  const switchReq = new Request('http://localhost/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet,
      action: 'switch',
      profileId: newProfId
    })
  });

  const switchRes = await handleProfileRequest(switchReq);
  const switchJson = await switchRes.json();
  assert.equal(switchJson.ok, true);
  assert.equal(switchJson.activeProfile.name, '撑伞');
});

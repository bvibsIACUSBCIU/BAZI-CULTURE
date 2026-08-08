import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import handleSessionHistoryRequest from '../api/session-history.js';
import { createRepositories } from '../lib/cloudflare/repositories/index.js';
import { createSessionService } from '../lib/auth/session-service.js';
import { createD1TestDatabase } from './helpers/d1-test-db.mjs';

function createHarness() {
  const db = createD1TestDatabase();
  db.exec(readFileSync(new URL('../migrations/0001_wallet_account.sql', import.meta.url), 'utf8'));
  return { db };
}

test('thread migration keeps the legacy reports writer available and snapshots it as version 1', async (t) => {
  const { db } = createHarness();
  t.after(() => db.close());
  await db.exec(`
    INSERT INTO users (id, wallet_address, created_at, updated_at)
    VALUES ('user-1', '0x${'1'.repeat(40)}', '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z');
    INSERT INTO conversations (id, user_id, request_id, title, question, topic, created_at, updated_at)
    VALUES ('conversation-1', 'user-1', 'legacy-request', '旧会话', '旧问题', 'career', '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z');
    INSERT INTO reports (id, conversation_id, user_id, summary, report_markdown, chart_summary, chart_json, completed_at, created_at, updated_at)
    VALUES ('report-1', 'conversation-1', 'user-1', '旧摘要', '旧报告', '旧命盘', '{}', NULL, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z');
  `);

  await db.exec(readFileSync(new URL('../migrations/0003_threaded_conversation_versions.sql', import.meta.url), 'utf8'));

  await db.prepare(`
    INSERT INTO reports (id, conversation_id, user_id, summary, report_markdown, chart_summary, chart_json, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary, report_markdown = excluded.report_markdown
  `).bind('report-latest', 'conversation-1', 'user-1', '新摘要', '最新报告', '旧命盘', '{}', null, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z').run();

  const columns = await db.prepare('PRAGMA table_info(report_versions)').all();
  assert.ok(columns.results.some((column) => column.name === 'version_number'));

  const legacyReport = await db.prepare('SELECT version_number, summary, report_markdown FROM report_versions WHERE conversation_id = ? AND version_number = 1').bind('conversation-1').first();
  assert.equal(legacyReport.version_number, 1);
  assert.equal(legacyReport.summary, '新摘要');
  assert.equal(legacyReport.report_markdown, '最新报告');

  await db.prepare(`
    INSERT INTO report_versions (id, conversation_id, user_id, version_number, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('report-2', 'conversation-1', 'user-1', 2, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z').run();

  await assert.rejects(
    db.prepare(`
      INSERT INTO report_versions (id, conversation_id, user_id, version_number, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('report-duplicate', 'conversation-1', 'user-1', 2, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z').run(),
    /UNIQUE constraint failed: report_versions\.conversation_id, report_versions\.version_number/,
  );
});

test('turn-request migration backfills an existing request with its latest report version', async (t) => {
  const { db } = createHarness();
  t.after(() => db.close());
  await db.exec(`
    INSERT INTO users (id, wallet_address, created_at, updated_at)
    VALUES ('user-legacy', '0x${'6'.repeat(40)}', '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z');
    INSERT INTO conversations (id, user_id, request_id, title, question, topic, created_at, updated_at)
    VALUES ('conversation-legacy', 'user-legacy', 'legacy-turn', '旧会话', '旧问题', 'career', '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z');
    INSERT INTO reports (id, conversation_id, user_id, summary, report_markdown, chart_summary, chart_json, completed_at, created_at, updated_at)
    VALUES ('report-legacy', 'conversation-legacy', 'user-legacy', '旧摘要', '旧报告', '旧命盘', '{}', NULL, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z');
  `);
  await db.exec(readFileSync(new URL('../migrations/0003_threaded_conversation_versions.sql', import.meta.url), 'utf8'));
  await db.prepare(`
    INSERT INTO report_versions (id, conversation_id, user_id, version_number, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('report-version-2', 'conversation-legacy', 'user-legacy', 2, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z').run();

  await db.exec(readFileSync(new URL('../migrations/0004_conversation_turn_requests.sql', import.meta.url), 'utf8'));
  const request = await db.prepare(
    'SELECT user_id, request_id, report_version_number FROM conversation_turn_requests WHERE conversation_id = ?',
  ).bind('conversation-legacy').first();

  assert.equal(request.user_id, 'user-legacy');
  assert.equal(request.request_id, 'legacy-turn');
  assert.equal(request.report_version_number, 2);
});

test('thread repositories append ordered messages and immutable report versions for the owner', async (t) => {
  const { db } = createHarness();
  t.after(() => db.close());
  await db.exec(readFileSync(new URL('../migrations/0003_threaded_conversation_versions.sql', import.meta.url), 'utf8'));
  const repositories = createRepositories(db, { createId: createSequentialId() });
  const user = await repositories.users.findOrCreate(`0x${'2'.repeat(40)}`);
  const profile = await repositories.profiles.create(user.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });

  const thread = await repositories.conversations.createForTurn(user.id, {
    profileId: profile.id, requestId: 'turn-1', question: '第一问', title: '第一问', topic: 'overview',
  });
  await repositories.messages.append(user.id, thread.id, 'user', '第一问');
  await repositories.messages.append(user.id, thread.id, 'assistant', '第一答');
  await repositories.reportVersions.complete(user.id, thread.id, {
    summary: '第一答', reportMarkdown: '报告一', chartSummary: '命盘一', chart: { dayMaster: '甲' }, topic: 'career',
  });
  await repositories.conversations.appendTurn(user.id, thread.id, {
    profileId: profile.id, requestId: 'turn-2', question: '第二问', topic: 'overview',
  });
  await repositories.messages.append(user.id, thread.id, 'user', '第二问');
  await repositories.messages.append(user.id, thread.id, 'assistant', '第二答');
  await repositories.reportVersions.complete(user.id, thread.id, {
    summary: '第二答', reportMarkdown: '报告二', chartSummary: '命盘二', chart: { dayMaster: '乙' }, topic: 'wealth',
  });

  assert.deepEqual((await repositories.messages.list(user.id, thread.id)).map((message) => [message.sequence, message.role, message.content]), [
    [1, 'user', '第一问'], [2, 'assistant', '第一答'], [3, 'user', '第二问'], [4, 'assistant', '第二答'],
  ]);
  assert.deepEqual((await repositories.reports.listByConversation(user.id, thread.id)).map((report) => [report.versionNumber, report.reportMarkdown]), [
    [1, '报告一'], [2, '报告二'],
  ]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM reports').first()).count, 0);
  assert.equal(await repositories.conversations.findById('foreign-user', thread.id), null);
});

test('thread detail returns ordered messages and every report version only to its owner', async (t) => {
  const { db } = createHarness();
  t.after(() => db.close());
  await db.exec(readFileSync(new URL('../migrations/0003_threaded_conversation_versions.sql', import.meta.url), 'utf8'));
  const repositories = createRepositories(db, { createId: createSequentialId() });
  const sessions = createSessionService({ sessions: repositories.sessions, environment: 'production' });
  const owner = await repositories.users.findOrCreate(`0x${'3'.repeat(40)}`);
  const foreign = await repositories.users.findOrCreate(`0x${'4'.repeat(40)}`);
  const profile = await repositories.profiles.create(owner.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const thread = await repositories.conversations.createForTurn(owner.id, {
    profileId: profile.id, requestId: 'detail-turn-1', question: '第一问', title: '第一问', topic: 'overview',
  });
  await repositories.messages.append(owner.id, thread.id, 'user', '第一问');
  await repositories.messages.append(owner.id, thread.id, 'assistant', '第一答');
  await repositories.reportVersions.complete(owner.id, thread.id, {
    summary: '第一答', reportMarkdown: '报告一', chartSummary: '命盘一', chart: { dayMaster: '甲' }, topic: 'career',
  });
  await repositories.conversations.appendTurn(owner.id, thread.id, {
    profileId: profile.id, requestId: 'detail-turn-2', question: '第二问', topic: 'wealth',
  });
  await repositories.messages.append(owner.id, thread.id, 'user', '第二问');
  await repositories.messages.append(owner.id, thread.id, 'assistant', '第二答');
  await repositories.reportVersions.complete(owner.id, thread.id, {
    summary: '第二答', reportMarkdown: '报告二', chartSummary: '命盘二', chart: { dayMaster: '乙' }, topic: 'wealth',
  });

  const origin = 'https://app.example.test';
  const issueCookie = async (userId) => (await sessions.issue({ userId })).cookie.split(';')[0];
  const env = {
    DB: db,
    AUTH_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    ENVIRONMENT: 'production',
    ALLOWED_ORIGIN: origin,
    SESSION_COOKIE_NAME: 'liangyi_session',
    SESSION_TTL_SECONDS: '21600',
  };
  const request = (cookie) => new Request(`${origin}/api/session-history?sessionId=${thread.id}`, {
    headers: { origin, cookie },
  });

  const ownerResponse = await handleSessionHistoryRequest(request(await issueCookie(owner.id)), { env });
  const ownerBody = await ownerResponse.json();
  assert.equal(ownerResponse.status, 200);
  assert.equal(ownerBody.session.id, thread.id);
  assert.deepEqual(ownerBody.messages.map((message) => message.sequence), [1, 2, 3, 4]);
  assert.deepEqual(ownerBody.reports.map((report) => report.versionNumber), [1, 2]);

  const foreignResponse = await handleSessionHistoryRequest(request(await issueCookie(foreign.id)), { env });
  assert.equal(foreignResponse.status, 404);
  assert.equal((await foreignResponse.json()).error, 'SESSION_NOT_FOUND');
});

test('appending the first real turn gives a placeholder conversation its question title', async (t) => {
  const { db } = createHarness();
  t.after(() => db.close());
  const repositories = createRepositories(db, { createId: createSequentialId() });
  const user = await repositories.users.findOrCreate(`0x${'5'.repeat(40)}`);
  const profile = await repositories.profiles.create(user.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const placeholder = await repositories.conversations.create(user.id, {
    profileId: profile.id, requestId: 'placeholder', question: '', topic: 'overview',
  });

  const appended = await repositories.conversations.appendTurn(user.id, placeholder.id, {
    profileId: profile.id, requestId: 'first-real-turn', question: '我该如何推进事业？', topic: 'career',
  });

  assert.equal(appended.title, '解答: 我该如何推进事业？...');
});

function createSequentialId() {
  let number = 0;
  return (prefix) => `${prefix}-${++number}`;
}

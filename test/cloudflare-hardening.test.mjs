import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { handleChatRequest } from '../api/chat.js';
import { createRepositories } from '../lib/cloudflare/repositories/index.js';
import { createSessionService } from '../lib/auth/session-service.js';
import { createD1TestDatabase } from './helpers/d1-test-db.mjs';
import worker from '../src/worker.js';

const ORIGIN = 'https://app.example.test';

function createHarness() {
  const db = createD1TestDatabase();
  db.exec(readFileSync(new URL('../migrations/0001_wallet_account.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0003_threaded_conversation_versions.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0004_conversation_turn_requests.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0005_thread_hardening.sql', import.meta.url), 'utf8'));
  const repositories = createRepositories(db);
  const sessions = createSessionService({ sessions: repositories.sessions, environment: 'production' });
  return {
    db,
    repositories,
    sessions,
    env: {
      DB: db,
      AUTH_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
      ENVIRONMENT: 'production',
      ALLOWED_ORIGIN: ORIGIN,
      SESSION_COOKIE_NAME: 'liangyi_session',
      SESSION_TTL_SECONDS: '21600',
    },
  };
}

function request(path, { method = 'GET', body, cookie } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function readEvents(response) {
  return (await response.text()).trim().split('\n\n').filter(Boolean).map((entry) => JSON.parse(entry.slice('data: '.length)));
}

test('authenticated history restore loads the persisted thread or newest owned thread detail', async () => {
  const moduleUrl = new URL('../lib/frontend/conversation-restore.js', import.meta.url);
  assert.equal(existsSync(moduleUrl), true, 'conversation restore module must exist');
  const { restoreOwnedConversation } = await import(moduleUrl);
  const requested = [];
  const loadDetail = async (conversationId) => {
    requested.push(conversationId);
    return { session: { id: conversationId }, messages: [{ sequence: 1 }], reports: [{ versionNumber: 1 }] };
  };
  const sessions = [{ id: 'newest' }, { id: 'persisted' }];

  const explicit = await restoreOwnedConversation({ sessions, persistedConversationId: 'persisted', loadDetail });
  const newest = await restoreOwnedConversation({ sessions, persistedConversationId: 'missing', loadDetail });

  assert.deepEqual(requested, ['persisted', 'newest']);
  assert.equal(explicit.session.id, 'persisted');
  assert.equal(newest.session.id, 'newest');
});

test('server ignores a stale client previousReport and uses the latest persisted version', async (t) => {
  const { db, repositories, sessions, env } = createHarness();
  t.after(() => db.close());
  const user = await repositories.users.findOrCreate(`0x${'1'.repeat(40)}`);
  await repositories.credits.recordOnce({ userId: user.id, amount: 100, reason: 'welcome', idempotencyKey: `welcome:${user.id}` });
  const profile = await repositories.profiles.create(user.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const thread = await repositories.conversations.createForTurn(user.id, {
    profileId: profile.id, requestId: 'first', question: '第一问', title: '第一问', topic: 'overview',
  });
  await repositories.reportVersions.complete(user.id, thread.id, {
    summary: '旧摘要', reportMarkdown: '权威报告上下文', chartSummary: '', chart: {}, topic: 'overview',
  });
  const cookie = (await sessions.issue({ userId: user.id })).cookie.split(';')[0];
  let seenPreviousReport;
  const runPipeline = async (input) => {
    seenPreviousReport = input.previousReport;
    return { summary: '完成', report: '新报告', chart: {}, chartSummary: '', topics: [], evidencePayload: {} };
  };

  const response = await handleChatRequest(request('/api/chat', {
    method: 'POST',
    cookie,
    body: {
      profileId: profile.id,
      conversationId: thread.id,
      question: '第二问',
      requestId: 'second',
      previousReport: '<script>stale()</script>',
    },
  }), { env, runPipeline });
  await readEvents(response);

  assert.equal(response.status, 200);
  assert.equal(seenPreviousReport, '权威报告上下文');
});

test('concurrent message appends allocate unique ordered sequences', async (t) => {
  const { db, repositories } = createHarness();
  t.after(() => db.close());
  const user = await repositories.users.findOrCreate(`0x${'2'.repeat(40)}`);
  const profile = await repositories.profiles.create(user.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const thread = await repositories.conversations.create(user.id, {
    profileId: profile.id, requestId: 'seed', question: 'seed', title: 'seed', topic: 'overview',
  });

  await Promise.all([
    repositories.messages.append(user.id, thread.id, 'user', '并发一'),
    repositories.messages.append(user.id, thread.id, 'user', '并发二'),
  ]);

  assert.deepEqual((await repositories.messages.list(user.id, thread.id)).map((message) => message.sequence), [1, 2]);
});

test('turn start batch rolls back debit, header, request, and sequence when the user message insert fails', async (t) => {
  const db = createD1TestDatabase();
  t.after(() => db.close());
  for (const migration of ['0001_wallet_account.sql', '0003_threaded_conversation_versions.sql', '0004_conversation_turn_requests.sql', '0005_thread_hardening.sql']) {
    await db.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const ids = new Map();
  const repositories = createRepositories(db, { createId: (prefix) => `${prefix}-${(ids.set(prefix, (ids.get(prefix) || 0) + 1), ids.get(prefix))}` });
  const user = await repositories.users.findOrCreate(`0x${'8'.repeat(40)}`);
  await repositories.credits.recordOnce({ userId: user.id, amount: 100, reason: 'welcome', idempotencyKey: 'welcome' });
  const profile = await repositories.profiles.create(user.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const thread = await repositories.conversations.create(user.id, {
    profileId: profile.id, requestId: 'seed', question: 'seed', title: '原始标题', topic: 'overview',
  });
  await db.prepare(
    'INSERT INTO conversation_messages (id, conversation_id, sequence, role, content, created_at) VALUES (?, ?, 1, \'system\', \'seed\', \'now\')',
  ).bind('msg-1', thread.id).run();
  await db.prepare('INSERT INTO conversation_sequences (conversation_id, next_message_sequence, next_report_version) VALUES (?, 2, 1)').bind(thread.id).run();

  await assert.rejects(repositories.turns.start(user.id, {
    conversationId: thread.id,
    profileId: profile.id,
    requestId: 'turn-fails',
    question: '不得半写入',
    topic: 'overview',
    creditAmount: -10,
    creditReason: 'chat',
  }), /UNIQUE constraint failed: conversation_messages\.id/);

  const unchanged = await repositories.conversations.findById(user.id, thread.id);
  assert.equal(unchanged.requestId, 'seed');
  assert.equal(await repositories.credits.getBalance(user.id), 100);
  assert.equal(await repositories.turnRequests.findByRequestId(user.id, 'turn-fails'), null);
  assert.equal((await db.prepare('SELECT next_message_sequence FROM conversation_sequences WHERE conversation_id = ?').bind(thread.id).first()).next_message_sequence, 2);
});

test('turn completion batch leaves no assistant, report, or completion marker after a write conflict', async (t) => {
  const db = createD1TestDatabase();
  t.after(() => db.close());
  for (const migration of ['0001_wallet_account.sql', '0003_threaded_conversation_versions.sql', '0004_conversation_turn_requests.sql', '0005_thread_hardening.sql']) {
    await db.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  let messageIdCalls = 0;
  const ids = new Map();
  const repositories = createRepositories(db, {
    createId: (prefix) => prefix === 'msg' ? `msg-${++messageIdCalls}` : `${prefix}-${(ids.set(prefix, (ids.get(prefix) || 0) + 1), ids.get(prefix))}`,
  });
  const user = await repositories.users.findOrCreate(`0x${'9'.repeat(40)}`);
  await repositories.credits.recordOnce({ userId: user.id, amount: 100, reason: 'welcome', idempotencyKey: 'welcome' });
  const profile = await repositories.profiles.create(user.id, {
    name: '青木', date: '1994-03-08', time: '08:00', gender: 'female', timeKnown: true,
  });
  const thread = await repositories.turns.start(user.id, {
    profileId: profile.id, requestId: 'turn-complete-fails', question: '问题', topic: 'overview', creditAmount: -10, creditReason: 'chat',
  });
  await db.prepare(
    'INSERT INTO conversation_messages (id, conversation_id, sequence, role, content, created_at) VALUES (?, ?, 99, \'system\', \'conflict\', \'now\')',
  ).bind('msg-2', thread.id).run();

  await assert.rejects(repositories.turns.complete(user.id, 'turn-complete-fails', {
    summary: '助手答复', reportMarkdown: '报告', chart: {}, topic: 'overview',
  }), /UNIQUE constraint failed: conversation_messages\.id/);

  assert.deepEqual((await repositories.messages.list(user.id, thread.id)).map((message) => message.role), ['user', 'system']);
  assert.equal((await repositories.reportVersions.listByConversation(user.id, thread.id)).length, 0);
  assert.equal((await repositories.turnRequests.findByRequestId(user.id, 'turn-complete-fails')).completedAt, null);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM conversation_turn_completions').first()).count, 0);
});

test('report version updates and deletes above version one are rejected by the hardening migration', async (t) => {
  const { db } = createHarness();
  t.after(() => db.close());
  await db.exec(`
    INSERT INTO users (id, wallet_address, created_at, updated_at) VALUES ('u', '0x${'3'.repeat(40)}', 'now', 'now');
    INSERT INTO conversations (id, user_id, request_id, title, question, topic, created_at, updated_at) VALUES ('c', 'u', 'r', 't', 'q', 'overview', 'now', 'now');
    INSERT INTO reports (id, conversation_id, user_id, created_at, updated_at) VALUES ('r1', 'c', 'u', 'now', 'now');
    INSERT INTO report_versions (id, conversation_id, user_id, version_number, created_at, updated_at) VALUES ('r2', 'c', 'u', 2, 'now', 'now');
  `);
  await assert.rejects(
    db.prepare('UPDATE report_versions SET summary = ? WHERE id = ?').bind('tampered', 'r2').run(),
    /report_versions_immutable/,
  );
  await assert.rejects(
    db.prepare('DELETE FROM report_versions WHERE id = ?').bind('r2').run(),
    /report_versions_immutable/,
  );
  await db.prepare('UPDATE reports SET summary = ? WHERE conversation_id = ?').bind('legacy update', 'c').run();
  assert.equal((await db.prepare('SELECT summary FROM report_versions WHERE conversation_id = ? AND version_number = 1').bind('c').first()).summary, 'legacy update');
});

test('worker CSP blocks inline scripts and static assets use a fresh cache version', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/api/health`), {
    DB: {}, AUTH_KV: {}, ENVIRONMENT: 'production', ALLOWED_ORIGIN: ORIGIN,
  }, {});
  const csp = response.headers.get('content-security-policy') || '';
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const versions = [...html.matchAll(/(?:app\.css|app\.js)\?v=(\d+\.\d+)/g)].map((match) => Number(match[1]));
  assert.ok(versions.length >= 2);
  assert.ok(versions.every((version) => version > 20260808.1));
});

test('hostile report HTML loses executable tags, handlers, and unsafe URLs', async () => {
  const moduleUrl = new URL('../lib/frontend/report-sanitizer.js', import.meta.url);
  assert.equal(existsSync(moduleUrl), true, 'report sanitizer module must exist');
  const { sanitizeReportHtml } = await import(moduleUrl);
  const safe = sanitizeReportHtml('<h1 onclick="steal()">标题</h1><script>alert(1)</script><a href="javascript:steal()">链接</a><img src=x onerror="steal()">');
  assert.match(safe, /<h1>标题<\/h1>/);
  assert.match(safe, /<a>链接<\/a>/);
  assert.doesNotMatch(safe, /<script|onclick|onerror|javascript:|<img/iu);
});

test('report rendering is sanitized and streamed chunks stay text-only', () => {
  const appJs = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(appJs, /sanitizeReportHtml/);
  assert.match(appJs, /reportContent\.textContent/);
  assert.doesNotMatch(appJs, /DOM\.reportContent\.innerHTML\s*\+=\s*event\.text_chunk/);
  assert.doesNotMatch(appJs, /onclick=/);
});

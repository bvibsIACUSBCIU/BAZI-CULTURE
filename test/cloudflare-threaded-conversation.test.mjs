import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
    ON CONFLICT(conversation_id) DO UPDATE SET report_markdown = excluded.report_markdown
  `).bind('report-latest', 'conversation-1', 'user-1', '新摘要', '最新报告', '旧命盘', '{}', null, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z').run();

  const columns = await db.prepare('PRAGMA table_info(report_versions)').all();
  assert.ok(columns.results.some((column) => column.name === 'version_number'));

  const legacyReport = await db.prepare('SELECT version_number, summary, report_markdown FROM report_versions WHERE id = ?').bind('report-1').first();
  assert.equal(legacyReport.version_number, 1);
  assert.equal(legacyReport.summary, '旧摘要');
  assert.equal(legacyReport.report_markdown, '旧报告');

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

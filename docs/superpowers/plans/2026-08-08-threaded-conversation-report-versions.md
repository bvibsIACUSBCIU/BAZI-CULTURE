# Threaded Conversation and Report Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one wallet-owned conversation thread across multiple questions, append its transcript in order, and create an immutable numbered report version for every successful question.

**Architecture:** Keep `conversations` as the thread header, use `conversation_messages` for the durable ordered transcript, and migrate `reports` from one row per conversation to one row per report version. The authenticated chat endpoint will either create a thread or append a turn to the supplied owned thread, then write the assistant summary and next report version after the unchanged six-stage pipeline finishes. The browser will hold an active thread ID, restore a selected transcript from the authenticated history API, and select report versions independently.

**Tech Stack:** Cloudflare Workers, D1/SQLite migrations, JavaScript Fetch/SSE, native DOM, Node test runner.

## Global Constraints

- Keep wallet-session authorization authoritative; never accept a wallet address as resource authorization.
- Preserve existing user data with an additive D1 migration and migrate legacy reports to version 1.
- Do not modify deterministic chart calculation, the six-stage pipeline, AI prompts, or dynamic report generation.
- A new report version is created only after a successful pipeline result; failed turns retain their user message and add no report version.
- Continue to use a unique request ID per turn for credit, message, and report-version idempotency.
- Run `npm test` and `node --env-file=.env scripts/test-simulation.mjs` before deployment.

---

### Task 1: Add Thread-Version D1 Migration

**Files:**
- Create: `migrations/0003_threaded_conversation_versions.sql`
- Test: `test/cloudflare-threaded-conversation.test.mjs`

**Interfaces:**
- Consumes: existing `conversations`, `conversation_messages`, and `reports` tables from `migrations/0001_wallet_account.sql`.
- Produces: `reports.version_number`, a unique `(conversation_id, version_number)` key, and data-compatible version 1 rows for existing reports.

- [ ] **Step 1: Write the failing migration-contract test**

```js
test('thread migration allows versioned reports while preserving a legacy report as version 1', async (t) => {
  const { db } = createHarness();
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../migrations/0003_threaded_conversation_versions.sql', import.meta.url), 'utf8'));
  const columns = await db.prepare('PRAGMA table_info(reports)').all();
  assert.ok(columns.results.some((column) => column.name === 'version_number'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/cloudflare-threaded-conversation.test.mjs`
Expected: FAIL because migration `0003_threaded_conversation_versions.sql` is absent.

- [ ] **Step 3: Write the additive migration**

```sql
ALTER TABLE reports RENAME TO reports_legacy;
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  summary TEXT NOT NULL DEFAULT '',
  report_markdown TEXT NOT NULL DEFAULT '',
  chart_summary TEXT NOT NULL DEFAULT '',
  chart_json TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (conversation_id, version_number)
);
INSERT INTO reports (...) SELECT ..., 1, ... FROM reports_legacy;
DROP TABLE reports_legacy;
CREATE INDEX reports_by_conversation_version ON reports(conversation_id, version_number DESC);
```

- [ ] **Step 4: Run the migration-contract test to verify it passes**

Run: `node --test test/cloudflare-threaded-conversation.test.mjs`
Expected: PASS, with the version number column and unique conversation-version key present.

- [ ] **Step 5: Commit**

```bash
git add migrations/0003_threaded_conversation_versions.sql test/cloudflare-threaded-conversation.test.mjs
git commit -m "feat: add versioned conversation reports schema"
```

### Task 2: Persist Turns and Immutable Report Versions

**Files:**
- Modify: `lib/cloudflare/repositories/index.js:3-310`
- Modify: `api/chat.js:52-137`
- Test: `test/cloudflare-threaded-conversation.test.mjs`
- Test: `test/cloudflare-chat-persistence.test.mjs`

**Interfaces:**
- Consumes: `conversationId`, `profileId`, `question`, and `requestId` from `POST /api/chat`.
- Produces: `repositories.conversations.appendTurn`, `repositories.messages.list`, `repositories.reports.listByConversation`, and SSE metadata `{ conversationId, reportVersion }`.

- [ ] **Step 1: Write failing API/repository tests**

```js
test('a second question appends transcript messages and creates report version 2 in one owned thread', async (t) => {
  const { user, profile, cookie, env, repositories } = await authenticatedHarness(t);
  await streamChat({ env, cookie, profileId: profile.id, question: '第一问', requestId: 'turn-1' });
  const thread = (await repositories.conversations.list(user.id))[0];
  await streamChat({ env, cookie, profileId: profile.id, conversationId: thread.id, question: '第二问', requestId: 'turn-2' });
  assert.deepEqual((await repositories.messages.list(user.id, thread.id)).map((message) => message.role), ['user', 'assistant', 'user', 'assistant']);
  assert.deepEqual((await repositories.reports.listByConversation(user.id, thread.id)).map((report) => report.versionNumber), [1, 2]);
});

test('a foreign wallet cannot append to or read another wallet thread', async (t) => {
  const { foreignCookie, ownedThreadId, env } = await twoUserHarness(t);
  const response = await handleChatRequest(request('/api/chat', { method: 'POST', cookie: foreignCookie, body: { conversationId: ownedThreadId, question: '越权', requestId: 'foreign-turn' } }), { env, runPipeline });
  assert.equal(response.status, 404);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `node --test test/cloudflare-threaded-conversation.test.mjs test/cloudflare-chat-persistence.test.mjs`
Expected: FAIL because messages are not written and reports are still overwritten per conversation.

- [ ] **Step 3: Implement repository methods and idempotent turn flow**

```js
// conversations: createForTurn / appendTurn verify profile ownership, update title on first turn, and touch updated_at
// messages: append(userId, conversationId, role, content) allocates MAX(sequence) + 1; list(...) orders by sequence ASC
// reports.complete(...) calculates MAX(version_number) + 1 and INSERTs one immutable row
// api/chat: resolve existing request first; otherwise create or own-check conversation, debit once, append user message, then on success append assistant summary and create versioned report
```

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `node --test test/cloudflare-threaded-conversation.test.mjs test/cloudflare-chat-persistence.test.mjs`
Expected: PASS, including idempotent replay retaining two messages and one report version for a repeated request ID.

- [ ] **Step 5: Commit**

```bash
git add lib/cloudflare/repositories/index.js api/chat.js test/cloudflare-threaded-conversation.test.mjs test/cloudflare-chat-persistence.test.mjs
git commit -m "feat: persist threaded chat turns and report versions"
```

### Task 3: Return Thread Details and Version Lists

**Files:**
- Modify: `api/session-history.js:72-136`
- Test: `test/cloudflare-resource-authz.test.mjs`
- Test: `test/cloudflare-threaded-conversation.test.mjs`

**Interfaces:**
- Consumes: authenticated `GET /api/session-history` and optional `sessionId` query parameter.
- Produces: lightweight `sessions` summaries, plus `{ session, messages, reports }` for an owned thread detail request.

- [ ] **Step 1: Write failing detail endpoint tests**

```js
test('thread detail returns ordered messages and every report version for its owner', async (t) => {
  const { env, cookie, threadId } = await seededThreadHarness(t);
  const response = await handleSessionHistoryRequest(request(`/api/session-history?sessionId=${threadId}`, { cookie }), { env });
  const body = await response.json();
  assert.deepEqual(body.messages.map((message) => message.sequence), [1, 2, 3, 4]);
  assert.deepEqual(body.reports.map((report) => report.versionNumber), [1, 2]);
});
```

- [ ] **Step 2: Run the focused endpoint tests to verify failure**

Run: `node --test test/cloudflare-threaded-conversation.test.mjs test/cloudflare-resource-authz.test.mjs`
Expected: FAIL because history currently returns only the latest report summary per conversation.

- [ ] **Step 3: Add owned thread-detail response handling**

```js
if (method === 'GET' && url.searchParams.get('sessionId')) {
  const session = await auth.repositories.conversations.findById(auth.userId, url.searchParams.get('sessionId'));
  if (!session) return createJsonResponse({ ok: false, error: 'SESSION_NOT_FOUND' }, 404);
  return createJsonResponse({ ok: true, session, messages: await auth.repositories.messages.list(auth.userId, session.id), reports: await auth.repositories.reports.listByConversation(auth.userId, session.id) });
}
```

- [ ] **Step 4: Run focused endpoint tests to verify they pass**

Run: `node --test test/cloudflare-threaded-conversation.test.mjs test/cloudflare-resource-authz.test.mjs`
Expected: PASS, including foreign-user not-found behavior.

- [ ] **Step 5: Commit**

```bash
git add api/session-history.js test/cloudflare-threaded-conversation.test.mjs test/cloudflare-resource-authz.test.mjs
git commit -m "feat: expose owned conversation thread details"
```

### Task 4: Render Appended Threads and Report Versions

**Files:**
- Modify: `app.html:157-160, 274-320`
- Modify: `app.css:521-620, 1781-1850`
- Modify: `app.js:109-115, 1170-1370, 1490-1610`
- Test: `test/frontend-contract.test.mjs`

**Interfaces:**
- Consumes: `session_start.sessionId`, `report.reportVersion`, and history detail `{ messages, reports }`.
- Produces: `activeConversationId`, appended message rows, `renderReportVersions(reports, selectedVersion)`, and version-selector controls in the report panel.

- [ ] **Step 1: Write failing frontend contract tests**

```js
test('frontend continues an active conversation and presents numbered report versions', () => {
  assert.match(appJs, /activeConversationId/);
  assert.match(appJs, /conversationId:s*activeConversationId/);
  assert.match(appJs, /function renderReportVersions/);
  assert.match(appHtml, /id="report-version-selector"/);
  assert.match(appCss, /.report-version-selector/);
});

test('frontend restores ordered thread messages instead of synthesizing one history response', () => {
  assert.match(appJs, /function renderConversationThread/);
  assert.match(appJs, /detail.messages/);
  assert.match(appJs, /detail.reports/);
});
```

- [ ] **Step 2: Run the frontend contract test to verify failure**

Run: `node --test test/frontend-contract.test.mjs`
Expected: FAIL because the page has no active thread ID or report-version controls.

- [ ] **Step 3: Implement thread rendering and report-version selector**

```js
// Send uses activeConversationId; session_start assigns it for the first turn.
// report event appends the received version to activeReportVersions then selects it.
// loadSessionDetail fetches /api/session-history?sessionId=... and renders every message in sequence.
// 新建对话 resets activeConversationId, activeReportVersions, currentReport, message list, and report pane.
```

- [ ] **Step 4: Run frontend contract test to verify pass**

Run: `node --test test/frontend-contract.test.mjs && node --check app.js && git diff --check`
Expected: all frontend contract tests pass with no syntax or whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add app.html app.css app.js test/frontend-contract.test.mjs
git commit -m "feat: continue chat threads with report versions"
```

### Task 5: Migrate, Verify, and Release

**Files:**
- Modify: `wrangler.toml` only if migration configuration needs no changes; otherwise no configuration change.
- Test: all existing tests plus browser and production D1 checks.

**Interfaces:**
- Consumes: migration `0003`, completed API/frontend implementation, existing Cloudflare `DB` binding.
- Produces: migrated production D1 schema, deployed Worker/Pages assets, and verified thread UX.

- [ ] **Step 1: Apply the migration to local D1 and inspect it**

Run: `npm run cf:db:migrate:local`
Run: `npx wrangler d1 execute liangyi-bazi-local --local --command "PRAGMA table_info(reports)"`
Expected: a `version_number` column exists.

- [ ] **Step 2: Run all required project verification**

Run: `npm test`
Run: `node --env-file=.env scripts/test-simulation.mjs`
Expected: all unit tests pass and simulation exits 0 with calculated pillars, pipeline, and dynamic report checks.

- [ ] **Step 3: Apply the migration to production D1 only after tests are green**

Run: `npm run cf:db:migrate:remote`
Run: `npx wrangler d1 execute liangyi-bazi-production --remote --command "PRAGMA table_info(reports)"`
Expected: the production schema has `version_number`; no user rows are deleted.

- [ ] **Step 4: Deploy Worker and Pages from the current branch**

Run: `npm run cf:deploy`
Run: `npx wrangler pages deploy <staged-static-assets> --project-name bazi-culture --branch feature/major-update-optimization --commit-hash "$(git rev-parse HEAD)" --commit-dirty=false`
Expected: a Worker deployment and a Pages deployment URL are reported.

- [ ] **Step 5: Perform authenticated browser verification**

1. Open `https://bazi.hlabs.me/app.html` and sign in with an authorized wallet.
2. Start one new conversation, submit two distinct questions, and wait for both to complete.
3. Verify one left-column thread, four ordered chat messages, and a report selector containing `版本 1` and `版本 2`.
4. Switch to `版本 1`, then `版本 2`, verifying neither Markdown result is overwritten.
5. Reload and reopen the thread; verify the same messages and versions return.

- [ ] **Step 6: Commit release verification changes if any**

```bash
git status --short
git add <only-files-changed-by-this-task>
git commit -m "chore: verify threaded conversation release"
```

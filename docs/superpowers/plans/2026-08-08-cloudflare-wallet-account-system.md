# Cloudflare Wallet Account System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a Cloudflare-hosted account system where a verified EVM wallet is the sole non-recoverable credential and all user data is securely persisted and synchronized across devices.

**Architecture:** Cloudflare Pages serves the static workbench. A same-origin Cloudflare Worker owns all `/api/*` routes, authenticates wallet signatures, issues hashed HttpOnly sessions, and accesses D1 through narrowly scoped repositories. D1 stores authoritative user data and KV stores one-time challenges and rate limits; no protected route authorizes a caller from a `wallet` request parameter.

**Tech Stack:** JavaScript ES modules, Cloudflare Workers, Cloudflare Pages, D1 (SQLite), KV, Wrangler, Ethers v6, Node test runner, existing SSE pipeline.

## Global Constraints

- An EVM wallet is the sole account credential. There is no email, social, support, or operator recovery path for a lost wallet.
- A verified session cookie, never a body/query `wallet` field or browser local storage, establishes the authenticated user for protected resources.
- D1 is authoritative for account, profile, conversation, report, preference, credit, and session data. KV is used only for short-lived challenge, rate-limit, and cache state.
- Challenge messages bind operation, normalized wallet, canonical origin, nonce, issue time, and version; challenges expire after ten minutes and are consumed once.
- Production cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, and path-scoped; session secrets are hashed before D1 storage.
- All user-owned reads and mutations constrain ownership with the authenticated user ID. Foreign or missing resource IDs return `404`.
- AI credit grants/debits and conversation creation are idempotent and transactional. Never fabricate a static report on failure; retain the actual failed generation state.
- Preserve the existing dynamic-report rule: all `userReport` text derives from the computed chart; do not add static fallback report paragraphs.
- After implementation changes affecting logic, agent prompts, AI services, or reports, run `npm test` and `node --env-file=.env scripts/test-simulation.mjs` as required by `AGENTS.md`.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `wrangler.toml` | Pages/Worker environment bindings and production-safe deployment configuration. |
| `migrations/0001_wallet_account.sql` | D1 tables, indexes, foreign keys, idempotency and ownership constraints. |
| `src/worker.js` | Cloudflare Worker fetch entry point, security headers, route dispatch, and same-origin CORS policy. |
| `lib/cloudflare/d1-client.js` | Small typed-by-convention wrapper around D1 prepared statements and transactions. |
| `lib/cloudflare/repositories/*.js` | One repository per ownership domain: users, auth sessions, profiles, conversations, preferences, credits, audits. |
| `lib/auth/challenge-service.js` | Canonical challenge construction, nonce persistence, signature verification, and replay protection. |
| `lib/auth/session-service.js` | Cookie parsing, random session creation, secret hashing, session lookup, renewal, and revocation. |
| `lib/http/auth-context.js` | Protected-request guard that resolves `userId` from the session and supplies `401`/`404` responses. |
| `lib/http/schema.js` | Shared bounded request parsing and validation helpers. |
| `api/auth.js` | Session-oriented challenge/register/login/me/logout handler, replacing process-local auth state. |
| `api/profile.js` | Authenticated D1 profile CRUD with active-profile synchronization. |
| `api/session-history.js` | Authenticated conversation, report, bookmark, and delete endpoints. |
| `api/chat.js` | Session-derived user/profile resolution; transactional credit and durable conversation/report lifecycle. |
| `api/quota.js` | D1 ledger-backed balance/check-in API using session identity. |
| `app.js` | Cookie-session bootstrap, authenticated state reset, server-first mutations, and preference synchronization. |
| `scripts/web-dev.mjs` | Local Worker-compatible API routing without wildcard CORS or wallet-param authorization. |
| `test/cloudflare-*.test.mjs` | D1/KV-backed contract, security, persistence, concurrency, and Worker route tests. |
| `docs/cloudflare-deployment.md` | Local, preview, production, rollback, secret, and smoke-test runbook. |

### Task 1: Establish Cloudflare Configuration and an Empty D1 Schema

**Files:**
- Create: `wrangler.toml`
- Create: `migrations/0001_wallet_account.sql`
- Create: `test/cloudflare-schema.test.mjs`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: current static entry files and existing `functions/api/*` deployment wrappers.
- Produces: D1 bindings named `DB`, KV binding named `AUTH_KV`, `npm run cf:dev`, `npm run cf:db:migrate:local`, and `npm run cf:deploy` commands.

- [ ] **Step 1: Write the failing schema contract test**

```js
test('wallet account migration creates each production ownership table', async () => {
  const tables = await listTables(db);
  for (const name of ['users', 'profiles', 'conversations', 'conversation_messages', 'reports', 'user_preferences', 'credit_ledger', 'auth_sessions', 'audit_events']) {
    assert.ok(tables.includes(name), `missing ${name}`);
  }
});
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run: `node --test test/cloudflare-schema.test.mjs`

Expected: FAIL because the D1 migration and local D1 test setup do not exist.

- [ ] **Step 3: Add Cloudflare configuration, migration, and npm scripts**

```toml
name = "liangyi-bazi-api"
main = "src/worker.js"
compatibility_date = "2026-08-08"

[[d1_databases]]
binding = "DB"
database_name = "liangyi-bazi"
database_id = "REPLACE_AFTER_CLOUDFLARE_D1_CREATE"
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "AUTH_KV"
id = "REPLACE_AFTER_CLOUDFLARE_KV_CREATE"
preview_id = "REPLACE_AFTER_CLOUDFLARE_KV_CREATE"
```

```sql
PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled'))
);
CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  active_profile_id TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  birth_time TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  time_known INTEGER NOT NULL DEFAULT 1,
  birthplace TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  profile_id TEXT REFERENCES profiles(id),
  request_id TEXT NOT NULL,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  topic TEXT NOT NULL,
  bookmarked INTEGER NOT NULL DEFAULT 0,
  generation_status TEXT NOT NULL DEFAULT 'pending' CHECK (generation_status IN ('pending', 'streaming', 'complete', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (user_id, request_id)
);
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, sequence)
);
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  summary TEXT NOT NULL DEFAULT '',
  report_markdown TEXT NOT NULL DEFAULT '',
  chart_summary TEXT NOT NULL DEFAULT '',
  chart_json TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  secret_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent_hash TEXT,
  ip_hash TEXT
);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX profiles_by_user_updated ON profiles(user_id, updated_at DESC);
CREATE INDEX conversations_by_user_updated ON conversations(user_id, updated_at DESC);
CREATE INDEX messages_by_conversation ON conversation_messages(conversation_id, sequence);
CREATE INDEX reports_by_user_updated ON reports(user_id, updated_at DESC);
CREATE INDEX sessions_by_user_expiry ON auth_sessions(user_id, expires_at);
CREATE INDEX audit_events_by_user_created ON audit_events(user_id, created_at DESC);
```

Add `wrangler` as a development dependency and scripts that call `wrangler d1 migrations apply DB --local`, `wrangler dev`, and `wrangler deploy` without placing account IDs or API tokens in Git.

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `npm run cf:db:migrate:local && node --test test/cloudflare-schema.test.mjs`

Expected: PASS; foreign keys and every required table are present in an isolated local D1 database.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example wrangler.toml migrations/0001_wallet_account.sql test/cloudflare-schema.test.mjs
git commit -m "feat: add cloudflare account data schema"
```

### Task 2: Build D1 Repositories and Transactional Credit Ledger

**Files:**
- Create: `lib/cloudflare/d1-client.js`
- Create: `lib/cloudflare/repositories/user-repository.js`
- Create: `lib/cloudflare/repositories/profile-repository.js`
- Create: `lib/cloudflare/repositories/conversation-repository.js`
- Create: `lib/cloudflare/repositories/preference-repository.js`
- Create: `lib/cloudflare/repositories/credit-repository.js`
- Create: `test/cloudflare-repositories.test.mjs`

**Interfaces:**
- Consumes: `env.DB` D1 binding and migration from Task 1.
- Produces: `findOrCreateUser(walletAddress)`, `findProfileForUser(userId, profileId)`, `listConversations(userId)`, `savePreferences(userId, patch)`, and `debitOnce({ userId, idempotencyKey, amount, reason })`.

- [ ] **Step 1: Write failing repository tests**

```js
test('a conversation cannot be retrieved through a different user id', async () => {
  const conversation = await conversations.create(owner.id, { title: '事业', question: '工作如何推进' });
  assert.equal(await conversations.findById(other.id, conversation.id), null);
});

test('debitOnce persists one immutable ledger event for repeated idempotency keys', async () => {
  const first = await credits.debitOnce({ userId, amount: 10, reason: 'chat', idempotencyKey: 'req-1' });
  const retry = await credits.debitOnce({ userId, amount: 10, reason: 'chat', idempotencyKey: 'req-1' });
  assert.equal(first.balance, retry.balance);
  assert.equal(await credits.countEvents(userId, 'req-1'), 1);
});
```

- [ ] **Step 2: Run the focused repository test to verify it fails**

Run: `node --test test/cloudflare-repositories.test.mjs`

Expected: FAIL because D1 repositories do not exist.

- [ ] **Step 3: Implement parameterized repositories and ledger semantics**

```js
export async function debitOnce({ userId, amount, reason, idempotencyKey }) {
  const previous = await db.prepare(
    'SELECT balance_after FROM credit_ledger WHERE user_id = ? AND idempotency_key = ?',
  ).bind(userId, idempotencyKey).first();
  if (previous) return { balance: previous.balance_after, replayed: true };

  return db.batch([
    db.prepare('INSERT INTO credit_ledger (id, user_id, amount, reason, idempotency_key, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, userId, -amount, reason, idempotencyKey, nextBalance, now),
    db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').bind(now, userId),
  ]);
}
```

Use D1 prepared statements only. Centralize generated IDs, ISO timestamps, JSON serialization, and ownership predicates. Implement soft-delete state for profiles and conversations, exclude deleted rows from lists, and never return raw database fields not needed by the caller.

- [ ] **Step 4: Run repository tests to verify they pass**

Run: `node --test test/cloudflare-repositories.test.mjs`

Expected: PASS; owner predicates, soft deletion, preference upsert, and ledger idempotency are covered.

- [ ] **Step 5: Commit**

```bash
git add lib/cloudflare test/cloudflare-repositories.test.mjs
git commit -m "feat: persist account records in d1"
```

### Task 3: Add One-Time Wallet Challenges and Hashed Server Sessions

**Files:**
- Create: `lib/auth/challenge-service.js`
- Create: `lib/auth/session-service.js`
- Create: `lib/http/auth-context.js`
- Create: `test/cloudflare-auth.test.mjs`
- Modify: `api/auth.js`

**Interfaces:**
- Consumes: `AUTH_KV`, D1 `users` and `auth_sessions`, Ethers `verifyMessage`, and repositories from Task 2.
- Produces: `createChallenge()`, `consumeVerifiedChallenge()`, `createSession()`, `requireAuth(request, env)`, and session-oriented `/api/auth/*` responses.

- [ ] **Step 1: Write failing authentication and session tests**

```js
test('verified login sets an HttpOnly cookie and /me resolves its wallet', async () => {
  const login = await loginWithSignedChallenge(wallet);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await worker.fetch('/api/auth/me', { headers: { cookie: login.headers.get('set-cookie') } })).status, 200);
});

test('a consumed nonce, wrong signer, wrong operation, or wrong origin cannot establish a session', async () => {
  for (const attempt of [replay, wrongSigner, wrongOperation, wrongOrigin]) {
    assert.equal((await attempt()).status, 401);
  }
});
```

- [ ] **Step 2: Run focused auth tests to verify they fail**

Run: `node --test test/cloudflare-auth.test.mjs`

Expected: FAIL because no Worker session boundary exists.

- [ ] **Step 3: Implement secure challenge and session services**

```js
export async function requireAuth(request, env) {
  const raw = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  if (!raw) return null;
  const hash = await sha256(raw);
  const session = await sessions.findActiveByHash(hash, new Date().toISOString());
  return session ? { userId: session.userId, walletAddress: session.walletAddress, sessionId: session.id } : null;
}
```

The auth handler must accept `register`, `login`, `me`, and `logout`; register creates a new wallet user, while login only resumes an existing wallet user. The username remains optional profile metadata and is never an additional login requirement. Generate 32 random bytes for raw session secrets, store a SHA-256 hash, rotate sessions at a documented threshold, revoke precisely the presented session on logout, and emit production cookie attributes only when `env.ENVIRONMENT === 'production'`.

- [ ] **Step 4: Run auth tests to verify they pass**

Run: `node --test test/cloudflare-auth.test.mjs`

Expected: PASS; each replay and mismatched binding fails, no raw cookie is stored in D1, and valid `/me` works.

- [ ] **Step 5: Commit**

```bash
git add api/auth.js lib/auth lib/http test/cloudflare-auth.test.mjs
git commit -m "feat: authenticate wallet users with secure sessions"
```

### Task 4: Replace Wallet-Parameter Profile, History, and Preference APIs

**Files:**
- Create: `api/preferences.js`
- Modify: `api/profile.js`
- Modify: `api/session-history.js`
- Modify: `api/quota.js`
- Create: `test/cloudflare-resource-authz.test.mjs`

**Interfaces:**
- Consumes: `requireAuth()` from Task 3 and D1 repositories from Task 2.
- Produces: session-scoped profile, conversation, bookmark, preference, and quota routes with no user-identity request parameter.

- [ ] **Step 1: Write failing cross-account authorization tests**

```js
test('supplying another wallet or foreign profile id never changes the selected account data', async () => {
  const response = await asUser(otherUser, '/api/profile', {
    method: 'DELETE', body: { profileId: ownerProfile.id, wallet: owner.walletAddress },
  });
  assert.equal(response.status, 404);
  assert.equal(await profiles.findById(owner.id, ownerProfile.id).then(Boolean), true);
});

test('preferences synchronize only for the session owner', async () => {
  await asUser(owner, '/api/preferences', { method: 'PATCH', body: { activeProfileId: ownerProfile.id, settings: { density: 'compact' } } });
  assert.deepEqual((await asUser(otherUser, '/api/preferences')).body.settings, {});
});
```

- [ ] **Step 2: Run resource authorization tests to verify they fail**

Run: `node --test test/cloudflare-resource-authz.test.mjs`

Expected: FAIL because existing endpoints trust `wallet` query/body values.

- [ ] **Step 3: Convert APIs to authenticated contracts**

```js
const auth = await requireAuth(request, env);
if (!auth) return json({ error: 'AUTH_REQUIRED' }, 401);
const profile = await profiles.findById(auth.userId, body.profileId);
if (!profile) return json({ error: 'PROFILE_NOT_FOUND' }, 404);
```

Remove `wallet` from protected endpoint inputs and response payloads unless returning the authenticated account summary from `/api/auth/me`. Make profile and conversation deletion soft deletes, validate bounded fields before persistence, return `404` for foreign IDs, and use preferences to persist active profile plus layout/settings JSON. Port quota/check-in state into the credit ledger or a D1 daily-check-in record owned by `user_id`; do not retain `userQuotaStore`.

- [ ] **Step 4: Run resource authorization tests to verify they pass**

Run: `node --test test/cloudflare-resource-authz.test.mjs`

Expected: PASS; all protected routes reject missing sessions and conceal cross-account resources.

- [ ] **Step 5: Commit**

```bash
git add api/profile.js api/session-history.js api/preferences.js api/quota.js test/cloudflare-resource-authz.test.mjs
git commit -m "feat: scope persisted resources to wallet sessions"
```

### Task 5: Make Chat, Reports, and Credits Durable and Idempotent

**Files:**
- Modify: `api/chat.js`
- Modify: `api/ai-report.js`
- Modify: `lib/runtime/session-history-service.js`
- Create: `test/cloudflare-chat-persistence.test.mjs`

**Interfaces:**
- Consumes: authenticated request context, D1 conversation/report repositories, `debitOnce()`, and existing `run6StagePipeline` stream events.
- Produces: an SSE chat route that creates one owned conversation, charges once, stores generated question/summary/report/chart metadata, and survives a Worker restart.

- [ ] **Step 1: Write failing chat lifecycle tests**

```js
test('chat persists the actual generated report once and reloads it through a fresh Worker instance', async () => {
  const first = await consumeSse(await asUser(user, '/api/chat', { method: 'POST', body: { profileId, question: '事业如何推进', requestId: 'chat-1' } }));
  assert.match(first.reportMarkdown, /事业/);
  const freshWorker = createWorkerWithSameD1();
  assert.equal((await freshWorker.fetch(`/api/conversations/${first.sessionId}`, cookie)).status, 200);
});

test('replaying the same request id does not double debit or create a second conversation', async () => {
  await sendChat('chat-retry');
  await sendChat('chat-retry');
  assert.equal(await credits.countEvents(user.id, 'chat-retry'), 1);
  assert.equal(await conversations.countByRequestId(user.id, 'chat-retry'), 1);
});
```

- [ ] **Step 2: Run chat persistence tests to verify they fail**

Run: `node --test test/cloudflare-chat-persistence.test.mjs`

Expected: FAIL because chat accepts a wallet body value and writes only process-local history.

- [ ] **Step 3: Make the SSE lifecycle persistence-backed**

```js
const auth = await requireAuth(request, env);
const conversation = await conversations.findOrCreateByRequestId(auth.userId, requestId, { profileId, question, topic });
await credits.debitOnce({ userId: auth.userId, amount: 10, reason: 'chat', idempotencyKey: requestId });
for await (const event of run6StagePipeline(input)) {
  stream.enqueue(encodeSse(event));
  if (event.type === 'final') await reports.complete(auth.userId, conversation.id, event);
}
```

Validate that `profileId` belongs to the authenticated user before building chart input. Persist the final real report and summary in D1, retain explicit failure state if streaming fails, and emit the stable conversation ID in SSE. Delete or rework `SessionHistoryService` only after all callers are migrated; it must not remain an authoritative in-memory path.

- [ ] **Step 4: Run chat persistence tests to verify they pass**

Run: `node --test test/cloudflare-chat-persistence.test.mjs`

Expected: PASS; restart persistence, ownership, real report content, and retry idempotency are proven.

- [ ] **Step 5: Commit**

```bash
git add api/chat.js api/ai-report.js lib/runtime/session-history-service.js test/cloudflare-chat-persistence.test.mjs
git commit -m "feat: persist authenticated chat reports"
```

### Task 6: Create the Cloudflare Worker API Boundary and Local Runtime Parity

**Files:**
- Create: `src/worker.js`
- Modify: `functions/api/auth.js`
- Modify: `functions/api/profile.js`
- Modify: `functions/api/session-history.js`
- Modify: `scripts/web-dev.mjs`
- Create: `test/cloudflare-worker-routes.test.mjs`

**Interfaces:**
- Consumes: all API handlers revised in Tasks 3-5 and bindings defined in Task 1.
- Produces: one Worker `fetch(request, env, ctx)` entry point where each protected handler receives `env`, with security headers and no wildcard credential CORS.

- [ ] **Step 1: Write failing Worker route and header tests**

```js
test('Worker dispatches protected API routes and refuses cross-origin credential use', async () => {
  const response = await worker.fetch(new Request('https://app.example/api/auth/me', { headers: { origin: 'https://evil.example' } }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
});
```

- [ ] **Step 2: Run Worker route tests to verify they fail**

Run: `node --test test/cloudflare-worker-routes.test.mjs`

Expected: FAIL because no Worker entry point exists and local development enables `Access-Control-Allow-Origin: *`.

- [ ] **Step 3: Implement one Worker router and align wrappers**

```js
export default {
  async fetch(request, env, ctx) {
    const response = await routeApiRequest(request, env, ctx);
    return withSecurityHeaders(response, env);
  },
};
```

Route `/api/auth/*`, `/api/profiles`, `/api/conversations`, `/api/preferences`, `/api/quota`, `/api/chat`, and existing public chart endpoints explicitly. Pass `env` to handlers. Restrict CORS to configured development origin only when needed, never use wildcard origins with sessions, implement OPTIONS only for the allowed origin, and add CSP, `nosniff`, referrer, and frame protections. Update the Node dev server to use the same handler signatures and set-cookie forwarding so local browser tests exercise session behavior.

- [ ] **Step 4: Run Worker route tests to verify they pass**

Run: `node --test test/cloudflare-worker-routes.test.mjs`

Expected: PASS; every expected route dispatches and security headers are set without wildcard credential access.

- [ ] **Step 5: Commit**

```bash
git add src/worker.js functions/api scripts/web-dev.mjs test/cloudflare-worker-routes.test.mjs
git commit -m "feat: add cloudflare worker api boundary"
```

### Task 7: Convert the Workbench to Session-First Remote State

**Files:**
- Modify: `app.js`
- Modify: `app.html`
- Modify: `app.css`
- Modify: `test/frontend-contract.test.mjs`
- Create: `test/cloudflare-frontend-session.test.mjs`

**Interfaces:**
- Consumes: `/api/auth/me`, `/api/auth/logout`, authenticated profile/conversation/preference endpoints, and browser `accountsChanged` events.
- Produces: no wallet-parameter protected fetches; a clear login/expired state; server-first profile/history/preference mutation behavior.

- [ ] **Step 1: Write failing frontend session-contract tests**

```js
test('frontend establishes data only from /api/auth/me and never appends wallet to protected API paths', () => {
  assert.match(appJs, /fetchApi\('\/api\/auth\/me'\)/);
  assert.doesNotMatch(appJs, /\/api\/(profile|session-history|quota)\?wallet=/);
  assert.doesNotMatch(appJs, /JSON\.stringify\(\{\s*wallet:\s*currentWallet/);
});

test('logout, account change, and 401 clear account state and remote data cache', () => {
  assert.match(appJs, /async function clearAuthenticatedState/);
  assert.match(appJs, /accountsChanged[\s\S]*?clearAuthenticatedState/);
  assert.match(appJs, /response\.status === 401[\s\S]*?clearAuthenticatedState/);
});
```

- [ ] **Step 2: Run frontend session tests to verify they fail**

Run: `node --test test/cloudflare-frontend-session.test.mjs`

Expected: FAIL because current protected calls include `wallet` and use local storage as fallback authority.

- [ ] **Step 3: Implement session bootstrap and remote synchronization**

```js
async function bootstrapAuthenticatedAccount() {
  const result = await fetchApi('/api/auth/me');
  account = result.account;
  currentWallet = account.walletAddress;
  await Promise.all([loadProfiles(), loadHistory(), loadPreferences()]);
}

async function clearAuthenticatedState() {
  account = null;
  currentWallet = null;
  profiles = [];
  savedSessions = [];
  activeProfile = null;
  removeWalletScopedRenderCache();
  renderUnconnectedState();
}
```

Use `credentials: 'same-origin'` in the shared fetch helper. After signing in, call `/api/auth/me` and render only server-returned account data. On logout, account change, signature refusal, or `401`, clear all in-memory state and wallet-scoped local render cache. Keep local storage only for non-sensitive rendering convenience after a verified session; never load it as remote truth when the network call fails. Persist active profile, workspace layout, and saved settings through `/api/preferences`; apply server responses before rendering. Escape user-controlled profile/session text before interpolating it in HTML.

- [ ] **Step 4: Run frontend tests to verify they pass**

Run: `node --test test/frontend-contract.test.mjs test/cloudflare-frontend-session.test.mjs`

Expected: PASS; session bootstrap and cache clearing contracts are present without regressing existing chart/report UI behavior.

- [ ] **Step 5: Commit**

```bash
git add app.js app.html app.css test/frontend-contract.test.mjs test/cloudflare-frontend-session.test.mjs
git commit -m "feat: load workbench data from secure wallet session"
```

### Task 8: Add Deployment Runbook, Preview Checks, and Production Configuration

**Files:**
- Create: `docs/cloudflare-deployment.md`
- Modify: `README.md`
- Modify: `.env.example`
- Create: `scripts/check-cloudflare-deployment.mjs`
- Create: `test/cloudflare-deployment-contract.test.mjs`

**Interfaces:**
- Consumes: Wrangler config, Worker entry point, D1 migrations, Pages static assets, and all revised API routes.
- Produces: exact commands to create bindings, set secrets, deploy preview/production, run D1 migrations, validate health, and roll back safely.

- [ ] **Step 1: Write failing deployment contract test**

```js
test('deployment documentation contains no actual secret and requires migrations before production deploy', () => {
  const doc = readFileSync('docs/cloudflare-deployment.md', 'utf8');
  assert.match(doc, /wrangler d1 migrations apply DB --remote/);
  assert.match(doc, /wrangler secret put OPENAI_API_KEY/);
  assert.doesNotMatch(doc, /OPENAI_API_KEY=sk-/);
});
```

- [ ] **Step 2: Run deployment contract test to verify it fails**

Run: `node --test test/cloudflare-deployment-contract.test.mjs`

Expected: FAIL because the production runbook and deployment checker do not exist.

- [ ] **Step 3: Document and automate a guarded deployment workflow**

```bash
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
npx wrangler pages deploy . --project-name liangyi-bazi
node scripts/check-cloudflare-deployment.mjs https://YOUR_PRODUCTION_DOMAIN
```

Document the required Cloudflare account authorization, D1/KV creation, binding IDs, Pages project creation, Worker route association, secret names, custom-domain TLS, preview isolation, Cloudflare Analytics/log review, and rollback to the previous Worker/Pages deployment. The checker must fail on a non-HTTPS URL, non-2xx health response, missing security headers, or an unauthenticated `/api/auth/me` response other than `401`.

- [ ] **Step 4: Run deployment contract test to verify it passes**

Run: `node --test test/cloudflare-deployment-contract.test.mjs`

Expected: PASS; runbook contains safe deployment order and no committed secrets.

- [ ] **Step 5: Commit**

```bash
git add docs/cloudflare-deployment.md README.md .env.example scripts/check-cloudflare-deployment.mjs test/cloudflare-deployment-contract.test.mjs
git commit -m "docs: add cloudflare production deployment runbook"
```

### Task 9: Execute End-to-End Verification and Deploy When Cloudflare Authority Is Available

**Files:**
- Modify as needed: only files failing the verification commands below.

**Interfaces:**
- Consumes: completed Tasks 1-8, local `.dev.vars`, a real browser with a test wallet, and a Cloudflare account authorized to create and deploy the named resources.
- Produces: terminal and browser evidence for local persistence, cross-account isolation, cross-device synchronization, preview deployment, production deployment, and rollback readiness.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: all existing and new unit/contract tests pass. Do not treat a partial targeted suite as evidence for the full account system.

- [ ] **Step 2: Run the mandatory dynamic report simulation**

Run: `node --env-file=.env scripts/test-simulation.mjs`

Expected: PASS with real four pillars, multi-agent pipeline events, and a non-repeated dynamic 1500-word report grounded in the chart.

- [ ] **Step 3: Prove local browser behavior using two wallets**

Run: `npm run dev:web`

Expected: first wallet registers, creates profile/history/preferences, reloads successfully, and logs out; second wallet cannot enumerate or fetch the first wallet's IDs; signing into the first wallet in a separate browser profile restores the same data and preferences.

- [ ] **Step 4: Deploy and verify a Cloudflare preview**

Run: `npm run cf:db:migrate:remote:preview && npm run cf:deploy:preview && npm run cf:pages:preview`

Expected: preview uses isolated D1/KV bindings, passes `node scripts/check-cloudflare-deployment.mjs PREVIEW_URL`, and completes the two-wallet browser flow over HTTPS.

- [ ] **Step 5: Deploy production after explicit resource/account availability**

Run: `npm run cf:db:migrate:remote && npm run cf:deploy && npm run cf:pages:deploy && node scripts/check-cloudflare-deployment.mjs PRODUCTION_URL`

Expected: production health checker passes, `/api/auth/me` rejects unauthenticated callers with `401`, the real login/persistence flow succeeds, and Cloudflare logs contain no session secret or provider secret.

## Plan Self-Review

- Spec coverage: Tasks 1-2 cover durable D1 data ownership; Task 3 covers wallet signature, one-time nonce, and secure sessions; Task 4 removes wallet-param authorization and adds synchronized preferences; Task 5 covers durable real report/chat and transactional usage; Task 6 covers Worker/Pages boundary and security headers; Task 7 covers browser session state; Task 8 covers deployment and secrets; Task 9 supplies local, preview, and production evidence.
- Placeholder scan: the only replacement values are Cloudflare IDs and production URLs intentionally supplied by the authorized Cloudflare account at deployment time; no implementation step depends on an unspecified code decision.
- Type consistency: `userId` comes only from `requireAuth`; repositories receive it as the first ownership argument; `requestId` is the idempotency key for chat and credit operations; D1 `auth_sessions` stores only hashed raw cookie secrets.

# Guest Session and Wallet Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let visitors use profiles and AI analysis without server-side persistence, and replace username-based wallet registration/login with one verified wallet-signature action.

**Architecture:** The frontend stores guest-only state in versioned `sessionStorage` and calls a stateless guest chat route that streams the existing six-stage pipeline without repository access. Wallet authentication adds a username-free `authenticate` challenge operation and endpoint that find-or-creates the verified wallet account and issues the existing session cookie.

**Tech Stack:** ES modules, Node `node:test`, Cloudflare Worker, D1, KV, browser `sessionStorage`, EIP-191 `personal_sign`.

## Global Constraints

- Guest personal data, profiles, conversations, reports, preferences, credits, check-ins, and sessions must not be written to D1, KV, or another server-side store.
- Guest state survives same-tab refreshes only through `sessionStorage`; it is cleared before signed-account state is loaded.
- Wallet authentication verifies the signature against the challenged address and canonical origin. No fallback address or username-based identity is allowed.
- Authenticated wallet flows retain their D1-backed authorization and persistence behavior.
- Complete `npm test` and `node --env-file=.env scripts/test-simulation.mjs` before handoff.

---

### Task 1: Define Username-Free Wallet Authentication

**Files:**
- Modify: `test/auth-register-login-contract.test.mjs`
- Modify: `test/cloudflare-auth.test.mjs`
- Modify: `test/cloudflare-frontend-session.test.mjs`
- Modify: `lib/auth/challenge-service.js`
- Modify: `lib/runtime/auth-service.js`
- Modify: `api/auth.js`

**Interfaces:**
- `GET /api/auth/challenge?wallet=<address>&operation=authenticate`
- `POST /api/auth/authenticate` body `{ wallet, challengeId, signature }`
- Account response contains verified `walletAddress` and `username: null`.

- [ ] Write failing legacy and Cloudflare tests where a valid `authenticate` signature creates a username-free account.

```js
const challenge = await challengeFor({ wallet, operation: 'authenticate', origin });
const response = await jsonResponse(request('http://api.example.test/api/auth/authenticate', {
  method: 'POST', origin, body: challenge,
}));
assert.equal(response.status, 200);
assert.equal(response.body.account.walletAddress, wallet.address.toLowerCase());
assert.equal(response.body.account.username, null);
```

- [ ] Add a repeat-authentication assertion: one D1 user and one `welcome` credit ledger entry exist for that wallet.
- [ ] Run `node --test test/auth-register-login-contract.test.mjs test/cloudflare-auth.test.mjs test/cloudflare-frontend-session.test.mjs` and confirm RED because `authenticate` does not exist.
- [ ] Update challenge normalization, legacy auth service, and Cloudflare auth handler to consume `authenticate`, find or create by recovered wallet, grant welcome credit once, and issue the standard session cookie.
- [ ] Re-run the same test command and confirm GREEN.
- [ ] Commit with `git add lib/auth/challenge-service.js lib/runtime/auth-service.js api/auth.js test/auth-register-login-contract.test.mjs test/cloudflare-auth.test.mjs test/cloudflare-frontend-session.test.mjs && git commit -m "feat: authenticate wallets without usernames"`.

### Task 2: Add Stateless Guest Analysis

**Files:**
- Modify: `test/cloudflare-chat-persistence.test.mjs`
- Modify: `api/chat.js`
- Modify: `src/worker.js`

**Interfaces:**
- `POST /api/guest/chat` body `{ profile, question, previousReport? }`
- Output uses existing SSE `phase_*`, `conclusion`, `report`, `session_end`, and `error` events.
- The handler must not call `requireAuth`, repositories, D1, KV, credits, conversations, messages, reports, or sessions.

- [ ] Write a failing test that sends a valid guest profile/question, asserts a `report` SSE event, and asserts zero rows in `users`, `profiles`, `conversations`, `conversation_messages`, `reports`, `auth_sessions`, `credit_ledger`, and `daily_checkins`.
- [ ] Add an invalid-profile case that returns `400 INVALID_GUEST_PROFILE` and leaves all tables empty.
- [ ] Run `node --test test/cloudflare-chat-persistence.test.mjs` and confirm RED because `handleGuestChatRequest` is missing.
- [ ] Export `handleGuestChatRequest` from `api/chat.js`. Validate a normalized profile, call `run6StagePipeline` with no repositories, and stream the result without persistence. Route `/api/guest/chat` in `src/worker.js`.
- [ ] Re-run the guest test and confirm GREEN.
- [ ] Commit with `git add api/chat.js src/worker.js test/cloudflare-chat-persistence.test.mjs && git commit -m "feat: add stateless guest analysis"`.

### Task 3: Add Browser-Session Guest State and Simplified Wallet UI

**Files:**
- Modify: `test/frontend-contract.test.mjs`
- Modify: `test/auth-register-login-contract.test.mjs`
- Modify: `test/cloudflare-frontend-session.test.mjs`
- Modify: `app.html`
- Modify: `app.js`
- Modify: `app.css` only if the existing state styles cannot render a concise guest label.

**Interfaces:**
- `sessionStorage['liangyi_guest_session_v1']` contains `{ profiles, activeProfileId, sessions, activeConversationId, reportVersions }`.
- Guests call `/api/guest/chat`; authenticated users call `/api/chat`.
- Guests never call persistent profile/history/preferences/quota routes for state changes.

- [ ] Write failing source contracts for `GUEST_SESSION_STORAGE_KEY`, `sessionStorage` load/save, `/api/guest/chat`, and a single `auth-submit-btn`; assert the old username/register/login element IDs are absent.
- [ ] Run `node --test test/frontend-contract.test.mjs test/auth-register-login-contract.test.mjs test/cloudflare-frontend-session.test.mjs` and confirm RED.
- [ ] Add small helpers in `app.js` to normalize, load, save, and clear guest state. On failed `/api/auth/me`, restore guest profiles/history from `sessionStorage`; branch profile, preference, history, bookmark, delete, and chat actions so guest actions write only that state object.
- [ ] Replace the username input and two auth submit buttons with one explicit wallet-signature control. Request an `authenticate` challenge, sign only after the click, and clear guest state before loading the verified account. A cancellation or wallet change remains unauthenticated.
- [ ] Re-run the frontend test command and confirm GREEN.
- [ ] Commit with `git add app.html app.js app.css test/frontend-contract.test.mjs test/auth-register-login-contract.test.mjs test/cloudflare-frontend-session.test.mjs && git commit -m "feat: support temporary guest workspaces"`.

### Task 4: Regression and Live Validation

**Files:**
- Modify: none unless a verification defect requires a focused fix.

- [ ] Run `npm test`; expect all tests passing.
- [ ] Run `node --env-file=.env scripts/test-simulation.mjs`; expect deterministic four pillars, six-stage pipeline output, and a dynamic report.
- [ ] Restart `npm run dev:web`; at `http://127.0.0.1:4173/app.html`, create a guest profile, request analysis, refresh, and verify the profile/report remain. Then sign in with a real wallet and verify no guest content transfers into the persistent account.
- [ ] Run `git diff --check` and `git status --short --branch`; preserve pre-existing user changes.

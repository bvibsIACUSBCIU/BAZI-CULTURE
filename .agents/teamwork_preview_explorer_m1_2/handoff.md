# Handoff Report — Backend & Quota Architecture Analysis (R1)

## Executive Summary
This report presents a thorough investigation of the backend endpoints, data models, persistence mechanisms, and quota tracking engines in `api/`, `lib/`, `functions/`, `package.json`, and `scripts/` to support **Milestone 1 (R1: Multi-Profile & Session Management)**. Key gaps have been identified in profile data modeling (single profile vs multi-profile), quota task tracking (`⚡ 1580 Free` & check-in progress), web session persistence, and Cloudflare Pages Functions route mounting. Concrete backend recommendations and interface specifications are provided below.

---

## 1. Observation (Direct Findings & References)

### 1.1 Auth & Account Data Model (`lib/runtime/auth-service.js`)
* **Line 101–108**: `AccountRecord` structure is currently defined as:
  ```js
  const newAccount = {
    walletAddress: cleanAddress,
    registeredIp: cleanIp,
    createdAt: new Date().toISOString(),
    masterProfile: null, // Single master profile object
    credits: 100,        // Default 100 credits
    usageCount: 0
  };
  ```
* **Line 93–97**: IP registration limit enforces a maximum of 3 wallet accounts per IP:
  ```js
  if (registeredWallets.size >= 3) {
    const err = new Error('IP_REGISTRATION_LIMIT_EXCEEDED');
    err.code = 'IP_REGISTRATION_LIMIT_EXCEEDED';
    err.details = `同一 IP (${cleanIp}) 最多只能创建 3 个钱包账户。`;
    throw err;
  }
  ```
* **Line 123–149**: `setMasterProfile(walletAddress, profile)` updates a single `masterProfile` object `{ name, gender, birthYear, birthMonth, birthDay, birthHour, birthplace }`.
* **Line 157–180**: `deductCredits(walletAddress, cost = 10)` subtracts credits (10 per call) and throws `INSUFFICIENT_CREDITS` if `credits < cost`.

### 1.2 Auth & Profile Endpoints (`api/auth.js`)
* Implements `/api/auth/challenge`, `/api/auth/login`, `/api/auth/profile`, and `/api/auth/account`.
* Does NOT currently implement multi-profile CRUD (listing profiles, creating a profile, switching active profile, deleting a profile).
* Does NOT implement `/api/quota` returning `{ points: number, checkinTaskProgress: number }` as defined in `PROJECT.md`.

### 1.3 Edge Worker Routing Table (`functions/api/entry.js`)
* **Line 8–14**: `routeMap` in `entry.js` exposes only 5 endpoints:
  ```js
  const routeMap = {
    "/api/report": reportHandler,
    "/api/ai-report": aiReportHandler,
    "/api/events": eventsHandler,
    "/api/ziwei": ziweiHandler,
    "/api/qimen": qimenHandler,
  };
  ```
* **Gap**: `/api/auth`, `/api/profile`, and `/api/quota` are NOT mounted in `functions/api/entry.js`. Calling these endpoints in Edge / Vercel Functions will return HTTP 404.

### 1.4 AI Report & Credit Consumption (`api/ai-report.js`)
* **Line 90–92**: Credit deduction is triggered when `wallet` address is passed via body or header `x-wallet-address`:
  ```js
  if (wallet) {
    creditInfo = defaultAuthService.deductCredits(wallet, 10);
  }
  ```
* Conversation context (`previousReading`) is received in request body from client. Sever-side session store (`lib/runtime/session-store.js`) is used by rate limiters and Telegram bot sessions, but is not exposed to the web frontend as a session history API (`/api/sessions`).

### 1.5 Project Specification Contract (`PROJECT.md`)
* `PROJECT.md` specifies:
  - Quota API `/api/quota`: Returns `{ points: number, checkinTaskProgress: number }`.
  - Profile API `/api/profile`: Switch active profile (e.g., "韩立"), update right panel natal charts and history flow automatically.
  - UI requirement: `⚡ 1580 Free` quota limit panel and newcomer check-in progress bar (`新手打卡任务进度条`).

---

## 2. Logic Chain

1. **Multi-Profile Data Model Gap**:
   - *Observation*: `AuthService` stores a single `masterProfile` per wallet.
   - *Reasoning*: R1 user stories explicitly demand a profile switcher (`+👤`), profile search, and switching between multiple profiles (e.g. "韩立", "李飞", self/relatives).
   - *Deduction*: `AccountRecord` must be refactored to hold `profiles: Map<string, ProfileRecord>` or `ProfileRecord[]`, with an explicit `activeProfileId`.

2. **Quota & Newcomer Check-in Gap**:
   - *Observation*: `AuthService` defaults `credits` to 100 without newcomer task state or check-in progress metrics.
   - *Reasoning*: The frontend sidebar features a `⚡ 1580 Free` points balance panel and a newcomer check-in progress bar. `/api/quota` must return initial quota (1580), current points, daily check-in status, and completion percentage (`checkinTaskProgress`).
   - *Deduction*: `AccountRecord` needs `points` (starting at 1580), `checkinDays` (e.g., day 1 to 7), `checkinTaskProgress` (float 0.0 – 1.0), and `claimedTasks` (array/set).

3. **Session & History Flow Persistence Gap**:
   - *Observation*: `SessionStore` (`MemorySessionStore` & `RedisSessionStore`) exists in `lib/runtime/session-store.js`, but web endpoints do not allow saving, loading, or bookmarking chat flows per profile.
   - *Reasoning*: When a user switches profiles in the sidebar, the middle AI workspace and right panel should load history flows and bookmarked chats linked to that specific profile.
   - *Deduction*: A web session persistence layer (`/api/sessions`) should store sessions scoped by `(walletAddress, profileId)`.

4. **Edge Entry Route Wiring Gap**:
   - *Observation*: `functions/api/entry.js` maps only 5 routes, excluding `/api/auth`, `/api/profile`, `/api/quota`.
   - *Reasoning*: Client API requests to `/api/profile` or `/api/quota` would fail with 404 in production environment.
   - *Deduction*: `entry.js` must be updated to export handlers for `/api/profile` and `/api/quota`.

---

## 3. Caveats

* **Database / Serverless State Persistence**: `AuthService` currently relies on an in-memory `Map`. In a multi-worker or serverless environment without Redis, state is ephemeral. Plugging `AuthService` into `SessionStore` (or Upstash Redis) ensures cross-instance persistence.
* **Guest / Unauthenticated Mode**: If a user uses the app without connecting a Web3 wallet, the backend should fallback to an IP-bound guest session or local storage fallback with default 1580 quota.

---

## 4. Conclusion & Required Backend Hooks / Recommendations

### Recommendation 1: Refactor `AccountRecord` & Add Multi-Profile Hooks (`/api/profile`)
Extend `AccountRecord` in `lib/runtime/auth-service.js`:
```js
{
  walletAddress: "0x...",
  registeredIp: "127.0.0.1",
  createdAt: "2026-08-01T00:00:00.000Z",
  activeProfileId: "prof_123",
  profiles: [
    {
      id: "prof_123",
      name: "韩立",
      gender: "male",
      birthYear: 1995,
      birthMonth: 8,
      birthDay: 18,
      birthHour: 10,
      birthplace: "北京",
      isDefault: true,
      createdAt: "2026-08-01T00:00:00.000Z"
    }
  ]
}
```
Expose REST Endpoints in `api/profile.js`:
* `GET /api/profile?wallet=0x...` -> Returns `{ activeProfile, profiles: [...] }`
* `POST /api/profile` (action: `create` | `switch` | `update` | `delete`) -> Updates active profile or list.

### Recommendation 2: Implement Quota & Newcomer Check-in API (`/api/quota`)
Extend `AccountRecord` with quota properties:
```js
{
  points: 1580,
  maxPoints: 1580,
  checkinDays: 1, // 1/7
  checkinTaskProgress: 0.14, // 14%
  lastCheckinDate: "2026-08-01"
}
```
Expose REST Endpoints in `api/quota.js`:
* `GET /api/quota?wallet=0x...` -> Returns `{ ok: true, points: 1580, checkinTaskProgress: 0.14, checkinDays: 1 }`
* `POST /api/quota/checkin` -> Executes check-in, grants bonus points (+100 points), updates `checkinTaskProgress`.

### Recommendation 3: Add Session History Persistence API (`/api/sessions`)
Expose session history management in `api/sessions.js`:
* `GET /api/sessions?wallet=0x...&profileId=prof_123` -> Lists history sessions & bookmarks for profile.
* `POST /api/sessions` -> Creates/saves a conversation session.
* `POST /api/sessions/bookmark` -> Toggles bookmark status of a session flow.

### Recommendation 4: Update Route Mapping in `functions/api/entry.js`
Add missing API routes to `routeMap`:
```js
import profileHandler from "../../api/profile.js";
import quotaHandler from "../../api/quota.js";
import sessionsHandler from "../../api/sessions.js";

const routeMap = {
  "/api/report": reportHandler,
  "/api/ai-report": aiReportHandler,
  "/api/events": eventsHandler,
  "/api/ziwei": ziweiHandler,
  "/api/qimen": qimenHandler,
  "/api/profile": profileHandler,
  "/api/quota": quotaHandler,
  "/api/sessions": sessionsHandler,
};
```

---

## 5. Verification Method

1. **Unit Test Verification**:
   Execute standard test suite:
   ```bash
   npm test
   ```
   *Expected Result*: All 92+ tests pass with 0 failures.

2. **Simulation Test Verification**:
   Execute multi-agent simulation test:
   ```bash
   node --env-file=.env scripts/test-simulation.mjs
   ```
   *Expected Result*: Simulation pipeline executes 5-step agent tree and outputs dynamic report without static hardcoding.

3. **API Contract Verification**:
   Verify endpoints return expected data models:
   - `GET /api/profile?wallet=0x...` returns active profile & profile list.
   - `GET /api/quota?wallet=0x...` returns `{ points: 1580, checkinTaskProgress: 0.14 }`.
   - `POST /api/auth/login` enforces max 3 accounts per IP.

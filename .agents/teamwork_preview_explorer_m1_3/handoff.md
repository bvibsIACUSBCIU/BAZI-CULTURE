# Handoff Report — Test Infrastructure Status & Verification Recommendations (Instance 3)

## 1. Observation

- **Test Commands & Execution Status**:
  - `package.json` line 10 defines `"test": "node --test api/*.test.mjs"`.
  - Command `npm test` executed with 17 test files: 92 passed, 0 failed, 0 skipped (~210ms execution time).
  - Command `node --env-file=.env scripts/test-simulation.mjs` executed: successfully outputs 四柱排盘 (Four Pillars chart), 多 Agent 推演 Pipeline, 事实依据 (Sections), and 1500-word dynamic user report sections (`corePortrait`, `career`, `relationship`, `health`, `wealth`, `currentStage`).

- **Existing Test Suite Coverage**:
  - `api/auth.test.mjs` (101 lines):
    - Lines 5-24: Challenge generation & signature validation.
    - Lines 26-53: IP registration limit enforcement (`IP_REGISTRATION_LIMIT_EXCEEDED`, max 3 wallets per IP).
    - Lines 55-77: Master profile setting (`setMasterProfile`) & 100 credits initialization.
    - Lines 79-100: Credit deduction (`deductCredits`, 10 credits per dialogue, max 10 times, throwing `INSUFFICIENT_CREDITS`).
  - `api/session-store.test.mjs` (33 lines):
    - Lines 6-19: `MemorySessionStore` TTL record expiration.
    - Lines 21-32: Atomic key lock (`setIfAbsent`).
  - `api/simulation.test.mjs` (127 lines):
    - Lines 28-85: SIMULATION 1 - End-to-end AI report pipeline & Markdown formatting.
    - Lines 87-111: SIMULATION 2 - Fallback mode 1500-word Markdown report verification.
    - Lines 113-126: SIMULATION 3 - Verification that different birth charts produce non-identical dynamic reports.
  - `testdata/golden/` directory:
    - Contains `chart-cases.json`, `input-boundaries.json`, `corpus.schema.json`, and `source-register.json` tested via `api/golden-corpus.test.mjs`.

- **Scope & Contract Gaps for Milestone 1 (R1)**:
  - `PROJECT.md` line 23 & lines 28-31 define R1 requirements:
    - Left sidebar profile switcher (`+👤`), search, bookmarks, history flow, newcomer check-in & points balance panel (`⚡ 1580 Free`).
    - Endpoint `/api/quota`: Returns `{ points: number, checkinTaskProgress: number }`.
    - Endpoint `/api/profile`: Switch active profile (e.g. "韩立"), update right panel natal charts and history flow automatically.
  - `lib/runtime/auth-service.js` line 105: `masterProfile` currently stores only 1 profile per wallet (`masterProfile: null | Profile`). There is no multi-profile array/map or active profile switching state.
  - `functions/api/entry.js` lines 8-14: Routes `/api/report`, `/api/ai-report`, `/api/events`, `/api/ziwei`, `/api/qimen`, but does NOT route `/api/auth`, `/api/profile`, or `/api/quota`.
  - There are currently 0 unit test files for multi-profile switching (`/api/profile`), quota querying (`/api/quota`), newcomer task check-in points accrual, or profile-scoped conversation history search.

---

## 2. Logic Chain

1. **Step 1 (Test Runner Integrity)**: `npm test` runs Node's built-in `node --test` runner against all `api/*.test.mjs` files. All 92 unit and integration tests are currently passing, verifying that core metaphysics calculation, single auth account creation, fallback report generation, and system redirects function without breakage.
2. **Step 2 (Simulation Verification)**: `scripts/test-simulation.mjs` verifies end-to-end pipeline execution from raw birth input to dynamic 1500-word report generation. However, it currently tests only the single `POST /api/ai-report` endpoint without incorporating wallet auth headers, profile identifiers, points quota checks, or session history persistence.
3. **Step 3 (R1 Functionality Gap Analysis)**: While `AuthService` handles single-master profile assignment and 100-credit deductions, R1 requires a multi-profile switcher (`+👤`), multi-profile CRUD/switching, newcomer check-in progress with points balance (`⚡ 1580 Free`), `/api/quota`, `/api/profile`, and profile-scoped conversation history.
4. **Step 4 (Target Verification Plan)**: To ensure R1 implementation quality and satisfy AGENTS.md / GEMINI.md mandate (100% test pass + simulation test verification), implementers must implement backend contracts for multi-profile management & quota tracking, add dedicated test files (`api/profile.test.mjs`, `api/quota.test.mjs`), and update the simulation test script (`scripts/test-simulation.mjs`) to validate R1 user journeys.

---

## 3. Caveats

- `scripts/test-simulation.mjs` invokes AI generation which may attempt an external API call or fall back to local AI generation when API keys/credentials are unconfigured or timed out. In local test environments, fallback generation ensures deterministic tests pass within ~2 seconds.
- No live browser DOM end-to-end tests (e.g. Playwright / Cypress) exist in the repository; UI verification relies on backend contract testing (`api/*.test.mjs`) and manual preview inspection.

---

## 4. Conclusion

The existing test infrastructure is robust, fast (~210ms), and 100% passing across 92 tests. However, R1 (Multi-Profile & Session Management) requirements currently lack unit test coverage for multi-profile CRUD/switching (`/api/profile`), points quota & newcomer check-in progress (`/api/quota`), and profile-scoped session history.

### Concrete Recommendations for Implementers:

1. **Mandatory Commands to Run During Development & Verification**:
   - Unit tests: `npm test`
   - Simulation test: `node --env-file=.env scripts/test-simulation.mjs`

2. **Required New Test Files for R1**:
   - `api/profile.test.mjs`: Test multi-profile creation (`+👤`), listing, switching active profile (e.g., to "韩立"), searching profiles, and bookmarking.
   - `api/quota.test.mjs`: Test `/api/quota` response `{ points: number, checkinTaskProgress: number }`, initial bonus points, check-in task progress increments, and deduction logic (`⚡ 1580 Free`).
   - `api/session-history.test.mjs`: Test saving and retrieving session conversation history linked to specific profiles.

3. **Enhance Simulation Script (`scripts/test-simulation.mjs`)**:
   - Expand simulation scenario to execute a full R1 user journey: Register wallet/IP -> Add/select active profile ("韩立") -> Check `/api/quota` points balance -> Trigger AI report generation -> Verify session history saving and credit deduction.

---

## 5. Verification Method

- **Unit Test Execution**:
  ```bash
  npm test
  ```
  *Expected Result*: All 92+ tests pass with zero failures.

- **End-to-End Simulation Execution**:
  ```bash
  node --env-file=.env scripts/test-simulation.mjs
  ```
  *Expected Result*: Outputs 四柱 (Four Pillars), 多 Agent 推演 Pipeline, 事实依据, and 1500-word dynamic user report sections.

- **Invalidation Conditions**:
  - Failures in `npm test` or `scripts/test-simulation.mjs`.
  - Non-dynamic or hardcoded static report outputs.
  - Adding R1 backend features without co-located unit tests in `api/`.

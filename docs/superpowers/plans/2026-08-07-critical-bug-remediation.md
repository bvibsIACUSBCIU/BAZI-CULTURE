# Critical Bug Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chart, report, profile and HTTP response paths use real input data and Web-standard interfaces.

**Architecture:** Keep deterministic calculation in `lib/metaphysics`, make the browser render only API-produced chart data, and make all Fetch-facing endpoints return standard `Response` objects. Dynamic fallback reports remain derived from chart facts and are validated for non-empty, non-static content.

**Tech Stack:** Node.js 20, native `node:test`, browser ES modules, Fetch `Request`/`Response`.

## Global Constraints

- `userReport` must be dynamically generated from the real chart; static report text is prohibited.
- Any logic/report/rendering change must finish with `npm test` and `node --env-file=.env scripts/test-simulation.mjs`.
- Preserve the user’s existing uncommitted work; do not reset or overwrite unrelated files.

---

### Task 1: Deterministic Bazi validation and data integrity

**Files:**
- Modify: `test/bazi-engine.test.mjs`
- Modify: `lib/metaphysics/bazi-engine.js`

- [ ] Add failing cases for midnight boundary input, two-hidden-stem role assignment, malformed pillar counting and duplicate structural metadata.
- [ ] Run `node --test test/bazi-engine.test.mjs` and confirm failures expose the current behavior.
- [ ] Permit validated `00:00` and `23:00` input under the documented UTC+8 calendar policy; classify the second of two hidden stems as `中气`; ignore malformed pillar values; deduplicate self-punishment and group positions.
- [ ] Re-run `node --test test/bazi-engine.test.mjs`.

### Task 2: Dynamic chart rendering and safe profile state

**Files:**
- Modify: `app.js`
- Modify: `api/report.js`

- [ ] Add API-level coverage for chart output suitable for the browser renderer.
- [ ] Replace name/default-dependent pillar and element rendering with the real deterministic chart returned by `/api/report`.
- [ ] Accept ISO date strings without silently changing a valid date; remove automatic synthetic profiles; make deletion asynchronous and backend-backed; avoid mutating selected profile input.
- [ ] Validate the browser module syntax with `node --check app.js` and re-run relevant API tests.

### Task 3: Profile persistence and Fetch response compatibility

**Files:**
- Modify: `test/profile.test.mjs`
- Modify: `lib/runtime/profile-service.js`
- Modify: `api/profile.js`
- Modify: `scripts/web-dev.mjs`

- [ ] Add failing tests for standard `Response` headers/body and deleting a persisted profile.
- [ ] Add `deleteProfile(wallet, profileId)` to `ProfileService`, expose an authenticated wallet-scoped DELETE action, and return JSON `Response` objects for every result.
- [ ] Route `/api/profile` DELETE through the local web server without reading JSON on body-less requests.
- [ ] Re-run `node --test test/profile.test.mjs`.

### Task 4: Response contract consistency and Worker routing

**Files:**
- Modify: `api/quota.js`
- Modify: `api/session-history.js`
- Modify: `functions/api/entry.js`
- Modify: `functions/api/worker-utils.js`
- Modify: or add `test/*.test.mjs`

- [ ] Add failing endpoint contract tests for Fetch `Response` headers and valid worker routing.
- [ ] Replace remaining dummy quota/session responses with JSON `Response`, and adapt Worker routing so Fetch-native handlers return directly while legacy handlers continue through the Node-compatible adapter.
- [ ] Include `/api/auth` and `/api/chat` in the Worker route map only when their interface adapters preserve Request/Response semantics.
- [ ] Re-run the focused endpoint tests.

### Task 5: Dynamic report quality guard

**Files:**
- Modify: `test/ai-service.test.mjs`
- Modify: `lib/agent/ai-service.js`
- Modify: `lib/agent/agent-policy.js`
- Modify: `scripts/test-simulation.mjs`

- [ ] Add failing tests proving fallback reports change with different charts and contain no fixed report-only claims.
- [ ] Rewrite fallback text so each dimension is constructed from pillars, ten-gods, relations, element counts and topic facts; validate required dimensions and minimum total text length before returning it.
- [ ] Update simulation output for the current `userReport` string/object contract and assert dynamic chart markers and report uniqueness.
- [ ] Run the focused tests, then the full required verification commands.

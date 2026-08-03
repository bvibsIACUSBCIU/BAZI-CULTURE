# Topic Agent Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route each Bazi AI request to a real, topic-specific specialist and render only its validated concise result.

**Architecture:** A deterministic coordinator chooses a route, a local chart stage extracts facts, one specialist model call produces a validated draft, and one writer model call produces the final validated display. The existing fixed six-section report and fabricated pipeline are removed; fallback output is assembled from live chart facts only.

**Tech Stack:** Node.js ESM, Node test runner, OpenAI Responses/OpenAI-compatible APIs, native browser DOM.

## Global Constraints

- The calendar engine, source rules, fact references and safety checks remain authoritative; AI must not calculate a chart.
- A request makes at most two model calls and uses only current route facts and approved/research context.
- `userReport` cannot contain fixed static reading prose in a fallback, template, or DOM.
- Logic, prompt, AI-service and report-rendering changes require `npm test` and `node --env-file=.env scripts/test-simulation.mjs`.

---

### Task 1: Add deterministic routing contracts

**Files:**
- Create: `lib/agent/topic-router.js`
- Test: `api/topic-router.test.mjs`

**Interfaces:**
- Produces `resolveAgentRoute({ topic, question })` returning `{ key, label, specialist, question }`.
- Keys are `overview`, `elements`, `career`, `wealth`, `relationship`, `method`, `research`, `boundary`.

- [ ] Write tests that map explicit topics and representative free questions to route keys.
- [ ] Run `node --test api/topic-router.test.mjs` and observe missing-module failure.
- [ ] Implement pure keyword and explicit-topic routing without model calls.
- [ ] Re-run `node --test api/topic-router.test.mjs` and confirm all route cases pass.

### Task 2: Replace the fixed report schema with a route display schema

**Files:**
- Modify: `lib/agent/ai-service.js`
- Modify: `lib/agent/agent-policy.js`
- Test: `api/ai-report.test.mjs`

**Interfaces:**
- `generateAiReading` accepts `route` and `phase` (`specialist` or `writer`).
- Specialist output is a validated draft; Writer output is a validated `display` with 2-4 route-specific sections.

- [ ] Write tests proving specialty prompts include the selected route and exclude the six-field `userReport` contract.
- [ ] Run the focused test and observe the old schema prevents the expected contract.
- [ ] Implement route-specific schemas, prompts, validation and the writer handoff.
- [ ] Re-run the focused tests and confirm a writer result includes only its requested route display.

### Task 3: Execute actual runtime stages and dynamic fallback

**Files:**
- Modify: `lib/agent/agent-runtime.js`
- Modify: `lib/agent/ai-service.js`
- Test: `api/agent-runtime.test.mjs`

**Interfaces:**
- Runtime calls Specialist then Writer, with Validator before and after writing.
- `agent.pipeline` contains only executed stages and summaries, never internal reasoning.
- `buildFallbackAiResult` accepts the route and produces fact-derived display sections.

- [ ] Write failing tests for two model calls, route-specific pipeline labels, and distinct fallback output across topics.
- [ ] Run `node --test api/agent-runtime.test.mjs` and observe the single-call/fixed-pipeline behavior fail the tests.
- [ ] Implement the staged runtime and remove fixed long fallback report construction.
- [ ] Re-run the focused runtime test suite and confirm the two-call limit and dynamic fallback assertions pass.

### Task 4: Render actual concise route results

**Files:**
- Modify: `index.html`
- Test: `api/system-pages.test.mjs`

**Interfaces:**
- `renderAi(reading, agent)` renders `reading.display` and service-returned pipeline summaries.
- Loading UI uses role/action labels only; no static fabricated thought chain.

- [ ] Add static-page assertions for the removal of six-field report rendering and fixed thought strings.
- [ ] Run `node --test api/system-pages.test.mjs` and observe failure against current HTML.
- [ ] Replace fixed loading and report rendering with route-aware concise sections and actual pipeline nodes.
- [ ] Re-run page tests and confirm the new route-display hooks are present.

### Task 5: Prove topic differentiation and run project gates

**Files:**
- Modify: `api/ai-report.test.mjs`, `api/simulation.test.mjs`, `scripts/test-simulation.mjs` only if its assertions require the new response contract.

- [ ] Add tests using one chart across elements, career, wealth, relationship and a free question; assert route keys, fact sets and display titles differ.
- [ ] Run focused tests and observe them fail before final integration fixes.
- [ ] Implement only the compatibility updates required by the changed response contract.
- [ ] Run `npm test` and `node --env-file=.env scripts/test-simulation.mjs`; inspect complete output before reporting results.

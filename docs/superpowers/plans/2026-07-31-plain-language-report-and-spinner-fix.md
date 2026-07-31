# Plain-Language Report & Step 05 Spinner Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a 1000-word plain-language interpretation report (通俗解盘报告) for every query while keeping all technical multi-agent pipeline and evidence sections above the report, and fix the Step 05 premature completion spinner bug.

**Architecture:** Extend backend `READING_SCHEMA` and system prompt in `lib/agent/ai-service.js` to output structured `userReport` sections, and overhaul frontend step loading and result rendering in `index.html`.

**Tech Stack:** Node.js, ES Modules, Native Web APIs (fetch, DOM).

## Global Constraints
- System Prompt word count for plain-language report: strictly 800 - 1000 Chinese characters.
- Non-collapsible placement of Technical Evidence / Pipeline above the report; Plain-Language Report placed at the bottom.
- 100% test pass rate maintained for `npm test`.

---

### Task 1: Backend Data Schema, Prompt & Fallback Updates

**Files:**
- Modify: `lib/agent/agent-policy.js:8-30`
- Modify: `lib/agent/ai-service.js:25-108`, `lib/agent/ai-service.js:160-240`, `lib/agent/ai-service.js:420-550`
- Test: `api/ai-report.test.mjs`, `api/topic-reading.test.mjs`

**Interfaces:**
- Consumes: `chart`, `topic`, `question`
- Produces: `reading.userReport` object with `corePortrait`, `career`, `relationship`, `health`, `wealth`, `currentStage`

- [ ] **Step 1: Write failing tests for userReport schema validation**

Add assertions in `api/topic-reading.test.mjs` ensuring `userReport` is present with required fields:

```js
import assert from "node.js:assert";
// Test that userReport contains corePortrait, career, relationship, health, wealth, currentStage
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/topic-reading.test.mjs`
Expected: FAIL due to missing `userReport` in schema.

- [ ] **Step 3: Update `READING_SCHEMA`, `BASE_SAFETY_INSTRUCTIONS`, and `validateReading`**

Add `userReport` object to `READING_SCHEMA` in `lib/agent/ai-service.js`:
```js
userReport: {
  type: "object",
  additionalProperties: false,
  required: ["corePortrait", "career", "relationship", "health", "wealth", "currentStage"],
  properties: {
    corePortrait: { type: "string", minLength: 10, maxLength: 300 },
    career: { type: "string", minLength: 10, maxLength: 300 },
    relationship: { type: "string", minLength: 10, maxLength: 300 },
    health: { type: "string", minLength: 10, maxLength: 300 },
    wealth: { type: "string", minLength: 10, maxLength: 300 },
    currentStage: { type: "string", minLength: 10, maxLength: 300 },
  }
}
```
Update `BASE_SAFETY_INSTRUCTIONS` in `lib/agent/agent-policy.js` instructing the model to generate empathetic plain Chinese (大白话) for `userReport` with 800-1000 characters total across all sections.

- [ ] **Step 4: Update `buildFallbackAiResult` in `lib/agent/ai-service.js`**

Ensure fallback results include a valid default `userReport` object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS all 84+ tests.

- [ ] **Step 6: Commit changes**

```bash
git add lib/agent/agent-policy.js lib/agent/ai-service.js api/topic-reading.test.mjs api/ai-report.test.mjs
git commit -m "feat(agent): update AI schema and prompt to include plain-language userReport"
```

---

### Task 2: Frontend Step 05 Spinner Fix & Report UI Rendering

**Files:**
- Modify: `index.html:2425-2435`, `index.html:2850-2975`, `index.html:3168-3270`

**Interfaces:**
- Consumes: `payload.ai.reading.userReport`
- Produces: UI rendering with Technical Pipeline/Fact-Tags on top (non-collapsible), Plain-Language Report at bottom, and real-time Step 05 status sync.

- [ ] **Step 1: Update Step 05 loading synchronization in `index.html`**

In `generateAi()`:
- Step 1 through Step 4 animate cleanly while `apiPromise` is pending.
- Step 5 (`Writer Agent`) remains in `is-active` state ("整合推演成果，正在生成解盘报告中...") until `apiPromise` resolves.
- When `apiPromise` resolves:
  - Mark Step 5 `is-done`.
  - Immediately hide `agentLoadingCard` and reveal `aiOutput`.
- Fast-forward step timing if `apiPromise` completes quickly.

- [ ] **Step 2: Remove details/collapsible behavior from `agent-pipeline-card`**

In `index.html`, ensure the Multi-Agent Pipeline & Technical Analysis section is always visible/open and non-collapsible above the plain-language report.

- [ ] **Step 3: Render Plain-Language User Report at the bottom of `aiOutput`**

In `renderAi()`:
- Append `user-report-card` container at the bottom of `aiOutput`.
- Display 6 structured plain-language cards:
  - 💡 **核心画像**
  - 🚀 **事业发展模式**
  - 💗 **感情与婚姻**
  - 🌿 **健康状况**
  - 💰 **财运分析**
  - 🎯 **当前人生阶段**

- [ ] **Step 4: Verify manual UX & run test suite**

Run: `npm test`
Expected: PASS all tests.

- [ ] **Step 5: Commit changes**

```bash
git add index.html
git commit -m "feat(ui): fix step 05 spinner sync and render plain-language report at bottom"
```

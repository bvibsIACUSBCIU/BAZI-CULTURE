# 确定性全盘 AI 解读质量改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将完整确定性三盘结果输入 AI，令报告直接回答用户问题，并在 AI 不可用时提供随本次命盘变化的动态解释。

**Architecture:** 服务端汇总八字、紫微、奇门及年度数据为统一证据载荷；AI 与本地降级解释器都消费该载荷，输出判断、依据、推导、建议，并拒绝无依据的内容。

**Tech Stack:** Node.js ESM、node:test、现有八字/紫微/奇门引擎、SSE、OpenAI-compatible Chat Completions。

## Global Constraints

- `userReport` 只能按当前命盘、专题和问题动态生成，禁止固定静态解盘文本。
- AI 只解释 `calculated` 来源的事实，不计算或补造命盘。
- 未计算的流年、大运、宫位、星曜和事件不得写为事实。
- 每个逻辑改动后必须运行 `npm test` 与 `node --env-file=.env scripts/test-simulation.mjs`。

---

### Task 1: 完整确定性证据载荷

**Files:** Modify `lib/agent/multi-agent-pipeline.js`, `api/chat.js`; create `test/report-evidence-payload.test.mjs`.

**Interface:** Export `buildReportEvidencePayload({ chart, ziwei, qimen, year })`, returning `{ bazi, ziwei, qimen, annual, calculationScope, facts }`; every fact must have `source: "calculated"`.

- [ ] **Step 1: Write the failing test.** Assert that day pillar is preserved, annual year is `2026`, and each fact source is `calculated`.
- [ ] **Step 2: Run `node --test test/report-evidence-payload.test.mjs`.** Expected: FAIL because the export does not exist.
- [ ] **Step 3: Implement `buildReportEvidencePayload`.** It freezes and returns the three actual chart payloads, `annual: { year, available }`, `calculationScope`, and facts collected only from deterministic fields.
- [ ] **Step 4: Re-run `node --test test/report-evidence-payload.test.mjs`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add lib/agent/multi-agent-pipeline.js api/chat.js test/report-evidence-payload.test.mjs && git commit -m "feat: provide complete calculated chart evidence"`.

### Task 2: 题目路由和动态解释器

**Files:** Modify `lib/agent/ai-service.js`, `test/dynamic-report.test.mjs`; create `test/report-quality.test.mjs`.

**Interface:** Export `buildQuestionInterpretation({ evidence, question, topic, groupAnalysis })`, returning `{ directAnswer, evidence, reasoning, recommendations, userReport }`.

- [ ] **Step 1: Write failing tests.** Annual question must mention `2026`, include an evidence-linked reasoning block, and no `userReport` section may contain `本题未选择`; two different charts/topics must return different sections.
- [ ] **Step 2: Run `node --test test/dynamic-report.test.mjs test/report-quality.test.mjs`.** Expected: FAIL because the interpretation export does not exist and current fallback uses `本题未选择`.
- [ ] **Step 3: Implement the interpreter.** Select topic facts from the complete evidence payload, compose direct answer/reasoning/action recommendations, and create all six dynamic sections without generic unselected-topic fillers.
- [ ] **Step 4: Route `mockReportMarkdown` and `buildDynamicUserReport` through the new interpreter.** Markdown must render `直接回答`, `本题依据`, `如何理解`, `行动建议` and `下一步` from this request's data.
- [ ] **Step 5: Re-run the two tests.** Expected: PASS.
- [ ] **Step 6: Commit.** `git add lib/agent/ai-service.js test/dynamic-report.test.mjs test/report-quality.test.mjs && git commit -m "feat: generate evidence-linked dynamic interpretations"`.

### Task 3: AI 输入合同与报告呈现

**Files:** Modify `lib/agent/ai-service.js`, `lib/agent/multi-agent-pipeline.js`, `app.js`, `app.css`, `test/frontend-contract.test.mjs`.

**Interface:** AI receives `{ question, evidencePayload, topicFacts, calculationScope }`; validated output is `{ directAnswer, evidenceRefs, reasoning, recommendations, markdown }`.

- [ ] **Step 1: Write failing frontend and AI-contract tests.** The source must expose answer/evidence/reasoning/recommendations, and must not retain `本题未选择事业专题`.
- [ ] **Step 2: Run `node --test test/frontend-contract.test.mjs test/report-quality.test.mjs`.** Expected: FAIL until the report contract is connected.
- [ ] **Step 3: Add complete evidence payload to every AI prompt and validate output references.** Reject outputs mentioning data absent from the payload and use `buildQuestionInterpretation` as the fallback.
- [ ] **Step 4: Render structured report and evidence link.** Use the count of deterministic facts in `#report-chart-evidence`; keep pipeline stages as server-confirmed progress only.
- [ ] **Step 5: Run `node --test test/frontend-contract.test.mjs test/report-quality.test.mjs && node --check app.js`.** Expected: PASS.
- [ ] **Step 6: Commit.** `git add lib/agent/ai-service.js lib/agent/multi-agent-pipeline.js app.js app.css test/frontend-contract.test.mjs test/report-quality.test.mjs && git commit -m "feat: render evidence-linked AI interpretations"`.

### Task 4: End-to-end quality gate

**Files:** Modify `scripts/test-simulation.mjs`, `test/report-quality.test.mjs`.

- [ ] **Step 1: Assert simulation output contains `直接回答`, `本题依据`, `行动建议`, and no report section contains `本题未选择`.**
- [ ] **Step 2: Run `npm test && node --env-file=.env scripts/test-simulation.mjs && node --check app.js && git diff --check`.** Expected: all pass; output includes real pillars and an evidence-linked direct answer.
- [ ] **Step 3: Browser verify with “今年我的运气怎么样？”.** Report must have direct answer, concrete evidence, explanation and actions without raw fallback disclaimers.
- [ ] **Step 4: Commit.** `git add scripts/test-simulation.mjs test/report-quality.test.mjs && git commit -m "test: verify evidence-linked report quality"`.

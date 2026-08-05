# 6-Stage 命理 AI Pipeline 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完全移除现有 20-Agent 模拟循环与静态 AI 解读，按全新《架构与 Prompt 设计方案》实现 6-Stage DeepSeek API 驱动的 100% 确定性排盘 AI 命理分析 Pipeline。

**Architecture:** 单向编排的 6-Stage Pipeline：①任务规划 (LLM) -> ②确定性数据与规则信号取数 (纯代码) -> ③组分析 (LLM 并发 + 反幻觉核查) -> ④报告撰写/修订 (LLM + 行级 Diff) -> ⑤对话总结 (LLM 200字) -> ⑥追问推荐 (LLM 1-3题)。

**Tech Stack:** Node.js (ES Module), Fetch API (DeepSeek/OpenAI compatible), Server-Sent Events (SSE), standard `node:test` runner.

## Global Constraints

- 所有「通俗解盘报告」必须基于用户实际排盘与规则信号动态计算生成，禁止在 DOM 或代码中使用静态固定文本段落。
- 逻辑修改后强制执行模拟测试：`npm test` 与 `node --env-file=.env scripts/test-simulation.mjs` 必须 100% 通过。
- 组分析 (Group Analysis) 必须通过字典反幻觉校验，防止编造星曜/宫位/四化。

---

### Task 1: 核心 Prompt 库与反幻觉校验模块 (AI Service Refactor)

**Files:**
- Modify: `lib/agent/ai-service.js`
- Test: `test/ai-service.test.mjs`

**Interfaces:**
- Consumes: `chart` (deterministic chart payload from `bazi-engine`, `ziwei-engine`, etc.), `question`, `profile`, `signals`
- Produces: `runPipelineStage(stage, payload)` or individual stage runners: `planTasks()`, `analyzeGroup()`, `writeReport()`, `reviseReport()`, `summarizeChat()`, `recommendQuestions()`, and `validateGroupAnalysisAgainstChart(analysis, chartData)`

- [ ] **Step 1: Write tests for anti-hallucination dictionary validation and stage prompt execution**

Create `test/ai-service.test.mjs`:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGroupAnalysisAgainstChart } from '../lib/agent/ai-service.js';

test('validateGroupAnalysisAgainstChart - passes when all stars and palaces exist', () => {
  const chartData = {
    palaces: ['命宫', '夫妻宫', '官禄宫'],
    stars: ['七杀', '武曲', '天相'],
    sihua: ['化忌', '化禄']
  };
  const analysis = {
    conclusion: '流年官禄宫重叠大限夫妻宫，事业面临重要转折。',
    details: [
      '流年官禄宫重叠大限夫妻宫，本命命宫，说明事业与婚姻能量交织。',
      '宫内七杀、武曲化忌，提醒注意合作风险。'
    ]
  };
  const result = validateGroupAnalysisAgainstChart(analysis, chartData);
  assert.equal(result.valid, true);
});

test('validateGroupAnalysisAgainstChart - rejects hallucinated star', () => {
  const chartData = {
    palaces: ['命宫', '夫妻宫'],
    stars: ['七杀'],
    sihua: ['化忌']
  };
  const analysis = {
    conclusion: '紫微星坐镇命宫。',
    details: ['命宫有紫微独坐。']
  };
  const result = validateGroupAnalysisAgainstChart(analysis, chartData);
  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('紫微'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ai-service.test.mjs`
Expected: FAIL with module/function missing.

- [ ] **Step 3: Implement 6-Stage Prompts and dictionary validator in `lib/agent/ai-service.js`**

Implement:
- `STAR_DICTIONARY`, `PALACE_DICTIONARY`, `SIHUA_DICTIONARY`
- `validateGroupAnalysisAgainstChart(analysis, chartData)`
- `callTaskPlanner()`, `callGroupAnalysis()`, `callReportWriter()`, `callReportReviser()`, `callChatSummarizer()`, `callQuestionRecommender()`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ai-service.test.mjs`
Expected: PASS.

---

### Task 2: 6-Stage Multi-Agent Pipeline Engine

**Files:**
- Modify: `lib/agent/multi-agent-pipeline.js`
- Test: `test/pipeline.test.mjs`

**Interfaces:**
- Consumes: `profile`, `question`, `previousReport`, `onEvent`
- Produces: `run6StagePipeline({ profile, question, previousReport, onEvent })` returning `{ chart, plan, groupResults, report, summary, recommendations }`

- [ ] **Step 1: Write test for `run6StagePipeline`**

Create `test/pipeline.test.mjs`:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { run6StagePipeline } from '../lib/agent/multi-agent-pipeline.js';

test('run6StagePipeline executes 6 stages and emits standard SSE events', async () => {
  const events = [];
  const profile = { name: '韩立', birthYear: 2001, birthMonth: 1, birthDay: 1, birthHour: 6 };
  
  const result = await run6StagePipeline({
    profile,
    question: '2026年事业与财运如何？',
    onEvent: (evt) => events.push(evt),
    mockAi: true // fallback deterministic when AI key is missing
  });

  assert.ok(result.chart);
  assert.ok(events.some(e => e.type === 'plan'));
  assert.ok(events.some(e => e.type === 'group_start'));
  assert.ok(events.some(e => e.type === 'group_done'));
  assert.ok(events.some(e => e.type === 'report_start'));
  assert.ok(events.some(e => e.type === 'report_done'));
  assert.ok(events.some(e => e.type === 'recommend'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pipeline.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Refactor `lib/agent/multi-agent-pipeline.js` to execute 6-stage pipeline**

Refactor `multi-agent-pipeline.js`:
1. Calculate deterministic chart (`bazi`, `ziwei`, `qimen`) & extract `signals`.
2. Stage ①: Call Task Planner -> emit `plan`.
3. Stage ②: Data Retrieval from chart for scope.
4. Stage ③: Group Analysis (parallel LLM calls with dictionary validator) -> emit `group_start`, `group_done`.
5. Stage ④: Report Generation / Revision (with text diff) -> emit `report_start`, `report_delta`, `report_done`.
6. Stage ⑤: Chat Summary -> emit `summary_delta`.
7. Stage ⑥: Recommendations -> emit `recommend`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pipeline.test.mjs`
Expected: PASS.

---

### Task 3: API Router & SSE Endpoint Integration

**Files:**
- Modify: `api/chat.js`
- Modify: `api/ai-report.js`
- Test: `test/chat.test.mjs`

**Interfaces:**
- Consumes: POST `/api/chat` and `/api/ai-report`
- Produces: SSE stream with events `plan`, `group_start`, `group_done`, `report_start`, `report_delta`, `report_done`, `summary_delta`, `recommend`

- [ ] **Step 1: Update `test/chat.test.mjs` to check 6-Stage SSE events**

Update `test/chat.test.mjs`:
Verify `/api/chat` emits `plan`, `group_start`, `group_done`, `report_done`, `summary_delta`, `recommend`.

- [ ] **Step 2: Run test to verify current state/failures**

Run: `node --test test/chat.test.mjs`

- [ ] **Step 3: Update `api/chat.js` and `api/ai-report.js`**

Connect `run6StagePipeline` to SSE stream controller.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/chat.test.mjs`
Expected: PASS.

---

### Task 4: Frontend Integration & State Machine (app.js)

**Files:**
- Modify: `app.js`
- Modify: `index.html` (if styling/structure adjustments are needed)

**Interfaces:**
- Consumes SSE stream events (`plan`, `group_start`, `group_done`, `report_start`, `report_delta`, `report_done`, `summary_delta`, `recommend`)
- Produces UI state updates for thinking block, step checklist, bold conclusion + gray details, typewriter output, version diff tabs, recommendations chips.

- [ ] **Step 1: Implement SSE handler in `app.js`**

Support rendering:
- Thinking fold block & subtask checklist
- Group step completion with bold conclusion and gray details
- Markdown report tab with version diff header ("新增 X 行，删除 Y 行")
- Conversational chat summary in main stream
- Recommendation buttons

- [ ] **Step 2: Manual UI verification in browser**

Verify `app.js` processes SSE events and updates UI cleanly.

---

### Task 5: End-to-End Simulation Test & Verification

**Files:**
- Modify: `scripts/test-simulation.mjs`
- Test: `test/simulation.test.mjs`

**Interfaces:**
- Consumes test inputs (`1996-08-18 09:30`)
- Produces clean execution report showing 100% deterministic chart calculation, 6-stage pipeline output, and dynamic report text.

- [ ] **Step 1: Update `scripts/test-simulation.mjs` and `test/simulation.test.mjs`**

Refactor test simulation script to validate the 6-stage pipeline output, group conclusions, report markdown, summary text, and recommend questions.

- [ ] **Step 2: Run full test suite and simulation**

Run: `npm test`
Run: `node --env-file=.env scripts/test-simulation.mjs`

- [ ] **Step 3: Commit all changes**

Run git commit.

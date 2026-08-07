# Tianfu 风格命理工作台质量与交互实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有三栏命理工作台收敛为可验证的确定排盘、专题化六阶段推演和动态长报告体验。

**Architecture:** `lib/metaphysics` 是唯一命盘事实源；`lib/agent` 根据事实和专题生成推演；`api` 管理钱包边界的档案与会话；`app.html`/`app.js` 仅渲染 API 结果。测试采用 `node:test`，模拟脚本覆盖真实 HTTP 形状的 handler 结果。

**Tech Stack:** Node.js 20、原生 `node:test`、Fetch Request/Response、SSE、原生浏览器 JavaScript。

## Global Constraints

- 不得使用预写命盘或预写解盘；每段 `userReport` 必须来自实际 chart 与专题。
- 三个命盘由确定性引擎计算，AI 输出只可解释已提供事实。
- `npm test` 必须执行至少 87 个有效断言；模拟脚本必须验证真实四柱、六阶段、不同输入产生不同报告。
- 每个生产改动必须先有一个失败的行为测试。
- 保留工作区当前未提交的实现，提交时将其作为本轮整体改造的一部分。

---

### Task 1: 动态报告事实绑定与静态模板清除

**Files:**
- Create: `test/dynamic-report.test.mjs`
- Modify: `lib/agent/ai-service.js`
- Modify: `scripts/test-simulation.mjs`

**Interfaces:**
- Consumes: `buildDynamicUserReport(chart, { question, topics })`
- Produces: 六个仅含实际 chart 与专题事实的报告段落。

- [ ] **Step 1: Write the failing test**

```js
test('动态报告随四柱与专题变化且不含遗留静态模板', () => {
  const career = buildDynamicUserReport(fireChart, careerContext);
  const wealth = buildDynamicUserReport(waterChart, wealthContext);
  assert.notDeepEqual(career, wealth);
  assert.match(career.corePortrait, /丙子/);
  assert.doesNotMatch(JSON.stringify(career), /厚积薄发|战略巩固期/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dynamic-report.test.mjs`

Expected: FAIL because the source still contains a legacy static fallback template.

- [ ] **Step 3: Write minimal implementation**

Remove unreachable legacy template text and derive each section from normalized pillars, day master, visible/hidden ten gods, element counts, relations and selected topic. Use topic-specific headings and explicit evidence phrases.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dynamic-report.test.mjs`

Expected: PASS.

### Task 2: 可执行的测试基线与端到端模拟断言

**Files:**
- Create: `test/workbench-contract.test.mjs`
- Modify: `scripts/test-simulation.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: profile, session history, report and AI report handlers.
- Produces: 超过 87 项 `node:test` 断言和模拟失败时的非零退出码。

- [ ] **Step 1: Write failing contract tests**

```js
test('档案、会话和 AI 报告 handler 返回标准 Response', async () => {
  const response = await handleProfileRequest(new Request(profileUrl));
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/workbench-contract.test.mjs`

Expected: FAIL until request fixtures and response contracts are wired.

- [ ] **Step 3: Implement the smallest testable contract fixes**

Use Fetch-native request fixtures, assert all report sections and pipeline stages, and make `test-simulation.mjs` throw when the chart is missing, any stage is absent, report text is too short, or two distinct charts yield the same report.

- [ ] **Step 4: Run the suite**

Run: `npm test && node --env-file=.env scripts/test-simulation.mjs`

Expected: at least 87 test assertions and one successful dynamic-report simulation.

### Task 3: 工作台端到端渲染与会话回载

**Files:**
- Create: `test/frontend-contract.test.mjs`
- Modify: `app.js`
- Modify: `app.html`
- Modify: `app.css`

**Interfaces:**
- Consumes: chart returned from `/api/report`, events from `/api/chat`, session `reportMarkdown` and `summary`.
- Produces: 三栏工作台中可选择命主、渲染三盘、显示六阶段、重开历史报告并复用追问。

- [ ] **Step 1: Write failing source-contract tests**

```js
test('前端不含名字驱动的伪造命盘和客户端模拟 Agent 输出', () => {
  const source = readFileSync('app.js', 'utf8');
  assert.doesNotMatch(source, /isWangling|isHanli|runClientAgentSimulation/);
  assert.match(source, /safeFetchBaziApi/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/frontend-contract.test.mjs`

Expected: FAIL while obsolete client simulation remains.

- [ ] **Step 3: Implement minimal rendering change**

Remove client-only simulated Agent output; consume only SSE events from `/api/chat`. On history selection restore summary and report; retain a visible evidence link from report to the active chart panel.

- [ ] **Step 4: Verify browser and syntax**

Run: `node --check app.js && npm test && node --env-file=.env scripts/test-simulation.mjs`

Expected: all commands pass, then manually exercise the local workstation in browser.

### Task 4: Commit

- [ ] Stage only the verified worktree changes and intentional test-suite replacement.
- [ ] Commit with message: `feat: build verified tianfu-style metaphysics workbench`.

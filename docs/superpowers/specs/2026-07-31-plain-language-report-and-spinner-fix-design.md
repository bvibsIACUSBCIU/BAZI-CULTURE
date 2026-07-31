# Plain-Language Report Generation & Step 05 Loading Spinner Fix Design

## Goal Description
Enhance the Bazi AI system by generating a 1000-word plain-language interpretation report (通俗解盘报告) understandable by non-experts, while preserving all existing technical multi-agent pipeline details, fact tags, and structural evidence above the report without collapsibility. In addition, fix the frontend bug where Step 05 ("结构化表达与报告生成") prematurely displays "思考完成" (Thinking Completed) while the top loading spinner continues spinning because the backend API response has not returned yet.

---

## Architecture & Data Schema Changes

### 1. Model Instructions & JSON Schema (`lib/agent/ai-service.js`, `lib/agent/agent-policy.js`)

Add a structured `userReport` field to `READING_SCHEMA`:
```json
{
  "userReport": {
    "corePortrait": "...",
    "career": "...",
    "relationship": "...",
    "health": "...",
    "wealth": "...",
    "currentStage": "..."
  }
}
```
* **Word Count Limit**: 800 - 1000 Chinese characters total across all 6 sections.
* **Tone**: Empathetic, warm, clear, plain-language Chinese (大白话). Avoid standalone jargon like "七杀", "偏财", "子卯刑" without translating them into actual personality traits, relationship dynamics, or life advice.
* **Fallback Support**: Update `buildFallbackAiResult` in `lib/agent/ai-service.js` to populate a structured `userReport` when the AI service is offline or fallback is triggered.

---

### 2. Frontend Layout & UI Structure (`index.html`)

Modify `renderAi(reading, agent)` in `index.html` to lay out components in the exact required top-to-bottom hierarchy:

1. **Header & Summary**:
   - `topicMeta`: Topic label & evidence completeness badge.
   - `aiSummary`: Technical executive summary.

2. **Multi-Agent Pipeline & Technical Analysis (Non-collapsible, Above Report)**:
   - `agent-pipeline-card`: Remove collapsible `<details>` wrapper or force `open` state; render nodes 01-05 cleanly.
   - `aiSections`: Structured sections with Fact Tags (`DAY_MASTER`, `MONTH_BRANCH`, etc.), supporting facts, counterpoints, reflection questions, and limitation notices.

3. **Plain-Language Report Section (Bottom)**:
   - `user-report-card`: Prominently styled card titled `📜 通俗解盘报告 (精炼大白话版)`.
   - Grid/Cards for 6 sections:
     - 💡 **核心画像** (`corePortrait`)
     - 🚀 **事业发展模式** (`career`)
     - 💗 **感情与婚姻** (`relationship`)
     - 🌿 **健康状况** (`health`)
     - 💰 **财运分析** (`wealth`)
     - 🎯 **当前人生阶段** (`currentStage`)

---

### 3. Step 05 Loading Spinner Synchronization (`index.html`)

Fix the async flow in `generateAi()`:
1. **Dynamic Step 5 Waiting**: Steps 1 to 4 advance sequentially while `apiPromise` is pending. Step 5 (`Writer Agent`) remains in `is-active` state displaying `整合 Agent 链推演输出 ➔ 格式化解盘报告中......` until `apiPromise` resolves.
2. **Resolution Trigger**:
   - Upon `apiPromise` resolving successfully, mark Step 5 as `is-done` ("✓ 报告生成完成").
   - Hide `agentLoadingCard` and reveal `aiOutput`.
3. **Fast-forward & Error Handling**:
   - If `apiPromise` resolves faster than animation timing, fast-forward steps 1-5 to `is-done` immediately.
   - If `apiPromise` rejects/times out, display failure on step 5, clear loading indicators, and display the error message.

---

## Verification Plan

### Automated Tests
- Run `npm test` to verify all 84 existing tests pass.
- Update `api/ai-report.test.mjs` and `api/topic-reading.test.mjs` to validate `userReport` schema properties.

### Manual Verification
- Test generating an overview report and topic report.
- Verify Step 05 stays active until the API returns, then transitions cleanly.
- Verify section ordering: Multi-Agent Pipeline & Technical Analysis at top, Plain-Language Report at the bottom.

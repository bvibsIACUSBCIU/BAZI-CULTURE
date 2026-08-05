# Design Spec: 6-Stage 命理 AI Pipeline 重构 (deepseek-v4-flash)

## Summary
将现有的 20-Agent 循环与静态 AI 解读重构为单向编排的 6-Stage Pipeline。命主的八字/紫微斗数/奇门排盘采用 100% 确定性算法（不经过 AI 推算），`deepseek-v4-flash` 负责理解提问、生成分步组分析、撰写结构化报告、提炼对话总结以及推荐追问。

---

## 1. 整体 Pipeline 架构 (Pipeline Architecture)

```
用户提问
   │
   ▼
①【任务规划 Task Planning】 ────► LLM 调用 (1次)
   输入：用户问题 + 命主 Profile + 规则引擎 Signals
   输出：{ topics: [ { topic, groups: [ { group_title, subtasks: [...], data_scope } ] } ] }
   → 发送 SSE `plan` 事件
   │
   ▼
②【数据取数 Data Retrieval】 ───► 纯代码 (非 LLM, 100% 确定性)
   根据 data_scope 从排盘引擎 (bazi-engine / ziwei-engine / qimen-engine) 取出已知事实数据 + 规则引擎 signal 指标
   │
   ▼
③【组分析 Group Analysis】 ────► LLM 调用 (每个 group 1次, 并发)
   输入：真实排盘数据 + group_title / subtasks
   输出：{ conclusion: "粗体结论", details: ["依据1", "依据2", ...] }
   → 运行反幻觉校验 (检查提到星曜/宫位是否在排盘数据内)
   → 发送 SSE `group_start` 与 `group_done` 事件
   │
   ▼
④【报告撰写 / 修订 Report Gen】 ─► LLM 调用 (1次)
   输入：所有 group 结论 + 历史 Markdown 报告 (若修订)
   输出：完整 Markdown 报告
   → 运行文本 Diff (计算 added/removed 行数)
   → 发送 SSE `report_start`, `report_delta` (打字机效果), `report_done`
   │
   ▼
⑤【对话区总结 Chat Summary】──► LLM 调用 (1次, 约 200 字口语化总结)
   输入：完整 Markdown 报告
   输出：口语化聊天总结
   → 发送 SSE `summary_delta`
   │
   ▼
⑥【追问推荐 Recommendations】─► LLM 调用 (1次)
   输入：本轮主题 + 命主 Profile
   输出：1-3 个推荐问题
   → 发送 SSE `recommend`
```

---

## 2. 事实数据结构 (Factual Payload Specification)

传入 LLM 的事实结构示例：
```json
{
  "profile": {
    "name": "命主姓名",
    "gender": "男/女",
    "solar_date": "2001-01-01 06:00",
    "lunar_date": "二〇〇〇年腊月初七",
    "bazi": "庚辰 戊子 甲子 丁卯",
    "wuxing_ju": "土五局"
  },
  "natal_chart": {
    "命宫": { "gan_zhi": "丙戌", "stars": ["七杀"], "range": "5-14" },
    "夫妻宫": { "gan_zhi": "甲申", "stars": ["武曲", "天相", "禄存", "地空", "天刑"], "range": "105-114" }
  },
  "daxian": {
    "period": "第3大限 2024-2033",
    "daxian_gong_mapping": { "大命": "丑", "大财": "午", "大官": "卯", "大夫": "戌" }
  },
  "liunian": {
    "year": 2026,
    "liunian_gong_mapping": { "年官": "午", "年迁": "巳", "年疾": "未" },
    "sihua": { "化权": "贪狼", "化科": null, "化忌": "廉贞", "化禄": "太阴" }
  },
  "signals": [
    { "type": "桃花指标", "year": 2026, "strength": "高", "basis": "流年交友宫叠大限兄弟宫本命父母宫+太阴化禄" },
    { "type": "变动指标", "year": 2026, "strength": "低", "basis": "未出现在候选流年信息中" },
    { "type": "纠葛指标", "year": 2026, "strength": "中", "basis": "流年夫妻宫廉贞化忌" }
  ]
}
```

---

## 3. Prompts & 校验与缓存 (Prompts, Anti-Hallucination & Cache)

1. **System & 阶段 Prompts**：
   - 3.1 Global System Prompt (人设与规则)
   - 3.2 Task Planning Prompt
   - 3.3 Group Analysis Prompt (严格数据绑定)
   - 3.4 Report Writing Prompt
   - 3.5 Report Revision Prompt (历史对比+冲突处理)
   - 3.6 Chat Summary Prompt (200字口语化总结)
   - 3.7 Follow-up Recommendations Prompt
2. **反幻觉字典核对**：
   - 抽取星曜 (紫微、天府、七杀、贪狼等)、宫位 (命宫、夫妻宫、官禄宫等) 与四化 (化禄、化权、化科、化忌)。
   - 对 `Group Analysis` 输出提取星曜/宫位名词，校验其是否在传入的 `resolved_chart_data` 中。不存在则自动纠偏。
3. **缓存机制**：
   - 按 `(profileId/bazi, year, group_key)` 缓存 Group 结论，追问时直接复用。

---

## 4. SSE 事件协议 (SSE Protocol)

- `plan`: `{ topics: [...] }`
- `group_start`: `{ topic, group_id, group_title, subtasks }`
- `group_done`: `{ group_id, conclusion, details }`
- `report_start`: `{ topic }`
- `report_delta`: `{ text_chunk }`
- `report_done`: `{ version, diff: { added, removed }, markdown }`
- `summary_delta`: `{ text_chunk }`
- `recommend`: `{ questions: [...] }`

---

## 5. 模块工程改动文件 (Affected Files)

- `lib/agent/ai-service.js`: 实现 6-stage DeepSeek API 驱动器、系统 Prompt 与反幻觉校验
- `lib/agent/multi-agent-pipeline.js`: 重构为单向编排 Pipeline 逻辑
- `api/chat.js` & `api/ai-report.js`: 升级 SSE 消息派发与降级方案
- `app.js` & `index.html`: 前端界面配合渲染思考步骤、Group 展开结论、打字机输出、版本 Diff
- `test/*.test.mjs` & `scripts/test-simulation.mjs`: 更新测试验证

---

## 6. 验证计划 (Verification Plan)

1. 执行 `npm test`：通过所有 87+ 单元测试。
2. 执行 `node --env-file=.env scripts/test-simulation.mjs`：验证端到端仿真数据流无误。

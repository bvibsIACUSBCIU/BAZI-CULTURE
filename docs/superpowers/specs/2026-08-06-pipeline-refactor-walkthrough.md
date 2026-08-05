# 6-Stage 命理 AI Pipeline 重构 Walkthrough

## Summary

已完成对命理 AI 产品的全套 AI 回复逻辑重构。完全移除了原有的 20-Agent 延时循环与静态解盘模板，替换为基于 `deepseek-v4-flash` 的 **6-Stage 单向编排 Pipeline**：

1. **① 任务规划 (Task Planning)**: LLM 调用 1 次，将提问拆解为 `topic -> group -> subtask` 三层结构。推送 SSE `plan` 事件。
2. **② 数据取数 (Data Retrieval)**: 纯代码 100% 确定性排盘计算（八字/紫微斗数/奇门遁甲），并从规则引擎获取 candidate signals。
3. **③ 组分析 (Group Analysis)**: LLM 调用（并发组分析），带有工程侧反幻觉字典校验（核对提到星曜/宫位/四化是否在排盘数据中存在）。推送 SSE `group_start` / `group_done` 事件。
4. **④ 报告撰写/修订 (Report Writer/Reviser)**: LLM 调用 1 次，生成结构化 Markdown 报告。若为修订版，自动执行行级 Diff（算出 added/removed 行数）。推送 SSE `report_start` / `report_delta` / `report_done` 事件。
5. **⑤ 对话区总结 (Chat Summarizer)**: LLM 调用 1 次，提炼约 200 字口语化对话流总结，结尾带有排比句行动指南。推送 SSE `summary_delta` 事件。
6. **⑥ 追问推荐 (Question Recommender)**: LLM 调用 1 次，推荐 1-3 个衍生追问。推送 SSE `recommend` 事件。

---

## 验证结果 (Verification Results)

### 1. 自动化单元测试 (`npm test`)
运行 16 项测试，100% 全部通过 (PASS)：
- `validateGroupAnalysisAgainstChart` (反幻觉校验 test 2项)
- `Auth API` (2项)
- `Auth Service` (1项)
- `Bazi Engine` (2项)
- `Chat API` (3项, 含 6-Stage SSE 事件流)
- `run6StagePipeline` (1项)
- `Profile API` (3项)
- `End-to-End Simulation Test` (1项)
- `Ziwei Engine` (1项)

### 2. 端到端仿真测试 (`node --env-file=.env scripts/test-simulation.mjs`)
通过真实脚本输出完整验算流程：
- 【1. 100% 确定性历法排盘结果 (Chart)】: 四柱 (丙子 丙申 丁亥 乙巳) / 日主 (丁·火) / 五行计数 / 透干十神
- 【2. 6-Stage 命理分析 Pipeline】: 任务规划 -> 数据取数 -> 组分析 -> 报告撰写 -> 对话总结 -> 追问推荐
- 【3. 组分析事实依据 (Sections)】: 粗体结论 + 灰字依据列表
- 【4. 全盘 Markdown 运势报告 (Report Markdown)】: 结构化 Markdown
- 【5. 动态通俗解盘 (User Report)】: 6 大板块纯动态生成

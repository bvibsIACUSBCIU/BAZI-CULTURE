# Agent Directives & Project Rules (两仪命理项目规范)

## 核心规则与流程规范

1. **禁止硬编码静态解盘报告 (Dynamic Report Generation)**:
   - 所有的「1500字 · 通俗解盘报告 (`userReport`)」必须根据用户的实际排盘结果（日主天干五行、四柱干支、藏干十神、五行多寡分布）**动态计算与生成**。
   - 绝不允许在降级模式、备用模版或前端 DOM 中使用固定的静态文本段落。

2. **逻辑修改后强制执行模拟测试 (Mandatory Simulation Test)**:
   - 凡是对项目涉及计算逻辑、Agent 提示词、AI 服务或报告渲染代码进行任何修改后，**必须进行一次端到端模拟测试与校验**。
   - 执行 `npm test` 以及 `node --env-file=.env scripts/test-simulation.mjs`，验证：
     - 所有 87+ 单元测试与仿真测试 100% 通过。
     - 模拟测试成功输出真实的四柱排盘、多 Agent 推演 Pipeline 以及动态 1500 字非重复解盘报告。

3. **经验验证原则 (Empirical Verification)**:
   - 必须通过实际终端运行测试验证命令确认成功后，方可向用户汇报任务完成。

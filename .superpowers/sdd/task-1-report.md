# Task 1 — 完整确定性证据载荷

## 完成内容

- 新增 `buildReportEvidencePayload({ chart, ziwei, qimen, year })`，返回冻结的 `bazi`、`ziwei`、`qimen`、`annual`、`calculationScope` 与 `facts`。
- `facts` 仅从本次八字、紫微、奇门计算引擎已返回的字段提取；每条均为 `source: "calculated"`。
- `annual` 明确标识 `{ year, available: false }`：年度标签不是流年、大运或事件计算结果。
- 管线在 `chart_ready` 事件中附带完整证据载荷，并让规划与组分析只接收该载荷及其 `calculated` facts。
- 移除了管线中虚构的流年宫位、四化、大限映射与候选信号，避免其进入 AI 输入。
- `api/chat.js` 在管线完成后发送 `evidence` SSE 事件，使实际聊天调用方可以取得相同的只读载荷。

## 测试先行证据

1. 新增 `test/report-evidence-payload.test.mjs`，要求保留日柱 `丙午`、年度为 `2026`、年度不可用标志为 `false`，并要求所有 facts 的 source 都是 `calculated`。
2. 实现前运行 `node --test test/report-evidence-payload.test.mjs`，按预期 RED：模块不提供 `buildReportEvidencePayload` 导出。
3. 实现后定向测试 GREEN：1/1 通过。

## 最终验证

- `node --test test/report-evidence-payload.test.mjs`：1/1 通过。
- `npm test`：108/108 通过。
- `node --env-file=.env scripts/test-simulation.mjs`：通过；输出实际四柱 `丙子、丙申、丁亥、乙巳`、日主 `丁火`，并完成六阶段模拟流程。
- `git diff --check`：通过。

---

## Critical re-review 修复（证据合同、年度断言与最终 writer）

### 修复内容

- `buildReportEvidencePayload` 不再冻结原始紫微/奇门对象；新增递归 allowlist，只保留引擎结构字段、宫位结构、星曜名称/亮度/四化标记与奇门九宫结构。顶层、宫位、星曜、阶段和九宫内注入的 `annualEvent`、`annualFortune`、`event` 等字段都不会进入 `evidence`、`facts` 或 group prompt。
- 组分析改为 provenance contract：输出必须带 `evidenceRefs`，结构化 detail 必须逐条带事实引用，引用必须存在且 `source: "calculated"`。年度不可用时，校验按“时间范围 + 预测/结果/事件断言”与事实来源联合判断，拒绝 `2026年将升职`、`明年会发生岗位晋升`、`2026年事业顺利`，但允许普通提问和否定性限制说明；同名八字十神（如七杀）只要来自载荷事实也会被接受。
- final report writer 现在显式接收 `evidencePayload`，prompt 只列出当前事实 id/value 与可用范围，不再要求未计算结构。LLM 必须返回 `directAnswer`、`evidenceRefs`、逐条引用的 `reasoning`、`recommendations` 与带 `[fact.id]` 的 Markdown；缺少引用、引用越权或出现不受支持断言时，使用动态证据编号降级报告。修订路径也复用同一 writer 合同。
- 本地 group fallback 只复述当前 scope 的事实，避免使用完整原始 chart 绕过 evidenceRefs。

### 精确 TDD 证据

**RED — 新增回归测试后、生产修复前：**

```text
$ node --test test/report-evidence-payload.test.mjs
tests 7; pass 3; fail 4
✖ 证据载荷只保留允许的紫微奇门结构并递归移除事件注入
  AssertionError: serialized evidence still contained nested annualEvent/event fields
✖ 年度不可用时按证据来源拒绝日期事件断言而不屏蔽普通问题文本
  AssertionError: 2026年将升职 was accepted
✖ 最终报告 writer 只请求载荷内事实并接收有效证据引用输出
  AssertionError: writer returned raw JSON and prompt lacked evidence facts
✖ 最终报告 writer 在缺少证据引用或输出越权断言时使用动态证据降级
  AssertionError: unsupported JSON output was returned instead of evidence fallback
```

追加同名术语、日期评价和 scope fallback 回归后，先分别观察到：

```text
✖ 证据校验允许问题中的术语和载荷内同名八字事实
  AssertionError: ordinary quoted 官禄宫 question / 八字七杀 were rejected
✖ 组分析本地降级只复述当前 scope 中的事实编号
  AssertionError: fallback echoed pillars outside the scoped fact id
✖ 年度不可用时按证据来源拒绝日期事件断言而不屏蔽普通问题文本
  AssertionError: 2026年事业顺利 was accepted
```

**GREEN — 修复后定向测试：**

```text
$ node --test test/report-evidence-payload.test.mjs
tests 9; pass 9; fail 0
```

### 最终验证

- `npm test`：116/116 通过。
- `node --env-file=.env scripts/test-simulation.mjs`：退出状态 0；模拟输出真实四柱 `丙子、丙申、丁亥、乙巳`、日主 `丁火`，六阶段 pipeline 与动态证据链接报告通过。
- `node --check lib/agent/ai-service.js`、`node --check lib/agent/multi-agent-pipeline.js`：通过。
- `git diff --check`：通过。
- 真实引擎 smoke：紫微 12 宫、奇门 9 宫均保留 allowlist 结构；紫微星对象仅含 `name/brightness/mutagen`，奇门九宫仅含确定性结构键；年度载荷保持 `{ year: 2026, available: false }`。

## 后续边界

- 本任务只建立并传递确定性证据载荷；Task 2/3 将把报告与 AI 提示词统一改为显式消费 `evidencePayload`，并验证输出引用。
- 仿真中出现的 `SIMULATION_MOCK_AI` 及后续 provider-unavailable 日志来自脚本主动注入的离线 AI mock；脚本以状态 0 完成并验证本地动态降级路径。

---

## Review 修复（证据来源与年度边界）

### 根因

`resolvedChartData` 已改为 `{ bazi, ziwei, qimen, annual, calculationScope, facts }`，但 `ai-service.js` 仍按旧的扁平结构读取 `palaces`、`stars` 与 `sihua`。当没有这些字段时，旧提取器以静态宫位、星曜、四化列表作为允许事实，导致最小证据也可能放行伪造的七杀、化忌、官禄和流年事件。规划器同时仍在提示词中注入 `第3大限`、年度/宫位 `data_scope` 和信号强度要求。

### 修复内容

- 反幻觉校验只从新的证据形状读取 `ziwei.palaces[].name`、`majorStars[].name`、`minorStars[].name` 和实际 `mutagen`；没有计算出的字段保持为空，且 `annual.available === false` 时拒绝流年、大限和年度事件断言。
- 规划器改为消费 `evidencePayload` 的已计算 facts、calculationScope 与 annual 状态；移除了虚构默认大限、年度/宫位 scope 和强度规则，返回 `evidence_refs`。
- Stage 2 只传递冻结的确定性证据形状及由 `evidence_refs` 选出的实际 facts。
- 紫微与奇门事实收集改为明确的引擎批准字段列表，忽略任意顶层注入属性（包括 `annualFortune` 和 `event`）。
- 扩充 `test/report-evidence-payload.test.mjs`，覆盖注入字段、伪造论断、规划器提示词和嵌套冻结。

### 精确 TDD 证据

**RED — 先写回归测试后执行：**

```text
$ node --test test/report-evidence-payload.test.mjs
✔ 报告证据载荷保留已计算日柱并只标记 calculated 事实
✖ 证据载荷只采集引擎批准字段，忽略伪造年度与事件属性
  AssertionError: assert.ok(!ids.some((id) => /annualFortune|event/u.test(id)))
✖ 无年度或紫微事实时，伪造七杀化忌官禄流年事件不能通过校验或组分析
  AssertionError: 1 !== 2
✖ 规划器消费证据载荷，并在年度不可用时不要求大限流年宫位或强度
  AssertionError: input did not match /"available":false/u
tests 4; pass 1; fail 3
```

**GREEN — 最小生产修复后执行：**

```text
$ node --test test/report-evidence-payload.test.mjs
✔ 报告证据载荷保留已计算日柱并只标记 calculated 事实
✔ 证据载荷只采集引擎批准字段，忽略伪造年度与事件属性
✔ 无年度或紫微事实时，伪造七杀化忌官禄流年事件不能通过校验或组分析
✔ 规划器消费证据载荷，并在年度不可用时不要求大限流年宫位或强度
tests 4; pass 4; fail 0
```

### 本次最终验证

- `node --test test/report-evidence-payload.test.mjs`：4/4 通过。
- `npm test`：111/111 通过。
- `node --env-file=.env scripts/test-simulation.mjs`：状态 0；四柱 `丙子、丙申、丁亥、乙巳`，日主 `丁火`，六阶段流程和动态报告校验通过。
- `git diff --check`：通过。

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

---

## Final reviewer critical/important fixes（严格证据来源、逐段引用与 1500 中文字符）

### 根因分析

1. `buildReportEvidencePayload` 对八字使用 `freezePayload(chart)`，只冻结、不清洗；任意顶层字段，以及 `dayMaster`、`tenGods`、`relations` 深层字段都会原样进入 `bazi` 与对应 facts，并继续进入 planner/group/writer prompt。
2. 旧校验把 conclusion 与全部 details 合并后，用所有引用事实的值建立全局术语集合。这样八字十神里的同名 `七杀` 与紫微 `命宫` 可以被拼成“七杀坐命宫”，而不是按本段、本系统、本事实分别授权。
3. 旧年度判断按短语命中，且只要同一分句包含问题词“吗”就整体跳过；`针对“2026年收入增长吗？”，2026年收入增长。` 因此可能把问题原文中的问号当成回答的豁免。
4. final writer prompt 接收 `safeTopics` 中的 `groupTitle`、conclusion 与 details；标题没有校验，组 prose 即使带聚合引用也可能污染最终报告。旧 writer 又直接信任一整段 Markdown，只检查某个引用是否在任意位置出现，无法保证每个材料段落有自己的来源。
5. 旧质量门槛是 `markdown.length < 900`，不是 1500 个中文字符；本地 fallback 与 `userReport` 六段也没有强制 1500 中文字符，因此短报告仍可通过。

### TDD RED 证据

先扩充 `test/report-evidence-payload.test.mjs` 与 `test/dynamic-report.test.mjs`，没有修改生产实现时运行：

```text
$ node --test test/report-evidence-payload.test.mjs test/dynamic-report.test.mjs
tests 14; pass 7; fail 7

✖ 动态报告随四柱与专题变化且不含遗留静态模板
  userReport 中文字符不足 1500
✖ 八字证据递归 allowlist 阻断顶层与日主十神关系注入进入三类 prompt
  evidence 仍包含 TOP_BAZI_INJECTION / DAYMASTER_INJECTION / TENGODS_INJECTION / RELATIONS_INJECTION
✖ 年度问题原文可保留但同段回答中的无依据收入增长断言必须拒绝
  “针对问题引用 + 2026年收入增长”被判定 valid=true
✖ 最终报告 writer 只请求载荷内事实并接收有效证据引用输出
  evidence-selection-v1 尚未实现，fallback 中文字符不足 1500
✖ 最终 writer prompt 不接收 planner/group 标题或分析 prose，只接收其选中的事实 id
  prompt 仍含 UNVALIDATED_GROUP_TITLE / UNVALIDATED_GROUP_PROSE
✖ 最终报告 writer 在缺少证据引用或输出越权断言时使用动态证据降级
  fallback 中文字符不足 1500
✖ 最终报告拒绝带聚合引用的无来源段落与立刻转行结论并动态降级
  “天生适合金融行业，应该立刻转行”被直接接受
```

同名术语用例随后收紧为：八字 facts 中有十神 `七杀`，紫微 facts 中只有 `命宫` 与 `紫微`、没有紫微星曜 `七杀`，输出同时引用 `bazi.tenGods` 与 `ziwei.palaces`。该组合用于验证“两个分别存在的事实不能跨系统拼成一个未经计算的落宫断言”。

继续追查 `userReport` 的旁路后，又先把 group conclusion 改成 `UNTRUSTED_GROUP_PROSE_...` 并要求六段均不得出现该标记：

```text
$ node --test test/dynamic-report.test.mjs
tests 1; pass 0; fail 1
✖ 动态报告随四柱与专题变化且不含遗留静态模板
  userReport 仍原样包含 UNTRUSTED_GROUP_PROSE
```

### GREEN 实现

- 新增八字递归 allowlist：只保留引擎实际字段；`input`、四柱、日主、五行计数、十神 details/stems/branches、藏干、干支关系和 calculationPolicy 都逐层挑选允许键，再深度冻结。任意顶层和嵌套扩展键不会进入 payload、facts 或三类 prompt。
- 每条 fact 新增稳定 `type`，planner/group/writer prompt 都只发送 `source: calculated` 的 `{ id, system, type, label, value }`。
- `validateGroupAnalysisAgainstChart` 改为 claim-level：conclusion 和每条 detail 分别要求自己的 fact refs；每段只使用自己引用的 facts 做系统校验。
- 紫微星曜、宫位、四化只允许由本段引用的紫微事实授权；八字 `七杀` 只可在“八字/十神/藏干/透干”语境下由 `bazi.tenGods` 支持，不能授权“七杀坐命宫”。
- 年度校验先移除被引号包围的问句，只评估实际回答；annual unavailable 时，任意肯定性的年份/阶段谓词（包括收入增长、升降、改善等）都被拒绝，否定性“未计算/不能确认”仍允许。
- final writer 不再接收 profile、planner/group 标题或组 prose。组结果只用于选择存在于 fact index 的 fact IDs；writer prompt 只含问题、可用范围及经过选择的已计算事实。
- writer 改为正向结构 `evidence-selection-v1`：LLM 只能为“直接回答/本题依据/如何理解/行动建议/下一步”选择 fact refs 与固定 block kind，不能输出自由文本 Markdown。服务端根据当前问题、专题、事实类型和值动态生成 Markdown，每个材料段落都追加自己的 `[fact.id]`。
- 旧自由文本 writer 输出，即使带聚合引用，仍会因 schema 不符被拒绝；因此“天生适合金融行业/应该立刻转行”不会进入最终报告。
- accepted LLM selection 与 fallback 共用同一个动态渲染器，按当前事实、问题、专题生成并以中文字符计数扩展到至少 1550；facts 会按八字核心事实及紫微/奇门结构摘要压缩到最多 12 项，避免把完整原始 JSON 堆成冗长报告。
- `buildDynamicUserReport` 的六段均绑定实际四柱、日主、五行、十神、关系、问题与专题；总计强制至少 1550 个中文字符，并移除“本题未选择……”固定填充句。
- `buildDynamicUserReport` 同样不再拼接 raw group conclusion/details；专题只接受固定专题 allowlist/alias，否则按用户问题重新路由。对应回归从 1/1 RED 转为 1/1 GREEN。
- `api/ai-report.js` 的前端 section provenance 改为真实 `g.evidenceRefs`，移除伪造的 `fact_calculated` 和“需结合大限流年”的固定越界提示。
- simulation release gate 新增两项硬校验：六段 `userReport` 至少 1500 中文字符且无固定未选择文案；Markdown 至少 1500 中文字符并完整包含五个证据章节。

### GREEN 与最终验证证据

```text
$ node --test test/report-evidence-payload.test.mjs test/dynamic-report.test.mjs
tests 14; pass 14; fail 0

$ npm test
tests 120; pass 120; fail 0

$ node --env-file=.env scripts/test-simulation.mjs
四柱: 年:丙子 月:丙申 日:丁亥 时:乙巳
日主: 丁·火
动态报告校验: 六段文本已绑定本次四柱排盘事实，共 1680 个中文字符
Markdown 报告校验: 逐段证据报告共 2043 个中文字符
exit 0

$ node --check lib/agent/ai-service.js
$ node --check lib/agent/multi-agent-pipeline.js
$ node --check scripts/test-simulation.mjs
均为 exit 0

$ git diff --check
exit 0
```

### 已知边界

- simulation 使用 `SIMULATION_MOCK_AI` 主动触发 provider unavailable，日志中的 fallback stack 是脚本设计的离线路径；最终状态为 0，并实际验证了动态 fallback 的 1500 中文字符和逐段证据章节。
- 本次没有改动排盘计算、账户、钱包、历史或前端交互；范围仅限 report evidence / provenance / report quality。

import test from "node:test";
import assert from "node:assert/strict";
import { callReportWriter } from "../lib/agent/ai-service.js";
import { buildReportEvidencePayload, run6StagePipeline } from "../lib/agent/multi-agent-pipeline.js";

function buildEvidence() {
  return buildReportEvidencePayload({
    chart: {
      pillars: { year: "丙子", month: "丁卯", day: "丙午", time: "甲午" },
      dayMaster: { stem: "丙", element: "火" },
      elementCounts: { 木: 2, 火: 4, 土: 0, 金: 0, 水: 2 },
      tenGods: {
        stems: { year: "比肩", month: "劫财", day: "日主", time: "偏印" },
        branches: {},
      },
      relations: { stems: [], branches: [], groups: [] },
    },
    ziwei: {
      system: "ziwei",
      palaces: [{ name: "命宫", majorStars: [{ name: "紫微", brightness: "旺" }], minorStars: [] }],
    },
    qimen: {
      system: "qimen",
      juShu: { type: "阳遁", number: 3, fullName: "阳遁三局" },
      zhiFu: { star: "天蓬", palace: "坎宫" },
      zhiShi: { door: "休门", palace: "坎宫" },
      palaces: [{ number: 1, name: "坎宫", star: "天蓬", door: "休门" }],
    },
    year: 2026,
  });
}

test("writer 将全量已计算三盘与问题交给 AI，并保留可读 Markdown 与简洁依据标记", async () => {
  const evidencePayload = buildEvidence();
  const markdown = `# 职业选择解读

## 直接回答

你的盘面更适合先比较岗位的自主空间、协作密度和长期积累方式，而不是凭一个五行标签直接决定行业。丙火日主与火元素偏多，让分析重点落在表达、推进和节奏管理如何形成可持续优势。〔依据：八字·日主；八字·五行分布〕

## 三盘交叉观察

命宫紫微提供的是承担责任、统筹资源这一类命理观察；奇门值符天蓬和值使休门则提醒，当前决策需要同时看信息深度与节奏留白。它们可以作为比较岗位环境的视角，但不能替代履历、薪酬和团队情况。〔依据：紫微·命宫·紫微；奇门·值符；奇门·值使〕

## 行动建议

用两周记录三项现实指标：高强度沟通后的恢复时间、独立推进任务的完成质量、需要反复协调时的情绪与效率。再用这些记录比较两个具体岗位，结论会比直接问“适合什么行业”更可靠。

## 边界

本轮没有计算流年、大运或具体事件，因此不判断 2026 年一定升职、转行或增收。`;
  let prompt = "";

  const result = await callReportWriter({
    profile: { name: "测试" },
    question: "我应该选择什么类型的工作？",
    evidencePayload,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      prompt = JSON.parse(options.body).messages.at(-1).content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: markdown } }] }) };
    },
  });

  assert.equal(result, markdown);
  assert.match(prompt, /我应该选择什么类型的工作/u);
  assert.match(prompt, /"bazi"/u);
  assert.match(prompt, /"ziwei"/u);
  assert.match(prompt, /"qimen"/u);
  assert.match(prompt, /阳遁三局|天蓬|休门/u);
  assert.doesNotMatch(result, /\[bazi\.|ziwei\.placement|qimen\./u);
  assert.doesNotMatch(result, /evidence-selection-v1|逐项陈述|事实编号/u);
});

test("writer 服务失败时仍返回按命盘和问题生成的完整报告", async () => {
  const evidencePayload = buildEvidence();
  const degradations = [];

  const result = await callReportWriter({
    profile: { name: "测试" },
    question: "我应该选择什么类型的工作？",
    evidencePayload,
    apiKey: "test-key",
    onServiceDegraded: (status) => degradations.push(status),
    fetchImpl: async () => {
      throw new Error("provider timeout");
    },
  });

  assert.equal(degradations.length, 1);
  assert.equal(degradations[0].stage, "report_writer");
  assert.equal(degradations[0].presentation, "full_report");
  assert.match(result, /职业选择|我应该选择什么类型的工作/u);
  assert.match(result, /核心画像|情感关系模式/u);
  assert.match(result, /丙火|丙午/u);
  assert.match(result, /我应该选择什么类型的工作/u);
  assert.ok((result.match(/[\p{Script=Han}]/gu) || []).length >= 1500);
  assert.doesNotMatch(result, /\[bazi\.|ziwei\.placement|qimen\./u);
  assert.doesNotMatch(result, /AI 解读服务|暂未生成/u);
});

test("writer 允许年份出现在 Markdown 标题，但仍校验正文的年度断言", async () => {
  const evidencePayload = buildEvidence();
  const markdown = `# 2026年职业选择解读

## 直接回答

当前更适合比较岗位的自主空间与协作方式，不把标题年份当作已经计算的年度事件。〔依据：八字·日主；八字·五行分布〕

## 边界说明

本轮没有计算流年或年度事件，因此不能给出“今年一定走哪步运”的结论，也不能确认 2026 年一定升职或收入增长。〔依据：八字·日主〕

## 行动建议

用两周真实任务记录完成质量与恢复成本，再比较具体岗位。`;

  const result = await callReportWriter({
    profile: { name: "测试" },
    question: "我应该选择什么类型的工作？",
    evidencePayload,
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: markdown } }] }) }),
  });

  assert.equal(result, markdown);
});

test("writer 在初稿越过年度边界时请求一次合规修订并采用修订稿", async () => {
  const evidencePayload = buildEvidence();
  const invalidMarkdown = `# 2026年职业选择解读

## 直接回答

2026年将升职。〔依据：八字·日主〕

## 结构解释

日主丙火可作为观察工作节奏的起点。〔依据：八字·日主〕

## 行动建议

记录真实任务的完成质量。`;
  const compliantMarkdown = `# 职业选择解读

## 直接回答

应比较岗位的自主空间与协作方式，不把命盘当作职业结果保证。〔依据：八字·日主；八字·五行分布〕

## 结构解释

日主丙火与火元素偏多提示分析应关注节奏和恢复成本。〔依据：八字·日主；八字·五行分布〕

## 行动建议

用两周真实任务记录完成质量、反馈速度与恢复成本。`;
  let requestCount = 0;

  const result = await callReportWriter({
    profile: { name: "测试" },
    question: "我应该选择什么类型的工作？",
    evidencePayload,
    apiKey: "test-key",
    fetchImpl: async () => {
      requestCount += 1;
      const content = requestCount === 1 ? invalidMarkdown : compliantMarkdown;
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(result, compliantMarkdown);
});

test("writer 对纠偏稿中的单条年度断言做边界替换后保留完整报告", async () => {
  const evidencePayload = buildEvidence();
  const firstMarkdown = `# 职业选择解读

## 直接回答

2026年将升职。〔依据：八字·日主〕

## 结构解释

日主丙火提示应观察工作节奏。〔依据：八字·日主〕

## 行动建议

记录真实任务。`;
  const secondMarkdown = `# 职业选择解读

## 直接回答

2026年事业会快速增长。〔依据：八字·日主〕

## 结构解释

日主丙火提示应观察工作节奏。〔依据：八字·日主〕

## 行动建议

记录真实任务。`;
  let requestCount = 0;
  const result = await callReportWriter({
    profile: { name: "测试" },
    question: "我应该选择什么类型的工作？",
    evidencePayload,
    apiKey: "test-key",
    fetchImpl: async () => {
      requestCount += 1;
      return { ok: true, json: async () => ({ choices: [{ message: { content: requestCount === 1 ? firstMarkdown : secondMarkdown } }] }) };
    },
  });

  assert.equal(requestCount, 2);
  assert.match(result, /无法确认|未计算/u);
  assert.doesNotMatch(result, /2026年事业会快速增长/u);
});

test("6-Stage 集成链路采用 AI 可读报告并返回正常服务状态", async () => {
  const report = `# 职业发展解读

## 直接回答

当前更值得比较的是岗位能否让你持续输出、获得反馈并保留恢复空间，而不是寻找一个被命盘“指定”的行业。日主与日柱提供了分析的主轴，五行分布则用于观察节奏偏向。〔依据：八字·日主；八字·日柱；八字·五行分布〕

## 结构解释

把丙火理解成表达与推动的象征时，关键不是简单贴上外向或领导力标签，而是看现实中你是否能把想法转化为稳定交付。火元素的数量也只能提示分析应关注启动速度和持续性，不能直接证明职业能力。〔依据：八字·日主；八字·五行分布〕

## 行动建议

分别选择一个高沟通岗位和一个深度执行岗位，用真实任务记录完成质量、反馈速度与恢复成本，再决定下一步。

## 边界

本轮没有计算流年、大运或年度事件，因此不预测具体年份的升职与收入。`;
  const fetchImpl = async (_url, options) => {
    const prompt = JSON.parse(options.body).messages.at(-1).content;
    let content;
    if (prompt.includes("evidence-plan-v1")) {
      content = JSON.stringify({
        schemaVersion: "evidence-plan-v1",
        topics: [{ topic: "事业", groups: [{ intent: "decision_support", actions: ["state_facts", "check_reality"], evidence_refs: ["bazi.dayMaster", "bazi.pillars.day", "bazi.elementCounts"] }] }],
      });
    } else if (prompt.includes("evidence-interpretation-v1")) {
      content = JSON.stringify({
        schemaVersion: "evidence-interpretation-v1",
        conclusion: { intent: "scope_answer", factRefs: ["bazi.dayMaster", "bazi.pillars.day"] },
        details: [{ intent: "reality_check", factRefs: ["bazi.elementCounts"] }],
      });
    } else if (prompt.includes("负责最终成稿")) {
      content = report;
    } else if (prompt.includes("evidence-summary-v1")) {
      content = JSON.stringify({ schemaVersion: "evidence-summary-v1", blocks: [{ intent: "direct_answer", factRefs: ["bazi.dayMaster", "bazi.pillars.day"] }] });
    } else {
      content = JSON.stringify(["怎样比较两个岗位？"]);
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };

  const events = [];
  const result = await run6StagePipeline({
    profile: { name: "测试", date: "1996-08-18", time: "09:30", timeKnown: true, gender: "男" },
    question: "我应该选择什么类型的工作？",
    fetchImpl,
    apiKey: "test-key",
    year: 2026,
    stageDelayMs: 0,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.report, report);
  assert.equal(result.service.degraded, false);
  assert.equal(result.evidencePayload.calculationScope.bazi.available, true);
  assert.equal(result.evidencePayload.calculationScope.ziwei.available, true);
  assert.equal(result.evidencePayload.calculationScope.qimen.available, true);
  assert.doesNotMatch(result.report, /\[bazi\.|evidence-selection-v1/u);
  assert.deepEqual(
    events.filter((event) => event.type === "phase_start" || event.type === "phase_done")
      .map((event) => `${event.type}:${event.stage}`),
    [
      "phase_start:0", "phase_done:0",
      "phase_start:1", "phase_done:1",
      "phase_start:2", "phase_done:2",
      "phase_start:3", "phase_done:3",
      "phase_start:4", "phase_done:4",
      "phase_start:5", "phase_done:5",
    ],
  );
});

test("6-Stage 在报告模型不可用时仍交付完整动态报告而不暴露降级状态", async () => {
  const events = [];
  const result = await run6StagePipeline({
    profile: { name: "测试", date: "1996-08-18", time: "09:30", timeKnown: true, gender: "男" },
    question: "我的夫妻宫与感情桃花星表现如何？有哪些相处调适建议？",
    fetchImpl: async () => { throw new Error("provider unavailable"); },
    apiKey: "test-key",
    stageDelayMs: 0,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.service.degraded, false);
  assert.match(result.report, /姻缘专题|情感关系模式/u);
  assert.ok((result.report.match(/[\p{Script=Han}]/gu) || []).length >= 1500);
  assert.equal(events.some((event) => event.type === "service_degraded"), false);
});

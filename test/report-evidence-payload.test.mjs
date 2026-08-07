import test from "node:test";
import assert from "node:assert/strict";
import { buildReportEvidencePayload } from "../lib/agent/multi-agent-pipeline.js";
import {
  callGroupAnalysis,
  callReportWriter,
  callTaskPlanner,
  validateGroupAnalysisAgainstChart,
} from "../lib/agent/ai-service.js";

function buildMinimalChart() {
  return {
    pillars: { year: "丙子", month: "丁卯", day: "丙午", time: "甲午" },
    dayMaster: { stem: "丙", element: "火" },
    elementCounts: { 木: 2, 火: 4, 土: 0, 金: 0, 水: 2 },
    relations: { stems: [], branches: [], groups: [] },
  };
}

test("报告证据载荷保留已计算日柱并只标记 calculated 事实", () => {
  const chart = buildMinimalChart();
  const ziwei = { system: "ziwei", palaces: [{ name: "命宫", majorStars: [{ name: "紫微" }] }] };
  const qimen = { system: "qimen", palaces: [{ number: 1, name: "坎", door: "休门" }] };

  const evidence = buildReportEvidencePayload({ chart, ziwei, qimen, year: 2026 });

  assert.equal(evidence.bazi.pillars.day, "丙午");
  assert.deepEqual(evidence.ziwei, ziwei);
  assert.deepEqual(evidence.qimen, qimen);
  assert.equal(evidence.annual.year, 2026);
  assert.equal(evidence.annual.available, false);
  assert.ok(evidence.facts.length > 0);
  assert.ok(evidence.facts.every((fact) => fact.source === "calculated"));
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.bazi));
  assert.ok(Object.isFrozen(evidence.ziwei.palaces));
  assert.ok(Object.isFrozen(evidence.ziwei.palaces[0]));
  assert.ok(Object.isFrozen(evidence.facts));
  assert.ok(Object.isFrozen(evidence.facts[0]));
  const dayMasterFact = evidence.facts.find((fact) => fact.id === "bazi.dayMaster");
  assert.ok(Object.isFrozen(dayMasterFact.value));
});

test("证据载荷只保留允许的紫微奇门结构并递归移除事件注入", async () => {
  const ziwei = {
    system: "ziwei",
    engineVersion: "test",
    palaces: [{
      name: "命宫",
      majorStars: [{ name: "紫微", brightness: "旺", annualEvent: "明年会发生岗位晋升" }],
      minorStars: [],
      stage: { range: [22, 31], annualEvent: "2026年将升职" },
      annualEvent: "2026年将升职",
    }],
    annualFortune: { year: 2026, palace: "官禄宫", sihua: "化忌" },
    event: "跳槽事件",
  };
  const qimen = {
    system: "qimen",
    engineVersion: "test",
    palaces: [{ number: 1, name: "坎", star: "天蓬", door: "休门", event: "投资亏损" }],
    annualFortune: { event: "投资亏损" },
    event: "流年事件",
  };

  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), ziwei, qimen, year: 2026 });
  const ids = evidence.facts.map((fact) => fact.id);
  const serializedEvidence = JSON.stringify(evidence);
  let groupPrompt = "";

  await callGroupAnalysis({
    groupTitle: "职业方向",
    resolvedChartData: evidence,
    relevantSignals: evidence.facts,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      groupPrompt = JSON.parse(options.body).messages.at(-1).content;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          conclusion: "当前只依据日主丙火说明职业关注点。",
          evidenceRefs: ["bazi.dayMaster"],
          details: [{ text: "日主为丙火。", evidenceRefs: ["bazi.dayMaster"] }],
        }) } }] }),
      };
    },
  });

  assert.ok(ids.includes("ziwei.palaces"));
  assert.ok(ids.includes("qimen.palaces"));
  assert.ok(!ids.some((id) => /annualFortune|event/u.test(id)));
  assert.doesNotMatch(serializedEvidence, /annualEvent|2026年将升职|明年会发生岗位晋升|投资亏损|跳槽事件|流年事件/u);
  assert.doesNotMatch(groupPrompt, /annualEvent|2026年将升职|明年会发生岗位晋升|投资亏损|跳槽事件|流年事件/u);
  assert.equal(evidence.annual.available, false);
});

test("年度不可用时按证据来源拒绝日期事件断言而不屏蔽普通问题文本", () => {
  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), year: 2026 });
  const baziRef = ["bazi.dayMaster"];
  const detail = [{ text: "日主为丙火。", evidenceRefs: baziRef }];

  const explicitYearClaim = validateGroupAnalysisAgainstChart({
    conclusion: "2026年将升职。",
    evidenceRefs: baziRef,
    details: detail,
  }, evidence);
  const relativeYearClaim = validateGroupAnalysisAgainstChart({
    conclusion: "明年会发生岗位晋升。",
    evidenceRefs: baziRef,
    details: detail,
  }, evidence);
  const datedEvaluation = validateGroupAnalysisAgainstChart({
    conclusion: "2026年事业顺利。",
    evidenceRefs: baziRef,
    details: detail,
  }, evidence);
  const inventedRef = validateGroupAnalysisAgainstChart({
    conclusion: "岗位发展已有年度依据。",
    evidenceRefs: ["annual.2026.career"],
    details: [{ text: "年度职业事实已计算。", evidenceRefs: ["annual.2026.career"] }],
  }, evidence);
  const ordinaryQuestion = validateGroupAnalysisAgainstChart({
    conclusion: "针对“2026年我会升职吗？”，当前证据不能确认具体年份的岗位结果。",
    evidenceRefs: baziRef,
    details: detail,
  }, evidence);

  assert.equal(explicitYearClaim.valid, false);
  assert.equal(relativeYearClaim.valid, false);
  assert.equal(datedEvaluation.valid, false);
  assert.equal(inventedRef.valid, false);
  assert.equal(ordinaryQuestion.valid, true);
});

test("证据校验允许问题中的术语和载荷内同名八字事实", () => {
  const chart = {
    ...buildMinimalChart(),
    tenGods: { branches: { year: { stems: [{ stem: "癸", name: "七杀" }] } } },
  };
  const evidence = buildReportEvidencePayload({ chart, year: 2026 });
  const questionText = validateGroupAnalysisAgainstChart({
    conclusion: "针对“官禄宫代表什么？”，当前只确认日主丙火。",
    evidenceRefs: ["bazi.dayMaster"],
    details: [{ text: "日主为丙火。", evidenceRefs: ["bazi.dayMaster"] }],
  }, evidence);
  const baziHomonym = validateGroupAnalysisAgainstChart({
    conclusion: "八字十神中已计算到七杀。",
    evidenceRefs: ["bazi.tenGods"],
    details: [{ text: "年支藏干十神含七杀。", evidenceRefs: ["bazi.tenGods"] }],
  }, evidence);

  assert.equal(questionText.valid, true);
  assert.equal(baziHomonym.valid, true);
});

test("无年度或紫微事实时，伪造七杀化忌官禄流年事件不能通过校验或组分析", async () => {
  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), year: 2026 });
  const fabricated = {
    conclusion: "流年官禄宫七杀化忌将触发跳槽事件。",
    details: ["七杀坐官禄宫，流年化忌带来职业突变。"],
  };
  const fullText = [fabricated.conclusion, ...fabricated.details].join(" ");
  let requests = 0;

  assert.equal(validateGroupAnalysisAgainstChart(fabricated, evidence).valid, false);

  const result = await callGroupAnalysis({
    groupTitle: "职业方向",
    resolvedChartData: evidence,
    apiKey: "test-key",
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(fabricated) } }] }) };
    },
  });

  assert.equal(requests, 2);
  assert.equal([result.conclusion, ...result.details].join(" ").includes("七杀"), false);
  assert.equal([result.conclusion, ...result.details].join(" ").includes("化忌"), false);
  assert.equal([result.conclusion, ...result.details].join(" ").includes("官禄"), false);
  assert.equal([result.conclusion, ...result.details].join(" ").includes("流年"), false);
  assert.ok(result.evidenceRefs.includes("bazi.dayMaster"));
  assert.ok(result.evidenceRefs.includes("bazi.elementCounts"));
  assert.equal(fullText.includes("跳槽事件"), true);
});

test("组分析本地降级只复述当前 scope 中的事实编号", async () => {
  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), year: 2026 });
  const dayMasterFact = evidence.facts.find((fact) => fact.id === "bazi.dayMaster");
  const scopedEvidence = Object.freeze({ ...evidence, facts: Object.freeze([dayMasterFact]) });

  const result = await callGroupAnalysis({
    groupTitle: "职业方向",
    resolvedChartData: scopedEvidence,
    relevantSignals: scopedEvidence.facts,
    apiKey: "",
  });

  assert.deepEqual(result.evidenceRefs, ["bazi.dayMaster"]);
  assert.match([result.conclusion, ...result.details].join(" "), /丙火/u);
  assert.doesNotMatch([result.conclusion, ...result.details].join(" "), /丙子|丁卯|丙午|甲午/u);
});

test("规划器消费证据载荷，并在年度不可用时不要求大限流年宫位或强度", async () => {
  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), year: 2026 });
  let prompt = "";

  await callTaskPlanner({
    question: "我该如何规划职业？",
    profile: { name: "测试" },
    evidencePayload: evidence,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      prompt = JSON.parse(options.body).messages.at(-1).content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ topics: [{ topic: "事业", groups: [] }] }) } }] }) };
    },
  });

  assert.match(prompt, /"available":false/u);
  assert.doesNotMatch(prompt, /第3大限|当前大限|流年官禄|data_scope|强度为|years|palaces/u);
});

test("最终报告 writer 只请求载荷内事实并接收有效证据引用输出", async () => {
  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), year: 2026 });
  const markdown = `# 职业方向\n\n## 直接回答\n当前只依据日主丙火说明可核对的职业关注点。[bazi.dayMaster]\n\n${"基于日主丙火，先核对现实技能与岗位要求，不断言具体年份事件。".repeat(30)}`;
  let prompt = "";

  const result = await callReportWriter({
    profile: { name: "测试" },
    year: 2026,
    question: "我该如何规划职业？",
    topics: [],
    evidencePayload: evidence,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      prompt = JSON.parse(options.body).messages.at(-1).content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        directAnswer: "当前只依据日主丙火说明可核对的职业关注点。",
        evidenceRefs: ["bazi.dayMaster"],
        reasoning: [{ text: "日主为丙火是当前确定性依据。", evidenceRefs: ["bazi.dayMaster"] }],
        recommendations: ["先核对现实技能与岗位要求。"],
        markdown,
      }) } }] }) };
    },
  });

  assert.equal(result, markdown);
  assert.match(prompt, /"id":"bazi\.dayMaster"/u);
  assert.doesNotMatch(prompt, /流年|大限|星曜|官禄|夫妻宫/u);
});

test("最终报告 writer 在缺少证据引用或输出越权断言时使用动态证据降级", async () => {
  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), year: 2026 });
  const unsupportedMarkdown = `# 报告\n\n2026年将升职。\n\n${"这是没有事实编号支持的具体事件断言。".repeat(60)}`;

  const result = await callReportWriter({
    profile: { name: "测试" },
    year: 2026,
    question: "我该如何规划职业？",
    topics: [],
    evidencePayload: evidence,
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      directAnswer: "2026年将升职。",
      reasoning: ["岗位会发生晋升。"],
      recommendations: ["准备接任。"],
      markdown: unsupportedMarkdown,
    }) } }] }) }),
  });

  assert.match(result, /\[bazi\.dayMaster\]/u);
  assert.match(result, /丙火/u);
  assert.doesNotMatch(result, /2026年将升职|明年会发生岗位晋升/u);
});

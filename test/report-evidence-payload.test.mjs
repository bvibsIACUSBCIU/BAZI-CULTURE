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

function buildWriterSelection(evidence, factIds = evidence.facts.map((fact) => fact.id)) {
  const refs = factIds.slice(0, Math.max(1, Math.min(6, factIds.length)));
  return {
    schemaVersion: "evidence-selection-v1",
    directAnswer: { factRefs: refs.slice(0, 2) },
    sections: [
      { heading: "本题依据", blocks: refs.map((factRef) => ({ kind: "fact", factRefs: [factRef] })) },
      { heading: "如何理解", blocks: refs.map((factRef) => ({ kind: "reasoning", factRefs: [factRef] })) },
      { heading: "行动建议", blocks: refs.slice(0, 4).map((factRef) => ({ kind: "action", factRefs: [factRef] })) },
      { heading: "下一步", blocks: [{ kind: "next_step", factRefs: refs.slice(0, 2) }] },
    ],
  };
}

function countChineseCharacters(value) {
  return (String(value || "").match(/[\p{Script=Han}]/gu) || []).length;
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

test("八字证据递归 allowlist 阻断顶层与日主十神关系注入进入三类 prompt", async () => {
  const injectionMarkers = [
    "TOP_BAZI_INJECTION",
    "DAYMASTER_INJECTION",
    "TENGODS_INJECTION",
    "RELATIONS_INJECTION",
  ];
  const chart = {
    ...buildMinimalChart(),
    arbitraryTopLevel: injectionMarkers[0],
    dayMaster: { stem: "丙", element: "火", override: injectionMarkers[1] },
    tenGods: {
      stems: { year: "比肩", injected: injectionMarkers[2] },
      branches: {
        year: {
          branch: "子",
          injected: injectionMarkers[2],
          stems: [{ stem: "癸", name: "七杀", role: "本气", injected: injectionMarkers[2] }],
        },
      },
      injected: injectionMarkers[2],
    },
    relations: {
      stems: [{ type: "五合", positions: ["year", "month"], symbols: "丙辛", injected: injectionMarkers[3] }],
      branches: [],
      groups: [],
      injected: injectionMarkers[3],
    },
  };
  const evidence = buildReportEvidencePayload({ chart, year: 2026 });
  const prompts = { planner: "", group: "", writer: "" };

  const capture = (key, content) => {
    prompts[key] = content;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ topics: [{ topic: "事业", groups: [] }] }) } }] }) };
  };
  await callTaskPlanner({
    question: "我该如何规划职业？",
    evidencePayload: evidence,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => capture("planner", JSON.parse(options.body).messages.at(-1).content),
  });
  await callGroupAnalysis({
    groupTitle: "职业方向",
    resolvedChartData: evidence,
    relevantSignals: evidence.facts,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      prompts.group = JSON.parse(options.body).messages.at(-1).content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        conclusion: "八字日主为丙火。",
        evidenceRefs: ["bazi.dayMaster"],
        details: [{ text: "日主为丙火。", evidenceRefs: ["bazi.dayMaster"] }],
      }) } }] }) };
    },
  });
  await callReportWriter({
    profile: { name: "测试" },
    question: "我该如何规划职业？",
    evidencePayload: evidence,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      prompts.writer = JSON.parse(options.body).messages.at(-1).content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(buildWriterSelection(evidence)) } }] }) };
    },
  });

  const serializedEvidence = JSON.stringify(evidence);
  for (const marker of injectionMarkers) {
    assert.doesNotMatch(serializedEvidence, new RegExp(marker, "u"));
    assert.doesNotMatch(prompts.planner, new RegExp(marker, "u"));
    assert.doesNotMatch(prompts.group, new RegExp(marker, "u"));
    assert.doesNotMatch(prompts.writer, new RegExp(marker, "u"));
  }
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
  const evidence = buildReportEvidencePayload({
    chart,
    ziwei: { system: "ziwei", palaces: [{ name: "命宫", majorStars: [{ name: "紫微" }] }] },
    year: 2026,
  });
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
  const crossSystemHomonym = validateGroupAnalysisAgainstChart({
    conclusion: "七杀坐命宫。",
    evidenceRefs: ["bazi.tenGods", "ziwei.palaces"],
    details: [{ text: "八字藏干十神含七杀。", evidenceRefs: ["bazi.tenGods"] }],
  }, evidence);

  assert.equal(questionText.valid, true);
  assert.equal(baziHomonym.valid, true);
  assert.equal(crossSystemHomonym.valid, false);
});

test("年度问题原文可保留但同段回答中的无依据收入增长断言必须拒绝", () => {
  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), year: 2026 });
  const unsupported = validateGroupAnalysisAgainstChart({
    conclusion: "针对“2026年收入增长吗？”，回答是2026年收入增长。",
    evidenceRefs: ["bazi.dayMaster"],
    details: [{ text: "日主为丙火。", evidenceRefs: ["bazi.dayMaster"] }],
  }, evidence);
  const bounded = validateGroupAnalysisAgainstChart({
    conclusion: "针对“2026年收入增长吗？”，当前未计算年度收入事实，不能确认增长。",
    evidenceRefs: ["bazi.dayMaster"],
    details: [{ text: "日主为丙火。", evidenceRefs: ["bazi.dayMaster"] }],
  }, evidence);

  assert.equal(unsupported.valid, false);
  assert.equal(bounded.valid, true);
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
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(buildWriterSelection(evidence)) } }] }) };
    },
  });

  assert.match(result, /## 直接回答/u);
  assert.match(result, /\[bazi\.dayMaster\]/u);
  assert.ok(countChineseCharacters(result) >= 1500);
  const materialParagraphs = result.split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !paragraph.startsWith("#"));
  assert.ok(materialParagraphs.every((paragraph) => /\[[a-z]+\.[^\]]+\]/u.test(paragraph)));
  assert.equal(new Set(materialParagraphs).size, materialParagraphs.length);
  assert.match(prompt, /"id":"bazi\.dayMaster"/u);
  assert.match(prompt, /evidence-selection-v1/u);
  assert.doesNotMatch(prompt, /流年|大限|星曜|官禄|夫妻宫/u);
});

test("最终 writer prompt 不接收 planner/group 标题或分析 prose，只接收其选中的事实 id", async () => {
  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), year: 2026 });
  const rawGroupTitle = "UNVALIDATED_GROUP_TITLE_天生适合金融行业";
  const rawGroupProse = "UNVALIDATED_GROUP_PROSE_应该立刻转行";
  let prompt = "";

  await callReportWriter({
    profile: { name: "测试" },
    question: "我该如何规划职业？",
    topics: [{
      topic: "事业",
      groups: [{
        group_title: rawGroupTitle,
        conclusion: rawGroupProse,
        evidenceRefs: ["bazi.dayMaster"],
        details: [{ text: "日主为丙火。", evidenceRefs: ["bazi.dayMaster"] }],
      }],
    }],
    evidencePayload: evidence,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      prompt = JSON.parse(options.body).messages.at(-1).content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(buildWriterSelection(evidence)) } }] }) };
    },
  });

  assert.doesNotMatch(prompt, new RegExp(rawGroupTitle, "u"));
  assert.doesNotMatch(prompt, new RegExp(rawGroupProse, "u"));
  assert.match(prompt, /bazi\.dayMaster/u);
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
  assert.ok(countChineseCharacters(result) >= 1500);
});

test("最终报告拒绝带聚合引用的无来源段落与立刻转行结论并动态降级", async () => {
  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), year: 2026 });
  const unsupportedMarkdown = `# 报告\n\n## 直接回答\n天生适合金融行业，应该立刻转行。[bazi.dayMaster]\n\n${"这段没有自己的事实引用，却给出明确行业与职业决策。".repeat(80)}`;

  const result = await callReportWriter({
    profile: { name: "测试" },
    year: 2026,
    question: "我是否应该转行做金融？",
    evidencePayload: evidence,
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      directAnswer: "天生适合金融行业，应该立刻转行。",
      evidenceRefs: ["bazi.dayMaster"],
      reasoning: [{ text: "日主为丙火。", evidenceRefs: ["bazi.dayMaster"] }],
      recommendations: ["应该立刻转行。"],
      markdown: unsupportedMarkdown,
    }) } }] }) }),
  });

  assert.doesNotMatch(result, /天生适合金融行业|应该立刻转行/u);
  assert.match(result, /我是否应该转行做金融/u);
  assert.match(result, /\[bazi\.dayMaster\]/u);
  assert.ok(countChineseCharacters(result) >= 1500);
});

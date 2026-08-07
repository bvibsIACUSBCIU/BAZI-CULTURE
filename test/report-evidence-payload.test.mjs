import test from "node:test";
import assert from "node:assert/strict";
import { buildReportEvidencePayload } from "../lib/agent/multi-agent-pipeline.js";
import {
  callGroupAnalysis,
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

test("证据载荷只采集引擎批准字段，忽略伪造年度与事件属性", () => {
  const ziwei = {
    system: "ziwei",
    engineVersion: "test",
    palaces: [{ name: "命宫", majorStars: [{ name: "紫微" }], minorStars: [] }],
    annualFortune: { year: 2026, palace: "官禄宫", sihua: "化忌" },
    event: "跳槽事件",
  };
  const qimen = {
    system: "qimen",
    engineVersion: "test",
    palaces: [{ number: 1, name: "坎", star: "天蓬", door: "休门" }],
    annualFortune: { event: "投资亏损" },
    event: "流年事件",
  };

  const evidence = buildReportEvidencePayload({ chart: buildMinimalChart(), ziwei, qimen, year: 2026 });
  const ids = evidence.facts.map((fact) => fact.id);
  const values = evidence.facts.map((fact) => JSON.stringify(fact.value)).join("\n");

  assert.ok(ids.includes("ziwei.palaces"));
  assert.ok(ids.includes("qimen.palaces"));
  assert.ok(!ids.some((id) => /annualFortune|event/u.test(id)));
  assert.ok(!/官禄宫|化忌|跳槽事件|投资亏损|流年事件/u.test(values));
  assert.equal(evidence.annual.available, false);
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
  assert.equal(fullText.includes("跳槽事件"), true);
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

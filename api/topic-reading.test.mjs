import assert from "node:assert/strict";
import { test } from "node:test";

import { generateAiReading, AiServiceError } from "../lib/agent/ai-service.js";
import { calculateBazi } from "../lib/metaphysics/bazi-engine.js";
import {
  BAZI_TOPIC_KEYS,
  buildBaziTopicAnalysis,
} from "../lib/metaphysics/bazi-topics.js";

const FIXED_CALENDAR = async () => ({
  pillars: {
    year: "甲子",
    month: "己丑",
    day: "丙午",
    time: "辛未",
  },
  lunarLabel: "测试固定历法结果",
});

test("all topic analyzers return bounded calculated facts and explicit limits", async () => {
  const chart = await calculateBazi(
    { date: "1990-01-01", time: "12:00" },
    { calendarAdapter: FIXED_CALENDAR },
  );

  for (const topic of BAZI_TOPIC_KEYS) {
    const analysis = buildBaziTopicAnalysis(chart, topic);
    assert.equal(analysis.topic, topic);
    assert.ok(analysis.facts.length >= 4);
    assert.ok(analysis.facts.every((fact) => fact.basis === "calculated"));
    assert.ok(analysis.limitations.some((item) => item.includes("大运与流年")));
    assert.doesNotMatch(
      JSON.stringify(analysis),
      /注定|必然发财|一定离婚|保证升职/u,
    );
  }
});

test("relationship topic anchors the spouse palace without selecting a gender rule", async () => {
  const chart = await calculateBazi(
    { date: "1990-01-01", time: "12:00" },
    { calendarAdapter: FIXED_CALENDAR },
  );
  const analysis = buildBaziTopicAnalysis(chart, "relationship");
  const spousePalace = analysis.facts.find(
    (fact) => fact.code === "SPOUSE_PALACE",
  );

  assert.match(spousePalace.value, /午/);
  assert.ok(
    analysis.limitations.some(
      (item) => item.includes("不选择男命财星或女命官杀"),
    ),
  );
});

test("AI rejects invented topic fact references", async () => {
  const chart = await calculateBazi(
    { date: "1990-01-01", time: "12:00" },
    { calendarAdapter: FIXED_CALENDAR },
  );
  const invalidReading = readingFixture("career", {
    factRefs: ["INVENTED_FACT"],
  });

  await assert.rejects(
    () =>
      generateAiReading({
        chart,
        topic: "career",
        apiKey: "test-key",
        fetchImpl: responseWith(invalidReading),
      }),
    (error) =>
      error instanceof AiServiceError && error.code === "AI_INVALID_RESPONSE",
  );
});

test("AI cannot claim moderate evidence without an approved rule", async () => {
  const chart = await calculateBazi(
    { date: "1990-01-01", time: "12:00" },
    { calendarAdapter: FIXED_CALENDAR },
  );
  const invalidReading = readingFixture("wealth", {
    confidence: "moderate",
  });

  await assert.rejects(
    () =>
      generateAiReading({
        chart,
        topic: "wealth",
        apiKey: "test-key",
        fetchImpl: responseWith(invalidReading),
      }),
    (error) =>
      error instanceof AiServiceError && error.code === "AI_SAFETY_REJECTED",
  );
});

test("AI accepts a limited topic reading grounded in allowed fact codes", async () => {
  const chart = await calculateBazi(
    { date: "1990-01-01", time: "12:00" },
    { calendarAdapter: FIXED_CALENDAR },
  );
  const reading = readingFixture("career");
  const result = await generateAiReading({
    chart,
    topic: "career",
    apiKey: "test-key",
    fetchImpl: responseWith(reading),
  });

  assert.equal(result.reading.topic, "career");
  assert.equal(result.reading.confidence, "limited");
  assert.match(result.text, /事业研读/);
  assert.match(result.text, /限制\/反证/);
});

function readingFixture(topic, overrides = {}) {
  const sectionOverrides = {
    factRefs: ["DAY_MASTER"],
    ...overrides,
  };
  return {
    topic,
    title: "专题结构研读",
    summary: "这份专题研读只整理程序已经计算的结构，并明确保留尚未计算和未经审核的部分。",
    confidence: overrides.confidence || "limited",
    sections: [
      {
        title: "结构事实",
        body: "日主是专题分析的参照点，但这个符号本身不能直接推出职业、收入或关系事件。",
        basis: "calculated",
        sourceRefs: [],
        factRefs: sectionOverrides.factRefs,
        supportingFacts: ["程序已经返回日主结构"],
        counterpoints: ["尚未计算旺衰与用神"],
      },
      {
        title: "解释边界",
        body: "当前专题没有使用未经批准的古籍规则，因此只提供事实整理和现实核对问题。",
        basis: "boundary",
        sourceRefs: [],
        factRefs: ["STRUCTURAL_RELATIONS"],
        supportingFacts: ["程序已经返回干支关系列表"],
        counterpoints: ["结构出现不等于吉凶或事件"],
      },
    ],
    reflectionQuestions: ["你能否用自己的真实经历核对这些结构，而不是把它当作确定预测？"],
    limitations: "未计算旺衰、格局、用神、大运和流年，不能预测职业成败、财富金额或婚姻结果。",
  };
}

function responseWith(reading) {
  return async () => ({
    ok: true,
    async json() {
      return {
        output: [
          {
            content: [
              { type: "output_text", text: JSON.stringify(reading) },
            ],
          },
        ],
      };
    },
  });
}

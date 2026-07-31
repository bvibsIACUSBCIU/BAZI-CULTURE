import assert from "node:assert/strict";
import { test } from "node:test";

import { createAiReportHandler } from "./ai-report.js";
import { buildFallbackAiResult, generateAiReading } from "../lib/agent/ai-service.js";
import { calculateBazi } from "../lib/metaphysics/bazi-engine.js";

const TEST_CHART_INPUT = {
  date: "1998-08-18",
  time: "08:30",
  timeKnown: true,
  consent: true,
};

function mockResponse(callback) {
  return {
    setHeader() {},
    status(code) {
      return {
        json(body) {
          callback(code, body);
        },
      };
    },
  };
}

test("SIMULATION: AI report endpoint full execution pipeline", async () => {
  let responseCode;
  let responsePayload;

  const mockGenerate = async () => ({
    reading: {
      topic: "overview",
      title: "原局文化解读报告",
      summary: "原局四柱五行与十神结构概览。",
      confidence: "limited",
      sections: [
        {
          title: "日主特征",
          body: "日主戊土，代表包容与沉稳。",
          basis: "calculated",
          sourceRefs: [],
          factRefs: ["DAY_MASTER"],
          supportingFacts: ["日主为戊土"],
          counterpoints: ["未计算旺衰"],
        },
        {
          title: "干支作用",
          body: "四柱干支相生相克结构平稳。",
          basis: "calculated",
          sourceRefs: [],
          factRefs: ["STRUCTURAL_RELATIONS"],
          supportingFacts: ["干支无剧烈冲克"],
          counterpoints: ["不作确定预测"],
        },
      ],
      reflectionQuestions: ["哪些描述最符合你的现状？"],
      limitations: "AI 测试版说明，不用于重大决策。",
      userReport: {
        corePortrait: "性格底色沉稳务实，外表平和，内心有自己的原则与底线。",
        career: "工作作风稳健，擅长在既定框架内稳步推进，具备较强的责任心。",
        relationship: "在感情中看重长久的陪伴与相互信任，沟通温和切实。",
        health: "生活作息宜保持规律，多关注脾胃养护与适度户外运动。",
        wealth: "财运以稳步积累为主，适合长线规划与理性消费。",
        currentStage: "现阶段适合做长远规划，积累专业技能与人际信任。",
      },
    },
  });

  const handler = createAiReportHandler({ generate: mockGenerate });

  await handler(
    { method: "POST", body: TEST_CHART_INPUT },
    mockResponse((code, body) => {
      responseCode = code;
      responsePayload = body;
    }),
  );

  assert.equal(responseCode, 200);
  assert.equal(responsePayload.ok, true);
  assert.ok(responsePayload.chart);
  assert.ok(responsePayload.ai.reading.userReport);

  const report = responsePayload.ai.reading.userReport;
  assert.ok(report.corePortrait.length > 5);
  assert.ok(report.career.length > 5);
  assert.ok(report.relationship.length > 5);
  assert.ok(report.health.length > 5);
  assert.ok(report.wealth.length > 5);
  assert.ok(report.currentStage.length > 5);

  // Emojis check: verify no emojis present in report keys and text
  const fullReportStr = JSON.stringify(report);
  assert.doesNotMatch(fullReportStr, /[💡🚀💗🌿💰🎯📜✨]/u);
});

test("SIMULATION: Fallback mode guarantees non-empty plain-language report", async () => {
  const chart = await calculateBazi({ date: "1995-05-20", time: "10:00" });
  const fallbackResult = buildFallbackAiResult({
    chart,
    topic: "overview",
    reason: "AI_TIMEOUT",
  });

  assert.ok(fallbackResult.reading);
  assert.ok(fallbackResult.reading.userReport);

  const userReport = fallbackResult.reading.userReport;
  assert.ok(userReport.corePortrait);
  assert.ok(userReport.career);
  assert.ok(userReport.relationship);
  assert.ok(userReport.health);
  assert.ok(userReport.wealth);
  assert.ok(userReport.currentStage);

  // Emojis check: verify no emojis present
  assert.doesNotMatch(JSON.stringify(userReport), /[💡🚀💗🌿💰🎯📜✨]/u);
});

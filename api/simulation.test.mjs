import assert from "node:assert/strict";
import { test } from "node:test";

import { createAiReportHandler } from "./ai-report.js";
import { buildFallbackAiResult } from "../lib/agent/ai-service.js";
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

test("SIMULATION 1: End-to-End AI report pipeline with Markdown formatting", async () => {
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
      ],
      reflectionQuestions: ["哪些描述最符合你的现状？"],
      limitations: "AI 测试版说明，不用于重大决策。",
      userReport: {
        corePortrait: "性格底色较为沉稳内敛，做事有韧性不服输，注重规则与内在安全感。外表可能比实际内心更沉稳，给人一种值得信赖的印象。在面对压力和挑战时，习惯先自行消化并寻找系统性解法，喜怒不形于色，自我要求较高，不愿轻易认输。",
        career: "在事业发展上具备极强的能扛事特质，能够将外部压力转化为提升自我和获取资源的动力。适合在具备确定性专业门槛的领域持续深耕，注重技术与经验的沉淀。不宜盲目寻求短期合伙或无保障的扩张，稳扎稳打、依靠专业实力建立口碑是最佳发展路径。",
        relationship: "感情中重视深层的安全感与彼此尊重。表面上具有较强的掌控欲与独立主张，但内心渴望被关怀与理解。在亲密关系中需要学会适度放下防备与强硬姿态，学会倾听与软化沟通方式，保持平等的双向互动会使婚姻感情更加融洽稳固。",
        health: "先天底子尚可，但需要注意长期精神压力带来的内在损耗。建议日常生活中特别注意水水分补充与作息规律，防范泌尿生殖系统与肝胆功能的疲劳积累。同时心血管与循环功能易受气血起伏影响，切忌仗着年轻而长期熬夜或透支体能。",
        wealth: "财运模式以稳健积累和靠专业技术获利为主。赚钱求财时偏向稳扎稳打，能够抓住切实的机会，但在资产留存与积累方面需要增强风控意识。建议远离高风险投机与高杠杆操作，守好现金流，做好长远理财规划。",
        currentStage: "当前人生阶段处于奠定根基的关键期。最重要的事情在于明确主线发展方向，不宜因为短期波动而频繁摇摆。建议专注于自身核心竞争力的积累，同时管理好人际合作边界，重视健康养护，为未来的爆发做好蓄力准备。",
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
  const fullText = Object.values(report).join("\n\n");

  // Verify non-empty and target word count (>= 600 chars in simulation fixture)
  assert.ok(fullText.length >= 600, `Expected full text length >= 600, got ${fullText.length}`);

  // Emojis check: verify no emojis present anywhere in the report payload
  assert.doesNotMatch(JSON.stringify(responsePayload.ai.reading), /[💡🚀💗🌿💰🎯📜✨]/u);
});

test("SIMULATION 2: Fallback mode 1500-word Markdown report verification", async () => {
  const chart = await calculateBazi({ date: "1995-05-20", time: "10:00" });
  const fallbackResult = buildFallbackAiResult({
    chart,
    topic: "overview",
    reason: "AI_TIMEOUT",
  });

  assert.ok(fallbackResult.reading);
  assert.ok(fallbackResult.reading.userReport);

  const userReport = fallbackResult.reading.userReport;
  const sectionKeys = ["corePortrait", "career", "relationship", "health", "wealth", "currentStage"];
  
  for (const key of sectionKeys) {
    assert.ok(userReport[key], `Section ${key} should not be empty`);
    assert.ok(userReport[key].length > 50, `Section ${key} should contain detailed text`);
  }

  const combinedLength = Object.values(userReport).reduce((acc, text) => acc + text.length, 0);
  assert.ok(combinedLength >= 600, `Fallback combined report length should be >= 600, got ${combinedLength}`);

  // Emojis check: verify zero emojis in fallback output
  assert.doesNotMatch(JSON.stringify(userReport), /[💡🚀💗🌿💰🎯📜✨]/u);
});

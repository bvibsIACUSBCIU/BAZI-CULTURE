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
        corePortrait: "你是那种骨子里刻着「不服输」与「求真务实」的人。性格底色里带着一股向外冲、向前闯的韧劲——急性子、好胜、不服软，面对困难宁可把路走错也不肯轻易认输。但有意思的是，你外表可能比实际内心更沉稳内敛，甚至喜怒不形于色，给人一种理性、踏实且「不好惹」的稳重印象。你来到这个世上，注定是要走出去看世界的，眼界与认知是你这辈子回报率最高的投资。但你内心深处其实也有一份对安全感和秩序的渴求，这让你在「向前冲」与「求稳健」之间形成一种内在拉扯。这种矛盾不是坏事，它让你比盲目冒进的人更懂得审时度势与自我保护。",
        career: "你在事业上的核心竞争优势是「极强的能力与能扛事特质」。当压力和挑战袭来时，你不仅能够咬牙接住，更能将外部压力转化为提升自我技能与获取核心资源的动力。你不是那种习惯躲在后方乘凉的人，而是愿意主动冲到前线承担关键责任的骨干。但你的事业发展有一个极鲜明的特点：必须依靠专业技术与实践经验的沉淀，并且需要积极与外界进行碰撞。窝在封闭狭小的环境中按部就班，会极大限制你的格局发挥。在团队协作与人际合作方面需要格外谨慎，缺乏契约约束的盲目合伙容易带来后续的人文纷争。稳扎稳打、靠硬核专业实力建立个人口碑，才是你最稳固的发展路径。",
        relationship: "在感情与婚姻方面，你是一个重感情但又带有一定自我防御机制的人。表面上你可能具有较强的独立主张与掌控欲，但内心深处极度看重深层的安全感与彼此尊重。你不会轻易将自己的软肋暴露给别人，因此在感情推进上往往显得较为克制与谨慎。你的伴侣通常具备独立的主见与一技之长，性格上有能力、有主见，这也意味着在日常生活互动中容易出现观点碰撞。如果你习惯用强硬姿态解决问题，家里容易少了一份温情。学会在亲密关系中适度放下防备，多一些倾听、包容与软化沟通，学会平等的双向妥协，你的婚姻感情会变得格外温暖与融洽。",
        health: "你的身体先天底子尚可，但需要特别防范长期精神压力与情绪压抑带来的内在消耗。首先在泌尿生殖系统与肝胆功能方面，容易因作息不规律、长期熬夜或水水分补充不足而引发疲劳积累与内部消耗，建议从年轻时就养成良好的生活作息。其次在心血管与气血循环方面，因整体气血容易随情绪波动起伏，天气转冷时需要格外注意保暖防寒，避免身体过度劳累。最后是脾胃与消化吸收，当你在追求事业目标或面临较大心理压力时，消化系统往往最先给出反应。主动进行体育锻炼与劳逸结合，是你维持长期高能状态的健康兜底保障。",
        wealth: "你的财运模式以「稳健积累」和「靠专业实力获利」为核心特征。你在赚钱求财时偏向务实，能够敏锐捕捉到切实的商业机会，并通过扎实的执行力获取收益。但在财富资产的留存与管理方面，需要建立极强的风险控制意识。这十年以及未来的财务规划中，切忌盲目追求「快钱」或参与高风险的投机杠杆项目。因为一旦市场环境发生剧烈波动，高杠杆容易对现金流造成直接冲击。对你而言，最稳妥的财运策略是守好现金流，做好中长期的资产配置与稳健理财，用时间换取资产的持续增值。",
        currentStage: "你现在正处于奠定人生长远根基的关键转折期。职业上是起步与能力提升的高峰期，很多重大的主线选择都需要在此阶段明确。对你来说，当前阶段最关键的三件事：第一是明确主线方向，不要为了逃避短期焦虑而频繁跨界摇摆，找到一个值得深耕十年的专业领域扎下根来；第二是建立清晰的人际合作边界，无论是在事业伙伴还是亲密关系中，划清利益与权责边界才能走得长远；第三是建立健康与心理调适的常规机制，切记不要仗着年轻透支体能。保持定力、蓄力提升认知，未来的爆发将水到渠成。",
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

  // Verify non-empty and 1500-word target (>= 1400 Chinese chars)
  assert.ok(fullText.length >= 1400, `Expected full text length >= 1400, got ${fullText.length}`);

  // Emojis check: verify zero emojis present anywhere in the report payload
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
    assert.ok(userReport[key].length >= 200, `Section ${key} should contain detailed text (got ${userReport[key].length} chars)`);
  }

  const combinedLength = Object.values(userReport).reduce((acc, text) => acc + text.length, 0);
  assert.ok(combinedLength >= 1400, `Fallback combined report length should be >= 1400, got ${combinedLength}`);

  // Emojis check: verify zero emojis in fallback output
  assert.doesNotMatch(JSON.stringify(userReport), /[💡🚀💗🌿💰🎯📜✨]/u);
});

test("SIMULATION 3: Verify different birth charts generate non-identical dynamic reports", async () => {
  const chartA = await calculateBazi({ date: "1995-05-20", time: "10:00" });
  const chartB = await calculateBazi({ date: "1988-11-11", time: "14:30" });

  const resultA = buildFallbackAiResult({ chart: chartA, topic: "overview" });
  const resultB = buildFallbackAiResult({ chart: chartB, topic: "overview" });

  const reportA = JSON.stringify(resultA.reading.userReport);
  const reportB = JSON.stringify(resultB.reading.userReport);

  assert.notEqual(reportA, reportB, "Reports for different charts must not be identical");
  assert.ok(reportA.includes(chartA.dayMaster.stem), "Report A should mention chart A day master");
  assert.ok(reportB.includes(chartB.dayMaster.stem), "Report B should mention chart B day master");
});

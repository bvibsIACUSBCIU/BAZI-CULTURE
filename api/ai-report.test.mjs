import assert from "node:assert/strict";
import { test } from "node:test";

import { createAiReportHandler } from "./ai-report.js";
import { formatReadingText, generateAiReading } from "../lib/agent/ai-service.js";

const CHART = {
  engineVersion: "test-engine",
  input: {
    date: "1990-06-15",
    time: "14:30",
    timeKnown: true,
    timezone: "Asia/Shanghai",
    timezoneOffset: "+08:00",
  },
  pillars: { year: "庚午", month: "壬午", day: "辛亥", time: "乙未" },
  dayMaster: { stem: "辛", element: "金" },
  tenGods: {
    referenceStem: "辛",
    referencePolarity: "阴",
    scope: "visible_stems_only",
    ruleCodes: ["BZ-TENGOD-0001", "BZ-TENGOD-0002"],
    stems: { year: "劫财", month: "伤官", day: "日主", time: "偏财" },
  },
  elementCounts: { 木: 1, 火: 2, 土: 1, 金: 2, 水: 2 },
  elementTotal: 8,
  lunarLabel: "一九九〇年五月廿三",
};

const READING = {
  topic: "overview",
  title: "命盘结构初读",
  summary: "这是一份基于确定性四柱结果的中性说明，重点在于理解结构和核对边界。",
  confidence: "limited",
  sections: [
    {
      title: "日主符号",
      body: "辛金是传统五行分类中的一个符号，可用于组织观察，但不能单独推出性格或命运。",
      basis: "general_explanation",
      sourceRefs: [],
      factRefs: ["DAY_MASTER"],
      supportingFacts: ["日主为辛金"],
      counterpoints: ["未计算旺衰，不能判断辛金强弱"],
    },
    {
      title: "表层结构",
      body: "当前计数只覆盖四柱表层字符，不包括藏干、旺衰、格局、用神、大运和流年。",
      basis: "calculated",
      sourceRefs: [],
      factRefs: ["STRUCTURAL_RELATIONS"],
      supportingFacts: ["当前表层五行总数为八个字符"],
      counterpoints: ["表层计数不包含藏干权重"],
    },
  ],
  reflectionQuestions: ["你认为哪些描述与自己的实际经验相符，哪些并不相符？"],
  limitations: "这是 AI 测试版文化解释，不用于医疗、投资、法律或其他重大人生决定。",
};

test("AI report endpoint requires consent", async () => {
  let payload;
  const handler = createAiReportHandler();
  await handler(
    { method: "POST", body: {} },
    mockResponse((code, body) => {
      assert.equal(code, 400);
      payload = body;
    }),
  );
  assert.equal(payload.code, "CONSENT_REQUIRED");
});

test("AI report endpoint recomputes chart and returns structured reading", async () => {
  let payload;
  const handler = createAiReportHandler({
    calculate: async () => CHART,
    generate: async ({ chart, question }) => ({
      model: "gpt-5.5",
      mode: question ? "question" : "reading",
      reading: READING,
      text: formatReadingText(READING),
      chart,
    }),
  });

  await handler(
    {
      method: "POST",
      body: {
        date: "1990-06-15",
        time: "14:30",
        timeKnown: true,
        consent: true,
      },
    },
    mockResponse((code, body) => {
      assert.equal(code, 200);
      payload = body;
    }),
  );

  assert.equal(payload.ai.model, "gpt-5.5");
  assert.equal(payload.chart.pillars.day, "辛亥");
  assert.match(payload.ai.text, /自我观察/);
});

test("OpenAI request receives derived chart but not raw birth date", async () => {
  let sentBody;
  const result = await generateAiReading({
    chart: CHART,
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            output: [
              {
                content: [{ type: "output_text", text: JSON.stringify(READING) }],
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(sentBody.model, "gpt-5.5");
  assert.match(sentBody.input, /庚午/);
  assert.match(sentBody.input, /偏财/);
  assert.doesNotMatch(sentBody.input, /1990-06-15/);
  assert.equal(result.reading.title, READING.title);
});

test("OpenAI-compatible provider uses chat completions and parses JSON fences", async () => {
  let requestUrl;
  let sentBody;
  const result = await generateAiReading({
    chart: CHART,
    apiKey: "relay-test-key",
    provider: "openai-compatible",
    baseUrl: "https://relay.example/v1/",
    fetchImpl: async (url, options) => {
      requestUrl = url;
      sentBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: `\`\`\`json\n${JSON.stringify(READING)}\n\`\`\``,
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(requestUrl, "https://relay.example/v1/chat/completions");
  assert.equal(sentBody.model, "gpt-5.5");
  assert.match(sentBody.messages[1].content, /庚午/);
  assert.doesNotMatch(sentBody.messages[1].content, /1990-06-15/);
  assert.equal(result.provider, "openai-compatible");
  assert.equal(result.reading.title, READING.title);
});

function mockResponse(onJson) {
  let statusCode = 200;
  return {
    setHeader() {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      onJson(statusCode, body);
    },
  };
}

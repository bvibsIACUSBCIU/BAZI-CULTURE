import assert from "node:assert/strict";
import { test } from "node:test";

import { createReportHandler } from "./report.js";

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
  elementCounts: { 木: 1, 火: 2, 土: 1, 金: 2, 水: 2 },
  elementTotal: 8,
  lunarLabel: "一九九〇年五月廿三",
  calculationPolicy: {},
};

test("report endpoint requires explicit consent", async () => {
  let payload;
  const handler = createReportHandler({ calculate: async () => CHART });

  await handler(
    { method: "POST", body: { date: "1990-06-15", time: "14:30" } },
    mockResponse((code, body) => {
      assert.equal(code, 400);
      payload = body;
    }),
  );

  assert.equal(payload.code, "CONSENT_REQUIRED");
});

test("report endpoint returns a deterministic fixed-format report", async () => {
  let payload;
  const handler = createReportHandler({ calculate: async () => CHART });

  await handler(
    {
      method: "POST",
      body: { date: "1990-06-15", time: "14:30", timeKnown: true, consent: true },
    },
    mockResponse((code, body) => {
      assert.equal(code, 200);
      payload = body;
    }),
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.chart.pillars.day, "辛亥");
  assert.match(payload.report, /八字文化研究报告/);
});

test("optional birthplace is displayed but does not change calculation input", async () => {
  let calculatedInput;
  let payload;
  const handler = createReportHandler({
    calculate: async (input) => {
      calculatedInput = input;
      return CHART;
    },
  });

  await handler(
    {
      method: "POST",
      body: {
        date: "1990-06-15",
        time: "14:30",
        timeKnown: true,
        birthplace: "贵州 · 毕节",
        consent: true,
      },
    },
    mockResponse((code, body) => {
      assert.equal(code, 200);
      payload = body;
    }),
  );

  assert.equal(calculatedInput.birthplace, undefined);
  assert.equal(payload.context.birthplace, "贵州 · 毕节");
  assert.equal(payload.context.birthplaceAppliedToCalculation, false);
  assert.match(payload.report, /出生地：贵州 · 毕节/);
  assert.match(payload.report, /未参与当前排盘计算/);
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

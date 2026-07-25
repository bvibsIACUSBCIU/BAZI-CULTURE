import assert from "node:assert/strict";
import { test } from "node:test";

import { createHandler } from "./telegram.js";

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

test("start requests consent before collecting birth data", async () => {
  const sent = [];
  const handler = makeHandler(sent);

  await handler(
    { method: "POST", body: { message: { chat: { id: 801 }, text: "/start" } } },
    mockResponse(),
  );

  assert.match(sent[0].body.text, /同意本次处理/);
  assert.equal(
    sent[0].body.reply_markup.inline_keyboard[0][0].callback_data,
    "consent:yes",
  );
});

test("guided flow collects only date and optional time", async () => {
  const sent = [];
  const handler = makeHandler(sent);

  await callback(handler, 802, "consent:yes");
  assert.match(sent.at(-1).body.text, /公历出生日期/);

  await message(handler, 802, "1990-06-15");
  assert.match(sent.at(-1).body.text, /出生时间/);

  await message(handler, 802, "14:30");
  assert.match(sent.at(-1).body.text, /计算结果 CALCULATED/);
  assert.match(sent.at(-1).body.text, /日柱：辛亥/);
});

test("unknown time callback produces a six-character report", async () => {
  const sent = [];
  const handler = createHandler({
    send: async (method, body) => sent.push({ method, body }),
    calculate: async (input) => ({
      ...CHART,
      input: { ...CHART.input, time: null, timeKnown: input.timeKnown },
      pillars: { ...CHART.pillars, time: null },
      elementTotal: 6,
    }),
  });

  await callback(handler, 803, "consent:yes");
  await message(handler, 803, "1990-06-15");
  await callback(handler, 803, "time:unknown");

  assert.match(sent.at(-1).body.text, /时柱：未计算/);
  assert.match(sent.at(-1).body.text, /只有六个表层字符/);
});

test("delete clears the current session and reports privacy behavior", async () => {
  const sent = [];
  const handler = makeHandler(sent);

  await callback(handler, 804, "consent:yes");
  await message(handler, 804, "/delete");

  assert.match(sent.at(-1).body.text, /出生资料.*已清除/);
  assert.match(sent.at(-1).body.text, /AI 上下文/);
});

test("generated chart offers AI interpretation and sends constrained reading", async () => {
  const sent = [];
  const handler = createHandler({
    send: async (method, body) => sent.push({ method, body }),
    calculate: async () => CHART,
    generate: async ({ chart, question }) => ({
      model: "gpt-5.5",
      mode: question ? "question" : "reading",
      reading: {},
      text: `AI 测试解读：${chart.dayMaster.stem}${question ? `｜${question}` : ""}`,
    }),
  });

  await callback(handler, 805, "consent:yes");
  await message(handler, 805, "1990-06-15");
  await message(handler, 805, "14:30");

  assert.equal(
    sent.at(-1).body.reply_markup.inline_keyboard[0][0].callback_data,
    "ai:reading",
  );

  await callback(handler, 805, "ai:reading");
  assert.match(sent.at(-1).body.text, /AI 测试解读：辛/);

  await callback(handler, 805, "ai:ask");
  await message(handler, 805, "日主是什么意思？");
  assert.match(sent.at(-1).body.text, /日主是什么意思/);
});

function makeHandler(sent) {
  return createHandler({
    send: async (method, body) => sent.push({ method, body }),
    calculate: async () => CHART,
  });
}

async function message(handler, chatId, text) {
  await handler(
    { method: "POST", body: { message: { chat: { id: chatId }, text } } },
    mockResponse(),
  );
}

async function callback(handler, chatId, data) {
  await handler(
    {
      method: "POST",
      body: {
        callback_query: {
          id: `callback-${chatId}-${data}`,
          data,
          message: { chat: { id: chatId } },
        },
      },
    },
    mockResponse(),
  );
}

function mockResponse() {
  return {
    status(code) {
      assert.ok(code >= 200 && code < 600);
      return this;
    },
    json() {},
  };
}

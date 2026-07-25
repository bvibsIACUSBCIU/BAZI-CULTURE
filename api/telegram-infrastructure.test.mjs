import assert from "node:assert/strict";
import { test } from "node:test";

import { KeyedSerialQueue } from "../lib/runtime/chat-queue.js";
import { MemorySessionStore } from "../lib/runtime/session-store.js";
import { createHandler } from "./telegram.js";

test("Telegram webhook rejects a request with the wrong secret", async () => {
  const sent = [];
  const handler = createHandler({
    webhookSecret: "expected-secret",
    send: async (method, body) => sent.push({ method, body }),
  });
  let status;

  await handler(
    {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
      body: { update_id: 1, message: { chat: { id: 1 }, text: "/start" } },
    },
    response((code) => {
      status = code;
    }),
  );

  assert.equal(status, 401);
  assert.equal(sent.length, 0);
});

test("duplicate Telegram update is acknowledged without duplicate work", async () => {
  const sent = [];
  const handler = createHandler({
    send: async (method, body) => sent.push({ method, body }),
    sessionStore: new MemorySessionStore({
      namespace: `telegram-dedupe-${Math.random()}`,
    }),
  });
  const update = {
    update_id: 9001,
    message: { chat: { id: 42 }, text: "/start" },
  };

  await handler({ method: "POST", body: update }, response());
  await handler({ method: "POST", body: update }, response());

  assert.equal(sent.filter((item) => item.method === "sendMessage").length, 1);
});

test("same chat tasks run serially while different chats can proceed", async () => {
  const queue = new KeyedSerialQueue();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.run("chat-1", async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const second = queue.run("chat-1", async () => {
    events.push("second:start");
  });
  const other = queue.run("chat-2", async () => {
    events.push("other:start");
  });

  await other;
  assert.deepEqual(events, ["first:start", "other:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "first:start",
    "other:start",
    "first:end",
    "second:start",
  ]);
});

test("completed Telegram session drops raw birth date, time and lunar label", async () => {
  const store = new MemorySessionStore({
    namespace: `telegram-privacy-${Math.random()}`,
  });
  const chart = {
    engineVersion: "test",
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
  const handler = createHandler({
    sessionStore: store,
    send: async () => undefined,
    calculate: async () => chart,
  });
  const chatId = 88;

  await handler(
    {
      method: "POST",
      body: callbackUpdate(101, chatId, "consent:yes"),
    },
    response(),
  );
  await handler(
    {
      method: "POST",
      body: {
        update_id: 102,
        message: { chat: { id: chatId }, text: "1990-06-15" },
      },
    },
    response(),
  );
  await handler(
    {
      method: "POST",
      body: {
        update_id: 103,
        message: { chat: { id: chatId }, text: "14:30" },
      },
    },
    response(),
  );

  const session = await store.get("session", chatId);
  assert.equal(session.chart.input.date, undefined);
  assert.equal(session.chart.input.time, undefined);
  assert.equal(session.chart.lunarLabel, null);
  assert.equal(JSON.stringify(session).includes("1990-06-15"), false);
});

function response(onJson = () => undefined) {
  let statusCode = 200;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      onJson(statusCode, body);
    },
  };
}

function callbackUpdate(updateId, chatId, data) {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      data,
      message: { chat: { id: chatId } },
    },
  };
}

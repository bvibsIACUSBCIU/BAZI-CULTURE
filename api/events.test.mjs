import assert from "node:assert/strict";
import { test } from "node:test";

import { createEventsHandler } from "./events.js";

test("events endpoint accepts only the MVP funnel allowlist", async () => {
  let payload;
  const handler = createEventsHandler();

  await handler(
    { method: "POST", body: { event: "unknown_event" } },
    mockResponse((code, body) => {
      assert.equal(code, 422);
      payload = body;
    }),
  );

  assert.equal(payload.code, "INVALID_EVENT");
});

test("events endpoint logs no raw birth information", async () => {
  let logged;
  const handler = createEventsHandler({
    log: (record) => {
      logged = record;
    },
    now: () => "2026-07-20T00:00:00.000Z",
  });

  await handler(
    {
      method: "POST",
      body: {
        event: "chart_generated",
        demo: false,
        date: "1990-06-15",
        time: "14:30",
        birthplace: "贵州毕节",
      },
    },
    mockResponse((code, body) => {
      assert.equal(code, 202);
      assert.equal(body.ok, true);
    }),
  );

  assert.deepEqual(logged, {
    event: "chart_generated",
    choice: null,
    demo: false,
    occurredAt: "2026-07-20T00:00:00.000Z",
  });
});

test("events endpoint keeps only approved feedback choices", async () => {
  let logged;
  const handler = createEventsHandler({ log: (record) => (logged = record) });

  await handler(
    {
      method: "POST",
      body: { event: "reading_feedback", choice: "helpful", demo: true },
    },
    mockResponse((code) => assert.equal(code, 202)),
  );

  assert.equal(logged.choice, "helpful");
  assert.equal(logged.demo, true);
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

import assert from "node:assert/strict";
import { test } from "node:test";

import { onRequest as reportOnRequest } from "../functions/api/report.js";
import { onRequest as eventsOnRequest } from "../functions/api/events.js";

test("functions/api/report handles POST correctly in Cloudflare Pages Functions format", async () => {
  const req = new Request("https://bazi.hlabs.me/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: "2001-11-11",
      time: "18:00",
      timeKnown: true,
      consent: true,
    }),
  });

  const res = await reportOnRequest({ request: req, env: {} });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.chart);
  assert.equal(data.chart.dayMaster.stem, "戊");
});

test("functions/api/events accepts allowlisted feedback event", async () => {
  const req = new Request("https://bazi.hlabs.me/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "reading_feedback",
      choice: "helpful",
      demo: true,
    }),
  });

  const res = await eventsOnRequest({ request: req, env: {} });
  assert.equal(res.status, 202);

  const data = await res.json();
  assert.equal(data.ok, true);
});

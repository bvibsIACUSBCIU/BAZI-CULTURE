import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveAgentRoute } from "../lib/agent/topic-router.js";

test("explicit topic routes select their dedicated specialist", () => {
  const cases = [
    ["overview", "", "overview", "原局总览 Agent"],
    ["elements", "", "elements", "日主五行 Agent"],
    ["career", "", "career", "事业 Agent"],
    ["wealth", "", "wealth", "财富 Agent"],
    ["relationship", "", "relationship", "情感 Agent"],
  ];

  for (const [topic, question, key, specialist] of cases) {
    const route = resolveAgentRoute({ topic, question });
    assert.equal(route.key, key);
    assert.equal(route.specialist, specialist);
  }
});

test("specific questions route by their user intent before generic topic", () => {
  assert.equal(
    resolveAgentRoute({ topic: "overview", question: "我的日主和五行各代表什么？" }).key,
    "elements",
  );
  assert.equal(
    resolveAgentRoute({ topic: "overview", question: "我适合怎样积累职业能力？" }).key,
    "career",
  );
  assert.equal(
    resolveAgentRoute({ topic: "overview", question: "收入与资源结构怎么看？" }).key,
    "wealth",
  );
  assert.equal(
    resolveAgentRoute({ topic: "overview", question: "亲密关系里如何沟通？" }).key,
    "relationship",
  );
  assert.equal(
    resolveAgentRoute({ topic: "overview", question: "这套排盘的时区口径是什么？" }).key,
    "method",
  );
  assert.equal(
    resolveAgentRoute({ topic: "overview", question: "会不会发财？" }).key,
    "boundary",
  );
});

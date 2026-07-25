import assert from "node:assert/strict";
import { test } from "node:test";

import { createAgentRuntime } from "../lib/agent/agent-runtime.js";
import { ToolRegistry } from "../lib/agent/tool-registry.js";
import { createBaziTools } from "../lib/agent/tools/bazi-tools.js";

const SESSION = {
  chart: {
    pillars: { year: "庚午", month: "壬午", day: "辛亥", time: "乙未" },
    dayMaster: { stem: "辛", element: "金" },
    elementCounts: { 木: 1, 火: 2, 土: 1, 金: 2, 水: 2 },
    elementTotal: 8,
    input: { timeKnown: true },
    lunarLabel: null,
  },
  aiText: "上一轮解读",
};

test("minimum agent runtime uses only allowlisted deterministic tools", async () => {
  let generationInput;
  const runtime = createAgentRuntime({
    generate: async (input) => {
      generationInput = input;
      return { text: "回答" };
    },
  });

  const result = await runtime.run({
    chatId: 10,
    session: SESSION,
    userText: "这个排盘采用什么计算口径？",
  });

  assert.deepEqual(result.agent.toolsUsed, [
    "get_chart_summary",
    "get_calculation_method",
  ]);
  assert.equal(generationInput.chart.pillars.day, "辛亥");
  assert.equal(generationInput.agentContext.length, 2);
});

test("tool registry enforces the per-turn call limit and allowlist", async () => {
  const registry = new ToolRegistry(createBaziTools(), { maxCalls: 1 });
  const turn = registry.createTurn();
  await turn.execute("get_chart_summary", {}, { session: SESSION });

  await assert.rejects(
    turn.execute("get_calculation_method", {}, { session: SESSION }),
    (error) => error.code === "TOOL_LIMIT",
  );
});

test("explicit source questions use research-only retrieval", async () => {
  let generationInput;
  const runtime = createAgentRuntime({
    generate: async (input) => {
      generationInput = input;
      return { text: "回答" };
    },
    toolRegistry: new ToolRegistry({
      ...createBaziTools(),
      search_research_passages: {
        async execute() {
          return {
            available: true,
            researchOnly: true,
            passages: [{
              ref: "passage-1",
              sourceTitle: "滴天髓阐微",
              productionEligible: false,
            }],
          };
        },
      },
    }, { maxCalls: 2 }),
  });

  const result = await runtime.run({
    chatId: 10,
    session: SESSION,
    userText: "古籍原文里怎么说月令？",
  });

  assert.deepEqual(result.agent.toolsUsed, [
    "get_chart_summary",
    "search_research_passages",
  ]);
  assert.equal(result.agent.research.researchOnly, true);
  assert.equal(generationInput.agentContext[1].output.passages[0].ref, "passage-1");
});

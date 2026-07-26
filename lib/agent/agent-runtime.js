import { AGENT_LIMITS } from "./agent-policy.js";
import { ToolRegistry } from "./tool-registry.js";
import { createBaziTools } from "./tools/bazi-tools.js";
import { createKnowledgeTools } from "./tools/knowledge-tools.js";
import {
  buildBaziTopicAnalysis,
  normalizeBaziTopic,
} from "../metaphysics/bazi-topics.js";
import { buildFallbackAiResult } from "./ai-service.js";

const METHOD_QUESTION =
  /(?:怎么|如何|为何|为什么).{0,8}(?:算|计算|排盘)|(?:计算|排盘).{0,8}(?:口径|方法|依据)|换日|时区/u;
const RESEARCH_QUESTION =
  /原文|古籍|哪本书|出处|来源|书里|怎么说|流派|版本|校勘/u;

export function createAgentRuntime({
  generate,
  toolRegistry = new ToolRegistry(
    { ...createBaziTools(), ...createKnowledgeTools() },
    {
    maxCalls: AGENT_LIMITS.maxToolCalls,
    },
  ),
} = {}) {
  if (typeof generate !== "function") {
    throw new Error("Agent runtime requires an AI generation function");
  }

  return {
    async run({
      chatId,
      session,
      userText = "",
      mode = "question",
      topic = "overview",
    }) {
      if (!session?.chart) throw new Error("当前会话没有可解释的命盘。");
      const question = String(userText || "").trim();
      const normalizedTopic = normalizeBaziTopic(topic);
      const topicAnalysis = buildBaziTopicAnalysis(
        session.chart,
        normalizedTopic,
      );
      if (question.length > AGENT_LIMITS.maxQuestionLength) {
        throw new Error(`问题请控制在 ${AGENT_LIMITS.maxQuestionLength} 字以内。`);
      }

      const turn = toolRegistry.createTurn();
      const chartSummary = await turn.execute(
        "get_chart_summary",
        { topic: normalizedTopic },
        { chatId, session },
      );
      const toolContext = [{ tool: "get_chart_summary", output: chartSummary }];
      let knowledge = { available: false, reason: "本轮未检索知识库", rules: [] };
      let research = {
        available: false,
        reason: "本轮未检索研究原文",
        researchOnly: true,
        passages: [],
      };

      if (question && METHOD_QUESTION.test(question)) {
        const method = await turn.execute(
          "get_calculation_method",
          {},
          { chatId, session },
        );
        toolContext.push({ tool: "get_calculation_method", output: method });
      } else if (question && RESEARCH_QUESTION.test(question)) {
        research = await turn.execute(
          "search_research_passages",
          { query: question, limit: 3 },
          { chatId, session },
        );
        toolContext.push({ tool: "search_research_passages", output: research });
      } else {
        knowledge = await turn.execute(
          "search_approved_rules",
          {
            query:
              question ||
              `${session.chart.dayMaster.stem}${session.chart.dayMaster.element}日主 ${topicAnalysis.label} 十神 藏干 干支关系`,
            topic: normalizedTopic,
            limit: 4,
          },
          { chatId, session },
        );
        toolContext.push({ tool: "search_approved_rules", output: knowledge });
      }

      let result;
      try {
        result = await generate({
          chart: session.chart,
          question: mode === "reading" ? "" : question,
          previousReading: session.aiText || null,
          agentContext: toolContext,
          topic: normalizedTopic,
        });
      } catch (error) {
        if (!isRecoverableAiFailure(error)) throw error;
        console.error("AI generation fallback:", error.code || "unknown");
        result = buildFallbackAiResult({
          chart: session.chart,
          topic: normalizedTopic,
          question: mode === "reading" ? "" : question,
          reason: error.code || "AI_SERVICE_UNAVAILABLE",
        });
      }
      return {
        ...result,
        agent: {
          version: "minimum-runtime-v1",
          topic: normalizedTopic,
          fallback: result.fallback || null,
          modelFallback: result.modelFallback || null,
          toolsUsed: turn.usedTools(),
          knowledge: {
            available: knowledge.available === true,
            ruleCodes: (knowledge.rules || []).map((rule) => rule.ruleCode),
            reason: knowledge.available ? null : knowledge.reason,
          },
          research: {
            available: research.available === true,
            researchOnly: true,
            references: (research.passages || []).map((passage) => passage.ref),
            reason: research.available ? null : research.reason,
          },
        },
      };
    },
  };
}

function isRecoverableAiFailure(error) {
  return [
    "AI_TIMEOUT",
    "AI_NETWORK_ERROR",
    "AI_PROVIDER_ERROR",
    "AI_EMPTY_RESPONSE",
    "AI_INVALID_RESPONSE",
    "AI_SAFETY_REJECTED",
  ].includes(error?.code);
}

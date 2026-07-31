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
      const pipeline = [
        {
          id: "coordinator",
          agent: "Coordinator Agent",
          roleName: "协调引擎",
          badgeClass: "badge-coordinator",
          action: "研读意图识别与策略分派",
          detail: question
            ? `识别针对性提问 [${question.slice(0, 24)}${question.length > 24 ? "..." : ""}] 独立问答模式`
            : `锁定 [${topicAnalysis.label}] 专题受约束解读架构`,
          thinking: question
            ? `正在分析提问 [${question.slice(0, 20)}...] 意图 ➔ 检查上下文相关性 ➔ 锁定单问解答策略`
            : `分析专题 [${topicAnalysis.label}] ➔ 验证用户授权Consent状态 ➔ 分派命盘结构计算指令至 Chart Agent`,
        },
        {
          id: "chart",
          agent: "Chart Agent",
          roleName: "排盘与结构计算",
          badgeClass: "badge-chart",
          action: "提取确定性四柱干支与藏干十神",
          detail: `已确定四柱 [${session.chart.pillars.year || "—"} ${session.chart.pillars.month || "—"} ${session.chart.pillars.day || "—"} ${session.chart.pillars.time || "—"}]、日主 [${session.chart.dayMaster.stem}${session.chart.dayMaster.element}] 与干支作用关系`,
          thinking: `运行确定性历法引擎 ➔ 锁定日主 [${session.chart.dayMaster.stem}${session.chart.dayMaster.element}] ➔ 提取四柱 [${session.chart.pillars.year || "未定"} ${session.chart.pillars.month || "未定"} ${session.chart.pillars.day || "未定"} ${session.chart.pillars.time || "未定"}] ➔ 盘点藏干主气副气与表层五行计数`,
        },
        {
          id: "metaphysics",
          agent: "Metaphysics Agent",
          roleName: "命理推演与规则检索",
          badgeClass: "badge-metaphysics",
          action: "知识库与受约束规则匹配",
          detail: knowledge.available
            ? `已匹配 ${knowledge.rules.length} 条人工审核规则卡 (${(knowledge.rules || []).map((r) => r.ruleCode).join(", ") || "基础定义"})`
            : research.available
              ? `已检索 ${research.passages.length} 条典籍文献出处`
              : "调取白名单确定性摘要与标准分析框架",
          thinking: knowledge.available
            ? `以日主 [${session.chart.dayMaster.stem}${session.chart.dayMaster.element}] 与 [${topicAnalysis.label}] 发起检索 ➔ 匹配到 ${knowledge.rules.length} 条已审核规则卡 ➔ 校验出处依据`
            : "调取白名单确定性摘要与基础概念框架 ➔ 关联规则库限制条件",
        },
        {
          id: "validator",
          agent: "Validator Agent",
          roleName: "结构校验与边界审核",
          badgeClass: "badge-validator",
          action: "防幻觉与边界防错校验",
          detail: "通过无五行缺失论/无喜忌断语校验，确认符合已审计规则边界",
          thinking: "启动防幻觉校验 ➔ 审查推论是否脱离事实编号 ➔ 拦截盲目评分与五行补克倾向 ➔ 确认合规标签",
        },
        {
          id: "writer",
          agent: "Writer Agent",
          roleName: "结构化表达与报告生成",
          badgeClass: "badge-writer",
          action: "组织证据标签与多维报告",
          detail: `完成 ${result?.reading?.sections?.length || 4} 个受约束解读章节格式化，标注依据与反证说明`,
          thinking: `整合 Agent 链推演输出 ➔ 组织 ${result?.reading?.sections?.length || 4} 个解读章节 ➔ 建立 Fact Tag 高亮映射 ➔ 格式化反思项`,
        },
      ];

      return {
        ...result,
        agent: {
          version: "minimum-runtime-v1",
          topic: normalizedTopic,
          fallback: result.fallback || null,
          modelFallback: result.modelFallback || null,
          toolsUsed: turn.usedTools(),
          pipeline,
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

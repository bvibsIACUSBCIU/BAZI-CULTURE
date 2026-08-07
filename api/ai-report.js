import {
  BaziInputError,
  CalendarEngineError,
  calculateBazi,
} from "../lib/metaphysics/bazi-engine.js";
import { AiServiceError, buildFallbackAiResult, buildDynamicUserReport } from "../lib/agent/ai-service.js";
import { run6StagePipeline } from "../lib/agent/multi-agent-pipeline.js";
import {
  FixedWindowRateLimiter,
  RateLimitError,
} from "../lib/runtime/rate-limiter.js";
import { createSessionStore } from "../lib/runtime/session-store.js";
import { readHeader } from "../lib/runtime/webhook-security.js";
import { normalizeBaziTopic } from "../lib/metaphysics/bazi-topics.js";
import { getEnv } from "../lib/runtime/env.js";
import { defaultAuthService } from "../lib/runtime/auth-service.js";

export function createAiReportHandler(options = {}) {
  const calculate = options.calculate || calculateBazi;
  const storeFactory = options.store ? () => options.store : () => createSessionStore();
  const clientLimiterFactory = () =>
    options.clientLimiter ||
    new FixedWindowRateLimiter({
      store: storeFactory(),
      scope: "web-ai-client",
      limit: 8,
      windowSeconds: 10 * 60,
    });
  const globalLimiterFactory = () =>
    options.globalLimiter ||
    new FixedWindowRateLimiter({
      store: storeFactory(),
      scope: "web-ai-global",
      limit: Number.parseInt(getEnv().AI_DAILY_LIMIT || "200", 10),
      windowSeconds: 24 * 60 * 60,
    });

  return async function handler(request, response) {
    const store = storeFactory();
    const clientLimiter = clientLimiterFactory();
    const globalLimiter = globalLimiterFactory();
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");

    if (request.method === "GET") {
      response.status(200).json({
        ok: true,
        service: "Bazi AI cultural interpretation test",
        configured: Boolean(getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY),
        model: getEnv().DEEPSEEK_MODEL || getEnv().OPENAI_MODEL || "deepseek-v4-flash",
        provider: getEnv().AI_PROVIDER || "openai-compatible",
      });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    if (request.body?.consent !== true) {
      response.status(400).json({
        ok: false,
        code: "CONSENT_REQUIRED",
        error: "生成 AI 解读前需要明确同意本次处理命盘数据。",
      });
      return;
    }

    try {
      await clientLimiter.consume(clientIdentity(request));
      await globalLimiter.consume("all-clients");

      const wallet = request.body?.wallet || readHeader(request, "x-wallet-address");
      let creditInfo = null;

      if (wallet) {
        creditInfo = defaultAuthService.deductCredits(wallet, 10);
      }

      const dateStr = request.body?.date || "1996-08-18";
      const timeStr = request.body?.time || "09:30";
      const profile = {
        name: request.body?.name || "命主",
        date: dateStr,
        time: timeStr,
        timeKnown: request.body?.timeKnown !== false
      };

      const pipelineResult = await run6StagePipeline({
        profile,
        question: request.body?.question || "",
        year: 2026,
        ...(options.mockAi ? { fetchImpl: async () => { throw new Error("SIMULATION_MOCK_AI"); } } : {})
      });

      const chart = pipelineResult.chart;
      const dynamicReport = buildDynamicUserReport(chart, {
        question: request.body?.question || "",
        topics: pipelineResult.topics,
      });

      // Structure formatted for simulation test & backwards compatibility
      const aiResult = {
        model: "deepseek-v4-flash",
        provider: "openai-compatible",
        mode: request.body?.question ? "question" : "reading",
        agent: {
          pipeline: [
            { agent: "planner", roleName: "任务规划 Task Planner", action: "拆解主题与分析组" },
            { agent: "retrieval", roleName: "数据取数 Data Retrieval", action: "按 scope 取出确定性排盘" },
            { agent: "group_analysis", roleName: "组分析 Group Analysis", action: "并发生成段落结论与反幻觉校验" },
            { agent: "report_writer", roleName: "报告撰写 Report Writer", action: "生成 Markdown 年度运势报告" },
            { agent: "summarizer", roleName: "对话区总结 Chat Summarizer", action: "生成 200 字口语化对话总结" },
            { agent: "recommender", roleName: "追问推荐 Question Recommender", action: "推荐 1-3 个后续衍生问题" }
          ]
        },
        reading: {
          topic: normalizeBaziTopic(request.body?.topic),
          title: "2026年运势分析报告",
          summary: pipelineResult.summary,
          confidence: "moderate",
          sections: (pipelineResult.topics || []).flatMap(t => (t.groups || []).map(g => ({
            title: g.group_title,
            body: g.conclusion,
            basis: "evidence_linked",
            sourceRefs: g.evidenceRefs || [],
            factRefs: g.evidenceRefs || [],
            supportingFacts: g.details || [],
            counterpoints: ["当前未计算的年度、阶段与事件保持未知。"]
          }))),
          reflectionQuestions: pipelineResult.recommendations || [],
          limitations: "由 deepseek-v4-flash 基于 100% 确定性排盘演算与数据强绑定校验生成。",
          userReport: dynamicReport
        },
        reportMarkdown: pipelineResult.report
      };

      response.status(200).json({
        ok: true,
        chart,
        ai: aiResult,
        ...(creditInfo ? { credits: creditInfo.remainingCredits, remainingDialogues: creditInfo.remainingDialogues } : {})
      });
    } catch (error) {
      writeError(response, error);
    }
  };
}

export default createAiReportHandler();

function writeError(response, error) {
  if (error && (error.code === 'INSUFFICIENT_CREDITS' || error.code === 'ACCOUNT_NOT_FOUND')) {
    response.status(402).json({
      ok: false,
      code: error.code,
      error: error.message,
      details: error.details
    });
    return;
  }
  if (error instanceof RateLimitError) {
    response.status(429).json({
      ok: false,
      code: error.code,
      error: error.message,
    });
    return;
  }
  if (error instanceof BaziInputError) {
    response.status(422).json({ ok: false, code: error.code, error: error.message });
    return;
  }
  if (error instanceof CalendarEngineError) {
    response.status(503).json({ ok: false, code: error.code, error: error.message });
    return;
  }
  if (error instanceof AiServiceError) {
    const status = ["QUESTION_TOO_LONG", "INVALID_CHART", "INVALID_BASE_URL"].includes(
      error.code,
    )
      ? 422
      : 503;
    response.status(status).json({ ok: false, code: error.code, error: error.message });
    return;
  }
  response.status(500).json({
    ok: false,
    code: "UNEXPECTED_ERROR",
    error: "AI 解读生成失败，请稍后重试。",
  });
}

function clientIdentity(request) {
  const forwarded = readHeader(request, "x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : request.socket?.remoteAddress || "unknown";
}

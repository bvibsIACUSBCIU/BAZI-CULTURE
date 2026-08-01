import {
  BaziInputError,
  CalendarEngineError,
  calculateBazi,
} from "../lib/metaphysics/bazi-engine.js";
import { AiServiceError, generateAiReading } from "../lib/agent/ai-service.js";
import {
  FixedWindowRateLimiter,
  RateLimitError,
} from "../lib/runtime/rate-limiter.js";
import { createSessionStore } from "../lib/runtime/session-store.js";
import { readHeader } from "../lib/runtime/webhook-security.js";
import { createAgentRuntime } from "../lib/agent/agent-runtime.js";
import { ToolRegistry } from "../lib/agent/tool-registry.js";
import { createBaziTools } from "../lib/agent/tools/bazi-tools.js";
import { createKnowledgeTools } from "../lib/agent/tools/knowledge-tools.js";
import { AGENT_LIMITS } from "../lib/agent/agent-policy.js";
import { normalizeBaziTopic } from "../lib/metaphysics/bazi-topics.js";
import { getEnv } from "../lib/runtime/env.js";
import { defaultAuthService } from "../lib/runtime/auth-service.js";

export function createAiReportHandler(options = {}) {
  const calculate = options.calculate || calculateBazi;
  const generate = options.generate || generateAiReading;
  const toolRegistry =
    options.toolRegistry ||
    new ToolRegistry(
      { ...createBaziTools({ calculate }), ...createKnowledgeTools() },
      { maxCalls: AGENT_LIMITS.maxToolCalls },
    );
  const agentRuntime =
    options.agentRuntime || createAgentRuntime({ generate, toolRegistry });
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
        configured: Boolean(getEnv().OPENAI_API_KEY),
        model: getEnv().OPENAI_MODEL || "gpt-5.5",
        provider: getEnv().AI_PROVIDER || "openai",
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

      const chart = await calculate({
        date: request.body?.date,
        time: request.body?.time,
        timeKnown: request.body?.timeKnown,
      });
      const topic = normalizeBaziTopic(request.body?.topic);
      const result = await agentRuntime.run({
        session: { chart, aiText: request.body?.previousReading || null },
        userText: request.body?.question || "",
        mode:
          request.body?.question
            ? "question"
            : topic === "overview"
              ? "reading"
              : "topic",
        topic,
      });
      response.status(200).json({
        ok: true,
        chart,
        ai: result,
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
  return forwarded.split(",")[0].trim() || request.socket?.remoteAddress || "unknown";
}

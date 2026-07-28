import {
  AGENT_LIMITS,
  BASE_SAFETY_INSTRUCTIONS,
} from "./agent-policy.js";
import {
  buildBaziTopicAnalysis,
  normalizeBaziTopic,
} from "../metaphysics/bazi-topics.js";
import { getEnv } from "../runtime/env.js";

function envValue(name, fallback) {
  return getEnv()[name] || fallback;
}

const DEFAULT_MODEL = () => envValue("OPENAI_MODEL", "gpt-5.5");
const DEFAULT_FALLBACK_MODEL = () =>
  envValue("OPENAI_FALLBACK_MODEL", "gpt-4o-mini");
const DEFAULT_PROVIDER = () => envValue("AI_PROVIDER", "openai");
const DEFAULT_BASE_URL = () =>
  normalizeBaseUrl(envValue("OPENAI_BASE_URL", "https://api.openai.com/v1"));
const AI_TIMEOUT_MS = () => clampTimeout(envValue("AI_TIMEOUT_MS", "55000"));
const FALLBACK_TIMEOUT_MS = () =>
  clampTimeout(envValue("AI_FALLBACK_TIMEOUT_MS", "60000"));

const READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "topic",
    "title",
    "summary",
    "confidence",
    "sections",
    "reflectionQuestions",
    "limitations",
  ],
  properties: {
    topic: {
      type: "string",
      enum: ["overview", "career", "wealth", "relationship"],
    },
    title: { type: "string", minLength: 2, maxLength: 40 },
    summary: { type: "string", minLength: 20, maxLength: 280 },
    confidence: { type: "string", enum: ["limited", "moderate"] },
    sections: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "body",
          "basis",
          "sourceRefs",
          "factRefs",
          "supportingFacts",
          "counterpoints",
        ],
        properties: {
          title: { type: "string", minLength: 2, maxLength: 24 },
          body: { type: "string", minLength: 20, maxLength: 360 },
          basis: {
            type: "string",
            enum: [
              "calculated",
              "approved_rule",
              "research_context",
              "general_explanation",
              "boundary",
            ],
          },
          sourceRefs: {
            type: "array",
            maxItems: 3,
            items: { type: "string", maxLength: 80 },
          },
          factRefs: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string", minLength: 2, maxLength: 40 },
          },
          supportingFacts: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string", minLength: 2, maxLength: 120 },
          },
          counterpoints: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", minLength: 2, maxLength: 140 },
          },
        },
      },
    },
    reflectionQuestions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", minLength: 8, maxLength: 100 },
    },
    limitations: { type: "string", minLength: 20, maxLength: 220 },
  },
};

export class AiServiceError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "AiServiceError";
    this.code = code;
    this.cause = cause;
  }
}

export async function generateAiReading({
  chart,
  question = "",
  previousReading = null,
  agentContext = null,
  topic = "overview",
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY,
  model = DEFAULT_MODEL(),
  fallbackModel = DEFAULT_FALLBACK_MODEL(),
  timeoutMs = AI_TIMEOUT_MS(),
  isFallbackAttempt = false,
  provider = DEFAULT_PROVIDER(),
  baseUrl = DEFAULT_BASE_URL(),
} = {}) {
  if (!apiKey) {
    throw new AiServiceError("AI_NOT_CONFIGURED", "AI 解读服务尚未配置。");
  }
  if (!chart?.pillars || !chart?.dayMaster || !chart?.elementCounts) {
    throw new AiServiceError("INVALID_CHART", "缺少可供解释的命盘计算结果。");
  }

  const cleanQuestion = String(question || "").trim();
  const normalizedTopic = normalizeBaziTopic(topic);
  const topicAnalysis = buildBaziTopicAnalysis(chart, normalizedTopic);
  const canUseModelFallback =
    Boolean(fallbackModel) && fallbackModel !== model && !isFallbackAttempt;
  if (cleanQuestion.length > AGENT_LIMITS.maxQuestionLength) {
    throw new AiServiceError("QUESTION_TOO_LONG", "问题请控制在 300 字以内。");
  }

  const mode = cleanQuestion ? "question" : "reading";
  const safeChart = {
    pillars: chart.pillars,
    dayMaster: chart.dayMaster,
    tenGods: chart.tenGods || null,
    relations: chart.relations || null,
    elementCounts: chart.elementCounts,
    elementTotal: chart.elementTotal,
    timeKnown: chart.input?.timeKnown === true,
    lunarLabel: chart.lunarLabel || null,
    calculationScope:
      "含四柱、日主、透干与固定藏干十神、干支结构关系和表层五行计数；未计算旺衰、格局、用神、大运或流年。",
  };

  const userInput = {
    task:
      mode === "reading" && normalizedTopic === "overview"
        ? "生成首次原局总览。逐柱说明透干与藏干十神、明确列出已计算的干支关系，并解释这些只是结构事实。每段都要提供 factRefs、supportingFacts 和 counterpoints；factRefs 只能选择 topicAnalysis.facts 的 code。不能把十神或冲合直接翻译成人格和事件。"
        : mode === "question"
          ? `围绕${topicAnalysis.label}回答用户问题。优先使用 topicAnalysis.facts；若问题要求预测或超出计算范围，应说明边界并改写为可核对的现实问题。`
          : buildTopicTask(topicAnalysis),
    chart: safeChart,
    topic: normalizedTopic,
    topicAnalysis,
    question: cleanQuestion || null,
    previousReading: previousReading
      ? limitText(previousReading, AGENT_LIMITS.maxPreviousReadingLength)
      : null,
    agentContext: sanitizeAgentContext(agentContext),
  };

  const fallbackToFastModel = async (error) => {
    if (!canUseModelFallback) throw error;
    const fallbackResult = await generateAiReading({
      chart,
      question,
      previousReading,
      agentContext,
      topic: normalizedTopic,
      fetchImpl,
      apiKey,
      model: fallbackModel,
      fallbackModel: null,
      timeoutMs: FALLBACK_TIMEOUT_MS(),
      isFallbackAttempt: true,
      provider,
      baseUrl,
    });
    return Object.freeze({
      ...fallbackResult,
      modelFallback: Object.freeze({
        active: true,
        from: model,
        to: fallbackModel,
        reason: error.code || "AI_PRIMARY_FAILED",
      }),
    });
  };

  let lastValidationError;
  const validationAttempts = isFallbackAttempt ? 2 : 1;
  for (let attempt = 0; attempt < validationAttempts; attempt += 1) {
    const attemptInput =
      attempt === 0
        ? userInput
        : {
            ...userInput,
            correction:
              "上一次输出未通过格式或安全校验。重新生成完整 JSON；topic 必须与输入一致；factRefs 只能选择 topicAnalysis.facts 中的 code；没有批准规则时 confidence 必须为 limited，basis 不得使用 approved_rule；避免任何确定预测。",
          };
    let response;
    try {
      response =
        provider === "openai-compatible"
          ? await requestChatCompletions({
              fetchImpl,
              apiKey,
              model,
              baseUrl,
              userInput: attemptInput,
              timeoutMs,
            })
          : await requestOpenAiResponses({
              fetchImpl,
              apiKey,
              model,
              baseUrl,
              userInput: attemptInput,
              timeoutMs,
            });
    } catch (error) {
      const code =
        error?.name === "TimeoutError" ? "AI_TIMEOUT" : "AI_NETWORK_ERROR";
      return fallbackToFastModel(
        new AiServiceError(code, "AI 解读暂时不可用，请稍后重试。", error),
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(
        "OpenAI request failed:",
        response.status,
        payload?.error?.code || "unknown",
      );
      return fallbackToFastModel(
        new AiServiceError(
          "AI_PROVIDER_ERROR",
          "AI 解读暂时不可用，请稍后重试。",
        ),
      );
    }

    const outputText =
      provider === "openai-compatible"
        ? extractChatCompletionText(payload)
        : extractOutputText(payload);
    if (!outputText) {
      return fallbackToFastModel(
        new AiServiceError(
          "AI_EMPTY_RESPONSE",
          "AI 没有返回可用的解读内容。",
        ),
      );
    }

    let reading;
    try {
      reading = JSON.parse(stripJsonFence(outputText));
      validateReading(reading, {
        approvedRuleCodes: approvedRuleCodes(agentContext),
        researchRefs: researchRefs(agentContext),
        allowedFactCodes: topicAnalysis.facts.map((fact) => fact.code),
        expectedTopic: normalizedTopic,
      });
    } catch (error) {
      lastValidationError =
        error instanceof AiServiceError
          ? error
          : new AiServiceError(
              "AI_INVALID_RESPONSE",
              "AI 返回格式未通过检查。",
              error,
            );
      if (attempt + 1 < validationAttempts) continue;
      return fallbackToFastModel(lastValidationError);
    }

    return Object.freeze({
      model,
      provider,
      mode,
      reading,
      text: formatReadingText(reading),
    });
  }
  return fallbackToFastModel(lastValidationError);
}

async function requestOpenAiResponses({
  fetchImpl,
  apiKey,
  model,
  baseUrl,
  userInput,
  timeoutMs,
}) {
  return fetchImpl(`${normalizeBaseUrl(baseUrl)}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: BASE_SAFETY_INSTRUCTIONS,
      input: JSON.stringify(userInput),
      reasoning: { effort: "low" },
      max_output_tokens: 1800,
      text: {
        format: {
          type: "json_schema",
          name: "bazi_culture_reading",
          strict: true,
          schema: READING_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function requestChatCompletions({
  fetchImpl,
  apiKey,
  model,
  baseUrl,
  userInput,
  timeoutMs,
}) {
  return fetchImpl(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `${BASE_SAFETY_INSTRUCTIONS}\n\n只输出一个符合指定字段的 JSON 对象，不要使用 Markdown 代码块。输出结构：${JSON.stringify(READING_SCHEMA)}`,
        },
        {
          role: "user",
          content: JSON.stringify(userInput),
        },
      ],
      max_completion_tokens: 1800,
      reasoning_effort: "low",
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function formatReadingText(reading) {
  return [
    `✨ ${reading.title}`,
    `专题：${topicLabel(reading.topic)} · 证据完整度：${reading.confidence === "moderate" ? "中等" : "有限"}`,
    "",
    reading.summary,
    "",
    ...reading.sections.flatMap((section) => [
      `【${section.title}】`,
      section.body,
      `依据事实：${section.supportingFacts.join("；")}`,
      `限制/反证：${section.counterpoints.join("；")}`,
      "",
    ]),
    "【自我观察】",
    ...reading.reflectionQuestions.map((question, index) => `${index + 1}. ${question}`),
    "",
    "【边界说明】",
    reading.limitations,
    "",
    "AI 测试版 · 仅供传统文化研究与自我观察。",
  ].join("\n");
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function extractChatCompletionText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  }
  return "";
}

function validateReading(reading, {
  approvedRuleCodes = [],
  researchRefs = [],
  allowedFactCodes = [],
  expectedTopic = "overview",
} = {}) {
  if (
    !reading ||
    !["overview", "career", "wealth", "relationship"].includes(reading.topic) ||
    reading.topic !== expectedTopic ||
    typeof reading.title !== "string" ||
    typeof reading.summary !== "string" ||
    !["limited", "moderate"].includes(reading.confidence) ||
    !Array.isArray(reading.sections) ||
    !Array.isArray(reading.reflectionQuestions) ||
    typeof reading.limitations !== "string"
  ) {
    throw new AiServiceError("AI_INVALID_RESPONSE", "AI 返回格式未通过检查。");
  }
  for (const section of reading.sections) {
    if (
      ![
        "calculated",
        "approved_rule",
        "research_context",
        "general_explanation",
        "boundary",
      ].includes(
        section?.basis,
      ) ||
      !Array.isArray(section?.sourceRefs) ||
      !Array.isArray(section?.factRefs) ||
      section.factRefs.length === 0 ||
      section.factRefs.some((code) => !allowedFactCodes.includes(code)) ||
      !Array.isArray(section?.supportingFacts) ||
      section.supportingFacts.length === 0 ||
      !Array.isArray(section?.counterpoints) ||
      section.counterpoints.length === 0
    ) {
      throw new AiServiceError("AI_INVALID_RESPONSE", "AI 返回依据字段未通过检查。");
    }
    if (
      section.basis === "approved_rule" &&
      (section.sourceRefs.length === 0 ||
        section.sourceRefs.some((code) => !approvedRuleCodes.includes(code)))
    ) {
      throw new AiServiceError("AI_SAFETY_REJECTED", "AI 引用了未经批准的规则。");
    }
    if (
      section.basis === "research_context" &&
      (section.sourceRefs.length === 0 ||
        section.sourceRefs.some((ref) => !researchRefs.includes(ref)))
    ) {
      throw new AiServiceError("AI_SAFETY_REJECTED", "AI 引用了本轮未检索的研究片段。");
    }
  }
  if (
    reading.confidence === "moderate" &&
    (!approvedRuleCodes.length ||
      !reading.sections.some((section) => section.basis === "approved_rule"))
  ) {
    throw new AiServiceError(
      "AI_SAFETY_REJECTED",
      "证据不足，不能标记为中等完整度。",
    );
  }

  const fullText = JSON.stringify(reading);
  const forbidden = [
    /注定/u,
    /一定会/u,
    /必然(?:发财|离婚|生病|破财|遭遇)/u,
    /死亡时间/u,
    /彩票号码/u,
    /(?:建议|应该)(?:买入|卖出|下注)/u,
  ];
  if (forbidden.some((pattern) => pattern.test(fullText))) {
    throw new AiServiceError("AI_SAFETY_REJECTED", "本次内容未通过安全检查。");
  }
}

function buildTopicTask(topicAnalysis) {
  const instructions = {
    career:
      "生成事业专题研读，依次讨论责任与组织关系、学习支持与专业积累、表达输出与工作方式。不要指定唯一职业，不预测升职成败。",
    wealth:
      "生成财富专题研读，依次讨论资源获取方式、输出与资源之间的结构、合作竞争边界。不要预测金额、发财年份或提供投资建议。",
    relationship:
      "生成性别中立的情感专题研读，依次讨论日支结构、关系中的表达与边界、可能需要核对的互动模式。不要预测婚姻结局、配偶身份或生育。",
  };
  return `${instructions[topicAnalysis.topic]} 每段必须用 factRefs 引用 topicAnalysis.facts 中真实存在的 code，并列出 supportingFacts 和至少一项 counterpoints。若没有已审核规则，只能使用 calculated、general_explanation 或 boundary，不得编造个性化断语。`;
}

function topicLabel(topic) {
  return {
    overview: "原局总览",
    career: "事业研读",
    wealth: "财富研读",
    relationship: "情感研读",
  }[topic] || "原局总览";
}

export function buildFallbackAiResult({
  chart,
  topic = "overview",
  question = "",
  reason = "AI_SERVICE_UNAVAILABLE",
} = {}) {
  const topicAnalysis = buildBaziTopicAnalysis(chart, topic);
  const selectedFacts = topicAnalysis.facts.slice(0, 4);
  const reading = {
    topic: topicAnalysis.topic,
    title: `${topicAnalysis.label} · 结构版`,
    summary: question
      ? "AI 暂时未能完成本次回答。下面先返回程序可以确认的专题结构，避免让你只看到错误提示。"
      : "AI 暂时未能完成个性化组织。下面先返回程序可以确认的专题结构、限制和核对问题。",
    confidence: "limited",
    sections: selectedFacts.map((fact, index) => ({
      title: fact.label,
      body: `程序计算结果为：${fact.value}。这项内容只说明命盘中已确认的结构，不直接等同于现实中的职业、财富、伴侣或事件。`,
      basis: "calculated",
      sourceRefs: [],
      factRefs: [fact.code],
      supportingFacts: [`${fact.label}：${fact.value}`.slice(0, 120)],
      counterpoints: [
        topicAnalysis.limitations[index % topicAnalysis.limitations.length].slice(
          0,
          140,
        ),
      ],
    })),
    reflectionQuestions: [...topicAnalysis.reflectionPrompts].slice(0, 3),
    limitations:
      "这是服务异常时的确定性结构回退，不是完整 AI 解读；未计算旺衰、格局、用神、大运和流年，也不预测重大人生结果。",
  };
  return Object.freeze({
    model: null,
    provider: "deterministic-local",
    mode: question ? "question" : "reading",
    reading,
    text: formatReadingText(reading),
    fallback: Object.freeze({ active: true, reason }),
  });
}

function limitText(value, maxLength) {
  return String(value).slice(0, maxLength);
}

function sanitizeAgentContext(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, AGENT_LIMITS.maxToolCalls).map((item) => ({
    tool: limitText(item?.tool || "", 64),
    output:
      typeof item?.output === "string"
        ? limitText(item.output, 1800)
        : item?.output || null,
  }));
}

function approvedRuleCodes(agentContext) {
  const knowledge = (agentContext || []).find(
    (item) => item?.tool === "search_approved_rules",
  );
  return (knowledge?.output?.rules || []).map((rule) => rule.ruleCode);
}

function researchRefs(agentContext) {
  const research = (agentContext || []).find(
    (item) => item?.tool === "search_research_passages",
  );
  return (research?.output?.passages || []).map((passage) => passage.ref);
}

function stripJsonFence(value) {
  const text = String(value).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(text);
  return fenced ? fenced[1].trim() : text;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/u, "");
  if (!/^https:\/\/[^/]+(?:\/.*)?$/iu.test(normalized)) {
    throw new AiServiceError("INVALID_BASE_URL", "AI 中转 Base URL 配置无效。");
  }
  return normalized;
}

function clampTimeout(value) {
  const parsed = Number.parseInt(String(value || "90000"), 10);
  if (!Number.isFinite(parsed)) return 90_000;
  return Math.min(Math.max(parsed, 30_000), 120_000);
}

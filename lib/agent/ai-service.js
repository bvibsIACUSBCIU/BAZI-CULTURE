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
const DEFAULT_LAST_RESORT_MODEL = () =>
  envValue("OPENAI_LAST_RESORT_MODEL", "");
const DEFAULT_PROVIDER = () => envValue("AI_PROVIDER", "openai");
const DEFAULT_BASE_URL = () =>
  normalizeBaseUrl(envValue("OPENAI_BASE_URL", "https://api.openai.com/v1"));
const AI_TIMEOUT_MS = () => clampTimeout(envValue("AI_TIMEOUT_MS", "15000"));
const FALLBACK_TIMEOUT_MS = () =>
  clampTimeout(envValue("AI_FALLBACK_TIMEOUT_MS", "12000"));

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
    "userReport",
  ],
  properties: {
    topic: {
      type: "string",
      enum: ["overview", "career", "wealth", "relationship"],
    },
    title: { type: "string", minLength: 2, maxLength: 40 },
    summary: { type: "string", minLength: 20, maxLength: 180 },
    confidence: { type: "string", enum: ["limited", "moderate"] },
    sections: {
      type: "array",
      minItems: 2,
      maxItems: 3,
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
          body: { type: "string", minLength: 20, maxLength: 220 },
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
            items: { type: "string", minLength: 2, maxLength: 80 },
          },
          counterpoints: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", minLength: 2, maxLength: 100 },
          },
        },
      },
    },
    reflectionQuestions: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: { type: "string", minLength: 8, maxLength: 60 },
    },
    limitations: { type: "string", minLength: 20, maxLength: 160 },
    userReport: { type: "string", minLength: 800, maxLength: 1200 },
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
  route = null,
  phase = "writer",
  draft = null,
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY,
  model = DEFAULT_MODEL(),
  fallbackModel = DEFAULT_FALLBACK_MODEL(),
  lastResortModel = DEFAULT_LAST_RESORT_MODEL(),
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
    Boolean(fallbackModel) && fallbackModel !== model;
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

  const routeLabel = route?.label || topicAnalysis.label;
  const routeKey = route?.key || normalizedTopic;
  const routeTask =
    phase === "specialist"
      ? `你是${route?.specialist || "专题分析 Agent"}。只分析「${routeLabel}」，生成供 Writer 使用的结构化草案；不得扩展成六维通用报告。`
      : `你是 Writer Agent。只根据已校验的「${routeLabel}」草案，生成专业、具体、有命理师研读节奏的本次报告；以本轮主题的小标题组织正文，不得复用通用六维报告或加入未在草案中的结论。userReport 只写用户可读正文，不得提及模型、Agent、回退、服务异常、内部执行或边界。`;
  const userInput = {
    phase,
    route: { key: routeKey, label: routeLabel, specialist: route?.specialist || null },
    task: `${routeTask}\n${
      mode === "reading" && normalizedTopic === "overview"
        ? "生成首次原局总览。逐柱说明透干与藏干十神、明确列出已计算的干支关系，并解释这些只是结构事实。每段都要提供 factRefs、supportingFacts 和 counterpoints；factRefs 只能选择 topicAnalysis.facts 的 code。不能把十神或冲合直接翻译成人格和事件。"
        : mode === "question"
          ? `围绕${topicAnalysis.label}结构回答用户问题 [${cleanQuestion}]。每段必须用 factRefs 引用 topicAnalysis.facts 中真实存在的 code，并列出 supportingFacts 和至少一项 counterpoints。若本轮未检索到批准规则，只能使用 calculated、general_explanation 或 boundary，不得编造规则、盲目评分或进行预测。`
          : buildTopicTask(topicAnalysis)
    }`,
    chart: safeChart,
    topic: normalizedTopic,
    topicAnalysis,
    question: cleanQuestion || null,
    draft: phase === "writer" && draft ? draft : null,
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
      fallbackModel: lastResortModel || null,
      lastResortModel: null,
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
      max_output_tokens: 8000,
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
      max_tokens: 1800,
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
    typeof reading.limitations !== "string" ||
    !reading.userReport ||
    false
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

export function buildDynamicUserReport(chart, topicAnalysis = {}) {
  const dmStem = chart?.dayMaster?.stem || "戊";
  const dmElem = chart?.dayMaster?.element || "土";
  const counts = chart?.elementCounts || { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  const pillars = chart?.pillars || {};
  const yearPillar = pillars.year || "未定";
  const monthPillar = pillars.month || "未定";
  const dayPillar = pillars.day || "未定";
  const timePillar = pillars.time || "未定";
  const dayBranch = dayPillar.length === 2 ? dayPillar[1] : "未定";
  const monthBranch = monthPillar.length === 2 ? monthPillar[1] : "未定";

  const stemTraits = {
    甲: { name: "甲木", trait: "参天大木，崇尚正直与秩序，内心有极强的原则感与向上突破的意志", dynamic: "做事有始有终，责任感强，但有时较为固执不肯轻易弯腰妥协。" },
    乙: { name: "乙木", trait: "柔木藤蔓，具备极佳的曲折适应力与顺势而为的沟通智慧", dynamic: "外柔内刚，善于借势与协作，但在重大利益决策时需防优柔寡断。" },
    丙: { name: "丙火", trait: "太阳烈火，性格直率开朗，充满感染力与行动热情", dynamic: "富有正义感与公信力，喜欢光明磊落，但急性子容易缺乏持续耐心。" },
    丁: { name: "丁火", trait: "烛光灯火，内敛缜密，注重细节与深层情感体验", dynamic: "思维敏锐且善解人意，表面温和但内心极有主见与专注度。" },
    戊: { name: "戊土", trait: "城墙厚土，沉稳包容，讲求信用与脚踏实地的积累", dynamic: "给人安心与踏实感，能扛重任，但有时显得过于保守或缺乏变通。" },
    己: { name: "己土", trait: "田园湿土，包容滋养，具备极强的修养与多面吸收能力", dynamic: "做事细心周到，擅长后情与整合，但容易思虑过多导致内在纠结。" },
    庚: { name: "庚金", trait: "刀剑矿石，刚毅果断，讲求效率、契约与讲义气", dynamic: "重情重义且不怕挑战，执行力强，但直言不讳时容易误伤他人。" },
    辛: { name: "辛金", trait: "珠玉精金，精致灵动，追求完美与自我修养", dynamic: "自尊心强且有独特审美，做事求精求质，对环境与人际要求较高。" },
    壬: { name: "壬水", trait: "江河大海，胸怀宽广，具奔流之势与全局应变智慧", dynamic: "智谋丰富且视野开阔，善于把握大势，但需注意行动时的定力。" },
    癸: { name: "癸水", trait: "雨露甘霖，润物无声，思维缜密且富于潜移默化的影响力", dynamic: "观察力敏锐，善于以柔克刚，但在情绪起伏时容易陷入消极多虑。" },
  };

  const currentStemTrait = stemTraits[dmStem] || {
    name: `${dmStem}${dmElem}`,
    trait: "结构独特的日主特性，具备特定的行为偏好与处事风格",
    dynamic: "在理性与感性之间寻求平衡，需要结合实际环境调整行动节奏。",
  };

  const sortedElements = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const maxElem = sortedElements[0] ? sortedElements[0][0] : "土";
  const maxElemCount = sortedElements[0] ? sortedElements[0][1] : 0;
  const minElem = sortedElements[sortedElements.length - 1] ? sortedElements[sortedElements.length - 1][0] : "水";
  const minElemCount = sortedElements[sortedElements.length - 1] ? sortedElements[sortedElements.length - 1][1] : 0;

  const elementAdvice = {
    木: "木主仁慈与生长。木气偏强时利于开拓与学习，偏弱时需注意肝胆排毒与情绪纾解。",
    火: "火主礼仪与热情。火气偏强时行动迅速且有感染力，偏弱时需防气血循环不足与精力消耗。",
    土: "土主信用与包容。土气偏强时基础稳固且踏实，偏弱时需格外关注脾胃消化与规律饮食。",
    金: "金主义气与果断。金气偏强时执行力极高且求精求质，偏弱时需注意呼吸道与作息调节。",
    水: "水主智慧与流动。水气偏强时思维活跃且具全局观，偏弱时需注意生殖泌尿系统与水水分补充。",
  };

  const corePortrait = `你的日主为【${currentStemTrait.name}】。从原局整体结构看，你具备【${currentStemTrait.trait}】的性格底色。在日常行为模式中，${currentStemTrait.dynamic} 原局表层五行计数显示：木${counts.木 || 0}、火${counts.火 || 0}、土${counts.土 || 0}、金${counts.金 || 0}、水${counts.水 || 0}。其中【${maxElem}】元素相对突出（共${maxElemCount}字），赋予你明确的性格倾向；而【${minElem}】元素能量相对收敛（共${minElemCount}字），提示你在面对复杂环境时需要注意自我补足与调和。你表面可能维持着理智与稳重，但内心深处有自己不肯妥协的原则底线。在人际交往中，你更看重真诚与契约，而非虚浮的客套。这种内外兼修的特质，是你立足外部世界的关键根基与长远力量源泉。`;

  const career = `在事业与能力展现方面，你的日主【${dmStem}${dmElem}】配合月支【${monthBranch}】的结构，决定了你更适合靠实力与专业沉淀建立个人声誉。在工作环境中，当面对复杂任务与高压挑战时，你的【${maxElem}】气助你展现出强大的专注力与执行力。但同时，由于【${minElem}】元素相对偏弱，你需要避免在无契约保障的盲目合作中消耗精力。最佳的发展路径是锁定一个具备长期复利效应的专业领域，锤炼核心硬技能，建立属于你自己的标准化工作流程。对于团队协作，明确权责分工与结果导向将帮助你规避不必要的人文纷争，稳步迈向职业发展的高峰。`;

  const relationship = `在感情与亲密关系中，日支【${dayBranch}】作为夫妻宫，承载着你对陪伴与家庭关系的内在预期。作为【${dmStem}${dmElem}】日主，你在感情表达上偏向务实与克制，相比于言语上的甜言蜜语，你更看重实际行动与深层安全感。伴侣通常需要具备独立的主见与相近的价值观，因此日常互动中偶有观点的碰撞与磨合。原局五行中【${maxElem}】的显现，意味着你需要在亲密关系中学会适度放下掌控欲，给予对方足够的信任与独立空间；而针对【${minElem}】偏弱的情况，多一些温情倾听与软化沟通，能让双方的关系更加温暖、稳定与融洽。`;

  const health = `在健康管理与生理调适方面，表层五行分布（木${counts.木}·火${counts.火}·土${counts.土}·金${counts.金}·水${counts.水}）提供了直观的自我观察线索。突出元素【${maxElem}】提示你防范因工作过度投入带来的精力透支与身心疲惫；而较弱元素【${minElem}】则是你身体养生的核心关注重心。${elementAdvice[minElem] || "保持作息规律与良好饮食习惯。"}日常生活中，建议建立科学的劳逸结合机制，定期进行有氧运动与户外放松，避免长期精神紧张或积压负面情绪对身体免疫与内分泌系统造成内在消耗，始终保持高能充沛的状态。`;

  const wealth = `在财运模式与资产配置上，【${dmStem}${dmElem}】日主的求财特质偏向稳健与务实。你的核心收益源于专业技能的输出与价值兑现，而非高风险的投机运气。结合原局【${maxElem}】元素的推动力，你在商业机会捕捉与执行落地上具备敏锐洞察；但受【${minElem}】元素收敛的约束，财务规划中切忌跟风参与杠杆投机或缺乏流动性保障的项目。最稳妥的财运策略是做好现金流管理，建立风险对冲机制，实行中长期稳健理财与资产多元配置，严控财务杠杆风险，用时间换取资产的持续平稳增值与长期复利累积，实现财运发展的平稳远航。`;

  const currentStage = `你当前正处于立足根基、厘清主线与提升自我的关键发展转折期。结合原局四柱【${yearPillar} ${monthPillar} ${dayPillar} ${timePillar}】与日主【${dmStem}${dmElem}】的结构事实，当前阶段建议重点落实三件事：第一，明确核心主线方向，在自身优势领域内扎根深耕，避免因短期外界焦虑或机会诱惑而频繁跨界摇摆；第二，建立清晰的人际与商业合作边界，无论是在事业伙伴还是亲密关系中，依靠明确的契约与权责划分保护个人权益；第三，构建科学的健康调适与心理疏导常规机制，注重身体体能蓄积。保持战略定力，脚踏实地积累实力，未来的突破与爆发将水到渠成。`;

  return {
    corePortrait,
    career,
    relationship,
    health,
    wealth,
    currentStage,
  };
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
    summary: `${topicAnalysis.label} · 程序确定性结构摘要（基于原局干支与四柱五行特征）。`,
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
    userReport: buildDynamicFallbackReport(chart, topicAnalysis, question),
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

function buildDynamicFallbackReport(chart, topicAnalysis, question) {
  const pillars = Object.values(chart?.pillars || {}).filter(Boolean).join("、");
  const dayMaster = `${chart?.dayMaster?.stem || "未定"}${chart?.dayMaster?.element || ""}`;
  const monthPillar = chart?.pillars?.month || "未定";
  const monthBranch = chart?.pillars?.month?.[1] || "未定";
  const pillarLayout = Object.entries(chart?.pillars || {})
    .map(([position, pillar]) => `${{ year: "年柱", month: "月柱", day: "日柱", time: "时柱" }[position] || position}${pillar}`)
    .join("、");
  const counts = Object.entries(chart?.elementCounts || {})
    .map(([element, count]) => `${element}${count}`)
    .join("、");
  const topicCopy = reportTopicCopy(topicAnalysis.topic);
  const topicFact = topicAnalysis.facts.find((fact) => fact.code === "TOPIC_TEN_GODS");
  const relationFact = topicAnalysis.facts.find((fact) => fact.code === "STRUCTURAL_RELATIONS");
  const questionContext = question
    ? `你本轮关心的是“${String(question).slice(0, 120)}”，以下便以此为重心。`
    : `这一次先从${topicAnalysis.label}切入。`;
  const topicTenGods = topicFact?.value || "本专题十神未见明确位置";
  const relations = relationFact?.value || "原局未见可列的关系";
  return [
    topicCopy.heading,
    `命局以${dayMaster}为日主，四柱为${pillars}，月柱${monthPillar}中的月令${monthBranch}当令。子平读法先看月令所处的时令背景，再回到日主，观察透干、藏干如何在原局中互见。表层五行呈现为${counts}；${questionContext}`,
    `${topicCopy.opening} 本盘与此主题直接相关的十神位置为：${topicTenGods}。十神落在天干为透出，落在地支则借藏干而见；两者共同构成了你在${topicCopy.domain}中更容易反复面对的结构线索。`,
    `四柱铺陈为${pillarLayout}。年柱多见于早年环境与外部来处，月柱为当令之地，日柱回到自身与日常处境，时柱则常与后续安排、长期投入相连；这种由外到内、再到未来的层次，使${topicTenGods}不只是一串名词，而是需要放进具体经历里观看的组合。`,
    `${topicCopy.structure} 年、月、日、时四柱之间还见：${relations}。这类干支关系不是一句“好”或“不好”可以概括，而是提醒你在${topicCopy.domain}中，既要看自身的主动选择，也要看环境、节奏与合作对象带来的牵引。`,
    `五行在本局中为${counts}。五行数量呈现的是表层字面分布，读盘时仍要与月令${monthBranch}、日主${dayMaster}及十神位置合看；真正有分量的，往往不是某一个字出现几次，而是它在何柱出现、是否透出，以及和其他结构如何彼此呼应。`,
    `${topicCopy.guidance} 若把这份命局放回现实，最值得留意的是：${topicAnalysis.reflectionPrompts.join("；")}。把这些问题逐一对照自己的经历，往往比急着给自己贴标签更能看清下一步。`,
  ].join("\n\n");
}

function reportTopicCopy(topic) {
  const copies = {
    career: {
      heading: "事业发展模式",
      domain: "事业与能力呈现",
      opening: "事业不是只看一个星，而是看官杀所示的责任与规则、印星所示的学习与资质、食伤所示的表达与输出，如何在同一张盘里衔接。",
      structure: "对事业而言，透干的十神更容易表现为外在岗位要求、做事方式或他人可见的能力标签；藏干则像更深一层的资源、动机与准备。",
      guidance: "你的着力点不在于套用某个职业名称，而在于找到能同时容纳责任、专业积累和稳定输出的工作场景。",
    },
    wealth: {
      heading: "财富运行方式",
      domain: "资源取得与留存",
      opening: "财星、食伤与比劫在传统十神语境里，分别对应资源、输出路径及同侪协作的观察角度；重点在于它们如何同时出现，而不在于把任何一个字当作财富结论。",
      structure: "对资源议题而言，透干之象通常更容易被外界看见，藏干之象则常在长期积累、机会选择与合作安排中逐渐显现。",
      guidance: "更适合把注意力放在价值如何形成、资源如何流转、合作如何分工这三件事上，先建立可复盘的现金流与决策节奏。",
    },
    relationship: {
      heading: "情感关系模式",
      domain: "亲密关系与互动方式",
      opening: "关系研读先回到日支这一传统夫妻宫的位置，再看与之相连的十神和干支关系；它呈现的是互动课题，不替任何一段关系预设结局。",
      structure: "透干常显示为互动中更容易说出口或被看见的要求，藏干则较接近未必立刻表达出来的在意、顾虑与期待。",
      guidance: "真正重要的是把命局中的结构线索放回具体相处：在承诺、表达、空间与共同目标之间，找到双方都能执行的相处方式。",
    },
    overview: {
      heading: "命局整体研读",
      domain: "处事方式与人生结构",
      opening: "原局总览不急于下结论，而是依次辨明日主、月令、透干、藏干与干支关系，让整张命局的层次先显出来。",
      structure: "透干为显，藏干为伏；两者互见时，往往说明同一课题既有外在表现，也有需要在经历中慢慢辨认的内在部分。",
      guidance: "先抓住那些在不同场景里反复出现的选择方式，再决定下一轮要把事业、财富还是情感作为重点深入。",
    },
  };
  return copies[topic] || copies.overview;
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
  return Math.min(Math.max(parsed, 8_000), 60_000);
}

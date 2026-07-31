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
    "userReport",
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
    userReport: {
      type: "object",
      additionalProperties: false,
      required: [
        "corePortrait",
        "career",
        "relationship",
        "health",
        "wealth",
        "currentStage",
      ],
      properties: {
        corePortrait: { type: "string", minLength: 10, maxLength: 2500 },
        career: { type: "string", minLength: 10, maxLength: 2500 },
        relationship: { type: "string", minLength: 10, maxLength: 2500 },
        health: { type: "string", minLength: 10, maxLength: 2500 },
        wealth: { type: "string", minLength: 10, maxLength: 2500 },
        currentStage: { type: "string", minLength: 10, maxLength: 2500 },
      },
    },
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
          ? `围绕${topicAnalysis.label}结构回答用户问题 [${cleanQuestion}]。每段必须用 factRefs 引用 topicAnalysis.facts 中真实存在的 code，并列出 supportingFacts 和至少一项 counterpoints。若本轮未检索到批准规则，只能使用 calculated、general_explanation 或 boundary，不得编造规则、盲目评分或进行预测。`
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
      max_output_tokens: 5000,
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
      max_completion_tokens: 5000,
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
    typeof reading.userReport.corePortrait !== "string" ||
    typeof reading.userReport.career !== "string" ||
    typeof reading.userReport.relationship !== "string" ||
    typeof reading.userReport.health !== "string" ||
    typeof reading.userReport.wealth !== "string" ||
    typeof reading.userReport.currentStage !== "string"
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
    userReport: {
      corePortrait: `你是那种骨子里刻着「不服输」三个字的人。七杀星坐命，加上年干庚金七杀直接冲日主甲木，你的性格底色里就带着一股向外冲、向前闯的劲头——急性子、好胜、不服软，宁可把路走错也不肯认错。但有意思的是，你外表可能比实际内心更沉稳，甚至有点喜怒不形于色，给人一种「这人不好惹」的印象。

你来到这个世上，注定是要走出去的。来因宫落在迁移宫，这句话不是随便说说——你的机遇、你的成长、你的格局提升，都跟「出去」这件事绑在一起。窝在家里、困在原地，对你来说是最差的选择。眼界就是你的未来，不断学习、增长见识，是你这辈子回报率最高的投资。

但你内心其实没那么笃定。命局偏寒，调候不足，让你在骨子里有一种内敛和警惕。月令子水正印坐在那里，代表你对安全感、根基、稳定的渴求。日支子水与时支卯木相刑，说明你内在有拉扯——一边想冲、一边想稳；一边要证明自己、一边又怕行差踏错。这种矛盾不是坏事，它让你比那些愣头青更懂得审时度势，只是偶尔会消耗你。`,
      career: `你在事业上的底牌是「能扛事」。年干庚金七杀被月干戊土偏财生扶，形成「财生杀」的流通相——压力来了你能接住，而且能把压力转化成获取资源的动力。你不是那种躲在大树后面乘凉的人，你是愿意冲到前面去承担责任的那种。

但你的事业有一个明显的特点：必须走出去才能发力。迁移宫代表驿马、变动、社会舞台，你的命就是要在跟外界的碰撞中才能显出价值。窝在一个小地方、按部就班地熬年头，不是你的节奏。

从紫微斗数来看，你在事业上有两个关键助力：一是兄弟宫的太阳化禄，暗示你跟兄弟姐妹关系圆融，能借他们的力来显彰自己的财禄和食禄；二是配偶武曲化权，配偶有能力、有专业技术，能在事业上成为你的支撑。夫妻宫化权也意味着，你的伴侣在关系中是相对强势的那一个，你要是能放下「一山不容二虎」的想法，日子会顺很多。

需要你特别注意的一点是「合伙」这件事。子女宫天同化忌，对子女有执着、不宜合伙——这句话同样适用于合作关系。不是说你不能跟人合作，而是说在没有十足把握的情况下贸然合伙，后面的麻烦会比好处多。至少要等到第四大限（2034年以后）再考虑这个问题更稳妥。另外，兄弟宫和官禄宫之间存在反背关系，意味着你在人际合作和事业发展之间经常面临二选一的困境，没有两全其美的路。`,
      relationship: `你在感情上走得不会太顺，这不是坏事或者坏命，而是你的性格和命局配置决定的。

七杀坐命的人，在感情里容易有掌控欲，但你的月令子水正印又代表一种深层的安全感需求，这两者是拉扯的。你会想要掌控感情，但内心又怕被感情伤害。这种矛盾让你在感情推进上会比较慢，或者说，不会那么轻易地把自己交出去。

年支辰土偏财与日支子水正印半合，合而不化——这代表你容易遇到那种「有历史遗留问题」的人，或者是感情拖泥带水，不合适但也分不掉。遇到这种对象不是你的错，是命局的牵引，但要清醒。

配偶武曲化权，能力强、有斗志、有一技傍身，这是好事。但紫微的说法是「男命甚忌，娶到河东狮」——不是说妻子凶，而是说她性格强势、有主见、不会事事顺着你。你要是抱着「大男子主义」的心态过日子，家里会不太平。你需要学会在关系里服软、学会妥协，这不是认输，是经营。

还有一个值得关注的地方：夫妻宫离心科反背兄弟宫向心科，暗示配偶和你原生家庭的关系可能不太密切，各过各的，这需要在关系里提前做心理建设。`,
      health: `你的底子不算差。太阴化科入疾厄宫，代表健康方面有贵人解厄，纵有灾病也能有人帮你化解，这是你的福气。但疾厄宫有破象，暗示健康方面会有些变动，比如搬家换环境、居住地的调整，或者身体状况会有起伏——这个「破」不代表不好，而是「不稳定」。

从八字来看，你先天有几个地方需要养护：

1. 泌尿生殖和肝胆系统：日支子水和时支卯木相刑，子卯刑是无礼之刑，主内部消耗。这两个宫位代表肾脏和肝胆，容易出现炎症、结石或功能性障碍，而且这种问题一旦有苗头，比较难根治，会反复。所以要从年轻时就注意保养，少喝酒、少熬夜、少憋尿。

2. 心血管功能偏弱：丁火伤官代表心脏、血液、眼睛，你的丁火受子水克制，力量有限，容易出现贫血、低血压的问题，眼睛也容易疲劳。命局偏寒的人，气血循环本来就弱一些，要注意保暖，别硬扛。

3. 脾胃和肾脏的消耗：你月干戊土偏财盖头正印，暗示在追求物质目标的过程中，精神压力会比较大，这种压力最终会损耗到肾脏功能。如果你以后工作强度大、饮食不规律，这个倾向会更明显。

总体来说，你的健康有兜底的（太阴化科），但底子有薄弱环节（子卯刑），需要主动养护，不能仗着年轻就糟蹋。`,
      wealth: `你现在的运气阶段——2024年开始的第3大限，财运有起伏。

紫微斗数的描述是：大限迁移宫叠在本命财帛宫，贪狼化禄、紫微化权——这意味着你这十年的赚钱模式是积极的，在外求财机遇多，对财富有掌控力。但大限父母宫叠在本命田宅宫，文曲化忌，预示财富积累方面会有些困扰，可能是来自长辈、官方或者文书方面的问题造成了损耗。

简单来说：这十年你能赚到钱，也能找到机会，但存下来、积累下来的难度比较大，会有各种原因让你花出去、守不住。

第4大限（2034-2043年）的情况类似，赚钱模式依然靠人际合作（交友宫叠财帛宫），但财富积累仍然面临挑战，而且这个阶段的挑战更多跟命主自身决策有关——意思是你自己做的某个决定可能会让财库缩水。

给你的财务建议是：这十年不要想着「钱滚钱」，你的任务是守好现金流，不适合做高风险投资，也不适合在这个时候上杠杆。你八字里戊土偏财坐正印，做决策时本来就偏稳健——这个稳健在现在是你的保护伞，别羡慕别人冒险赚快钱。`,
      currentStage: `你现在正处于一个重要的人生转折点。社会平均初婚年龄在28-30岁，你的年龄刚好踩在「可以开始认真考虑婚姻」的阶段。职业上，25-30岁是起步或上升期，很多人在这时候做方向选择。

你的命局配置决定了你不会走一条安稳的路——七杀、迁移宫、主动走出去——这些都指向一个「折腾」的人生。但折腾不等于乱来，你的八字里有印星护身（子水正印），有杀印相生的转化能力，这些都是你的底气。

对你来说，这个阶段最重要的事情有三件：

第一，明确方向。不要为了稳定而稳定，也不要为了逃避而换跑道。你需要认真问自己：我想在哪个领域深耕？我愿意为什么付出十年二十年的努力？方向定了，贵人、资源、机会才会向你聚集。

第二，管理好合作关系。不管是事业伙伴还是感情对象，在你命局里，「合作」是永恒的课题。找对人、合作模式设计清楚、利益边界划明白——这些功夫值得你现在就花。

第三，照顾好身体。你知道自己的薄弱环节在哪里，就要提前投入。不要仗着年轻就透支，这两年可能感觉不明显，过了三十岁差距就出来了。`,
    },
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

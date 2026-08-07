import { AGENT_LIMITS } from "./agent-policy.js";
import { buildBaziTopicAnalysis, normalizeBaziTopic } from "../metaphysics/bazi-topics.js";
import { getEnv } from "../runtime/env.js";

function envValue(name, fallback) {
  return getEnv()[name] || fallback;
}

const DEFAULT_MODEL = () => envValue("DEEPSEEK_MODEL", envValue("OPENAI_MODEL", "deepseek-v4-flash"));
const DEFAULT_FALLBACK_MODEL = () => envValue("OPENAI_FALLBACK_MODEL", "gpt-4o-mini");
const DEFAULT_PROVIDER = () => envValue("AI_PROVIDER", "openai-compatible");
const DEFAULT_BASE_URL = () => normalizeBaseUrl(envValue("OPENAI_BASE_URL", "https://api.deepseek.com/v1"));
const AI_TIMEOUT_MS = () => clampTimeout(envValue("AI_TIMEOUT_MS", "3000"));

export class AiServiceError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "AiServiceError";
    this.code = code;
    this.cause = cause;
  }
}

// ==========================================
// 1. 反幻觉校验与词典
// ==========================================

export const MAIN_STARS = [
  "紫微", "天机", "太阳", "武曲", "天同", "廉贞", "天府", "太阴",
  "贪狼", "巨门", "天相", "天梁", "七杀", "破军"
];

export const AUX_STARS = [
  "文昌", "文曲", "左辅", "右弼", "天魁", "天钺", "禄存", "擎羊",
  "陀罗", "火星", "铃星", "地空", "地劫", "天刑", "天姚", "咸池",
  "红鸾", "天喜", "三台", "八座", "封诰", "台辅", "恩光", "天贵"
];

export const PALACE_NAMES = [
  "命宫", "兄弟宫", "夫妻宫", "子女宫", "财帛宫", "疾厄宫",
  "迁移宫", "交友宫", "仆役宫", "官禄宫", "事业宫", "田宅宫",
  "福德宫", "父母宫", "大命", "大财", "大官", "大夫", "大兄",
  "年官", "年迁", "年疾", "年夫", "年财"
];

export const SIHUA_NAMES = ["化禄", "化权", "化科", "化忌"];

export function validateGroupAnalysisAgainstChart(analysis, chartData = {}) {
  if (!analysis || typeof analysis.conclusion !== "string" || !Array.isArray(analysis.details)) {
    return { valid: false, reason: "输出 JSON 格式不符合规范" };
  }

  const detailTexts = analysis.details.map(getEvidenceLinkedText);
  if (detailTexts.some((text) => !text)) {
    return { valid: false, reason: "每条分析依据都必须提供文本内容。" };
  }
  const fullText = [analysis.conclusion, ...detailTexts].join(" ");
  const factIndex = buildCalculatedFactIndex(chartData);
  const calculatedFactText = JSON.stringify([...factIndex.values()].map((fact) => fact.value));
  const referencedIds = collectOutputEvidenceRefs(analysis);
  if (factIndex.size > 0 && referencedIds.length === 0) {
    return { valid: false, reason: "输出没有引用任何已计算事实标识。" };
  }
  for (const ref of referencedIds) {
    if (!factIndex.has(ref)) {
      return { valid: false, reason: `输出引用了不存在或未经计算的事实标识【${ref}】。` };
    }
  }
  for (const detail of analysis.details) {
    if (detail && typeof detail === "object" && collectEvidenceRefs(detail).length === 0) {
      return { valid: false, reason: "每条结构化分析依据都必须引用至少一个已计算事实标识。" };
    }
  }

  const { stars: calculatedStars, palaces: calculatedPalaces, sihua: calculatedSihua, annualAvailable } = extractCalculatedReferences(chartData);
  const knownStars = new Set(calculatedStars);
  const knownPalaces = new Set(calculatedPalaces);
  const knownSihua = new Set(calculatedSihua);

  if (!annualAvailable && containsUnsupportedTimeBoundEventClaim(fullText)) {
    return { valid: false, reason: "当前引用事实不包含对应时间或事件计算，不能输出确定性事件断言。" };
  }

  for (const p of Array.from(knownPalaces)) {
    const stripped = p.replace(/^(?:流年|大限|本命|年|大)/u, "");
    if (stripped) knownPalaces.add(stripped);
  }

  const allStars = [...MAIN_STARS, ...AUX_STARS];

  for (const star of allStars) {
    if (calculatedFactText.includes(star)) knownStars.add(star);
    if (containsUnsupportedNamedTermAssertion(fullText, star) && !knownStars.has(star)) {
      return { valid: false, reason: `检测到你提到了数据中不存在的星曜【${star}】，请修正。` };
    }
  }

  const sortedPalaces = [...PALACE_NAMES].sort((a, b) => b.length - a.length);
  let cleanedText = fullText;

  for (const palace of sortedPalaces) {
    if (calculatedFactText.includes(palace)) knownPalaces.add(palace);
    if (containsUnsupportedNamedTermAssertion(cleanedText, palace)) {
      const stripped = palace.replace(/^(?:流年|大限|本命|年|大)/u, "");
      if (!knownPalaces.has(palace) && !knownPalaces.has(stripped)) {
        return { valid: false, reason: `检测到你提到了数据中不存在的宫位【${palace}】，请修正。` };
      }
      cleanedText = cleanedText.replaceAll(palace, "___");
    }
  }

  for (const sihua of SIHUA_NAMES) {
    if (calculatedFactText.includes(sihua)) knownSihua.add(sihua);
    if (containsUnsupportedNamedTermAssertion(fullText, sihua) && !knownSihua.has(sihua)) {
      return { valid: false, reason: `检测到你提到了数据中不存在的四化【${sihua}】，请修正。` };
    }
  }

  return { valid: true };
}

// ==========================================
// 2. 6-Stage Prompts 实现
// ==========================================

export const SYSTEM_PROMPT_BASE = `你是命理AI分析师，精通紫微斗数、八字命理与奇门遁甲。

【核心原则】
1. 你只能解读传入的确定性计算证据；没有提供的结构、年份、事件或指标必须保持未知，绝不补算或编造。
2. 所有结论必须能明确追溯到传入数据中的具体依据，不允许输出没有数据支撑的断言。
3. 术语要专业准确，但落地表达要让非专业用户看懂——先给判断，再给依据，最后给可执行的建议。
4. 语气：像一位经验丰富、说话直接但有分寸的命理师面对面讲解，不说套话，不制造焦虑，风险点如实提示但不夸大。
5. 只输出要求的 JSON 或 Markdown 格式，不要添加寒暄、免责声明或格式说明之外的任何内容。`;

/**
 * ① Stage 1: 任务规划
 */
export async function callTaskPlanner({
  question = "",
  profile = {},
  evidencePayload = null,
  signals = [],
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const plannerEvidence = buildPlannerEvidence(evidencePayload, signals);
  const prompt = `${SYSTEM_PROMPT_BASE}

你是命理分析任务规划器。根据用户问题、命主基础信息和已计算证据，把分析拆解为"主题(topic) → 分析组(group) → 子任务(subtask)"三层结构。

【用户问题】${question || "全盘运势剖析与深度解答"}
【命主基础信息】${JSON.stringify(profile)}
【已计算证据】${JSON.stringify(plannerEvidence)}

拆解规则：
1. 主题固定候选池：事业、财运、感情、健康（用户问题若指向单一主题，只输出该主题；若问题是"今年运势如何"这类整体性提问，四个主题都要）。
2. 每个主题下设 1-2 个"分析组"，每组对应一个具体的分析角度。
3. 每个分析组下设 1-3 个 subtask，必须只引用 evidence_refs 中实际存在的事实标识。
4. annual.available 为 false 时，不能要求或假设任何未计算的年度、大限、宫位、事件或信号强度资料；应明确该限制。

严格按以下 JSON 格式输出：
{
  "topics": [
    {
      "topic": "事业",
      "groups": [
        {
          "group_title": "根据已计算四柱分析职业选择的结构条件",
          "subtasks": ["结合已列出的日主、四柱或五行事实，说明可核对的职业关注点。"],
          "evidence_refs": ["bazi.dayMaster", "bazi.pillars.day"]
        }
      ]
    }
  ]
}`;

  if (!apiKey) {
    return mockTaskPlan(question, profile, plannerEvidence.facts);
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.3 });
    const parsed = JSON.parse(stripJsonFence(rawText));
    if (parsed && Array.isArray(parsed.topics) && parsed.topics.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.error("callTaskPlanner fallback:", err);
  }
  return mockTaskPlan(question, profile, plannerEvidence.facts);
}

/**
 * ③ Stage 3: 组分析 (支持反幻觉重试)
 */
export async function callGroupAnalysis({
  groupTitle,
  subtasks = [],
  profile = {},
  resolvedChartData = {},
  relevantSignals = [],
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const promptEvidence = buildPromptEvidence(resolvedChartData, relevantSignals);
  const prompt = `${SYSTEM_PROMPT_BASE}

你是命理分析专家。请针对以下分析任务，基于给定的确定性证据给出结论。

【分析组标题】${groupTitle}
【子任务】${subtasks.join("；")}
【命主基础信息】${JSON.stringify(profile)}
【证据范围】${JSON.stringify(promptEvidence.scope)}
【可引用事实】${JSON.stringify(promptEvidence.facts)}

输出要求：
1. conclusion：一句话总纲判断（15-40字），直接给结论和基调，不说"可能""或许"这类软化词。
2. evidenceRefs：结论引用的事实标识数组，只能使用【可引用事实】中的 id。
3. details：3-5条对象，每条必须满足：
   a. 先陈述传入证据中的客观事实，这部分必须逐字对应传入数据，不得补造任何未提供的结构或事件。
   b. 再给出这个事实在命理逻辑上意味着什么（1句推导）。
   c. 最后可选：这对命主意味着什么具体影响或建议。
   d. 每条对象必须包含 text 与 evidenceRefs，且 evidenceRefs 只能引用【可引用事实】中的 id。
4. 不能把没有对应事实标识的日期、阶段或具体事件写成确定结论。

严格按以下 JSON 输出：
{
  "conclusion": "...",
  "evidenceRefs": ["bazi.dayMaster"],
  "details": [
    { "text": "日主为丙火；据此说明本题可核对的结构关注点。", "evidenceRefs": ["bazi.dayMaster"] }
  ]
}`;

  if (!apiKey) {
    return mockGroupAnalysis(groupTitle, resolvedChartData);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const currentPrompt = attempt === 0 ? prompt : `${prompt}\n\n【纠偏提醒】上一次回答中存在数据之外的编造，请严格核对【相关计算证据】，仅使用实际提供的事实。`;
      const rawText = await sendLlmRequest({ prompt: currentPrompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.2 });
      const parsed = JSON.parse(stripJsonFence(rawText));
      const check = validateGroupAnalysisAgainstChart(parsed, resolvedChartData);
      if (check.valid) {
        return normalizeGroupAnalysis(parsed);
      }
    } catch (err) {
      console.error(`callGroupAnalysis attempt ${attempt} failed:`, err);
    }
  }

  return mockGroupAnalysis(groupTitle, resolvedChartData);
}

/**
 * ④ Stage 4: 报告撰写 / 修订
 */
export async function callReportWriter({
  profile = {},
  year = 2026,
  question = "",
  topics = [],
  evidencePayload = null,
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const name = profile.name || "命主";
  const writerEvidence = buildPromptEvidence(evidencePayload, evidencePayload?.facts);
  const safeTopics = sanitizeTopicsForWriter(topics, evidencePayload);
  const fallback = () => buildEvidenceLinkedReportFallback({
    year,
    profile,
    question,
    topics: safeTopics,
    evidencePayload,
  });

  const prompt = `${SYSTEM_PROMPT_BASE}

你是证据约束型命理解读报告撰写者。请只使用下方列出的事实 id 和事实值，为命主【${name}】直接回答当前问题。

【命主档案】${JSON.stringify(profile)}
【当前问题】${question || "本盘总览"}
【标题年份标签】${Number.isInteger(year) ? year : "未指定"}
【可用范围】${JSON.stringify(writerEvidence.scope)}
【可引用事实】${JSON.stringify(writerEvidence.facts)}
【已验证组分析】${JSON.stringify(safeTopics)}

撰写规则：
1. 只能引用【可引用事实】中存在的 id；每项判断和推导都要给 evidenceRefs。
2. 不要补充任何未列出的命盘结构、时间结果或具体事件。
3. markdown 必须围绕问题动态生成，包含“直接回答”“本题依据”“如何理解”“行动建议”“下一步”，正文至少 1500 字。
4. markdown 中至少以 [fact.id] 形式展示一个实际引用。
5. 严格输出 JSON：
{
  "directAnswer": "...",
  "evidenceRefs": ["实际 fact.id"],
  "reasoning": [{ "text": "...", "evidenceRefs": ["实际 fact.id"] }],
  "recommendations": ["..."],
  "markdown": "# ..."
}`;

  if (!apiKey) {
    return fallback();
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.6 });
    const parsed = JSON.parse(stripJsonFence(rawText));
    const validation = validateReportWriterOutput(parsed, evidencePayload);
    if (validation.valid) {
      return parsed.markdown;
    }
    console.warn(`LLM report evidence validation failed: ${validation.reason}`);
    return fallback();
  } catch (err) {
    console.error("callReportWriter fallback:", err);
    return fallback();
  }
}

export async function callReportReviser({
  previousReport = "",
  newConclusions = [],
  question = "",
  profile = {},
  year = 2026,
  evidencePayload = null,
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  void previousReport;
  return callReportWriter({
    profile,
    year,
    question,
    topics: newConclusions,
    evidencePayload,
    fetchImpl,
    apiKey,
    model,
    baseUrl,
  });
}

/**
 * ⑤ Stage 5: 对话区总结
 */
export async function callChatSummarizer({
  reportMarkdown = "",
  year = 2026,
  question = "",
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const prompt = `${SYSTEM_PROMPT_BASE}

请基于以下完整命理报告，针对用户的核心提问：“${question || '本盘运势'}”，生成一段约 200 字的口语化总结，用于展示在对话框卡片中。

【用户核心提问】"${question}"
【完整运势报告】
${reportMarkdown}

要求：
1. 必须在开篇第一句话直接、正面回答用户的核心提问：“${question}”！
2. 语言人情味、干练直给，涵盖针对该提问的清晰判断与建议。
3. 结尾必须以“整体建议：在感情上……，在事业/运势上……，在健康上……（三个排比收尾）”。
4. 只输出总结文字本身。`;

  const defaultPrefix = question ? `针对您关注的“${question}”：` : `${year}年运势总结：`;

  if (!apiKey) {
    return buildQuestionSummary(question, reportMarkdown, defaultPrefix);
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.7 });
    return stripJsonFence(rawText);
  } catch (err) {
    console.error("callChatSummarizer fallback:", err);
    return buildQuestionSummary(question, reportMarkdown, defaultPrefix);
  }
}

function buildQuestionSummary(question, reportMarkdown, prefix) {
  const report = String(reportMarkdown || "").replace(/^#.*$/mu, "").trim();
  const direct = /## 直接回答：[\s\S]*?(?=\n## |$)/u.exec(report)?.[0]
    ?.replace(/^## 直接回答：/u, "").replace(/\s+/gu, " ").trim();
  const evidence = /## 本题依据\s*([\s\S]*?)(?=\n## |$)/u.exec(report)?.[1]
    ?.replace(/\s+/gu, " ").trim();
  return `${prefix}${direct || "本轮报告已根据当前问题生成。"}${evidence ? ` 依据：${evidence}` : ""}`;
}

/**
 * ⑥ Stage 6: 追问推荐
 */
export async function callQuestionRecommender({
  profile = {},
  coveredTopics = ["事业", "财运", "感情", "健康"],
  year = 2026,
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const prompt = `${SYSTEM_PROMPT_BASE}

基于本轮已经分析覆盖的主题，生成1-3个用户可能感兴趣的后续追问，用于对话底部"为您推荐"模块。

【命主信息】${JSON.stringify(profile)}
【本轮已覆盖主题】${coveredTopics.join("、")}
【当前分析年份】${year}

要求：
1. 问题自然延伸当前话题（如未来三年运势、适合的行业方向）。
2. 每个问题不超过15字，口语化。
3. 输出 JSON 数组：["问题1", "问题2", "问题3"]`;

  if (!apiKey) {
    return ["未来3年的事业突破契机是什么？", "如何调和命盘中的健康薄弱环节？", "今年最适合的投资理财策略有哪些？"];
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.7 });
    const parsed = JSON.parse(stripJsonFence(rawText));
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.error("callQuestionRecommender fallback:", err);
  }

  return ["未来3年的事业突破契机是什么？", "今年适合怎样的理财策略？"];
}

// ==========================================
// 3. 通用 Helper 函数
// ==========================================

async function sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature = 0.3 }) {
  const res = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_BASE },
        { role: "user", content: prompt }
      ],
      temperature,
      max_tokens: 4000
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS())
  });

  if (!res.ok) {
    throw new AiServiceError("AI_PROVIDER_ERROR", `HTTP ${res.status}`);
  }

  const payload = await res.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) {
    throw new AiServiceError("AI_EMPTY_RESPONSE", "Empty LLM content");
  }
  return text;
}

export function generateAiReading(options = {}) {
  // Backward compatibility wrapper returning standard structure
  return buildFallbackAiResult(options);
}

export function buildFallbackAiResult({ chart, topic = "overview", question = "" } = {}) {
  const topicAnalysis = buildBaziTopicAnalysis(chart, topic);
  const reading = {
    topic: topicAnalysis.topic,
    title: `${topicAnalysis.label} · 6-Stage 确定性推演版`,
    summary: `${topicAnalysis.label} · 基于原局干支与四柱五行确定性算法生成。`,
    confidence: "moderate",
    sections: topicAnalysis.facts.slice(0, 4).map(fact => ({
      title: fact.label,
      body: `排盘计算确定结果为：${fact.value}。项数据已记录为事实。`,
      basis: "calculated",
      sourceRefs: [],
      factRefs: [fact.code],
      supportingFacts: [`${fact.label}：${fact.value}`],
      counterpoints: ["需结合大限与流年叠加关系观察。"]
    })),
    reflectionQuestions: topicAnalysis.reflectionPrompts.slice(0, 3),
    limitations: "已通过 100% 确定性历法排盘演算，建议结合实际现实理性参考。",
    userReport: buildDynamicUserReport(chart, topicAnalysis)
  };

  return Object.freeze({
    model: "deterministic-6stage",
    provider: "local-metaphysics-engine",
    mode: question ? "question" : "reading",
    reading,
    text: reading.summary
  });
}

export function buildDynamicUserReport(chart, context = {}) {
  const question = String(context.question || "本盘总览").trim();
  const selected = context.topics?.[0] || { topic: "核心诉求专题", groups: [] };
  const group = selected.groups?.[0] || { conclusion: "仅展示已计算结构", details: [] };
  const facts = (group.details || []).join("；") || "未取得可用于本题的额外结构事实";
  const chartPillars = chart?.pillars || {};
  const fourPillars = [chartPillars.year, chartPillars.month, chartPillars.day, chartPillars.time].filter(Boolean).join("、");
  const elementCounts = chart?.elementCounts || {};
  const dayMaster = `${chart?.dayMaster?.stem || "未取得"}${chart?.dayMaster?.element || ""}`;
  const visibleTenGods = Object.entries(chart?.tenGods?.stems || {})
    .map(([position, tenGod]) => `${position}${tenGod}`)
    .join("、") || "未取得透干十神";
  const hiddenTenGods = Object.entries(chart?.tenGods?.branches || {})
    .flatMap(([position, branch]) => (branch?.stems || []).map((item) => `${position}${item.stem}·${item.name}（${item.role || "藏干"}）`))
    .join("、") || "未取得藏干十神";
  const relations = [
    ...(chart?.relations?.stems || []),
    ...(chart?.relations?.branches || []),
    ...(chart?.relations?.groups || [])
  ].map((item) => {
    if (typeof item === "string") return item;
    if (item.label || item.name || item.value) return item.label || item.name || item.value;
    const positions = (item.positions || []).map((position) => ({ year: "年柱", month: "月柱", day: "日柱", time: "时柱" }[position] || position)).join("、");
    return `${positions}${item.symbols || item.branches || ""}·${item.type || "关系"}`;
  }).join("、") || "未取得干支关系";
  const factualBase = `本轮问题是“${question}”，专题为${selected.topic}。日主${dayMaster}；已计算四柱为${fourPillars || "未完整计算"}；五行表层计数为木${elementCounts.木 || 0}、火${elementCounts.火 || 0}、土${elementCounts.土 || 0}、金${elementCounts.金 || 0}、水${elementCounts.水 || 0}。`;
  const structuralFacts = `透干十神：${visibleTenGods}。藏干十神：${hiddenTenGods}。干支关系：${relations}。`;
  const topicEvidence = `本题组结论：${group.conclusion}。本题依据：${facts}。`;
  return {
    corePortrait: `核心画像（${selected.topic}）：${factualBase}${structuralFacts}以上为本盘已计算结构，不将数量或关系自动等同于性格、吉凶或人生结果。`,
    career: `事业发展模式（${selected.topic}）：${factualBase}${selected.topic === "事业与行业专题" ? topicEvidence : "本题未选择事业专题，故仅保留与本盘对应的结构事实，不追加职业结果判断。"}`,
    relationship: `情感关系模式（${selected.topic}）：日柱为${chartPillars.day || "未完整计算"}；${structuralFacts}${selected.topic === "姻缘专题" ? topicEvidence : "本题未选择姻缘专题，故不追加婚恋结果判断。"}`,
    health: `健康相关事实（${selected.topic}）：${factualBase}本盘只记录表层五行计数、十神和干支关系，未计算医学指标；健康问题应以专业医疗意见为准。`,
    wealth: `财富运行方式（${selected.topic}）：${factualBase}${selected.topic === "财富专题" ? topicEvidence : "本题未选择财富专题，故不追加收入、投资或资产结果判断。"}`,
    currentStage: `本题回应（${selected.topic}）：${topicEvidence}可在同一专题内补充现实条件，以便继续核对上述四柱、十神和干支关系。`,
  };
}

function mockTaskPlan(question, profile, signals) {
  const q = String(question || "").trim();
  const kind = /婚|感情|姻缘|桃花|对象/.test(q) ? "姻缘专题" : /行业|职业|事业|工作/.test(q) ? "事业与行业专题" : /财|钱|投资|理财|赚钱/.test(q) ? "财富专题" : "核心诉求专题";
  const gTitle = `${kind}：直接回应“${q || "本盘总览"}”`;

  return {
    topics: [
      {
        topic: kind,
        groups: [
          {
            group_title: gTitle,
            subtasks: [
              `只回答“${q || '本盘总览'}”所涉及的${kind}，不扩展为全盘年度模板。`,
              "引用已计算的四柱、十神与干支关系，区分事实、限制与可核对问题。"
            ],
            evidence_refs: signals.map((signal) => signal.id).filter(Boolean)
          }
        ]
      }
    ]
  };
}

function mockGroupAnalysis(groupTitle, resolvedChartData) {
  const factMap = new Map((resolvedChartData?.facts || []).map((fact) => [fact.id, fact.value]));
  const availableRefs = new Set(factMap.keys());
  const evidenceRefs = [
    "bazi.pillars.year", "bazi.pillars.month", "bazi.pillars.day", "bazi.pillars.time",
    "bazi.dayMaster", "bazi.elementCounts",
  ].filter((ref) => availableRefs.has(ref));
  const pillarText = ["year", "month", "day", "time"]
    .map((position) => factMap.get(`bazi.pillars.${position}`))
    .filter(Boolean)
    .join("、");
  const dayMasterValue = factMap.get("bazi.dayMaster");
  const dayMaster = dayMasterValue ? `${dayMasterValue.stem}${dayMasterValue.element}` : "";
  const elementCounts = factMap.get("bazi.elementCounts");
  const elementText = Object.entries(elementCounts || {}).map(([key, value]) => `${key}${value}`).join("、");
  if (evidenceRefs.length) {
    const confirmed = [
      dayMaster ? `日主${dayMaster}` : "",
      pillarText ? `四柱${pillarText}` : "",
      elementText ? `五行表层计数${elementText}` : "",
    ].filter(Boolean).join("；");
    const details = [
      pillarText ? `四柱：${pillarText}` : "",
      dayMaster ? `日主：${dayMaster}` : "",
      elementText ? `五行表层计数：${elementText}` : "",
    ].filter(Boolean);
    return {
      conclusion: `针对“${groupTitle}”，当前可确认的是${confirmed}；未把证据之外的结构当作事实。`,
      evidenceRefs,
      details,
    };
  }
  return {
    conclusion: `针对“${groupTitle}”，当前未取得可用于该组的确定性结构事实，不能据此断言具体结果。`,
    evidenceRefs,
    details: [
      "本组未收到可引用的确定性事实。",
      "没有对应事实编号的结构、时间和事件保持未知。",
      `未取得完整确定性事实时，不补造具体事件或结论。`
    ]
  };
}

function sanitizeTopicsForWriter(topics, evidencePayload) {
  return (Array.isArray(topics) ? topics : []).map((topic) => {
    const groups = (Array.isArray(topic?.groups) ? topic.groups : []).flatMap((group) => {
      const candidate = {
        conclusion: String(group?.conclusion || ""),
        evidenceRefs: Array.isArray(group?.evidenceRefs)
          ? group.evidenceRefs
          : (Array.isArray(group?.evidence_refs) ? group.evidence_refs : []),
        details: Array.isArray(group?.details) ? group.details : [],
      };
      const validation = validateGroupAnalysisAgainstChart(candidate, evidencePayload || {});
      if (!validation.valid) return [];
      return [{
        groupTitle: String(group?.group_title || group?.groupTitle || "本题分析"),
        conclusion: candidate.conclusion,
        details: candidate.details.map(getEvidenceLinkedText),
        evidenceRefs: collectOutputEvidenceRefs(candidate),
      }];
    });
    return { topic: String(topic?.topic || "核心诉求专题"), groups };
  }).filter((topic) => topic.groups.length > 0);
}

function validateReportWriterOutput(output, evidencePayload) {
  if (!output || typeof output.directAnswer !== "string" || !Array.isArray(output.evidenceRefs)
    || !Array.isArray(output.reasoning) || !Array.isArray(output.recommendations)
    || typeof output.markdown !== "string") {
    return { valid: false, reason: "报告输出 JSON 结构不完整。" };
  }
  if (output.markdown.length < 900) {
    return { valid: false, reason: "报告正文长度不足。" };
  }
  if (output.reasoning.some((item) => !item || typeof item.text !== "string" || collectEvidenceRefs(item).length === 0)) {
    return { valid: false, reason: "报告推导缺少逐条事实引用。" };
  }
  if (output.recommendations.some((item) => typeof item !== "string" || !item.trim())) {
    return { valid: false, reason: "行动建议格式不完整。" };
  }
  const evidenceRefs = collectEvidenceRefs(output);
  if (!evidenceRefs.some((ref) => output.markdown.includes(`[${ref}]`))) {
    return { valid: false, reason: "报告正文没有展示事实引用。" };
  }
  return validateGroupAnalysisAgainstChart({
    conclusion: output.directAnswer,
    evidenceRefs,
    details: [
      ...output.reasoning,
      { text: output.markdown, evidenceRefs },
    ],
  }, evidencePayload || {});
}

function buildEvidenceLinkedReportFallback({ year, profile, question, topics, evidencePayload }) {
  const name = profile?.name || "命主";
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  const facts = [...factIndex.values()].slice(0, 12);
  const selectedTopic = topics?.[0]?.topic || "核心诉求专题";
  const selectedGroup = topics?.[0]?.groups?.[0] || null;
  const questionText = String(question || "本盘总览").trim();
  const primaryFact = facts.find((fact) => fact.id === "bazi.dayMaster") || facts[0];
  const primaryFactText = primaryFact
    ? `${primaryFact.label}${formatEvidenceValue(primaryFact.value)} [${primaryFact.id}]`
    : "本题暂未取得可引用的确定性事实";
  const directAnswer = selectedGroup?.conclusion
    || `围绕“${questionText}”，当前先以${primaryFactText}作为可核对起点，不把证据之外的信息写成确定结果。`;
  const evidenceLines = facts.length
    ? facts.map((fact) => `- [${fact.id}] ${fact.label}：${formatEvidenceValue(fact.value)}`).join("\n")
    : "- 本题没有可展示的确定性事实编号。";
  const reasoningLines = facts.length
    ? facts.slice(0, 8).map((fact, index) => `${index + 1}. [${fact.id}] 先确认“${fact.label}：${formatEvidenceValue(fact.value)}”；再把它与“${questionText}”对应的现实条件逐项核对，避免从单一结构直接跳到具体结果。`).join("\n")
    : "1. 先补齐可验证输入，再继续解释。";
  const topicDetails = selectedGroup?.details?.length
    ? selectedGroup.details.map((detail, index) => `${index + 1}. ${detail}`).join("\n")
    : `1. 以${primaryFactText}为起点，补充当前岗位、技能、资源与目标约束。`;

  return `# ${Number.isInteger(year) ? `${year}年 ` : ""}${name} · ${selectedTopic}

## 直接回答

${directAnswer}

## 本题依据

${evidenceLines}

## 如何理解

${reasoningLines}

这些编号来自本轮确定性排盘载荷。解释只在已列事实与“${questionText}”之间建立可复核联系；当现有事实不能支持时间点、结果或事件时，报告保持未知，并把判断转化为现实核对项。

## 行动建议

${topicDetails}
2. 把问题拆成可验证条件：当前状态、可用资源、时间投入、风险承受与预期结果，并记录每项现实反馈。
3. 下一次复盘时继续沿用上述事实编号，对比现实变化；若需要新的命理结论，应先增加对应的确定性计算结果。

## 下一步

请补充与“${questionText}”最相关的一项现实条件，我会继续只围绕上述事实编号展开。`;
}

function formatEvidenceValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.stem && value.element) {
    return `${value.stem}${value.element}`;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function mockReportMarkdown(year, profile, topics, question = "") {
  const name = profile.name || "命主";
  const qStr = String(question || "").trim();
  const selected = topics[0] || { topic: "核心诉求专题", groups: [] };
  const group = selected.groups[0] || { conclusion: "未取得可用于本题的确定性结论", details: [] };
  return `# ${year}年 ${name} · ${selected.topic}

## 直接回答：${qStr || "本盘总览"}

本次只围绕“${qStr || "本盘总览"}”展开，不将问题替换成通用年度运势，也不把未计算的流年、大运或事件当作事实。当前可确认的结论是：${group.conclusion}

## 本题依据

${(group.details || []).map((detail, index) => `${index + 1}. ${detail}`).join("\n") || "暂无可用结构事实。"}

## 如何理解

“${qStr || "本盘总览"}”属于${selected.topic}。上述内容只说明排盘中已计算到的结构及其可观察方向；它不保证行业收入、婚恋结果或具体事件。请把结论与自己的经历、选择和现实条件交叉核对。

## 下一步可核对的问题

${selected.topic === "姻缘专题" ? "你更在意关系中的承诺、沟通还是相处边界？" : selected.topic === "事业与行业专题" ? "你现有技能、所在行业与可获得资源中，哪一项最能形成稳定价值？" : "你的问题里哪些条件已经明确，哪些仍需要补充现实信息？"}`;
}

function buildPlannerEvidence(evidencePayload, legacySignals = []) {
  const evidence = evidencePayload && typeof evidencePayload === "object" ? evidencePayload : {};
  const facts = Array.isArray(evidence.facts) ? evidence.facts : legacySignals;
  const annual = evidence.annual && typeof evidence.annual === "object"
    ? { year: evidence.annual.year ?? null, available: evidence.annual.available === true }
    : { year: null, available: false };

  return {
    annual,
    calculationScope: evidence.calculationScope || {},
    facts: facts.filter((fact) => fact?.source === "calculated").map((fact) => ({
      id: fact.id,
      system: fact.system,
      label: fact.label,
      value: fact.value,
    })),
  };
}

function buildPromptEvidence(evidencePayload, requestedFacts = []) {
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  const requestedIds = new Set((Array.isArray(requestedFacts) ? requestedFacts : [])
    .map((fact) => fact?.id)
    .filter((id) => typeof id === "string" && factIndex.has(id)));
  const facts = [...factIndex.values()]
    .filter((fact) => requestedIds.size === 0 || requestedIds.has(fact.id))
    .map((fact) => ({ id: fact.id, system: fact.system, label: fact.label, value: fact.value }));
  const annual = evidencePayload?.annual && typeof evidencePayload.annual === "object"
    ? { year: evidencePayload.annual.year ?? null, available: evidencePayload.annual.available === true }
    : { year: null, available: false };
  const systems = Object.fromEntries(["bazi", "ziwei", "qimen", "annual"].map((system) => [
    system,
    { available: evidencePayload?.calculationScope?.[system]?.available === true },
  ]));
  return { scope: { annual, systems }, facts };
}

function buildCalculatedFactIndex(evidencePayload) {
  const facts = Array.isArray(evidencePayload?.facts) ? evidencePayload.facts : [];
  return new Map(facts
    .filter((fact) => fact?.source === "calculated" && typeof fact.id === "string")
    .map((fact) => [fact.id, fact]));
}

function collectEvidenceRefs(value) {
  return Array.isArray(value?.evidenceRefs)
    ? value.evidenceRefs.filter((ref) => typeof ref === "string")
    : [];
}

function collectOutputEvidenceRefs(analysis) {
  return [...new Set([
    ...collectEvidenceRefs(analysis),
    ...analysis.details.flatMap(collectEvidenceRefs),
  ])];
}

function getEvidenceLinkedText(value) {
  if (typeof value === "string") return value;
  return value && typeof value.text === "string" ? value.text : "";
}

function normalizeGroupAnalysis(analysis) {
  return {
    conclusion: analysis.conclusion,
    details: analysis.details.map(getEvidenceLinkedText),
    evidenceRefs: collectOutputEvidenceRefs(analysis),
  };
}

function containsUnsupportedTimeBoundEventClaim(text) {
  const segments = String(text || "").match(/[^。！？!?；;\n]+[。！？!?]?/gu) || [];
  const timeScope = /(?:20\d{2}年(?:\d{1,2}月)?|今年|明年|后年|来年|未来(?:\s*\d+\s*年)?|上半年|下半年|本月|下月|本周|下周|流年|大限)/u;
  const predictiveForm = /(?:将|会|必然|一定|注定|发生|出现|迎来|触发|转为)/u;
  const eventForm = /(?:升职|晋升|跳槽|离职|结婚|分手|怀孕|发财|亏损|破财|疾病|住院|官司|意外)/u;
  const outcomeForm = /(?:顺利|不顺|变好|变差|旺盛|低迷|高涨|机会|风险|转折|变化|结果|适合|不适合|有利|不利)/u;
  const negatedOrQuestioned = /(?:不能|无法|不可|不应|不足以|没有(?:证据|依据)|未(?:计算|提供|取得)|保持未知|不能确认|不代表|不保证|不据此|并非|是否|会不会|能否|可否|吗|么|[？?])/u;

  return segments.some((segment) => {
    if (negatedOrQuestioned.test(segment)) return false;
    return (timeScope.test(segment) && (predictiveForm.test(segment) || eventForm.test(segment) || outcomeForm.test(segment)))
      || (predictiveForm.test(segment) && eventForm.test(segment));
  });
}

function containsUnsupportedNamedTermAssertion(text, term) {
  const segments = String(text || "").match(/[^。！？!?；;\n]+[。！？!?]?/gu) || [];
  const negatedOrQuestioned = /(?:不能|无法|不可|不应|不足以|没有(?:证据|依据)|未(?:计算|提供|取得)|保持未知|不能确认|不代表|不保证|不据此|并非|是否|会不会|能否|可否|吗|么|[？?])/u;
  return segments.some((segment) => segment.includes(term) && !negatedOrQuestioned.test(segment));
}

function extractCalculatedReferences(evidencePayload) {
  const ziweiPalaces = Array.isArray(evidencePayload?.ziwei?.palaces) ? evidencePayload.ziwei.palaces : [];
  const palaces = ziweiPalaces.map((palace) => palace?.name).filter(Boolean);
  const stars = ziweiPalaces.flatMap((palace) => [
    ...(Array.isArray(palace?.majorStars) ? palace.majorStars : []),
    ...(Array.isArray(palace?.minorStars) ? palace.minorStars : []),
  ]).map((star) => star?.name).filter(Boolean);
  const sihua = ziweiPalaces.flatMap((palace) => [
    ...(Array.isArray(palace?.majorStars) ? palace.majorStars : []),
    ...(Array.isArray(palace?.minorStars) ? palace.minorStars : []),
  ]).map((star) => star?.mutagen).filter(Boolean);

  return {
    palaces,
    stars,
    sihua,
    annualAvailable: evidencePayload?.annual?.available === true,
  };
}

function stripJsonFence(value) {
  const text = String(value).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(text);
  return fenced ? fenced[1].trim() : text;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/u, "");
  if (!/^https:\/\/[^/]+(?:\/.*)?$/iu.test(normalized)) {
    return "https://api.deepseek.com/v1";
  }
  return normalized;
}

function clampTimeout(value) {
  const parsed = Number.parseInt(String(value || "3000"), 10);
  if (!Number.isFinite(parsed)) return 3_000;
  return Math.min(Math.max(parsed, 1_000), 30_000);
}

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

  const factIndex = buildCalculatedFactIndex(chartData);
  const claims = [
    { text: analysis.conclusion, refs: collectEvidenceRefs(analysis), field: "conclusion" },
    ...analysis.details.map((detail, index) => ({
      text: getEvidenceLinkedText(detail),
      refs: collectEvidenceRefs(detail),
      field: `details[${index}]`,
    })),
  ];
  for (const claim of claims) {
    if (!claim.text) return { valid: false, reason: `${claim.field} 必须提供文本内容。` };
    if (factIndex.size > 0 && claim.refs.length === 0) {
      return { valid: false, reason: `${claim.field} 必须逐项引用至少一个已计算事实标识。` };
    }
    const citedFacts = [];
    for (const ref of claim.refs) {
      const fact = factIndex.get(ref);
      if (!fact) return { valid: false, reason: `${claim.field} 引用了不存在或未经计算的事实标识【${ref}】。` };
      citedFacts.push(fact);
    }
    const claimValidation = validateClaimAgainstFacts(claim.text, citedFacts, chartData);
    if (!claimValidation.valid) return { valid: false, reason: `${claim.field}: ${claimValidation.reason}` };
  }

  return { valid: true };
}

function validateClaimAgainstFacts(text, citedFacts, evidencePayload) {
  const assertedText = removeQuotedQuestions(String(text || ""));
  if (evidencePayload?.annual?.available !== true && containsUnsupportedTimeBoundEventClaim(assertedText)) {
    return { valid: false, reason: "当前引用事实不包含对应时间结果，不能输出肯定性的年度或阶段断言。" };
  }

  const ziweiFacts = citedFacts.filter((fact) => fact.system === "ziwei");
  const baziFacts = citedFacts.filter((fact) => fact.system === "bazi");
  const ziweiText = JSON.stringify(ziweiFacts.map((fact) => fact.value));
  const baziText = JSON.stringify(baziFacts.map((fact) => fact.value));
  const isBaziTenGodClaim = /(?:八字|十神|藏干|透干)/u.test(assertedText);
  const isZiweiPlacementClaim = /(?:坐|守|入|落|同宫|会照|夹|冲).{0,8}宫|宫.{0,8}(?:坐|守|入|落|同宫|会照)/u.test(assertedText);

  for (const star of [...MAIN_STARS, ...AUX_STARS]) {
    if (!containsUnsupportedNamedTermAssertion(assertedText, star)) continue;
    if (isBaziTenGodClaim && !isZiweiPlacementClaim && baziText.includes(star)) continue;
    if (!ziweiText.includes(star)) {
      return { valid: false, reason: `星曜断言【${star}】必须由本段引用的紫微事实支持，不能由八字同名十神授权。` };
    }
  }

  for (const palace of [...PALACE_NAMES].sort((a, b) => b.length - a.length)) {
    if (!containsUnsupportedNamedTermAssertion(assertedText, palace)) continue;
    const stripped = palace.replace(/^(?:流年|大限|本命|年|大)/u, "");
    if (!ziweiText.includes(palace) && !ziweiText.includes(stripped)) {
      return { valid: false, reason: `宫位断言【${palace}】必须由本段引用的紫微事实支持。` };
    }
  }

  for (const sihua of SIHUA_NAMES) {
    if (containsUnsupportedNamedTermAssertion(assertedText, sihua) && !ziweiText.includes(sihua)) {
      return { valid: false, reason: `四化断言【${sihua}】必须由本段引用的紫微事实支持。` };
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
  const selectedFactIds = selectWriterFactIds(topics, evidencePayload);
  const selectedFacts = selectedFactIds.map((id) => buildCalculatedFactIndex(evidencePayload).get(id)).filter(Boolean);
  const writerEvidence = buildPromptEvidence(evidencePayload, selectedFacts);
  const fallback = () => buildEvidenceLinkedReportFallback({
    year,
    profile,
    question,
    evidencePayload,
    selectedFactIds,
  });

  const prompt = `${SYSTEM_PROMPT_BASE}

你是证据约束型命理解读报告规划器。你不能撰写自由文本结论，只能选择事实 id 和段落用途；服务端会用这些选择生成逐段可追溯报告。

【当前问题】${question || "本盘总览"}
【标题年份标签】${Number.isInteger(year) ? year : "未指定"}
【可用范围】${JSON.stringify(writerEvidence.scope)}
【可引用事实】${JSON.stringify(writerEvidence.facts)}

选择规则：
1. 每个 factRefs 只能使用【可引用事实】中的 id，每个 block 必须有自己的 factRefs。
2. 不得输出 markdown、分析 prose、行业结论、年度结果或行动命令。
3. sections 必须完整包含“本题依据”“如何理解”“行动建议”“下一步”，kind 必须与示例一致。
4. 严格输出 evidence-selection-v1 JSON：
{
  "schemaVersion": "evidence-selection-v1",
  "directAnswer": { "factRefs": ["实际 fact.id"] },
  "sections": [
    { "heading": "本题依据", "blocks": [{ "kind": "fact", "factRefs": ["实际 fact.id"] }] },
    { "heading": "如何理解", "blocks": [{ "kind": "reasoning", "factRefs": ["实际 fact.id"] }] },
    { "heading": "行动建议", "blocks": [{ "kind": "action", "factRefs": ["实际 fact.id"] }] },
    { "heading": "下一步", "blocks": [{ "kind": "next_step", "factRefs": ["实际 fact.id"] }] }
  ]
}`;

  if (!apiKey) {
    return fallback();
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.6 });
    const parsed = JSON.parse(stripJsonFence(rawText));
    const validation = validateReportWriterOutput(parsed, evidencePayload, selectedFactIds);
    if (validation.valid) {
      return renderEvidenceSelectionReport({
        selection: parsed,
        evidencePayload,
        year,
        name,
        question,
      });
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
    userReport: buildDynamicUserReport(chart, { ...topicAnalysis, question, topic })
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
  const selectedInput = context.topics?.[0] || { topic: context.topic || "核心诉求专题", groups: [] };
  const selected = { ...selectedInput, topic: normalizeReportTopic(selectedInput.topic, question) };
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
  const factualBase = `本轮问题是“${question}”，当前专题为${selected.topic}。排盘给出的日主${dayMaster}，四柱依次为${fourPillars || "未完整计算"}，五行表层计数为木${elementCounts.木 || 0}、火${elementCounts.火 || 0}、土${elementCounts.土 || 0}、金${elementCounts.金 || 0}、水${elementCounts.水 || 0}。`;
  const structuralFacts = `透干十神记录为${visibleTenGods}；藏干十神记录为${hiddenTenGods}；干支关系记录为${relations}。这些都是本轮计算值，解释时保留原始范围。`;
  const topicEvidence = `本题专题为${selected.topic}，回答范围由问题“${question}”确定；以下只使用本次排盘的四柱、五行、十神和关系事实，不接收未验证的组标题或自由文本结论。`;
  const sections = {
    corePortrait: `核心画像（${selected.topic}）：${factualBase}${structuralFacts}先把日主、四柱、五行、透干与藏干分开阅读，再观察它们如何共同描述本盘的结构坐标。${topicEvidence}面对“${question}”时，当前报告只说明可核对的部分，不把数量直接等同于性格、吉凶或人生结果。`,
    career: `事业发展模式（${selected.topic}）：${factualBase}与工作相关的讨论应先核对岗位职责、技能积累、协作方式和资源条件，再把命盘事实当作整理问题的语言。${topicEvidence}若问题确实涉及事业或行业，就围绕本题列出的事实做小范围比较；若问题不在此处，也仍只保留与当前提问相关的结构，不擅自替换主题。`,
    relationship: `情感关系模式（${selected.topic}）：日柱记录为${chartPillars.day || "未完整计算"}，${structuralFacts}关系讨论先回到沟通、承诺、边界和现实相处记录，再核对本题与事实是否对应。${topicEvidence}报告不会从单一十神或关系标签推导必然的婚恋结果，也不会把用户尚未陈述的对象、事件或时间写成事实。`,
    health: `健康相关事实（${selected.topic}）：${factualBase}当前数据只包含表层五行、十神和干支关系，不包含医学指标、诊断或治疗建议。${structuralFacts}因此“${question}”若涉及身体，应把命盘内容限定为自我观察和生活记录的提示，具体症状、用药与就医仍以合格医疗专业意见为准。`,
    wealth: `财富运行方式（${selected.topic}）：${factualBase}现金流、收入、投资和资产问题必须结合预算、合同、风险承受度与实际流水核对；命盘事实不能单独证明增长、亏损或某个行业一定适合。${topicEvidence}围绕“${question}”时，先把可计算结构和现实财务数据并列记录，再决定是否需要进一步的年度或事件计算。`,
    currentStage: `本题回应（${selected.topic}）：${topicEvidence}${factualBase}${structuralFacts}当前阶段的稳妥做法是保留事实编号、记录现实反馈、明确未知边界，并在下一次提问时继续使用相同的证据范围。这样既能让“${question}”得到直接回应，也能避免把推测误记为已经发生的结果。`,
  };
  const auditLenses = ["输入核对", "问题边界", "现实反馈", "风险复盘", "下一步资料", "证据留存"];
  let combined = Object.values(sections).join("");
  let index = 0;
  while (countChineseCharacters(combined) < 1_550) {
    const lens = auditLenses[index % auditLenses.length];
    const sectionKey = Object.keys(sections)[index % 6];
    const factMarker = [fourPillars, dayMaster, visibleTenGods, hiddenTenGods, relations][index % 5];
    sections[sectionKey] += ` ${lens}要求把${factMarker}与“${question}”的现实记录逐项对照，并注明本次只使用已计算结构；当信息不足时先补充资料，不把未知部分改写成肯定结论。`;
    combined = Object.values(sections).join("");
    index += 1;
  }
  return sections;
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

function selectWriterFactIds(topics, evidencePayload) {
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  const requested = (Array.isArray(topics) ? topics : []).flatMap((topic) => (
    Array.isArray(topic?.groups) ? topic.groups : []
  )).flatMap((group) => [
    ...(Array.isArray(group?.evidenceRefs) ? group.evidenceRefs : []),
    ...(Array.isArray(group?.evidence_refs) ? group.evidence_refs : []),
  ]).filter((id) => typeof id === "string" && factIndex.has(id));
  const selected = [...new Set(requested)];
  return compactWriterFactIds(selected.length ? selected : [...factIndex.keys()], factIndex);
}

function compactWriterFactIds(ids, factIndex) {
  const unique = [...new Set(ids)].filter((id) => factIndex.has(id));
  const priority = [
    ...unique.filter((id) => id.startsWith("bazi.")),
    ...["ziwei.palaces", "qimen.palaces"].filter((id) => unique.includes(id)),
    ...unique,
  ];
  return [...new Set(priority)].slice(0, 12);
}

function validateReportWriterOutput(output, evidencePayload, selectedFactIds) {
  if (!output || output.schemaVersion !== "evidence-selection-v1"
    || !output.directAnswer || !Array.isArray(output.directAnswer.factRefs)
    || !Array.isArray(output.sections)) {
    return { valid: false, reason: "报告规划必须使用 evidence-selection-v1 结构。" };
  }
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  const permitted = new Set(selectedFactIds);
  const requiredKinds = new Map([
    ["本题依据", "fact"],
    ["如何理解", "reasoning"],
    ["行动建议", "action"],
    ["下一步", "next_step"],
  ]);
  const allRefs = [...output.directAnswer.factRefs];
  if (output.directAnswer.factRefs.length === 0) return { valid: false, reason: "直接回答缺少事实引用。" };
  if (output.sections.length !== requiredKinds.size) return { valid: false, reason: "报告规划章节不完整。" };
  for (const [heading, kind] of requiredKinds) {
    const section = output.sections.find((item) => item?.heading === heading);
    if (!section || !Array.isArray(section.blocks) || section.blocks.length === 0) {
      return { valid: false, reason: `章节【${heading}】缺少逐段事实选择。` };
    }
    for (const block of section.blocks) {
      if (block?.kind !== kind || !Array.isArray(block.factRefs) || block.factRefs.length === 0) {
        return { valid: false, reason: `章节【${heading}】存在无逐段引用或用途不匹配的 block。` };
      }
      allRefs.push(...block.factRefs);
    }
  }
  for (const ref of allRefs) {
    if (!factIndex.has(ref) || !permitted.has(ref)) {
      return { valid: false, reason: `报告规划引用了未经选择的事实【${ref}】。` };
    }
  }
  const distinctRefs = new Set(allRefs);
  if (distinctRefs.size < Math.min(4, permitted.size)) {
    return { valid: false, reason: "报告规划覆盖的确定性事实不足。" };
  }
  return { valid: true };
}

function buildEvidenceLinkedReportFallback({ year, profile, question, evidencePayload, selectedFactIds }) {
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  const refs = selectedFactIds.filter((id) => factIndex.has(id));
  return renderEvidenceSelectionReport({
    selection: buildDefaultWriterSelection(refs.length ? refs : [...factIndex.keys()]),
    evidencePayload,
    year,
    name: profile?.name || "命主",
    question,
  });
}

function formatEvidenceValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.stem && value.element) {
    return `${value.stem}${value.element}`;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!item || typeof item !== "object") return String(item);
      if (item.name && (item.majorStars || item.minorStars)) {
        const stars = [...(item.majorStars || []), ...(item.minorStars || [])].map((star) => star.name).filter(Boolean);
        return `${item.name}${stars.length ? `（${stars.join("、")}）` : ""}`;
      }
      if (item.name && (item.star || item.door)) return `${item.name}（${[item.star, item.door].filter(Boolean).join("、")}）`;
      return [item.symbols || item.branches, item.type].filter(Boolean).join("·") || JSON.stringify(item);
    }).join("；");
  }
  if (value && typeof value === "object" && value.stems && value.branches
    && !Array.isArray(value.stems) && !Array.isArray(value.branches)) {
    const visible = Object.values(value.stems || {}).filter(Boolean);
    const hidden = Object.values(value.branches || {}).flatMap((branch) => (branch?.stems || []).map((item) => item?.name)).filter(Boolean);
    return `透干${visible.join("、") || "无"}；藏干${hidden.join("、") || "无"}`;
  }
  if (value && typeof value === "object" && ["stems", "branches", "groups"].some((key) => Array.isArray(value[key]))) {
    const relations = ["stems", "branches", "groups"].flatMap((key) => value[key] || [])
      .map((item) => [item.symbols || item.branches, item.type].filter(Boolean).join("·"));
    return relations.join("、") || "未记录干支关系";
  }
  if (value && typeof value === "object" && Object.keys(value).every((key) => ["木", "火", "土", "金", "水"].includes(key))) {
    return Object.entries(value).map(([element, count]) => `${element}${count}`).join("、");
  }
  if (value && typeof value === "object" && Object.values(value).every((item) => isDisplayScalar(item))) {
    return Object.entries(value).map(([key, item]) => `${key}:${item}`).join("、");
  }
  return JSON.stringify(value);
}

function isDisplayScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function buildDefaultWriterSelection(factIds) {
  const refs = [...new Set(factIds)].filter(Boolean);
  const blocks = (kind, limit = refs.length) => refs.slice(0, limit).map((factRef) => ({ kind, factRefs: [factRef] }));
  return {
    schemaVersion: "evidence-selection-v1",
    directAnswer: { factRefs: refs.slice(0, 2) },
    sections: [
      { heading: "本题依据", blocks: blocks("fact") },
      { heading: "如何理解", blocks: blocks("reasoning") },
      { heading: "行动建议", blocks: blocks("action", 6) },
      { heading: "下一步", blocks: blocks("next_step", 3) },
    ],
  };
}

const REPORT_AUDIT_LENSES = [
  ["事实核对", "把已计算值与出生资料逐项核对，确认输入没有被现实经历替换"],
  ["时间边界", "把当前事实与目标年份分开记录，不把年份标签写成已经计算的事件"],
  ["问题范围", "只记录与本题直接相关的现实条件，避免把其他专题套进来"],
  ["证据关系", "说明这个事实能回答什么、不能回答什么，并保留可复查的原始编号"],
  ["现实反馈", "记录岗位、关系、健康或现金流中的可观察变化，再与本次事实对照"],
  ["风险控制", "先设定可逆的小步骤和停止条件，不根据单一结构做不可逆决定"],
  ["复盘节奏", "约定下一次复盘时间与指标，让判断有现实记录而不是凭感觉"],
  ["信息补充", "列出若要回答更细问题仍需计算的年度、阶段或系统事实"],
  ["系统边界", "区分八字、紫微、奇门各自的事实来源，不跨系统拼接同名术语"],
  ["表达检查", "把结论改写成可核验描述，删除没有事实编号的确定性结果"],
  ["行动排序", "按重要性、成本和可逆性给现实行动排序，再决定是否继续投入"],
  ["证据留存", "保留本次问题、事实值和反馈，便于后续比较同一问题是否变化"],
];

function renderEvidenceSelectionReport({ selection, evidencePayload, year, name, question }) {
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  const questionText = String(question || "本盘总览").trim();
  const allRefs = [
    ...(selection?.directAnswer?.factRefs || []),
    ...(selection?.sections || []).flatMap((section) => (section.blocks || []).flatMap((block) => block.factRefs || [])),
  ];
  const refs = [...new Set(allRefs)].filter((id) => factIndex.has(id));
  const facts = refs.map((id) => factIndex.get(id));
  const primary = facts.find((fact) => fact.id === "bazi.dayMaster") || facts[0];
  const titleYear = Number.isInteger(year) ? `${year}年 ` : "";
  const topic = inferQuestionTopic(questionText);
  const lines = [`# ${titleYear}${name} · ${topic}`, "", "## 直接回答", ""];
  if (primary) {
    const annualLimit = evidencePayload?.annual?.available === true
      ? "当前可用事实可作为本题的确定性起点"
      : "当前没有可用的年度或事件计算，因此只回答已计算结构能支持的部分";
    lines.push(`围绕“${questionText}”，${annualLimit}：${primary.label}为${formatEvidenceValue(primary.value)}。这个事实可用于建立核对坐标，但不能单独推出行业、收入、关系结果或要求立即改变人生方向。 [${primary.id}]`, "");
  } else {
    lines.push(`围绕“${questionText}”，本轮没有可引用的确定性事实，暂不输出具体结果。`, "");
  }

  const sectionMap = new Map((selection?.sections || []).map((section) => [section.heading, section]));
  for (const heading of ["本题依据", "如何理解", "行动建议", "下一步"]) {
    lines.push(`## ${heading}`, "");
    const section = sectionMap.get(heading);
    const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
    for (const [index, block] of blocks.entries()) {
      const blockFacts = (block.factRefs || []).map((id) => factIndex.get(id)).filter(Boolean);
      for (const fact of blockFacts) {
        lines.push(`${index + 1}. ${renderEvidenceBlock(block.kind, fact, questionText, topic)} [${fact.id}]`, "");
      }
    }
  }

  let report = lines.join("\n");
  let lensIndex = 0;
  while (countChineseCharacters(report) < 1_550 && facts.length > 0) {
    const [lensName, lensText] = REPORT_AUDIT_LENSES[lensIndex % REPORT_AUDIT_LENSES.length];
    const fact = facts[lensIndex % facts.length];
    report += `\n## ${lensName}复核\n\n${lensText}。本次问题“${questionText}”仍以${fact.label}的已计算值${formatEvidenceValue(fact.value)}为参照；把观察记录、现实反馈和后续计算分别保存，能够避免把推测误记为事实。 [${fact.id}]\n`;
    lensIndex += 1;
  }
  return report.trim();
}

function renderEvidenceBlock(kind, fact, question, topic) {
  const value = formatEvidenceValue(fact.value);
  if (kind === "fact") {
    return `已计算事实“${fact.label}”记录为${value}，来源系统为${fact.system}；它是回答“${question}”时可以复查的原始依据`;
  }
  if (kind === "reasoning") {
    return `从${fact.label}的记录${value}出发，只能在${topic}范围内建立结构观察：先描述事实，再核对现实条件，不把单一编号解释成确定事件或结果`;
  }
  if (kind === "action") {
    return `以${fact.label}的记录${value}为检查起点，把“${question}”拆成一项可执行、可撤回的现实核对，记录成本、反馈与停止条件，不用命盘事实替代专业决策`;
  }
  return `下一步继续保存${fact.label}的编号与值${value}，补充与“${question}”相关的现实信息；若要判断年度、阶段或具体事件，应先完成相应的确定性计算`;
}

function countChineseCharacters(value) {
  return (String(value || "").match(/[\p{Script=Han}]/gu) || []).length;
}

function inferQuestionTopic(question) {
  const value = String(question || "");
  if (/(?:婚|感情|姻缘|桃花|对象)/u.test(value)) return "姻缘专题";
  if (/(?:行业|职业|事业|工作|转行)/u.test(value)) return "事业与行业专题";
  if (/(?:财|钱|投资|理财|赚钱|收入)/u.test(value)) return "财富专题";
  if (/(?:健康|身体|疾病)/u.test(value)) return "健康专题";
  return "核心诉求专题";
}

function normalizeReportTopic(value, question) {
  const allowed = new Set(["事业与行业专题", "财富专题", "姻缘专题", "健康专题", "核心诉求专题"]);
  if (allowed.has(value)) return value;
  const aliases = {
    事业: "事业与行业专题",
    财运: "财富专题",
    感情: "姻缘专题",
    健康: "健康专题",
    career: "事业与行业专题",
    wealth: "财富专题",
    relationship: "姻缘专题",
    health: "健康专题",
  };
  return aliases[value] || inferQuestionTopic(question);
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
      type: fact.type,
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
    .map((fact) => ({ id: fact.id, system: fact.system, type: fact.type, label: fact.label, value: fact.value }));
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
  const predictiveForm = /(?:将|会|必然|一定|注定|发生|出现|迎来|触发|转为|增长|下降|增加|减少|改善|恶化|升高|降低|扩大|缩小)/u;
  const negatedOrQuestioned = /(?:不能|无法|不可|不应|不足以|没有(?:证据|依据)|未(?:计算|提供|取得)|保持未知|不能确认|不代表|不保证|不据此|并非|尚无|是否|会不会|能否|可否|吗|么|[？?])/u;

  return segments.some((segment) => {
    if (negatedOrQuestioned.test(segment)) return false;
    return timeScope.test(segment) && (predictiveForm.test(segment) || hasAffirmativePredicate(segment));
  });
}

function hasAffirmativePredicate(segment) {
  const withoutScope = segment.replace(/(?:20\d{2}年(?:\d{1,2}月)?|今年|明年|后年|来年|未来(?:\s*\d+\s*年)?|上半年|下半年|本月|下月|本周|下周|流年|大限)/gu, "");
  return withoutScope.replace(/[，,。.!！\s]/gu, "").length >= 2;
}

function removeQuotedQuestions(text) {
  return String(text || "").replace(/[“"]([^”"]+)[”"]/gu, (quoted, inner) => (
    /(?:是否|能否|会不会|可否|吗|么|[？?])/u.test(inner) ? "" : quoted
  ));
}

function containsUnsupportedNamedTermAssertion(text, term) {
  const segments = String(text || "").match(/[^。！？!?；;\n]+[。！？!?]?/gu) || [];
  const negatedOrQuestioned = /(?:不能|无法|不可|不应|不足以|没有(?:证据|依据)|未(?:计算|提供|取得)|保持未知|不能确认|不代表|不保证|不据此|并非|是否|会不会|能否|可否|吗|么|[？?])/u;
  return segments.some((segment) => segment.includes(term) && !negatedOrQuestioned.test(segment));
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

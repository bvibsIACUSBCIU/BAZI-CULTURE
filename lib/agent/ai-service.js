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
const AI_TIMEOUT_MS = () => clampTimeout(envValue("AI_TIMEOUT_MS", "120000"));

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
  if (containsUnsupportedMaterialClaim(assertedText)) {
    return { valid: false, reason: "当前引用事实不能单独支持行业天赋、立即转行或确定盈利等现实结果。" };
  }

  const ziweiFacts = citedFacts.filter((fact) => fact.system === "ziwei");
  const baziFacts = citedFacts.filter((fact) => fact.system === "bazi");
  const ziweiText = JSON.stringify(ziweiFacts.map((fact) => fact.value));
  const baziText = JSON.stringify(baziFacts.map((fact) => fact.value));
  const isBaziTenGodClaim = /(?:八字|十神|藏干|透干)/u.test(assertedText);
  const isZiweiPlacementClaim = /(?:坐|守|入|落|同宫|会照|夹|冲).{0,8}宫|宫.{0,8}(?:坐|守|入|落|同宫|会照)/u.test(assertedText);
  for (const placement of extractZiweiPlacementClaims(assertedText)) {
    const supported = ziweiFacts.some((fact) => (
      fact.type?.startsWith("placement.")
      && fact.value?.palace === placement.palace
      && fact.value?.star === placement.star
    ));
    if (!supported) {
      return { valid: false, reason: `星曜落宫断言【${placement.star}坐${placement.palace}】必须引用该星在该宫的具体落点事实。` };
    }
  }

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

function containsUnsupportedMaterialClaim(text) {
  const value = String(text || "");
  return /天生(?:就)?适合.{0,16}(?:行业|职业|岗位)/u.test(value)
    || /(?:应该|必须|务必|立刻|马上).{0,10}(?:转行|辞职|离职|投资|买入|卖出)/u.test(value)
    || /(?:必然|一定|注定|保证).{0,16}(?:盈利|获利|赚钱|升职|增长|成功|亏损)/u.test(value)
    || /(?:日主|十神|藏干|透干|五行|星曜|宫位).{0,18}(?:说明|表明|代表|意味着|判断).{0,18}(?:性格|冲动|领导力|能力|智力|情商|执行力|创造力)/u.test(value);
}

function extractZiweiPlacementClaims(text) {
  const claims = [];
  const stars = [...MAIN_STARS, ...AUX_STARS].sort((a, b) => b.length - a.length);
  const palaces = [...PALACE_NAMES].sort((a, b) => b.length - a.length);
  for (const star of stars) {
    for (const palace of palaces) {
      const starFirst = new RegExp(`${escapeRegExp(star)}(?:星)?[^。！？!?；;，,]{0,4}(?:坐|守|入|落|同宫|会照|照入|在|位于)[^。！？!?；;，,]{0,4}${escapeRegExp(palace)}`, "u");
      const palaceFirst = new RegExp(`${escapeRegExp(palace)}[^。！？!?；;，,]{0,4}(?:有|见|逢|得|坐|守|入|落|同宫|会照)[^。！？!?；;，,]{0,4}${escapeRegExp(star)}(?:星)?`, "u");
      if (starFirst.test(text) || palaceFirst.test(text)) claims.push({ star, palace });
    }
  }
  return claims;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

你是命理分析任务规划器。你不能输出自由文本标题、结论、性格或能力判断，只能选择主题、受限意图、受限动作和事实编号；服务端会据此渲染任务文案。

【用户问题】${question || "全盘运势剖析与深度解答"}
【已计算证据】${JSON.stringify(plannerEvidence)}

选择规则：
1. 主题固定候选池：事业、财运、感情、健康（用户问题若指向单一主题，只输出该主题；若问题是"今年运势如何"这类整体性提问，四个主题都要）。
2. intent 只能是 fact_review、compare_facts、decision_support、scope_limit。
3. actions 只能从 state_facts、compare_facts、check_reality、identify_unknowns 中选择 1-3 项。
4. evidence_refs 必须只引用已计算证据中实际存在的 fact.id。
4. annual.available 为 false 时，不能要求或假设任何未计算的年度、大限、宫位、事件或信号强度资料；应明确该限制。

严格输出 evidence-plan-v1 JSON：
{
  "schemaVersion": "evidence-plan-v1",
  "topics": [
    {
      "topic": "事业",
      "groups": [
        {
          "intent": "compare_facts",
          "actions": ["state_facts", "check_reality"],
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
    const validation = validateTaskPlanAgainstEvidence(parsed, evidencePayload);
    if (validation.valid) {
      return renderTaskPlanSelection(parsed, question);
    }
    console.warn(`LLM planner evidence validation failed: ${validation.reason}`);
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

你是命理分析证据选择器。你不能输出自由文本结论、性格判断、能力判断或行动命令，只能为服务端选择解释意图与事实编号。

【分析组标题】${groupTitle}
【子任务】${subtasks.join("；")}
【证据范围】${JSON.stringify(promptEvidence.scope)}
【可引用事实】${JSON.stringify(promptEvidence.facts)}

选择要求：
1. conclusion.intent 只能是 scope_answer 或 scope_limit。
2. details.intent 只能是 fact_explanation、compare_facts、reality_check、action_check、scope_limit。
3. 每个 factRefs 只能使用【可引用事实】中的 id，且每个 block 至少引用一条事实。
4. 不得输出 text、markdown、人格特征、能力高低、职业适配、具体事件或确定结果。

严格输出 evidence-interpretation-v1 JSON：
{
  "schemaVersion": "evidence-interpretation-v1",
  "conclusion": { "intent": "scope_answer", "factRefs": ["bazi.dayMaster"] },
  "details": [
    { "intent": "fact_explanation", "factRefs": ["bazi.dayMaster"] },
    { "intent": "reality_check", "factRefs": ["bazi.pillars.day"] }
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
      const check = validateGroupSelectionAgainstEvidence(parsed, resolvedChartData);
      if (check.valid) {
        return renderGroupSelection(parsed, resolvedChartData, groupTitle);
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
  baseUrl = DEFAULT_BASE_URL(),
  onServiceDegraded = null,
} = {}) {
  const name = profile.name || "命主";
  const selectedFactIds = selectWriterFactIds(topics, evidencePayload);
  const writerEvidence = buildPromptEvidence(evidencePayload);
  const evidenceCatalog = buildReadableEvidenceCatalog(evidencePayload);
  const fallback = (reason, error = null) => {
    onServiceDegraded?.({
      stage: "report_writer",
      reason,
      presentation: "full_report",
      message: error?.message || "AI 解读服务未返回可用报告。",
    });
    return buildCompleteReportFallback({
      year,
      profile,
      question,
      evidencePayload,
      reason,
    });
  };
  const prompt = `${SYSTEM_PROMPT_BASE}

你是负责最终成稿的资深命理解读师。请直接撰写有判断、有解释、有现实建议的高质量 Markdown 报告，不要输出 JSON，不要只做证据选择或逐项复述数据。

【当前问题】${question || "本盘总览"}
【标题年份标签】${Number.isInteger(year) ? year : "未指定"}
【计算范围】${JSON.stringify(writerEvidence.scope)}
【完整已计算数据】${JSON.stringify({
    bazi: evidencePayload?.bazi || null,
    ziwei: evidencePayload?.ziwei || null,
    qimen: evidencePayload?.qimen || null,
    annual: evidencePayload?.annual || null,
  })}
【可用依据短标记】${JSON.stringify(evidenceCatalog)}

成稿要求：
1. 先直接回应用户问题，再进行八字、紫微、奇门的交叉解释；只能使用上面的已计算数据，缺失的系统或字段保持未知。
2. 重点解释“这些结构为何与问题有关、彼此如何印证或形成张力、现实中怎样验证”，不要把报告写成原始数据清单。
3. 专业术语后紧跟通俗解释；建议必须具体、低风险、可观察，不能用命盘替代职业、投资、医疗或关系决定。
4. 每个使用盘面事实的段落末尾放一个简短标记，格式严格为“〔依据：八字·日主；紫微·命宫·紫微〕”；只能选用【可用依据短标记】里的 ref。无需每句话标注，也不得输出 bazi.dayMaster 等内部 id。
5. 没有计算流年、大运、年度事件时，明确说明边界，不得编造具体年份事件、收益、升迁、婚期或疾病。
6. 使用 4-7 个有意义的 Markdown 二级标题，避免固定套话、逐条事实复述和重复扩写。正文通常 1200-2200 个中文字符；问题较窄时可更短，以信息密度优先。
7. 只输出最终 Markdown。`;

  if (!apiKey) {
    return fallback("not_configured");
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.6 });
    const markdown = stripMarkdownFence(rawText);
    if (markdown.startsWith("{")) {
      const parsed = JSON.parse(stripJsonFence(markdown));
      const legacyValidation = validateReportWriterOutput(parsed, evidencePayload, selectedFactIds);
      if (legacyValidation.valid) {
        return renderEvidenceSelectionReport({
          selection: parsed,
          evidencePayload,
          year,
          name,
          question,
        });
      }
      console.warn(`LLM report legacy validation failed: ${legacyValidation.reason}`);
      return fallback("invalid_response");
    }
    const validation = validateMarkdownReportAgainstEvidence(markdown, evidencePayload);
    if (validation.valid) return markdown;
    console.warn(`LLM report evidence validation failed: ${validation.reason}`);

    // A capable model can still carry one unsupported year phrase from the
    // user's question into an otherwise useful report. Give it one corrective
    // pass with the exact validator reason before falling back.
    try {
      const correctionPrompt = `${prompt}

【上一稿未通过校验】${validation.reason}
请重新输出完整 Markdown，删除所有未计算的年度、流年、大运或阶段结果断言；年份只能作为标题或问题背景，不能写成会发生、一定发生、增长、升职等结论。只输出修订后的 Markdown。`;
      const correctedText = stripMarkdownFence(await sendLlmRequest({
        prompt: correctionPrompt,
        fetchImpl,
        apiKey,
        model,
        baseUrl,
        temperature: 0.4,
      }));
      if (!correctedText.startsWith("{")) {
        const correctedValidation = validateMarkdownReportAgainstEvidence(correctedText, evidencePayload);
        if (correctedValidation.valid) return correctedText;
        console.warn(`LLM report correction validation failed: ${correctedValidation.reason}`);
        const boundedText = replaceUnsupportedTimeBoundClaims(correctedText, evidencePayload);
        const boundedValidation = validateMarkdownReportAgainstEvidence(boundedText, evidencePayload);
        if (boundedValidation.valid) return boundedText;
      }
    } catch (err) {
      console.warn("LLM report correction request failed:", err?.message || err);
    }
    return fallback("invalid_response");
  } catch (err) {
    console.error("callReportWriter fallback:", err);
    return fallback(err?.name === "TimeoutError" || err?.name === "AbortError" ? "timeout" : "provider_failure", err);
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
  baseUrl = DEFAULT_BASE_URL(),
  onServiceDegraded = null,
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
    onServiceDegraded,
  });
}

/**
 * ⑤ Stage 5: 对话区总结
 */
export async function callChatSummarizer({
  reportMarkdown = "",
  year = 2026,
  question = "",
  evidencePayload = null,
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const summaryEvidence = buildPromptEvidence(evidencePayload);
  const prompt = `${SYSTEM_PROMPT_BASE}

你是对话总结证据选择器。你不能撰写自由文本总结、性格或能力判断，只能选择受限摘要意图和事实编号；服务端会渲染口语化总结。

【用户核心提问】"${question}"
【可引用事实】${JSON.stringify(summaryEvidence)}
【完整运势报告】
${reportMarkdown}

选择规则：
1. blocks.intent 只能是 direct_answer、fact_snapshot、scope_limit、next_check。
2. 每个 factRefs 只能使用【可引用事实】中的 id，并至少引用一条事实。
3. 不得输出 summary、text、markdown、人格特征、能力高低、年度结果或行动命令。
4. 严格输出 evidence-summary-v1 JSON：{"schemaVersion":"evidence-summary-v1","blocks":[{"intent":"direct_answer","factRefs":["实际 fact.id"]},{"intent":"next_check","factRefs":["实际 fact.id"]}]}。`;

  const defaultPrefix = question ? `针对您关注的“${question}”：` : `${year}年运势总结：`;

  if (!apiKey) {
    return buildQuestionSummary(question, reportMarkdown, defaultPrefix);
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.7 });
    const parsed = JSON.parse(stripJsonFence(rawText));
    const validation = validateSummaryAgainstEvidence(parsed, evidencePayload);
    if (validation.valid) return renderSummarySelection(parsed, evidencePayload, question, defaultPrefix);
    console.warn(`LLM summary evidence validation failed: ${validation.reason}`);
    return buildQuestionSummary(question, reportMarkdown, defaultPrefix);
  } catch (err) {
    console.error("callChatSummarizer fallback:", err);
    return buildQuestionSummary(question, reportMarkdown, defaultPrefix);
  }
}

function buildQuestionSummary(question, reportMarkdown, prefix) {
  const report = String(reportMarkdown || "").replace(/^#.*$/mu, "").trim();
  const direct = /## 直接回答：?[\s\S]*?(?=\n## |$)/u.exec(report)?.[0]
    ?.replace(/^## 直接回答：?/u, "").replace(/\s+/gu, " ").trim();
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
      max_tokens: 6000
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
  const topic = normalizeReportTopic(selectedInput.topic, question);
  const facts = collectDynamicBaziFacts(chart);
  const sectionDefinitions = buildDynamicSectionDefinitions(topic);
  const sectionMeta = new Map(sectionDefinitions.map(([key, label, focus]) => [key, { label, focus }]));
  const sectionParagraphs = Object.fromEntries(sectionDefinitions.map(([key]) => [key, []]));

  sectionParagraphs.corePortrait.push(renderDynamicFactIndex({ topic, question, facts, focus: sectionMeta.get("corePortrait").focus }));
  for (const fact of facts) {
    const sectionKey = classifyDynamicFactSection(fact);
    const meta = sectionMeta.get(sectionKey);
    sectionParagraphs[sectionKey].push(renderDynamicFactAnalysis({ fact, topic, question, sectionLabel: meta.label, focus: meta.focus }));
  }
  for (const combination of selectDynamicFactCombinations(facts, topic)) {
    const meta = sectionMeta.get(combination.sectionKey);
    sectionParagraphs[combination.sectionKey].push(renderDynamicFactCombination({
      ...combination,
      topic,
      question,
      sectionLabel: meta.label,
      focus: meta.focus,
    }));
  }
  for (const [sectionKey, paragraphs] of Object.entries(sectionParagraphs)) {
    if (paragraphs.length > 0) continue;
    const meta = sectionMeta.get(sectionKey);
    const basis = selectDynamicSectionBasis(sectionKey, facts);
    paragraphs.push(renderDynamicSectionBridge({ basis, topic, question, sectionLabel: meta.label, focus: meta.focus }));
  }

  return Object.fromEntries(sectionDefinitions.map(([sectionKey]) => [sectionKey, sectionParagraphs[sectionKey].join("\n\n")]));
}

function collectDynamicBaziFacts(chart) {
  const facts = [];
  const push = (id, label, value) => {
    if (value !== undefined && value !== null && String(value).trim()) facts.push({ id, label, value: String(value) });
  };
  const positionLabels = { year: "年柱", month: "月柱", day: "日柱", time: "时柱" };
  for (const position of ["year", "month", "day", "time"]) {
    push(`bazi.pillars.${position}`, positionLabels[position], chart?.pillars?.[position]);
  }
  push("bazi.dayMaster", "日主", `${chart?.dayMaster?.stem || "未取得"}${chart?.dayMaster?.element || ""}`);
  for (const element of ["木", "火", "土", "金", "水"]) {
    if (Number.isFinite(chart?.elementCounts?.[element])) {
      push(`bazi.elementCounts.${element}`, `${element}行表层计数`, chart.elementCounts[element]);
    }
  }
  for (const [position, tenGod] of Object.entries(chart?.tenGods?.stems || {})) {
    push(`bazi.tenGods.stems.${position}`, `${positionLabels[position] || position}透干十神`, tenGod);
  }
  for (const [position, branch] of Object.entries(chart?.tenGods?.branches || {})) {
    for (const [index, item] of (branch?.stems || []).entries()) {
      push(
        `bazi.tenGods.branches.${position}.${index}`,
        `${positionLabels[position] || position}藏干十神`,
        `${item.stem || ""}·${item.name || "未标注"}（${item.role || "藏干"}）`,
      );
    }
  }
  for (const relationGroup of ["stems", "branches", "groups"]) {
    for (const [index, relation] of (chart?.relations?.[relationGroup] || []).entries()) {
      push(`bazi.relations.${relationGroup}.${index}`, "干支关系", formatDynamicRelation(relation));
    }
  }
  return facts.length ? facts : [{ id: "bazi.chart.scope", label: "排盘范围", value: "本次未取得完整结构" }];
}

function formatDynamicRelation(relation) {
  if (typeof relation === "string") return relation;
  if (relation?.label || relation?.name || relation?.value) return relation.label || relation.name || relation.value;
  const positionLabels = { year: "年柱", month: "月柱", day: "日柱", time: "时柱" };
  const positions = (relation?.positions || []).map((position) => positionLabels[position] || position).join("、");
  return `${positions}${relation?.symbols || relation?.branches || ""}·${relation?.type || "关系"}`;
}

function buildDynamicSectionDefinitions(topic) {
  const topicFocus = {
    "事业与行业专题": ["岗位职责与能力组合", "职业选择与协作方式", "合作承诺与团队沟通", "工作节奏与身体反馈", "收入来源与现金流条件", "转行问题的现实验证"],
    "财富专题": ["资产与现金流的结构起点", "收入所依赖的职业条件", "共同财务与契约边界", "消费节奏与压力反馈", "预算风险和资金用途", "财务问题的阶段核对"],
    "姻缘专题": ["关系模式的结构起点", "工作安排对相处的影响", "沟通承诺与边界", "情绪和身体感受记录", "共同支出与责任分配", "关系问题的现实核对"],
    "健康专题": ["日常状态的结构记录", "工作负荷与恢复安排", "支持关系与求助渠道", "作息症状和医学记录", "健康支出的预算条件", "身体问题的专业核对"],
    "核心诉求专题": ["问题涉及的结构起点", "现实任务与资源条件", "关系角色与沟通条件", "身心状态与生活记录", "成本收益与风险边界", "下一步需要补充的信息"],
  }[topic];
  const labels = ["核心画像", "事业发展模式", "情感关系模式", "健康相关事实", "财富运行方式", "本题回应"];
  const keys = ["corePortrait", "career", "relationship", "health", "wealth", "currentStage"];
  return keys.map((key, index) => [key, labels[index], topicFocus[index]]);
}

function renderDynamicFactIndex({ topic, question, facts, focus }) {
  const anchors = facts.map((fact) => `[${fact.id}=${fact.value}]`).join("；");
  const dayMaster = facts.find((fact) => fact.id === "bazi.dayMaster");
  return `核心画像围绕“${question}”进入${topic}${dayMaster ? `，排盘日主${dayMaster.value}` : ""}。本轮实际取得的结构索引为${anchors}。这些编号和值共同界定${focus}，后文只会使用这里真实存在的事实：四柱负责定位干支位置，日主记录参照天干与五行，表层计数描述四柱可见元素，十神保存相对关系名称，干支关系保存引擎识别出的组合。阅读时应先核对输入与原值，再区分结构记录、命理解释和现实反馈三层；当前未计算的年份、阶段、事件、性格与能力结论不会因为篇幅要求被补写。`;
}

function classifyDynamicFactSection(fact) {
  if (fact.id === "bazi.dayMaster" || /pillars\.(?:year|month)$/u.test(fact.id)) return "corePortrait";
  if (fact.id === "bazi.pillars.day" || fact.id.includes("tenGods.branches") || fact.id.includes("relations")) return "relationship";
  if (fact.id === "bazi.pillars.time") return "currentStage";
  if (fact.id.includes("tenGods.stems")) return "career";
  if (fact.id.includes("elementCounts.木") || fact.id.includes("elementCounts.火")) return "health";
  if (fact.id.includes("elementCounts")) return "wealth";
  return "currentStage";
}

function renderDynamicFactAnalysis({ fact, topic, question, sectionLabel, focus }) {
  const anchor = `[${fact.id}=${fact.value}]`;
  const scope = dynamicFactScope(fact);
  const topicMethod = dynamicTopicMethod(topic);
  return `${sectionLabel}针对“${question}”先读取${fact.label}${anchor}。这条记录在本轮只直接说明${scope}，因此它能参与${focus}的结构核对，却不能单独证明某种个性、能力、职业适配、收益、关系结果或健康结论。进一步解释时至少保留两条替代路径：一是同一结构在不同现实资源、职责和关系条件下可能呈现不同反馈；二是用户当前的问题可能需要年度、阶段、专业测量或真实行为记录，而这些尚未进入计算。围绕${topic}，${topicMethod}。可执行的做法是把事实原值、现实观察、相反证据和停止条件分栏记录，先做低成本、可撤回的核对；如果现实资料与该编号不一致，应优先检查输入、计算范围与现实条件，而不是修改事实含义来迎合预期。`;
}

function dynamicFactScope(fact) {
  if (fact.id.includes("pillars")) return "该干支在四柱中的明确位置";
  if (fact.id === "bazi.dayMaster") return "日柱天干及其五行归属";
  if (fact.id.includes("elementCounts")) return "四柱天干与地支主元素的表层数量";
  if (fact.id.includes("tenGods")) return "以日主为参照计算出的十神名称与所在位置";
  if (fact.id.includes("relations")) return "排盘引擎已经识别出的干支结构关系";
  return "本次排盘实际返回的结构字段";
}

function dynamicTopicMethod(topic) {
  return {
    "事业与行业专题": "应把岗位职责、技能证据、协作反馈、转换成本与事实编号并列比较，再判断哪个现实方案值得试验",
    "财富专题": "应把收入来源、固定支出、合同责任、风险承受度和现金流记录与事实编号分开保存，不把结构值直接换算成盈亏",
    "姻缘专题": "应把沟通频率、承诺边界、冲突记录、共同责任和双方反馈与事实编号对应，不把结构值直接替代对方意愿",
    "健康专题": "应把作息、症状、持续时间、诱因和专业检查结果单独记录，命盘结构只作问题整理线索，不替代医学判断",
    "核心诉求专题": "应先把目标、资源、限制、现实反馈与未知信息拆开，再确认当前计算事实究竟能回答问题的哪一部分",
  }[topic];
}

function selectDynamicFactCombinations(facts, topic) {
  const factIndex = new Map(facts.map((fact) => [fact.id, fact]));
  const dayMaster = factIndex.get("bazi.dayMaster");
  const dayPillar = factIndex.get("bazi.pillars.day");
  const combinations = [];
  const seen = new Set();
  const add = (sectionKey, left, right, purpose) => {
    if (!left || !right || left.id === right.id) return;
    const ids = [left.id, right.id].sort();
    const key = `${ids.join("|")}|${purpose}`;
    if (seen.has(key)) return;
    seen.add(key);
    combinations.push({ sectionKey, left, right, purpose });
  };

  if (topic === "事业与行业专题") {
    add("currentStage", dayMaster, dayPillar, "把问题拆成结构条件与现实决策条件");
    for (const fact of facts.filter((item) => item.id.includes("tenGods.stems"))) {
      const position = fact.id.split(".").at(-1);
      add("career", fact, factIndex.get(`bazi.pillars.${position}`) || dayMaster, "核对十神位置与对应柱位");
    }
    for (const fact of facts.filter((item) => item.id.includes("relations"))) {
      add("career", fact, dayMaster, "区分关系结构与职业现实反馈");
    }
  } else if (topic === "财富专题") {
    const comparison = facts.find((item) => item.id.includes("tenGods")) || dayMaster;
    for (const fact of facts.filter((item) => item.id.includes("elementCounts"))) {
      add("wealth", fact, comparison, "把结构数量与现实现金流条件分开核对");
    }
  } else if (topic === "姻缘专题") {
    for (const fact of facts.filter((item) => item.id.includes("tenGods.branches") || item.id.includes("relations"))) {
      add("relationship", fact, dayPillar || dayMaster, "把关系结构与双方现实记录分别核对");
    }
  } else if (topic === "健康专题") {
    for (const fact of facts.filter((item) => item.id.includes("elementCounts"))) {
      add("health", fact, dayMaster, "把表层数量与生活及医学记录分开核对");
      add("health", fact, dayPillar, "把表层数量与日柱位置及现实健康记录分开核对");
    }
  } else {
    for (const fact of facts.filter((item) => item.id.includes("pillars"))) {
      add("currentStage", fact, dayMaster, "确认问题范围与当前事实坐标");
    }
  }
  return combinations;
}

function renderDynamicFactCombination({ left, right, purpose, topic, question, sectionLabel, focus }) {
  const leftAnchor = `[${left.id}=${left.value}]`;
  const rightAnchor = `[${right.id}=${right.value}]`;
  return `${sectionLabel}在${topic}中把${left.label}${leftAnchor}与${right.label}${rightAnchor}组成一个实际存在的证据对，用于${purpose}。回答“${question}”时，先说明两项各自记录了什么，再观察它们是否指向同一类结构信息；如果二者来源、位置或计量口径不同，就不能把名称相近当成相互证明。可考虑的替代解释包括现实环境改变、角色要求不同、用户目标变化以及尚未计算的年度条件，因此本段不把组合直接写成结果。行动上应为两项分别设置可观察指标和反例：记录什么现象支持当前理解、什么现象会推翻它、多久复查一次、出现何种成本就停止。这样形成的建议来自当前事实组合与问题语境，而不是为了凑足篇幅重复轮换同一组编号。`;
}

function selectDynamicSectionBasis(sectionKey, facts) {
  const preferences = {
    career: ["tenGods.stems", "dayMaster", "pillars.month"],
    relationship: ["pillars.day", "tenGods.branches", "relations"],
    health: ["elementCounts", "dayMaster"],
    wealth: ["elementCounts", "tenGods", "dayMaster"],
    currentStage: ["pillars.time", "dayMaster", "pillars.day"],
    corePortrait: ["dayMaster", "pillars"],
  }[sectionKey] || [];
  return preferences.flatMap((needle) => facts.filter((fact) => fact.id.includes(needle))).at(0) || facts[0];
}

function renderDynamicSectionBridge({ basis, topic, question, sectionLabel, focus }) {
  const anchor = `[${basis.id}=${basis.value}]`;
  return `${sectionLabel}围绕“${question}”的${topic}目前可直接调用的起点是${basis.label}${anchor}。由于本轮没有更多属于${focus}的独立计算项，本段不复制不存在的事实，而是明确怎样使用这条现有记录：先核对原值和来源，再列出与本题相关的现实条件、相反案例、需要专业资料确认的部分以及尚未计算的时间范围。替代方案应以现实信息为依据，例如补充职责、收支、沟通或身体记录，并设置可撤回的验证步骤；只有新增了相应事实，后续报告才增加新的组合段落。`;
}

function mockTaskPlan(question, profile, signals) {
  const q = String(question || "").trim();
  const kind = /婚|感情|姻缘|桃花|对象/.test(q) ? "姻缘专题" : /行业|职业|事业|工作/.test(q) ? "事业与行业专题" : /财|钱|投资|理财|赚钱/.test(q) ? "财富专题" : "核心诉求专题";
  const gTitle = `${kind}：直接回应“${q || "本盘总览"}”`;
  const evidenceRefs = selectPlannerFallbackRefs(signals, kind);

  return {
    schemaVersion: "evidence-plan-v1",
    topics: [
      {
        topic: kind,
        groups: [
          {
            intent: "fact_review",
            actions: ["state_facts", "check_reality", "identify_unknowns"],
            group_title: gTitle,
            subtasks: [
              `只回答“${q || '本盘总览'}”所涉及的${kind}，不扩展为全盘年度模板。`,
              "引用已计算的四柱、十神与干支关系，区分事实、限制与可核对问题。"
            ],
            evidence_refs: evidenceRefs
          }
        ]
      }
    ]
  };
}

function selectPlannerFallbackRefs(signals, topic) {
  const palaceByTopic = {
    "事业与行业专题": new Set(["官禄宫", "事业宫", "迁移宫"]),
    "财富专题": new Set(["财帛宫", "田宅宫"]),
    "姻缘专题": new Set(["夫妻宫", "命宫", "福德宫"]),
    "健康专题": new Set(["疾厄宫", "福德宫"]),
    "核心诉求专题": new Set(["命宫"]),
  }[topic] || new Set();
  const refs = signals.filter((fact) => {
    if (!fact?.id) return false;
    if (fact.system === "bazi") return true;
    if (fact.system === "ziwei") {
      if (fact.type?.startsWith("placement.")) return palaceByTopic.has(fact.value?.palace);
      return ["ziwei.soul", "ziwei.body", "ziwei.fiveElementsClass"].includes(fact.id);
    }
    if (fact.system === "qimen") return ["qimen.juShu", "qimen.zhiFu", "qimen.zhiShi"].includes(fact.id);
    return false;
  }).map((fact) => fact.id);
  return [...new Set(refs)];
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
    ...unique.filter((id) => id.startsWith("ziwei.placement.")),
    ...["qimen.palaces"].filter((id) => unique.includes(id)),
    ...unique,
  ];
  return [...new Set(priority)];
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

function buildReadableEvidenceCatalog(evidencePayload) {
  const seen = new Set();
  return [...buildCalculatedFactIndex(evidencePayload).values()].flatMap((fact) => {
    const ref = readableEvidenceRef(fact);
    if (!ref || seen.has(ref)) return [];
    seen.add(ref);
    return [{ ref, system: systemDisplayName(fact.system), label: fact.label, value: fact.value }];
  });
}

function readableEvidenceRef(fact) {
  if (!fact) return "";
  if (fact.id.startsWith("bazi.pillars.")) {
    const position = fact.id.split(".").at(-1);
    return `八字·${{ year: "年柱", month: "月柱", day: "日柱", time: "时柱" }[position] || fact.label}`;
  }
  if (fact.id === "bazi.dayMaster") return "八字·日主";
  if (fact.id === "bazi.elementCounts") return "八字·五行分布";
  if (fact.id === "bazi.tenGods") return "八字·十神";
  if (fact.id === "bazi.relations") return "八字·干支关系";
  if (fact.id === "bazi.lunarLabel") return "八字·农历";
  if (fact.system === "ziwei" && fact.value?.palace && fact.value?.star) {
    return `紫微·${fact.value.palace}·${fact.value.star}`;
  }
  if (fact.system === "ziwei" && fact.id.startsWith("ziwei.palace.")) {
    return fact.value?.name ? `紫微·${fact.value.name}` : "";
  }
  if (fact.system === "ziwei") return `紫微·${ziweiFieldLabel(fact.id.split(".").at(-1), fact.label)}`;
  if (fact.system === "qimen") return `奇门·${qimenFieldLabel(fact.id.split(".").at(-1), fact.label)}`;
  return "";
}

function systemDisplayName(system) {
  return { bazi: "八字", ziwei: "紫微斗数", qimen: "奇门遁甲" }[system] || system;
}

function ziweiFieldLabel(field, fallback) {
  return {
    soul: "命主", body: "身主", fiveElementsClass: "五行局",
    soulPalaceBranch: "命宫地支", bodyPalaceBranch: "身宫地支",
    zodiac: "生肖", sign: "星座", timeLabel: "时辰",
  }[field] || fallback;
}

function qimenFieldLabel(field, fallback) {
  return {
    siZhu: "四柱", juShu: "局数", xunShou: "旬首", zhiFu: "值符",
    zhiShi: "值使", emptyPalaces: "空亡", horse: "驿马", palaces: "九宫",
  }[field] || fallback;
}

function validateMarkdownReportAgainstEvidence(markdown, evidencePayload) {
  const text = String(markdown || "").trim();
  if (!text.startsWith("#") || (text.match(/^##\s+/gmu) || []).length < 3) {
    return { valid: false, reason: "报告必须是结构完整的 Markdown 正文。" };
  }
  if (/\[(?:bazi|ziwei|qimen)\.[^\]]+\]/u.test(text) || /(?:bazi|ziwei|qimen)\.[a-z]/iu.test(text)) {
    return { valid: false, reason: "报告暴露了内部事实 id。" };
  }
  const availableRefs = new Set(buildReadableEvidenceCatalog(evidencePayload).map((item) => item.ref));
  const markers = [...text.matchAll(/〔依据：([^〕]+)〕/gu)]
    .flatMap((match) => match[1].split(/[；;]/u).map((item) => item.trim()).filter(Boolean));
  if (availableRefs.size > 0 && markers.length < Math.min(2, availableRefs.size)) {
    return { valid: false, reason: "报告缺少足够的简洁依据标记。" };
  }
  for (const ref of markers) {
    if (!availableRefs.has(ref)) return { valid: false, reason: `报告引用了未计算的依据【${ref}】。` };
  }
  // Markdown headings label the report and are not predictive assertions. A year
  // in a title such as "2026年职业选择解读" must not trigger the body guard.
  const assertionText = text.split(/\r?\n/u)
    .filter((line) => !/^\s{0,3}#{1,6}\s/u.test(line))
    .join("\n")
    // Quoted question wording or an example is not a claim made by the report.
    .replace(/[“"][^”"]+[”"]/gu, "");
  if (evidencePayload?.annual?.available !== true && containsUnsupportedTimeBoundEventClaim(assertionText)) {
    return { valid: false, reason: "报告包含未计算的年度或阶段肯定断言。" };
  }
  const dayMaster = evidencePayload?.bazi?.dayMaster;
  const dayMasterClaims = [
    ...text.matchAll(/日主(?:为|是|属)?\s*([甲乙丙丁戊己庚辛壬癸])([木火土金水])?/gu),
    ...text.matchAll(/([甲乙丙丁戊己庚辛壬癸])([木火土金水])日主/gu),
  ];
  for (const claim of dayMasterClaims) {
    const [, stem, element] = claim;
    if (stem !== dayMaster?.stem || (element && element !== dayMaster?.element)) {
      return { valid: false, reason: `报告中的日主标识【${stem}${element || ""}】与计算结果不一致。` };
    }
  }
  const evidenceText = JSON.stringify({ ziwei: evidencePayload?.ziwei, qimen: evidencePayload?.qimen });
  const ziweiPlacements = [...buildCalculatedFactIndex(evidencePayload).values()]
    .filter((fact) => fact.system === "ziwei" && fact.value?.palace && fact.value?.star);
  for (const placement of extractZiweiPlacementClaims(text)) {
    if (!ziweiPlacements.some((fact) => fact.value.palace === placement.palace && fact.value.star === placement.star)) {
      return { valid: false, reason: `报告使用了未计算的星曜落宫【${placement.star}坐${placement.palace}】。` };
    }
  }
  for (const star of [...MAIN_STARS, ...AUX_STARS]) {
    if (containsUnsupportedNamedTermAssertion(text, star) && !evidenceText.includes(star)) {
      return { valid: false, reason: `报告使用了未计算的星曜【${star}】。` };
    }
  }
  for (const palace of PALACE_NAMES) {
    if (containsUnsupportedNamedTermAssertion(text, palace) && !evidenceText.includes(palace)) {
      return { valid: false, reason: `报告使用了未计算的宫位【${palace}】。` };
    }
  }
  for (const sihua of SIHUA_NAMES) {
    if (containsUnsupportedNamedTermAssertion(text, sihua) && !evidenceText.includes(sihua)) {
      return { valid: false, reason: `报告使用了未计算的四化【${sihua}】。` };
    }
  }
  const qimen = evidencePayload?.qimen;
  for (const match of text.matchAll(/值符(?:为|是|临|落)?\s*([天蓬任冲辅英芮柱心禽]{2})/gu)) {
    if (!JSON.stringify(qimen?.zhiFu || {}).includes(match[1])) {
      return { valid: false, reason: `报告使用了未计算的值符【${match[1]}】。` };
    }
  }
  for (const match of text.matchAll(/值使(?:为|是|临|落)?\s*([休生伤杜景死惊开]门)/gu)) {
    if (!JSON.stringify(qimen?.zhiShi || {}).includes(match[1])) {
      return { valid: false, reason: `报告使用了未计算的值使【${match[1]}】。` };
    }
  }
  return { valid: true };
}

function buildCompleteReportFallback({ year, profile, question, evidencePayload, reason }) {
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  const fact = (id) => factIndex.get(id)?.value;
  const pillars = ["year", "month", "day", "time"]
    .map((position) => fact(`bazi.pillars.${position}`))
    .filter(Boolean);
  const dayMaster = fact("bazi.dayMaster");
  const elements = fact("bazi.elementCounts");
  const name = profile?.name || "命主";
  const questionText = String(question || "本盘总览").trim();
  const topic = inferQuestionTopic(questionText);
  const dynamicSections = buildDynamicUserReport(evidencePayload?.bazi || {}, {
    question: questionText,
    topic,
  });
  const cleanSection = (text) => String(text || "")
    .replace(/\s*\[bazi\.[^\]]+\]/gu, "")
    .replace(/本轮实际取得的结构索引为[^。]*。/gu, "本轮以已排出的四柱、日主、五行与干支关系作为核对基础。")
    .replace(/这些编号和值/gu, "这些结构字段")
    .replace(/事实编号/gu, "命盘记录")
    .replace(/至少保留两条替代路径/gu, "同时保留不同的现实解释")
    .replace(/\s{2,}/gu, " ")
    .trim();
  const palaceByTopic = {
    "姻缘专题": ["夫妻", "命", "福德"],
    "事业与行业专题": ["官禄", "迁移", "命"],
    "财富专题": ["财帛", "田宅", "命"],
    "健康专题": ["疾厄", "福德", "命"],
    "核心诉求专题": ["命", "福德"],
  }[topic] || [];
  const ziweiDetails = (evidencePayload?.ziwei?.palaces || [])
    .filter((palace) => palaceByTopic.some((name) => palace.name?.includes(name)))
    .slice(0, 3)
    .map((palace) => {
      const stars = [...(palace.majorStars || []), ...(palace.minorStars || [])]
        .map((star) => star.name).filter(Boolean).join("、");
      return `${palace.name}${stars ? `宫见${stars}` : "宫已排出"}`;
    });
  const qimenDetails = [
    evidencePayload?.qimen?.juShu?.fullName,
    evidencePayload?.qimen?.zhiFu?.star ? `值符${evidencePayload.qimen.zhiFu.star}` : "",
    evidencePayload?.qimen?.zhiShi?.door ? `值使${evidencePayload.qimen.zhiShi.door}` : "",
  ].filter(Boolean).join("；");
  const topicLead = {
    "姻缘专题": "把问题拆成相处节奏、沟通方式、承诺边界和双方真实反馈四部分来看",
    "事业与行业专题": "把问题拆成工作内容、协作方式、成长反馈和现实机会四部分来看",
    "财富专题": "把问题拆成收入来源、支出责任、风险承受和现金流记录四部分来看",
    "健康专题": "把问题拆成作息、症状记录、压力来源和专业检查四部分来看",
    "核心诉求专题": "先区分命盘中已知的结构信息与现实中仍需核实的条件",
  }[topic];
  const titleYear = Number.isInteger(year) ? `${year}年 ` : "";
  void reason;
  return `# ${titleYear}${name} · ${topic}解读

## 直接回应

针对“${questionText}”，本轮可以${topicLead}。已排出的四柱为${pillars.join("、") || "未完整取得"}${dayMaster?.stem ? `，日主为${dayMaster.stem}${dayMaster.element || ""}` : ""}。这些资料适合作为观察和提问的起点，不替代另一方意愿、现实沟通或重大人生决定。

## 三盘事实坐标

八字记录的表层五行计数为${elements ? Object.entries(elements).map(([key, value]) => `${key}${value}`).join("、") : "未完整取得"}。${ziweiDetails.length ? `紫微盘中，本题相关的已排出位置包括${ziweiDetails.join("；")}。` : "紫微盘未提供本题可用的宫位摘要。"}${qimenDetails ? `奇门本次起局记录为${qimenDetails}。` : "奇门本次未取得可用的结构摘要。"}这些均为程序实际计算的结构坐标，后续解读只围绕这些已知字段展开。

## 核心画像

${cleanSection(dynamicSections.corePortrait)}

## 事业发展模式

${cleanSection(dynamicSections.career)}

## 情感关系模式

${cleanSection(dynamicSections.relationship)}

## 健康相关事实

${cleanSection(dynamicSections.health)}

## 财富运行方式

${cleanSection(dynamicSections.wealth)}

## 本题回应与现实核对

${cleanSection(dynamicSections.currentStage)}

本轮没有计算流年、大运或具体事件，因此不判断某一年一定发生的婚姻、收入、职业或健康结果。把报告中与本题相关的观察点写成现实记录，并和当事人的沟通、责任分配、实际条件一起复核，结论才会更可靠。`;
}

function formatEvidenceValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.stem && value.element) {
    return `${value.stem}${value.element}`;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && value.palace && value.star) {
    return `${value.star}坐${value.palace}${value.brightness ? `（${value.brightness}）` : ""}${value.mutagen ? `·${value.mutagen}` : ""}`;
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
  const buckets = { fact: [], reasoning: [], action: [] };
  for (const ref of refs) {
    if (/(?:tenGods|relations|ziwei\.placement|ziwei\.palace)/u.test(ref)) buckets.reasoning.push(ref);
    else if (/(?:elementCounts|qimen\.)/u.test(ref)) buckets.action.push(ref);
    else buckets.fact.push(ref);
  }
  const primary = refs.find((ref) => ref === "bazi.dayMaster") || refs[0];
  const blocks = (kind, selectedRefs) => (selectedRefs.length ? selectedRefs : [primary])
    .filter(Boolean)
    .map((factRef) => ({ kind, factRefs: [factRef] }));
  return {
    schemaVersion: "evidence-selection-v1",
    directAnswer: { factRefs: refs.slice(0, 2) },
    sections: [
      { heading: "本题依据", blocks: blocks("fact", buckets.fact) },
      { heading: "如何理解", blocks: blocks("reasoning", buckets.reasoning) },
      { heading: "行动建议", blocks: blocks("action", buckets.action) },
      { heading: "下一步", blocks: [{ kind: "next_step", factRefs: primary ? [primary] : [] }] },
    ],
  };
}

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
  if (facts.length > 0) {
    lines.push("## 事实组合解读", "");
    for (const paragraph of buildEvidenceCombinationParagraphs(facts, questionText, topic)) {
      lines.push(paragraph, "");
    }
  }
  return lines.join("\n").trim();
}

function buildEvidenceCombinationParagraphs(facts, question, topic) {
  return facts.map((fact, index) => {
    const companion = selectEvidenceCompanion(fact, facts, topic);
    const factValue = formatEvidenceValue(fact.value);
    const companionText = companion
      ? `并与${companion.label}的计算值${formatEvidenceValue(companion.value)}交叉核对`
      : "并保留为本题当前唯一可用的同类结构记录";
    const companionRef = companion ? ` [${companion.id}]` : "";
    return `${index + 1}. 围绕“${question}”的${topic}，本段从${fact.label}的实际计算值${factValue}出发，${companionText}。这组当前存在的事实可以支持三层工作：先核对输入、位置与计算口径是否一致；再说明它们在结构上能比较什么、不能推出什么；最后把命盘记录与岗位、收支、沟通、身体反馈等现实资料分开保存。至少保留两种替代解释，一种来自现实条件差异，另一种来自尚未计算的年度、阶段或专业数据，避免把用户期待写成已经发生的结果。行动时只选择低成本、可撤回、可记录反例的步骤，并事先写明何种反馈会支持当前理解、何种反馈会要求停止或重算。 [${fact.id}]${companionRef}`;
  });
}

function selectEvidenceCompanion(fact, facts, topic) {
  const candidates = facts.filter((item) => item.id !== fact.id);
  const exactPreferences = [];
  if (fact.id.startsWith("bazi.tenGods.stems.")) {
    exactPreferences.push(`bazi.pillars.${fact.id.split(".").at(-1)}`, "bazi.dayMaster");
  } else if (fact.id.startsWith("bazi.tenGods.branches.")) {
    exactPreferences.push(`bazi.pillars.${fact.id.split(".")[3]}`, "bazi.pillars.day", "bazi.dayMaster");
  } else if (fact.id.startsWith("bazi.elementCounts")) {
    exactPreferences.push(topic === "财富专题" ? "bazi.tenGods" : "bazi.dayMaster");
  } else if (fact.id.startsWith("bazi.pillars.")) {
    exactPreferences.push("bazi.dayMaster", "bazi.tenGods");
  } else if (fact.id.startsWith("ziwei.placement.")) {
    exactPreferences.push("ziwei.palace.");
  } else if (fact.id.startsWith("qimen.")) {
    exactPreferences.push("qimen.");
  }
  for (const preference of exactPreferences) {
    const matched = candidates.find((item) => item.id === preference || item.id.startsWith(preference));
    if (matched) return matched;
  }
  return candidates.find((item) => item.system === fact.system) || candidates[0] || null;
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

const PLANNER_INTENTS = new Set(["fact_review", "compare_facts", "decision_support", "scope_limit"]);
const PLANNER_ACTIONS = new Set(["state_facts", "compare_facts", "check_reality", "identify_unknowns"]);
const GROUP_CONCLUSION_INTENTS = new Set(["scope_answer", "scope_limit"]);
const GROUP_DETAIL_INTENTS = new Set(["fact_explanation", "compare_facts", "reality_check", "action_check", "scope_limit"]);
const SUMMARY_INTENTS = new Set(["direct_answer", "fact_snapshot", "scope_limit", "next_check"]);

function validateTaskPlanAgainstEvidence(plan, evidencePayload) {
  if (!plan || plan.schemaVersion !== "evidence-plan-v1"
    || !Array.isArray(plan.topics) || plan.topics.length === 0) {
    return { valid: false, reason: "规划结果必须使用 evidence-plan-v1 并包含 topics。" };
  }
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  for (const [topicIndex, topic] of plan.topics.entries()) {
    if (!topic || !["事业", "财运", "感情", "健康"].includes(topic.topic) || !Array.isArray(topic.groups)) {
      return { valid: false, reason: `topics[${topicIndex}] 结构无效。` };
    }
    for (const [groupIndex, group] of topic.groups.entries()) {
      if (!group || !PLANNER_INTENTS.has(group.intent) || !Array.isArray(group.actions)
        || group.actions.length === 0 || group.actions.length > 3
        || !Array.isArray(group.evidence_refs) || group.evidence_refs.length === 0) {
        return { valid: false, reason: `topics[${topicIndex}].groups[${groupIndex}] 缺少受限意图、动作或事实引用。` };
      }
      if (!group.actions.every((action) => PLANNER_ACTIONS.has(action))) {
        return { valid: false, reason: `topics[${topicIndex}].groups[${groupIndex}] 包含未允许的动作。` };
      }
      for (const ref of group.evidence_refs) {
        if (!factIndex.has(ref)) return { valid: false, reason: `规划器引用了不存在的事实【${ref}】。` };
      }
    }
  }
  return { valid: true };
}

function renderTaskPlanSelection(selection, question) {
  const questionText = String(question || "本盘总览").trim();
  const intentLabels = {
    fact_review: "事实核对",
    compare_facts: "事实比较",
    decision_support: "决策条件整理",
    scope_limit: "证据范围确认",
  };
  const actionText = {
    state_facts: (topic) => `逐项陈述本轮${topic}范围内已计算事实的原值与编号。`,
    compare_facts: (topic) => `比较本轮${topic}事实之间可见的结构差异，不外推性格、能力或结果。`,
    check_reality: () => `把已计算事实与“${questionText}”相关的现实条件分别记录并核对。`,
    identify_unknowns: () => "列出当前未计算的年度、阶段、事件与现实资料，保持未知边界。",
  };
  return {
    schemaVersion: selection.schemaVersion,
    topics: selection.topics.map((topic) => ({
      topic: topic.topic,
      groups: topic.groups.map((group) => ({
        intent: group.intent,
        actions: [...group.actions],
        group_title: `${topic.topic} · ${intentLabels[group.intent]}：回应“${questionText}”`,
        subtasks: group.actions.map((action) => actionText[action](topic.topic)),
        evidence_refs: [...new Set(group.evidence_refs)],
      })),
    })),
  };
}

function validateGroupSelectionAgainstEvidence(selection, evidencePayload) {
  if (!selection || selection.schemaVersion !== "evidence-interpretation-v1"
    || !selection.conclusion || !Array.isArray(selection.details) || selection.details.length === 0) {
    return { valid: false, reason: "组分析必须使用 evidence-interpretation-v1 结构。" };
  }
  if (!GROUP_CONCLUSION_INTENTS.has(selection.conclusion.intent)) {
    return { valid: false, reason: "组分析 conclusion 使用了未允许的解释意图。" };
  }
  const blocks = [selection.conclusion, ...selection.details];
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  for (const [index, block] of blocks.entries()) {
    const allowed = index === 0 ? GROUP_CONCLUSION_INTENTS : GROUP_DETAIL_INTENTS;
    if (!allowed.has(block?.intent) || !Array.isArray(block.factRefs) || block.factRefs.length === 0) {
      return { valid: false, reason: `组分析 block[${index}] 缺少受限意图或事实引用。` };
    }
    for (const ref of block.factRefs) {
      if (!factIndex.has(ref)) return { valid: false, reason: `组分析引用了不存在的事实【${ref}】。` };
    }
  }
  return { valid: true };
}

function renderGroupSelection(selection, evidencePayload, groupTitle) {
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  const render = (block) => {
    const facts = block.factRefs.map((ref) => factIndex.get(ref)).filter(Boolean);
    return renderEvidenceInterpretation(block.intent, facts, groupTitle, evidencePayload);
  };
  const conclusion = render(selection.conclusion);
  const details = selection.details.map(render);
  const evidenceRefs = [...new Set([
    ...selection.conclusion.factRefs,
    ...selection.details.flatMap((detail) => detail.factRefs),
  ])];
  return { conclusion, details, evidenceRefs };
}

function renderEvidenceInterpretation(intent, facts, groupTitle, evidencePayload) {
  const factText = describeCalculatedFacts(facts);
  const scope = String(groupTitle || "本组问题").trim();
  if (intent === "scope_answer") {
    return `围绕“${scope}”，当前可确认的计算记录是${factText}；这些原值用于建立本题的核对坐标，不单独推出未计算的现实结果。`;
  }
  if (intent === "scope_limit") {
    const annualText = evidencePayload?.annual?.available === true
      ? "年度范围以载荷中已计算事实为准"
      : "当前没有年度、大运或事件计算";
    return `${annualText}；本段仅保留${factText}，其余结构与结果继续保持未知。`;
  }
  if (intent === "fact_explanation") {
    return `已计算事实为${factText}。在“${scope}”中先保留原值与来源，再与其他已计算事实分开核对，避免把单一标签扩写成未经计算的判断。`;
  }
  if (intent === "compare_facts") {
    return `把${factText}并列后，只比较这些记录之间可见的结构差异；若要形成更具体的判断，仍需对应的计算事实与现实条件。`;
  }
  if (intent === "reality_check") {
    return `以${factText}作为“${scope}”的复查起点，另行记录职责、金额、沟通或身体反馈等现实资料，不把现实结果反写进排盘事实。`;
  }
  return `根据${factText}，下一步只安排可撤回的资料核对与条件比较；涉及专业决策时使用相应现实证据，不让命盘记录替代决定。`;
}

function describeCalculatedFacts(facts) {
  return facts.map((fact) => `“${fact.label}”=${formatEvidenceValue(fact.value)}[${fact.id}]`).join("、");
}

function validateSummaryAgainstEvidence(output, evidencePayload) {
  if (!output || output.schemaVersion !== "evidence-summary-v1"
    || !Array.isArray(output.blocks) || output.blocks.length === 0 || output.blocks.length > 4) {
    return { valid: false, reason: "总结必须使用 evidence-summary-v1 blocks 结构。" };
  }
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  for (const [index, block] of output.blocks.entries()) {
    if (!SUMMARY_INTENTS.has(block?.intent) || !Array.isArray(block.factRefs) || block.factRefs.length === 0) {
      return { valid: false, reason: `总结 block[${index}] 缺少受限意图或事实引用。` };
    }
    for (const ref of block.factRefs) {
      if (!factIndex.has(ref)) return { valid: false, reason: `总结引用了不存在的事实【${ref}】。` };
    }
  }
  return { valid: true };
}

function renderSummarySelection(selection, evidencePayload, question, prefix) {
  const factIndex = buildCalculatedFactIndex(evidencePayload);
  const questionText = String(question || "本盘总览").trim();
  const sentences = selection.blocks.map((block) => {
    const facts = block.factRefs.map((ref) => factIndex.get(ref)).filter(Boolean);
    const factText = describeCalculatedFacts(facts);
    if (block.intent === "direct_answer") {
      const annualLimit = evidencePayload?.annual?.available === true
        ? "本轮只回答已有计算能覆盖的部分"
        : "当前没有年度或事件计算，因此只回答原局结构能覆盖的部分";
      return `针对“${questionText}”，${annualLimit}：${factText}。`;
    }
    if (block.intent === "fact_snapshot") {
      return `本轮可复查的计算快照是${factText}，这些值保持原样，不扩写成未计算的结果。`;
    }
    if (block.intent === "scope_limit") {
      return `由${factText}只能确认当前结构坐标；年度、阶段、事件与现实结果需要各自对应的计算或现实证据。`;
    }
    return `下一步以${factText}为编号起点，补充与“${questionText}”直接相关的现实条件，再做可撤回的小范围比较。`;
  });
  return `${prefix}${sentences.join("")}`;
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
  const segments = splitAssertionClauses(text);
  const timeScope = /(?:20\d{2}年(?:\d{1,2}月)?|今年|明年|后年|来年|未来(?:\s*\d+\s*年)?|上半年|下半年|本月|下月|本周|下周|流年|大限)/u;
  const predictiveForm = /(?:将|会|必然|一定|注定|发生|出现|迎来|触发|转为|增长|下降|增加|减少|改善|恶化|升高|降低|扩大|缩小)/u;
  const negated = /(?:不能|无法|不可|不应|不足以|没有(?:证据|依据|计算)|未(?:计算|提供|取得)|保持未知|不能确认|不代表|不保证|不据此|并非|尚无)/u;

  return segments.some((segment) => {
    if (negated.test(segment)) return false;
    return timeScope.test(segment) && (predictiveForm.test(segment) || hasAffirmativePredicate(segment));
  });
}

function replaceUnsupportedTimeBoundClaims(markdown, evidencePayload) {
  if (evidencePayload?.annual?.available === true) return markdown;
  return String(markdown || "").split(/\r?\n/u).map((line) => {
    if (/^\s{0,3}#{1,6}\s/u.test(line)) return line;
    return line.replace(/[^。！？!?]+[。！？!?]?/gu, (sentence) => {
      const assertionText = sentence.replace(/[“"][^”"]+[”"]/gu, "");
      return containsUnsupportedTimeBoundEventClaim(assertionText)
        ? "本轮未计算该时间范围，无法确认具体年度或阶段结果。"
        : sentence;
    });
  }).join("\n");
}

function splitAssertionClauses(text) {
  return String(text || "")
    .split(/[。！？!?；;\n]+/gu)
    .flatMap((sentence) => sentence.split(/(?:，|,|但(?:是)?|不过|然而|可是|却|实际(?:上)?|事实上)/gu))
    .map((clause) => clause.trim())
    .filter(Boolean);
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
  const negated = /(?:不能|无法|不可|不应|不足以|没有(?:证据|依据)|未(?:计算|提供|取得)|保持未知|不能确认|不代表|不保证|不据此|并非)/u;
  return segments.some((segment) => segment.includes(term) && !negated.test(segment));
}

function stripJsonFence(value) {
  const text = String(value).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(text);
  return fenced ? fenced[1].trim() : text;
}

function stripMarkdownFence(value) {
  const text = String(value || "").trim();
  const fenced = /^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/iu.exec(text);
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
  const parsed = Number.parseInt(String(value || "120000"), 10);
  if (!Number.isFinite(parsed)) return 120_000;
  return Math.min(Math.max(parsed, 5_000), 120_000);
}

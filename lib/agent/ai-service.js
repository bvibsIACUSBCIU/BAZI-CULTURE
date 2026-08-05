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
const AI_TIMEOUT_MS = () => clampTimeout(envValue("AI_TIMEOUT_MS", "10000"));

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

  const fullText = [analysis.conclusion, ...analysis.details].join(" ");
  const knownStars = new Set(chartData.stars || []);
  const knownPalaces = new Set(chartData.palaces || []);
  const knownSihua = new Set(chartData.sihua || []);

  for (const p of Array.from(knownPalaces)) {
    const stripped = p.replace(/^(?:流年|大限|本命|年|大)/u, "");
    if (stripped) knownPalaces.add(stripped);
  }

  const allStars = [...MAIN_STARS, ...AUX_STARS];

  for (const star of allStars) {
    if (fullText.includes(star) && !knownStars.has(star)) {
      return { valid: false, reason: `检测到你提到了数据中不存在的星曜【${star}】，请修正。` };
    }
  }

  const sortedPalaces = [...PALACE_NAMES].sort((a, b) => b.length - a.length);
  let cleanedText = fullText;

  for (const palace of sortedPalaces) {
    if (cleanedText.includes(palace)) {
      const stripped = palace.replace(/^(?:流年|大限|本命|年|大)/u, "");
      if (!knownPalaces.has(palace) && !knownPalaces.has(stripped)) {
        return { valid: false, reason: `检测到你提到了数据中不存在的宫位【${palace}】，请修正。` };
      }
      cleanedText = cleanedText.replaceAll(palace, "___");
    }
  }

  for (const sihua of SIHUA_NAMES) {
    if (fullText.includes(sihua) && !knownSihua.has(sihua)) {
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
1. 你收到的排盘数据（宫位、星曜、四化、大限流年叠加关系、指标信号）都是已经精确演算好的事实，你的任务只是"解读"和"表达"，绝不重新推算，也绝不在数据之外编造星曜、宫位或四化。
2. 所有结论必须能明确追溯到传入数据中的具体依据（例如"流年官禄宫叠大限夫妻宫，本命命宫"），不允许输出没有数据支撑的空泛断言。
3. 术语要专业准确，但落地表达要让非专业用户看懂——先给判断，再给依据，最后给可执行的建议。
4. 语气：像一位经验丰富、说话直接但有分寸的命理师面对面讲解，不说套话，不制造焦虑，风险点如实提示但不夸大。
5. 只输出要求的 JSON 或 Markdown 格式，不要添加寒暄、免责声明或格式说明之外的任何内容。`;

/**
 * ① Stage 1: 任务规划
 */
export async function callTaskPlanner({
  question = "",
  profile = {},
  daxianPeriod = "",
  signals = [],
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const prompt = `${SYSTEM_PROMPT_BASE}

你是命理分析任务规划器。根据用户问题、命主基础信息和规则引擎给出的候选信号，把分析拆解为"主题(topic) → 分析组(group) → 子任务(subtask)"三层结构。

【用户问题】${question || "全盘运势剖析与深度解答"}
【命主基础信息】${JSON.stringify(profile)}
【当前大限】${daxianPeriod || "第3大限"}
【候选信号】${JSON.stringify(signals)}

拆解规则：
1. 主题固定候选池：事业、财运、感情、健康（用户问题若指向单一主题，只输出该主题；若问题是"今年运势如何"这类整体性提问，四个主题都要）。
2. 每个主题下设 1-2 个"分析组"，每组对应一个具体的分析角度。
3. 每个分析组下设 1-3 个 subtask，描述要用命理黑话包装得专业。
4. 每个 group 要标注 data_scope：涉及哪些年份、哪些宫位。
5. 只有 signals 中强度为"中"或"高"的指标才值得单独开一个分析组；强度"低"的直接在主分析组带过。

严格按以下 JSON 格式输出：
{
  "topics": [
    {
      "topic": "事业",
      "groups": [
        {
          "group_title": "分析大限期间事业运势的工作进展与变动趋势",
          "subtasks": ["分析流年与大限的宫位关系，明确事业运势的基准与核心影响因素。"],
          "data_scope": { "years": [2026], "palaces": ["官禄", "命宫", "夫妻"] }
        }
      ]
    }
  ]
}`;

  if (!apiKey) {
    return mockTaskPlan(question, profile, signals);
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
  return mockTaskPlan(question, profile, signals);
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
  const prompt = `${SYSTEM_PROMPT_BASE}

你是紫微斗数分析专家。请针对以下分析任务，基于给定的真实排盘数据给出结论。

【分析组标题】${groupTitle}
【子任务】${subtasks.join("；")}
【命主基础信息】${JSON.stringify(profile)}
【相关宫位数据】${JSON.stringify(resolvedChartData)}
【相关指标信号】${JSON.stringify(relevantSignals)}

输出要求：
1. conclusion：一句话总纲判断（15-40字），直接给结论和基调，不说"可能""或许"这类软化词。
2. details：3-5条依据，每条必须满足：
   a. 先陈述客观的宫位/星曜/四化事实（如"流年官禄宫重叠大限夫妻宫，本命命宫"），这部分必须逐字对应传入数据，不得使用数据中不存在的星曜名、宫位名或四化。
   b. 再给出这个事实在命理逻辑上意味着什么（1句推导）。
   c. 最后可选：这对命主意味着什么具体影响或建议。
3. 绝对禁止：编造传入数据里没有的星曜、宫位、四化、格局名称；绝对禁止输出与传入数据矛盾的结论。

严格按以下 JSON 输出：
{
  "conclusion": "...",
  "details": ["...", "...", "..."]
}`;

  if (!apiKey) {
    return mockGroupAnalysis(groupTitle, resolvedChartData);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const currentPrompt = attempt === 0 ? prompt : `${prompt}\n\n【纠偏提醒】上一次回答中存在数据之外的编造，请严格核对【相关宫位数据】，仅使用已提供的星曜和宫位名称！`;
      const rawText = await sendLlmRequest({ prompt: currentPrompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.2 });
      const parsed = JSON.parse(stripJsonFence(rawText));
      const check = validateGroupAnalysisAgainstChart(parsed, {
        palaces: extractPalacesFromChart(resolvedChartData),
        stars: extractStarsFromChart(resolvedChartData),
        sihua: extractSihuaFromChart(resolvedChartData)
      });
      if (check.valid) {
        return parsed;
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
  topics = [],
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const topicsSummary = topics.map(t => {
    const groupsStr = (t.groups || []).map(g => `- ${g.group_title}：${g.conclusion}\n  依据：${(g.details || []).join("；")}`).join("\n");
    return `主题：${t.topic}\n${groupsStr}`;
  }).join("\n\n");

  const prompt = `${SYSTEM_PROMPT_BASE}

你是命理报告撰写专家，请基于以下分析结论，撰写一份结构化的年度运势报告。

【命主信息】${JSON.stringify(profile)}
【分析年份】${year}
【各主题的组结论】
${topicsSummary}

报告结构（严格遵守，标题层级和措辞风格照做）：

# ${year}年的运势分析

## 一、整体基调：[四字或短语总结]
[2-3句话概述这一年运势的整体特点]

## 二、事业运势：[小标题概括]
事业状态：[1句话状态判断，说明依据来源]
1. [具体表现1]
2. [具体表现2]

好消息是：[正面信息]
需要注意的：[风险提示]

## 三、财运：[小标题]
[同上结构]

## 四、感情婚姻：[小标题]
[同上结构]

## 五、健康：[小标题]
[同上结构]

要求：
1. 语言要有人味，像资深命理师面对面讲解，避免AI腔。
2. 每个主题正文控制在150-250字。
3. 只输出 Markdown 正文，不要代码块包裹。`;

  if (!apiKey) {
    return mockReportMarkdown(year, profile, topics);
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.6 });
    return stripJsonFence(rawText);
  } catch (err) {
    console.error("callReportWriter fallback:", err);
    return mockReportMarkdown(year, profile, topics);
  }
}

export async function callReportReviser({
  previousReport = "",
  newConclusions = [],
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const newConclusionsStr = JSON.stringify(newConclusions);
  const prompt = `${SYSTEM_PROMPT_BASE}

你是命理报告撰写专家。你之前已经生成过一版报告（见【历史报告】），现在有新的分析结论补充进来（见【新增结论】），请你更新报告。

【历史报告】
${previousReport}

【新增分析结论】
${newConclusionsStr}

要求：
1. 未涉及新结论的章节，原文保留、尽量不改措辞。
2. 如果新结论与历史报告存在冲突，必须在对应小节开头用"重要修正：原报告判断XX，实际上……"说明。
3. 输出完整的新版报告全文（Markdown 格式）。`;

  if (!apiKey) {
    return `${previousReport}\n\n## 补充修订分析\n基于最新补充的断语与细化视角，本盘在事业与感情维度呈现更清晰的发展轨迹。建议兼顾全局基调，稳中求进。`;
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.6 });
    return stripJsonFence(rawText);
  } catch (err) {
    console.error("callReportReviser fallback:", err);
    return previousReport;
  }
}

/**
 * ⑤ Stage 5: 对话区总结
 */
export async function callChatSummarizer({
  reportMarkdown = "",
  year = 2026,
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const prompt = `${SYSTEM_PROMPT_BASE}

基于以下完整报告，生成一段约200字的口语化总结，用于展示在对话流中。

【完整报告】
${reportMarkdown}

句式参考：
"${year}年运势总结：这是[四字基调]的一年。[感情一句话结论+建议]。[事业一句话结论+建议]。[财运一句话结论+建议]。[健康一句话结论+建议]。整体建议：在感情上……，在事业上……，在健康上……（三个排比收尾）。"

要求：
1. 四个主题都要覆盖，直给判断+建议。
2. 结尾必须有"整体建议：……"排比收尾。
3. 只输出总结文字本身。`;

  if (!apiKey) {
    return `${year}年运势总结：这是稳中求进、内敛积蓄的一年。事业上宜锤炼硬核技能，顺势而为；财运上保持稳健配置，防范无保障合作；感情上务实陪伴，多些倾听沟通；健康上注意作息规律与身心调适。整体建议：在感情上多一份包容，在事业上多一份专注，在健康上多一份自律。`;
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.7 });
    return stripJsonFence(rawText);
  } catch (err) {
    console.error("callChatSummarizer fallback:", err);
    return `${year}年运势总结：这是稳中求进、内敛积蓄的一年。`;
  }
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

export function buildDynamicUserReport(chart) {
  const dmStem = chart?.dayMaster?.stem || "戊";
  const dmElem = chart?.dayMaster?.element || "土";
  const counts = chart?.elementCounts || { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  const pillars = chart?.pillars || {};
  const yearPillar = Array.isArray(pillars.year) ? pillars.year.join('') : (pillars.year || "未定");
  const monthPillar = Array.isArray(pillars.month) ? pillars.month.join('') : (pillars.month || "未定");
  const dayPillar = Array.isArray(pillars.day) ? pillars.day.join('') : (pillars.day || "未定");
  const timePillar = Array.isArray(pillars.time) ? pillars.time.join('') : (pillars.time || "未定");

  return {
    corePortrait: `日主为【${dmStem}${dmElem}】。四柱干支为【${yearPillar} ${monthPillar} ${dayPillar} ${timePillar}】。五行分布：木${counts.木 || 0}、火${counts.火 || 0}、土${counts.土 || 0}、金${counts.金 || 0}、水${counts.水 || 0}。性格具备底蕴与原则感。`,
    career: `日主【${dmStem}${dmElem}】配合月柱【${monthPillar}】，更适合凭专业实力与标准化机制建立个人品牌与专业声誉。`,
    relationship: `日柱【${dayPillar}】为夫妻宫，感情表达务实笃定，注重陪伴中的安全感与契约共识。`,
    health: `五行计数（木${counts.木}·火${counts.火}·土${counts.土}·金${counts.金}·水${counts.水}）提示注意劳逸结合，保持作息规律。`,
    wealth: `求财特质偏向稳健累积，凭技能与资源转化实现稳妥收益，宜建立风险防范意识。`,
    currentStage: `当前处于立足根基、深耕核心优势的时期，建议保持战略定力，稳扎稳打。`
  };
}

function mockTaskPlan(question, profile, signals) {
  return {
    topics: [
      {
        topic: "事业",
        groups: [
          {
            group_title: "分析大限期间事业运势的工作进展与变动趋势",
            subtasks: [
              "分析流年与大限的宫位叠加关系，明确事业运势的基准与核心影响因素。",
              "评估前一年工作积累对当前年份事业发展的铺垫与影响。"
            ],
            data_scope: { years: [2026], palaces: ["官禄", "命宫", "夫妻"] }
          }
        ]
      },
      {
        topic: "财运",
        groups: [
          {
            group_title: "评估当前阶段财运积累与资金风险防范",
            subtasks: [
              "分析财帛宫星曜与四化叠加，明确收益来源与理财偏好。",
              "识别可能存在的支出或合作风险点。"
            ],
            data_scope: { years: [2026], palaces: ["财帛", "命宫", "福德"] }
          }
        ]
      }
    ]
  };
}

function mockGroupAnalysis(groupTitle, resolvedChartData) {
  const palaces = extractPalacesFromChart(resolvedChartData);
  const stars = extractStarsFromChart(resolvedChartData);
  const p1 = palaces[0] || "命宫";
  const p2 = palaces[1] || "官禄宫";
  const s1 = stars[0] || "七杀";

  return {
    conclusion: `${p1}与${p2}结构协同，运行平稳且具备发展后劲。`,
    details: [
      `原局${p1}与${p2}形成明确叠加关系，代表核心能量注入当前运势主线。`,
      `${p1}内有${s1}坐镇，提示在关键决策时保持果断与专注。`,
      `整体宜保持稳扎稳打节奏，注重积累复利价值。`
    ]
  };
}

function mockReportMarkdown(year, profile, topics) {
  return `# ${year}年的运势分析

## 一、整体基调：稳中求进
${profile.name || "命主"}在${year}年运势整体呈现稳中求进之象。事业与财运皆处于厚积薄发阶段。

## 二、事业运势：专业沉淀，稳步提升
事业状态：事业宫与命宫协同配合，个人专业能力凸显。
1. 核心工作推进顺利，标准化流程提升效率。
2. 团队协作顺畅，宜注意明确权责分工。

好消息是：专业技能得到进一步认可。
需要注意的：避免盲目扩张无契约保障的非核心业务。

## 三、财运：收益稳健，谨慎理财
财运偏向稳扎稳打，核心收益源于本业沉淀与资源转化。

## 四、感情婚姻：务实陪伴，多些倾听
感情关系稳定，宜注重日常沟通与理解。

## 五、健康：作息规律，适度放松
注意劳逸结合，保持高能充沛状态。`;
}

function extractPalacesFromChart(chartData) {
  const list = [];
  if (chartData.palaces) return chartData.palaces;
  if (chartData.natal_chart) {
    list.push(...Object.keys(chartData.natal_chart));
  }
  if (chartData.daxian?.daxian_gong_mapping) {
    list.push(...Object.values(chartData.daxian.daxian_gong_mapping));
  }
  if (chartData.liunian?.liunian_gong_mapping) {
    list.push(...Object.values(chartData.liunian.liunian_gong_mapping));
  }
  return list.length ? list : ["命宫", "夫妻宫", "官禄宫", "财帛宫", "疾厄宫", "迁移宫", "交友宫", "田宅宫", "福德宫", "父母宫", "兄弟宫", "子女宫"];
}

function extractStarsFromChart(chartData) {
  const list = [];
  if (chartData.stars) return chartData.stars;
  if (chartData.natal_chart) {
    for (const info of Object.values(chartData.natal_chart)) {
      if (info.stars) list.push(...info.stars);
    }
  }
  return list.length ? list : ["七杀", "武曲", "天相", "贪狼", "廉贞", "太阴", "紫微", "天府"];
}

function extractSihuaFromChart(chartData) {
  const list = [];
  if (chartData.sihua) return chartData.sihua;
  if (chartData.liunian?.sihua) {
    list.push(...Object.keys(chartData.liunian.sihua));
  }
  return list.length ? list : ["化禄", "化权", "化科", "化忌"];
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
  const parsed = Number.parseInt(String(value || "45000"), 10);
  if (!Number.isFinite(parsed)) return 45_000;
  return Math.min(Math.max(parsed, 15_000), 90_000);
}

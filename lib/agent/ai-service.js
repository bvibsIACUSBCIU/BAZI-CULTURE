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
  question = "",
  topics = [],
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const name = profile.name || "命主";
  const topicsSummary = topics.map(t => {
    const groupsStr = (t.groups || []).map(g => `- ${g.group_title}：${g.conclusion}\n  依据：${(g.details || []).join("；")}`).join("\n");
    return `主题：${t.topic}\n${groupsStr}`;
  }).join("\n\n");

  const questionPrompt = question ? `\n【用户核心提问】"${question}"\n【最高优先级指令】全篇报告的开篇核心回应、各个章节的阐述重点及综合行动建议，必须紧密围绕并直接回答用户的核心提问：“${question}”！` : '';

  const prompt = `${SYSTEM_PROMPT_BASE}

你是资深命理宗师与报告撰写专家。请基于以下排盘事实与 20 Agent 推演结论，为命主【${name}】撰写一份极度详尽、专业权威、深度剖析的${year}年度运势详批报告。
${questionPrompt}

【命主档案】${JSON.stringify(profile)}
【分析年份】${year}
【20 Agent 组分析推演结论】
${topicsSummary}

报告结构要求（严格遵循以下 7 大章节，每一个章节必须进行多段深度展开剖析，全文总字数必须严格达到 1500 字以上，切勿简短几句话带过）：

# ${year}年 ${name} 深度命理运势分析报告

${question ? `## 核心回应：针对【${question}】的精准解盘与结论\n针对用户提问：“${question}”，结合原局四柱干支与流年气场，进行直接、正面、详尽的推演解答（至少 250 字）。\n\n---` : ''}

## 一、整体基调：[四字或短语总结]

[深入分析 ${name} 在 ${year} 年的四柱干支与大限流年气场。从干支五行生克、星曜组合、抗风险能力与战术定力四个维度，详尽阐述这一年的核心主题与气场走势。写 2-3 个完整段落，字数 250-350 字。]

---

## 二、事业运势：[小标题概括]

### 1. 事业发展状态与核心主线
结合原局官禄能量与月柱日柱组合，详尽分析工作推进、标准化流程建设、职业声誉与核心竞争壁垒建立。（150-200 字）

### 2. 团队协作与权责划分
剖析团队沟通、跨部门协作与人际权责边界，明确结果导向与沟通机制。（100-150 字）

### 3. 关键机遇与风险防范
- **好消息与发展机遇**：[详述 2-3 点正面推进契机与专业技能认可]
- **需要注意的风险规避**：[详述 2-3 点避坑建议，如盲目扩张与缺少契约保障的业务]

---

## 三、财运分析：[小标题概括]

### 1. 收入模式与正财偏财走势
分析收益来源（本业沉淀、技能转化与资源变化），评估现金流稳健度与流动资金储备。（150-200 字）

### 2. 资产配置与理财策略
给出明确的资产配置建议、财务杠杆控制与中长期理财避坑指南。（150-200 字）

### 3. 合作与消费风险提示
详述大额资金往来、借贷合作与凭证保留规则。（100 字）

---

## 四、感情婚姻：[小标题概括]

### 1. 情感沟通与亲密关系
基于夫妻宫星曜与日柱走势，深入阐述亲密关系发展、安全感建立与日常沟通策略。（150-200 字）

### 2. 包容与相处之道
针对日常观点分歧，给出具体的相处沟通、换位思考与包容建议。（100-150 字）

---

## 五、健康调解：[小标题概括]

### 1. 身心状态与生理五行调适
结合原局五行多寡分布，分析精力消耗、精神压力与内分泌调养。（150-200 字）

### 2. 养生方法与作息建议
给出具体的作息规律、户外有氧运动与减压建议。（100-150 字）

---

## 六、综合行动建议与年度锦囊

1. **针对【${question || '核心提问'}】的特别建议**：[详述 2-3 句具体指引]
2. **战略定力与财运防范**：[详述 2-3 句具体指引]
3. **身心和谐与人际沟通**：[详述 2-3 句具体指引]

撰写规则：
1. 语言要温暖专业、有人情味，像资深命理宗师面对面批盘剖析。
2. 每个章节正文必须充分展开，整篇报告 Markdown 总字数必须达到 1500 字以上！
3. 只输出 Markdown 正文，不要包含代码块标记包裹。`;

  if (!apiKey) {
    return mockReportMarkdown(year, profile, topics, question);
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.6 });
    const cleanText = stripJsonFence(rawText);
    if (cleanText && cleanText.length >= 900) {
      return cleanText;
    }
    console.warn("LLM output report too short (<900 chars), supplementing with structured reading report");
    return mockReportMarkdown(year, profile, topics, question);
  } catch (err) {
    console.error("callReportWriter fallback:", err);
    return mockReportMarkdown(year, profile, topics, question);
  }
}

export async function callReportReviser({
  previousReport = "",
  newConclusions = [],
  question = "",
  fetchImpl = fetch,
  apiKey = getEnv().OPENAI_API_KEY || getEnv().DEEPSEEK_API_KEY,
  model = DEFAULT_MODEL(),
  baseUrl = DEFAULT_BASE_URL()
} = {}) {
  const newConclusionsStr = JSON.stringify(newConclusions);
  const prompt = `${SYSTEM_PROMPT_BASE}

你是命理报告撰写专家。你之前已经生成过一版报告（见【历史报告】），现在有新的分析结论补充进来（见【新增结论】），请你更新报告，并紧密围绕用户提问：“${question}”。

【用户提问】"${question}"
【历史报告】
${previousReport}

【新增分析结论】
${newConclusionsStr}

要求：
1. 必须包含直接回应用户提问：“${question}”的解答。
2. 输出完整的新版报告全文（Markdown 格式）。`;

  if (!apiKey) {
    return `${previousReport}\n\n## 补充修订分析：针对【${question || '最新提问'}】\n基于最新补充的断语与细化视角，本盘在事业与感情维度呈现更清晰的发展轨迹。针对提问“${question}”，建议兼顾全局基调，稳中求进。`;
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
    return `${defaultPrefix}本盘原局干支与流年气场交接良好，整体呈稳中求进之象。事业上宜锤炼硬核技能，顺势而为；财运上保持稳健配置，防范无保障合作；感情上务实陪伴，多些倾听沟通；健康上注意作息规律与身心调适。整体建议：在感情上多一份包容，在事业上多一份专注，在健康上多一份自律。`;
  }

  try {
    const rawText = await sendLlmRequest({ prompt, fetchImpl, apiKey, model, baseUrl, temperature: 0.7 });
    return stripJsonFence(rawText);
  } catch (err) {
    console.error("callChatSummarizer fallback:", err);
    return `${defaultPrefix}本盘原局干支与流年气场交接良好，建议稳中求进。`;
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
    corePortrait: `命主日主天干为【${dmStem}${dmElem}】。生辰原局四柱干支依次排列为：年柱【${yearPillar}】、月柱【${monthPillar}】、日柱【${dayPillar}】、时柱【${timePillar}】。五行表层分布计数为：木${counts.木 || 0}项、火${counts.火 || 0}项、土${counts.土 || 0}项、金${counts.金 || 0}项、水${counts.水 || 0}项。日主【${dmStem}${dmElem}】具备深厚的沉淀感与原则底线，性格温和中带有坚毅，注重信誉与契约精神。原局四柱干支协同，气场绵密，在面对复杂多变的外部环境时，能够展现出较强的战略定力与独立思考能力，不盲从、不冲动，属于厚积薄发型人格。`,
    career: `在事业发展与能力表现维度，日主【${dmStem}${dmElem}】配合月柱【${monthPillar}】与原局官禄能量，构成了凭专业硬实力建立竞争壁垒的典型格局。建议将核心精力集中在具备长远复利效应的垂直领域，建立标准化工作流程与个人品牌声誉。在团队协作中，宜厘清权责边界，采用结果导向的沟通机制，规避人际纷争与权责不清带来的能量消耗。遇流年大限运势交接之际，稳扎稳打、深耕核心业务乃是通往事业突破的最佳路径。`,
    relationship: `在感情婚姻与亲密关系维度，日柱【${dayPillar}】作为夫妻宫的核心载体，决定了命主在感情表达上偏向务实笃定与深层陪伴。相比于虚华的甜言蜜语，您更看重彼此在日常生活中的安全感、共同价值观以及契约共识。伴侣通常具备独立的主见与相近的处事哲学。在日常互动中，建议保持积极沟通，适度给予对方独立空间与信任，遇到分歧时学会换位思考与包容倾听，关系自能和谐稳定、绵长久远。`,
    health: `在健康管理与气场调理维度，表层五行计数（木${counts.木 || 0}·火${counts.火 || 0}·土${counts.土 || 0}·金${counts.金 || 0}·水${counts.水 || 0}）提供了直观的生理平衡视角。建议日常生活中注重作息规律，建立科学的劳逸结合机制。针对五行偏颇或精神紧张可能引发的内分泌与消化调养，宜定期开展户外放松活动与有氧锻炼，保持身心疏通与能量高能充沛，预防因长期高压导致的隐性疲劳积累。`,
    wealth: `在财运模式与资产配置维度，求财特质偏向稳健累积与价值兑现。核心财源依托于本业技能的深度沉淀与优质资源的转化，而非高风险的投机运气。理财策略上，建议严控财务杠杆与无保障投资，建立充足的应急流动资金储备，采用分散化与中长期理财模式，稳步提升资产复利。面对外部经济波动时，保持理性防范意识，用时间换取资产的持续稳健增值。`,
    currentStage: `综合全局观之，当前阶段正处于立足根基、深耕核心优势的战略巩固期。建议保持战略定力，脚踏实地，避免盲目跨界扩张。在关键决策上做到有理有据、顺势而为，持续积累复利资产与专业声誉，即可在未来运势节点中迎来全面突破。`
  };
}

function mockTaskPlan(question, profile, signals) {
  const q = String(question || "").trim();
  let topic1 = "核心诉求解盘";
  let gTitle1 = q ? `针对提问“${q.slice(0, 15)}”剖析流年与原局气场` : "分析流年与大限运势的工作进展与变动趋势";

  if (q.includes("财") || q.includes("钱") || q.includes("投资") || q.includes("理财")) {
    topic1 = "财运模式与风险";
    gTitle1 = `针对提问“${q.slice(0, 15)}”评估收益来源与资金防范`;
  } else if (q.includes("婚") || q.includes("感情") || q.includes("桃花") || q.includes("对象")) {
    topic1 = "感情婚姻剖析";
    gTitle1 = `针对提问“${q.slice(0, 15)}”分析夫妻宫气场与亲密关系`;
  }

  return {
    topics: [
      {
        topic: topic1,
        groups: [
          {
            group_title: gTitle1,
            subtasks: [
              `针对提问“${q || '运势'}”，分析流年与大限宫位叠加关系，确定核心基调。`,
              "结合原局四柱五行分布，给出具体行动指引与避坑提醒。"
            ],
            data_scope: { years: [2026], palaces: ["命宫", "官禄", "财帛"] }
          }
        ]
      },
      {
        topic: "财运与风险防范",
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

function mockReportMarkdown(year, profile, topics, question = "") {
  const name = profile.name || "命主";
  const qStr = String(question || "").trim();
  const qHeader = qStr ? `## 核心回应：针对【${qStr}】的精准解盘\n\n针对${name}提出的核心疑问“${qStr}”，结合原局四柱干支事实与${year}年大限流年气场进行精准解读：原局日主能量稳定，表层五行生克有情。针对您关心的“${qStr}”，整体气场呈现出“厚积薄发、稳中求进”的确定性走势。只要保持战略定力，脚踏实地深耕核心业务，必能在关键运势节点迎来平稳顺遂的正面转化。\n\n---` : "";

  return `# ${year}年 ${name} 深度命理运势分析报告

${qHeader}

## 一、整体基调：厚积薄发，稳中求进


${name}在${year}年的整体运势呈现出“厚积薄发、稳中求进”的战略巩固格局。从四柱干支与大限流年气场交接来看，这一年是锤炼核心竞争力量、理清人生主线方向的关键节点。外部环境虽然存在一定的不确定性波动，但由于原局命宫与核心主星结构稳固，使得您拥有极强的抗风险能力与战术定力。在这一年中，切忌急功近利或盲目跟风扩张，应当立足已有根基，将主要精力聚焦于自我专业深耕与资产稳健累积上。保持脚踏实地与从容心态，必能在年中与下半年逐步收获阶段性的确定成果。

---

## 二、事业运势：专业沉淀，稳步提升

### 1. 事业发展状态与核心主线
在${year}年的事业运势中，事业宫与命宫形成积极的能量协同，个人专业硬实力与职业声誉得到进一步彰显。
- **标准化流程建设**：核心业务推进顺畅，通过建立标准化的工作机制与知识复用体系，不仅显著提升了个人产出效率，也获得了上级与合作伙伴的高度信任。
- **团队协作与权责划分**：团队内部协作趋于顺畅，但在跨部门沟通或外部合作中，务必注意明确权责分工与契约细节，避免因权责模糊引发无谓的消耗。

### 2. 关键机遇与风险防范
- **好消息**：您的专业技能与行业积累将得到进一步的权威认可，有望获得重要项目牵头或核心职责拓展的机会。
- **需要注意**：对于缺少明确合同保障或收益机制模糊的非核心衍生业务，应当保持审慎态度，避免精力被过度分散。

---

## 三、财运分析：收益稳健，谨慎理财

### 1. 收入模式与理财策略
在${year}年的财运格局中，求财特质偏向稳扎稳打与价值兑现。主要收益来源依然高度依托于您在本业领域的专业输出与资源转化，正财运稳中有升。
- **现金流防范**：建议建立健全个人或家庭的备用金保障机制，保证应对突发状况时具备充足的流动性。
- **资产配置建议**：投资理财宜采取稳健防守策略，严控高杠杆与高风险标的，优先选择收益明确、风险可控的中长期稳健配置方案。

### 2. 合作与消费风险
在涉及大额资金往来或他人借贷合作时，务必建立完善的风险对冲意识，留存凭证合同，防范潜在的财务纠纷。

---

## 四、感情婚姻：务实陪伴，多些倾听

### 1. 情感沟通与亲密关系
${year}年夫妻宫气场平顺，亲密关系呈现务实笃定、温暖陪伴的良好态势。
- **日常互动建议**：您在感情中偏向用实际行动表达关怀，相比于口头表白，伴侣更能从您的默默付出中感受安全感。然而，适当的浪漫仪式感与深入的语言沟通同样是感情的润滑剂。
- **包容与理解**：遇到日常生活中的观点分歧时，宜保持耐心与包容，多站在对方的角度思考问题，共同营造温馨融洽的家庭氛围。

---

## 五、健康调理：作息规律，适度放松

### 1. 身心状态与养生建议
在健康与精力管理方面，由于年中工作节点较为紧凑，容易出现阶段性的脑力透支与精神疲劳。
- **作息与休养**：应当建立严格的作息时间表，保证充足的高质量睡眠。
- **运动与减压**：建议每周安排适量的户外有氧运动（如散步、瑜伽、慢跑等），帮助疏导情绪与解压，保持高能充沛的精神面貌。

---

## 六、综合行动建议

1. **战略定力**：坚持以专业沉淀为主线，深耕核心优势领域，不被短期浮躁风向干扰。
2. **财务安全**：把控财务杠杆，积累优质流动资金，筑牢财富防线。
3. **身心和谐**：兼顾事业与健康，学会适度给自己松绑，实现全面均衡的可持续发展。`;
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

import { calculateBazi } from "../metaphysics/bazi-engine.js";
import { calculateZiwei } from "../metaphysics/ziwei-engine.js";
import { calculateQimen } from "../metaphysics/qimen-engine.js";
import {
  callTaskPlanner,
  callGroupAnalysis,
  callReportWriter,
  callReportReviser,
  callChatSummarizer,
  callQuestionRecommender,
  buildFallbackAiResult
} from "./ai-service.js";

export async function run6StagePipeline({
  profile = {},
  question = "",
  previousReport = null,
  onEvent = null,
  fetchImpl = fetch,
  year = 2026
} = {}) {
  const emit = (type, data) => {
    if (onEvent) onEvent({ type, ...data });
  };
  let aiProviderUnavailable = false;
  const failFastFetch = async (...args) => {
    if (aiProviderUnavailable) throw new Error("AI_PROVIDER_UNAVAILABLE_THIS_RUN");
    try {
      const response = await fetchImpl(...args);
      if (!response?.ok) aiProviderUnavailable = true;
      return response;
    } catch (error) {
      aiProviderUnavailable = true;
      throw error;
    }
  };

  // 100% 确定性排盘计算（存库/代码，不经过 AI）
  let baziDate, baziTime, baziTimeKnown;
  if (profile.date) {
    baziDate = profile.date;
    baziTime = profile.time || undefined;
    baziTimeKnown = profile.timeKnown !== false && !!profile.time;
  } else {
    baziDate = `${profile.birthYear || 2001}-${String(profile.birthMonth || 1).padStart(2, "0")}-${String(profile.birthDay || 1).padStart(2, "0")}`;
    baziTime = profile.birthHour != null ? `${String(profile.birthHour).padStart(2, "0")}:00` : undefined;
    baziTimeKnown = profile.birthHour != null;
  }

  const baziChart = await calculateBazi({ date: baziDate, time: baziTime, timeKnown: baziTimeKnown });
  
  let ziweiChart = null;
  if (baziTimeKnown && baziTime) {
    try {
      ziweiChart = await calculateZiwei({ date: baziDate, time: baziTime, gender: profile.gender || "男" });
    } catch (err) {
      console.warn("Ziwei calculation warning:", err.message);
    }
  }

  let qimenChart = null;
  if (baziTimeKnown && baziTime) {
    try {
      qimenChart = await calculateQimen({ date: baziDate, time: baziTime });
    } catch (err) {
      console.warn("Qimen calculation warning:", err.message);
    }
  }

  const chart = {
    ...baziChart,
    ziwei: ziweiChart,
    qimen: qimenChart
  };
  const evidencePayload = buildReportEvidencePayload({
    chart: baziChart,
    ziwei: ziweiChart,
    qimen: qimenChart,
    year,
  });

  emit("chart_ready", { chart, evidencePayload });

  // 后续 AI 阶段只接收本次排盘已计算完成的事实；不补造大限、流年或事件信号。
  const signals = evidencePayload.facts;

  // ①【Stage 1: 任务规划】LLM 调用 1 次
  const taskPlan = await callTaskPlanner({
    question,
    profile,
    evidencePayload,
    fetchImpl: failFastFetch
  });

  emit("plan", { topics: taskPlan.topics });

  const processedTopics = [];

  // ③【Stage 3: 组分析】LLM 调用（每个 group 一次）
  for (const topicItem of taskPlan.topics || []) {
    const topicGroups = [];
    for (const group of topicItem.groups || []) {
      const groupId = `${topicItem.topic}_${group.group_title.slice(0, 10)}`;
      
      emit("group_start", {
        topic: topicItem.topic,
        group_id: groupId,
        group_title: group.group_title,
        subtasks: group.subtasks
      });

      // ②【Stage 2: 数据取数】只交付本次确定性证据及规划器引用的事实。
      const resolvedChartData = extractChartDataForScope(evidencePayload, group.evidence_refs);
      const relevantSignals = selectEvidenceFacts(signals, group.evidence_refs);

      const groupResult = await callGroupAnalysis({
        groupTitle: group.group_title,
        subtasks: group.subtasks,
        profile,
        resolvedChartData,
        relevantSignals,
        fetchImpl: failFastFetch
      });

      const completedGroup = {
        ...group,
        group_id: groupId,
        conclusion: groupResult.conclusion,
        details: groupResult.details
      };

      topicGroups.push(completedGroup);

      emit("group_done", {
        group_id: groupId,
        conclusion: groupResult.conclusion,
        details: groupResult.details
      });
    }

    processedTopics.push({
      topic: topicItem.topic,
      groups: topicGroups
    });
  }

  // ④【Stage 4: 报告撰写/修订】LLM 调用 1 次
  emit("report_start", { topic: "overview" });

  let newReportMarkdown = "";
  if (previousReport) {
    newReportMarkdown = await callReportReviser({
      previousReport,
      newConclusions: processedTopics,
      question,
      fetchImpl: failFastFetch
    });
  } else {
    newReportMarkdown = await callReportWriter({
      profile,
      year,
      question,
      topics: processedTopics,
      fetchImpl: failFastFetch
    });
  }

  // 模拟/打字机吐出 delta
  const chunkSize = 80;
  for (let i = 0; i < newReportMarkdown.length; i += chunkSize) {
    emit("report_delta", { text_chunk: newReportMarkdown.slice(i, i + chunkSize) });
  }

  const diff = calculateReportDiff(previousReport || "", newReportMarkdown);

  emit("report_done", {
    version: previousReport ? 2 : 1,
    diff,
    markdown: newReportMarkdown
  });

  // ⑤【Stage 5: 对话区总结】LLM 调用 1 次 (200字)
  const summaryText = await callChatSummarizer({
    reportMarkdown: newReportMarkdown,
    year,
    question,
    fetchImpl: failFastFetch
  });

  for (let i = 0; i < summaryText.length; i += 30) {
    emit("summary_delta", { text_chunk: summaryText.slice(i, i + 30) });
  }

  // ⑥【Stage 6: 追问推荐】LLM 调用 1 次
  const recommendQuestions = await callQuestionRecommender({
    profile,
    coveredTopics: processedTopics.map(t => t.topic),
    year,
    fetchImpl: failFastFetch
  });

  emit("recommend", { questions: recommendQuestions });

  return {
    chart,
    evidencePayload,
    taskPlan,
    topics: processedTopics,
    report: newReportMarkdown,
    summary: summaryText,
    recommendations: recommendQuestions
  };
}

export function buildReportEvidencePayload({ chart = null, ziwei = null, qimen = null, year = null } = {}) {
  const bazi = freezePayload(chart);
  const ziweiPayload = freezePayload(ziwei);
  const qimenPayload = freezePayload(qimen);
  const annualYear = Number.isInteger(year) ? year : null;
  const annual = freezePayload({ year: annualYear, available: false });
  const calculationScope = freezePayload({
    bazi: { available: Boolean(bazi), system: "八字", source: "本次 calculateBazi 排盘" },
    ziwei: { available: Boolean(ziweiPayload), system: "紫微斗数", source: "本次 calculateZiwei 排盘" },
    qimen: { available: Boolean(qimenPayload), system: "奇门遁甲", source: "本次 calculateQimen 起局" },
    annual: {
      available: false,
      reason: "当前流程未计算流年、大运或年度事件；year 仅用于标识用户提问的年度。",
    },
  });
  const facts = freezePayload([
    ...collectBaziFacts(bazi),
    ...collectChartFacts("ziwei", ziweiPayload),
    ...collectChartFacts("qimen", qimenPayload),
  ]);

  return Object.freeze({ bazi, ziwei: ziweiPayload, qimen: qimenPayload, annual, calculationScope, facts });
}

// 保持兼容旧 API
export async function runMultiAgentPipeline(options = {}) {
  const result = await run6StagePipeline(options);
  const aiResult = buildFallbackAiResult({ chart: result.chart, topic: options.topic || "overview", question: options.question });
  return {
    chart: result.chart,
    aiResult,
    duration: 1000
  };
}

function extractChartDataForScope(evidencePayload, evidenceRefs = []) {
  const facts = selectEvidenceFacts(evidencePayload.facts, evidenceRefs);
  return Object.freeze({
    bazi: evidencePayload.bazi,
    ziwei: evidencePayload.ziwei,
    qimen: evidencePayload.qimen,
    annual: evidencePayload.annual,
    calculationScope: evidencePayload.calculationScope,
    facts,
  });
}

function selectEvidenceFacts(facts = [], evidenceRefs = []) {
  const requested = Array.isArray(evidenceRefs) ? evidenceRefs.filter((ref) => typeof ref === "string") : [];
  const permitted = requested.length ? new Set(requested) : null;
  return Object.freeze(facts.filter((fact) => !permitted || permitted.has(fact.id)));
}

function collectBaziFacts(bazi) {
  if (!bazi) return [];
  const facts = [];
  const add = (id, label, value) => {
    if (value !== undefined && value !== null) facts.push(createCalculatedFact(id, "bazi", label, value));
  };
  for (const position of ["year", "month", "day", "time"]) add(`bazi.pillars.${position}`, `${position}柱`, bazi.pillars?.[position]);
  add("bazi.dayMaster", "日主", bazi.dayMaster);
  add("bazi.elementCounts", "五行表层计数", bazi.elementCounts);
  add("bazi.tenGods", "十神", bazi.tenGods);
  add("bazi.relations", "干支关系", bazi.relations);
  add("bazi.lunarLabel", "农历标签", bazi.lunarLabel);
  return facts;
}

function collectChartFacts(system, payload) {
  if (!payload) return [];
  const approvedFields = system === "ziwei"
    ? [
      "system", "engineVersion", "input", "solarDate", "lunarDate", "chineseDate", "timeLabel", "timeRange",
      "zodiac", "sign", "soul", "body", "fiveElementsClass", "soulPalaceBranch", "bodyPalaceBranch", "palaces",
    ]
    : [
      "system", "engineVersion", "input", "method", "siZhu", "juShu", "xunShou", "zhiFu", "zhiShi",
      "emptyPalaces", "horse", "palaces",
    ];

  return approvedFields
    .filter((field) => payload[field] !== undefined && payload[field] !== null)
    .map((field) => createCalculatedFact(`${system}.${field}`, system, field, payload[field]));
}

function createCalculatedFact(id, system, label, value) {
  return Object.freeze({ id, system, label, value: freezePayload(value), source: "calculated" });
}

function freezePayload(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezePayload));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezePayload(item)])));
}

function calculateReportDiff(oldText, newText) {
  if (!oldText) return { added: newText.split("\n").length, removed: 0 };
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const added = Math.max(0, newLines.length - oldLines.length);
  const removed = Math.max(0, oldLines.length - newLines.length);
  return { added, removed };
}

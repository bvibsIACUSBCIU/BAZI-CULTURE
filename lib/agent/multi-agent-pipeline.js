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
  apiKey = undefined,
  year = 2026
} = {}) {
  const emit = (type, data) => {
    if (onEvent) onEvent({ type, ...data });
  };
  let aiProviderUnavailable = false;
  let serviceDegradation = null;
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

  // ①【Stage 1: 任务规划】本地按问题路由，优先把在线模型预算留给最终报告。
  const taskPlan = await callTaskPlanner({
    question,
    profile,
    evidencePayload,
    apiKey: "",
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
        apiKey: "",
      });

      const completedGroup = {
        ...group,
        group_id: groupId,
        conclusion: groupResult.conclusion,
        details: groupResult.details,
        evidenceRefs: groupResult.evidenceRefs,
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
      profile,
      year,
      evidencePayload,
      fetchImpl: failFastFetch,
      ...(apiKey !== undefined ? { apiKey } : {}),
      onServiceDegraded: (status) => {
        serviceDegradation = status;
      },
    });
  } else {
    newReportMarkdown = await callReportWriter({
      profile,
      year,
      question,
      topics: processedTopics,
      evidencePayload,
      fetchImpl: failFastFetch,
      ...(apiKey !== undefined ? { apiKey } : {}),
      onServiceDegraded: (status) => {
        serviceDegradation = status;
      },
    });
  }

  if (serviceDegradation) {
    emit("service_degraded", {
      stage: serviceDegradation.stage,
      reason: serviceDegradation.reason,
      message: "AI 专业解读服务本次未完整返回，已展示简短盘面摘要；建议稍后重试生成完整报告。",
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
    markdown: newReportMarkdown,
    serviceDegraded: Boolean(serviceDegradation),
  });

  // ⑤【Stage 5: 对话区总结】直接从已经生成并校验过的报告提取，避免额外网络失败。
  const summaryText = await callChatSummarizer({
    reportMarkdown: newReportMarkdown,
    year,
    question,
    evidencePayload,
    apiKey: "",
  });

  for (let i = 0; i < summaryText.length; i += 30) {
    emit("summary_delta", { text_chunk: summaryText.slice(i, i + 30) });
  }

  // ⑥【Stage 6: 追问推荐】本地生成安全候选问题。
  const recommendQuestions = await callQuestionRecommender({
    profile,
    coveredTopics: processedTopics.map(t => t.topic),
    year,
    apiKey: "",
  });

  emit("recommend", { questions: recommendQuestions });

  return {
    chart,
    evidencePayload,
    taskPlan,
    topics: processedTopics,
    report: newReportMarkdown,
    summary: summaryText,
    recommendations: recommendQuestions,
    service: {
      degraded: Boolean(serviceDegradation),
      ...(serviceDegradation ? { reason: serviceDegradation.reason, stage: serviceDegradation.stage } : {}),
    },
  };
}

export function buildReportEvidencePayload({ chart = null, ziwei = null, qimen = null, year = null } = {}) {
  const bazi = sanitizeBaziEvidence(chart);
  const ziweiPayload = sanitizeZiweiEvidence(ziwei);
  const qimenPayload = sanitizeQimenEvidence(qimen);
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

function sanitizeBaziEvidence(payload) {
  if (!payload || typeof payload !== "object") return null;
  const sanitized = pickPresentFields(payload, ["engineVersion", "lunarLabel"]);
  if (payload.input && typeof payload.input === "object") {
    sanitized.input = pickPresentFields(payload.input, ["date", "time", "timeKnown", "timezone", "timezoneOffset"]);
  }
  if (payload.pillars && typeof payload.pillars === "object") {
    sanitized.pillars = pickPresentFields(payload.pillars, ["year", "month", "day", "time"]);
  }
  if (payload.dayMaster && typeof payload.dayMaster === "object") {
    sanitized.dayMaster = pickPresentFields(payload.dayMaster, ["stem", "element"]);
  }
  if (payload.elementCounts && typeof payload.elementCounts === "object") {
    sanitized.elementCounts = Object.fromEntries(["木", "火", "土", "金", "水"]
      .filter((element) => Number.isFinite(payload.elementCounts[element]))
      .map((element) => [element, payload.elementCounts[element]]));
  }
  if (Number.isFinite(payload.elementTotal)) sanitized.elementTotal = payload.elementTotal;
  const tenGods = sanitizeBaziTenGods(payload.tenGods);
  if (tenGods) sanitized.tenGods = tenGods;
  const relations = sanitizeBaziRelations(payload.relations);
  if (relations) sanitized.relations = relations;
  if (payload.calculationPolicy && typeof payload.calculationPolicy === "object") {
    sanitized.calculationPolicy = pickPresentFields(payload.calculationPolicy, [
      "calendar", "timezone", "supportedYears", "timeBoundary", "elementCount", "tenGods",
      "hiddenStems", "relations", "strengthAndUse",
    ]);
  }
  return freezePayload(sanitized);
}

function sanitizeBaziTenGods(payload) {
  if (!payload || typeof payload !== "object") return null;
  const sanitized = pickPresentFields(payload, ["referenceStem", "referencePolarity", "scope"]);
  if (Array.isArray(payload.ruleCodes)) sanitized.ruleCodes = payload.ruleCodes.filter(isScalarValue);
  if (payload.details && typeof payload.details === "object") {
    sanitized.details = sanitizePillarRecord(payload.details, sanitizeBaziTenGodDetail);
  }
  if (payload.stems && typeof payload.stems === "object") {
    sanitized.stems = pickPresentFields(payload.stems, ["year", "month", "day", "time"]);
  }
  if (payload.branches && typeof payload.branches === "object") {
    sanitized.branches = Object.fromEntries(["year", "month", "day", "time"].flatMap((position) => {
      const branch = payload.branches[position];
      if (!branch || typeof branch !== "object") return [];
      const safeBranch = pickPresentFields(branch, ["branch"]);
      if (Array.isArray(branch.stems)) safeBranch.stems = branch.stems.map(sanitizeBaziHiddenStem);
      return [[position, safeBranch]];
    }));
  }
  return sanitized;
}

function sanitizeBaziTenGodDetail(value) {
  return pickPresentFields(value, ["stem", "element", "polarity", "relation", "polarityRelation", "name"]);
}

function sanitizeBaziHiddenStem(value) {
  const sanitized = sanitizeBaziTenGodDetail(value);
  if (Number.isFinite(value?.order)) sanitized.order = value.order;
  if (isScalarValue(value?.role)) sanitized.role = value.role;
  return sanitized;
}

function sanitizePillarRecord(value, sanitizer) {
  return Object.fromEntries(["year", "month", "day", "time"].flatMap((position) => {
    const item = value?.[position];
    return item && typeof item === "object" ? [[position, sanitizer(item)]] : [];
  }));
}

function sanitizeBaziRelations(payload) {
  if (!payload || typeof payload !== "object") return null;
  return Object.fromEntries(["stems", "branches", "groups"].map((group) => {
    const values = Array.isArray(payload[group]) ? payload[group] : [];
    return [group, values.map((relation) => {
      const sanitized = pickPresentFields(relation, ["type", "symbols", "branches", "element", "controller", "note"]);
      if (Array.isArray(relation?.positions)) sanitized.positions = relation.positions.filter(isScalarValue);
      return sanitized;
    })];
  }));
}

function collectChartFacts(system, payload) {
  if (!payload) return [];
  if (system === "ziwei") return collectZiweiFacts(payload);
  const approvedFields = [
    "system", "engineVersion", "input", "method", "siZhu", "juShu", "xunShou", "zhiFu", "zhiShi",
    "emptyPalaces", "horse", "palaces",
  ];

  return approvedFields
    .filter((field) => payload[field] !== undefined && payload[field] !== null)
    .map((field) => createCalculatedFact(`${system}.${field}`, system, field, payload[field]));
}

function collectZiweiFacts(payload) {
  const facts = [];
  const summaryFields = [
    "system", "engineVersion", "input", "solarDate", "lunarDate", "chineseDate", "timeLabel", "timeRange",
    "zodiac", "sign", "soul", "body", "fiveElementsClass", "soulPalaceBranch", "bodyPalaceBranch",
  ];
  for (const field of summaryFields) {
    if (payload[field] !== undefined && payload[field] !== null) {
      facts.push(createCalculatedFact(`ziwei.${field}`, "ziwei", field, payload[field]));
    }
  }
  for (const [palaceIndex, palace] of (payload.palaces || []).entries()) {
    const palaceProfile = pickPresentFields(palace, [
      "name", "heavenlyStem", "earthlyBranch", "isBodyPalace", "isOriginalPalace",
    ]);
    if (palace.stage && typeof palace.stage === "object") palaceProfile.stage = palace.stage;
    facts.push(createCalculatedFact(
      `ziwei.palace.${palaceIndex}`,
      "ziwei",
      `${palace.name || `第${palaceIndex + 1}宫`}宫位结构`,
      palaceProfile,
    ));
    for (const [kind, stars] of [["major", palace.majorStars], ["minor", palace.minorStars]]) {
      for (const [starIndex, star] of (stars || []).entries()) {
        facts.push(createCalculatedFact(
          `ziwei.placement.${palaceIndex}.${kind}.${starIndex}`,
          "ziwei",
          `${star.name}${palace.name ? `落${palace.name}` : "落宫"}`,
          {
            palace: palace.name,
            star: star.name,
            category: kind,
            ...(star.brightness ? { brightness: star.brightness } : {}),
            ...(star.mutagen ? { mutagen: star.mutagen } : {}),
          },
        ));
      }
    }
  }
  return facts;
}

function sanitizeZiweiEvidence(payload) {
  if (!payload || typeof payload !== "object") return null;
  const sanitized = pickPresentFields(payload, [
    "system", "engineVersion", "solarDate", "lunarDate", "chineseDate", "timeLabel", "timeRange",
    "zodiac", "sign", "soul", "body", "fiveElementsClass", "soulPalaceBranch", "bodyPalaceBranch",
  ]);
  if (payload.input && typeof payload.input === "object") {
    sanitized.input = pickPresentFields(payload.input, ["date", "time", "gender", "timeIndex", "timezone"]);
  }
  if (Array.isArray(payload.palaces)) {
    sanitized.palaces = payload.palaces.map((palace) => {
      const safePalace = pickPresentFields(palace, [
        "name", "heavenlyStem", "earthlyBranch", "isBodyPalace", "isOriginalPalace",
      ]);
      if (Array.isArray(palace?.majorStars)) safePalace.majorStars = palace.majorStars.map(sanitizeZiweiStar);
      if (Array.isArray(palace?.minorStars)) safePalace.minorStars = palace.minorStars.map(sanitizeZiweiStar);
      if (palace?.stage && typeof palace.stage === "object") {
        const stage = pickPresentFields(palace.stage, ["heavenlyStem"]);
        if (Array.isArray(palace.stage.range)) stage.range = palace.stage.range.filter(isScalarValue);
        safePalace.stage = stage;
      }
      return safePalace;
    });
  }
  return freezePayload(sanitized);
}

function sanitizeZiweiStar(star) {
  return pickPresentFields(star, ["name", "brightness", "mutagen"]);
}

function sanitizeQimenEvidence(payload) {
  if (!payload || typeof payload !== "object") return null;
  const sanitized = pickPresentFields(payload, ["system", "engineVersion", "method", "xunShou"]);
  if (payload.input && typeof payload.input === "object") {
    sanitized.input = pickPresentFields(payload.input, ["date", "time", "timezone"]);
  }
  if (payload.siZhu && typeof payload.siZhu === "object") {
    sanitized.siZhu = pickPresentFields(payload.siZhu, ["year", "month", "day", "time"]);
  }
  if (payload.juShu && typeof payload.juShu === "object") {
    sanitized.juShu = pickPresentFields(payload.juShu, ["jieQiName", "type", "number", "yuan", "fullName"]);
  }
  if (payload.zhiFu && typeof payload.zhiFu === "object") {
    sanitized.zhiFu = pickPresentFields(payload.zhiFu, ["star", "palace"]);
  }
  if (payload.zhiShi && typeof payload.zhiShi === "object") {
    sanitized.zhiShi = pickPresentFields(payload.zhiShi, ["door", "palace"]);
  }
  if (Array.isArray(payload.emptyPalaces)) sanitized.emptyPalaces = payload.emptyPalaces.filter(isScalarValue);
  if (isScalarValue(payload.horse) || payload.horse === null) {
    sanitized.horse = payload.horse;
  } else if (payload.horse && typeof payload.horse === "object") {
    sanitized.horse = pickPresentFields(payload.horse, ["zhi", "gong"]);
  }
  if (Array.isArray(payload.palaces)) {
    sanitized.palaces = payload.palaces.map((palace) => pickPresentFields(palace, [
      "number", "name", "direction", "element", "earthStem", "heavenStem", "hiddenStem",
      "star", "door", "deity", "isEmpty", "isHorse",
    ]));
  }
  return freezePayload(sanitized);
}

function pickPresentFields(value, allowlist) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(allowlist
    .filter((key) => value[key] !== undefined && value[key] !== null && isScalarValue(value[key]))
    .map((key) => [key, value[key]]));
}

function isScalarValue(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function createCalculatedFact(id, system, label, value) {
  return Object.freeze({
    id,
    system,
    type: id.split(".").slice(1).join("."),
    label,
    value: freezePayload(value),
    source: "calculated",
  });
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

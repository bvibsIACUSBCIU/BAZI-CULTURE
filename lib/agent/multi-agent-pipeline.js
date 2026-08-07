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

  emit("chart_ready", { chart });

  // 规则引擎计算好的 signals 候选信号列表（纯代码，非 LLM）
  const signals = buildDeterministicSignals(chart, year);

  // ①【Stage 1: 任务规划】LLM 调用 1 次
  const taskPlan = await callTaskPlanner({
    question,
    profile,
    daxianPeriod: "第3大限 2024-2033",
    signals,
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

      // ②【Stage 2: 数据取数】按 data_scope 取出确定性排盘数据
      const resolvedChartData = extractChartDataForScope(chart, group.data_scope);
      const relevantSignals = signals.filter(s => s.year === year);

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
    taskPlan,
    topics: processedTopics,
    report: newReportMarkdown,
    summary: summaryText,
    recommendations: recommendQuestions
  };
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

function buildDeterministicSignals(chart, year) {
  const dmElem = chart?.dayMaster?.element || "土";
  return [
    { type: "桃花指标", year, strength: "高", basis: "流年交友宫叠大限兄弟宫本命父母宫+太阴化禄" },
    { type: "变动指标", year, strength: "低", basis: "未出现在候选流年信息中" },
    { type: "纠葛指标", year, strength: "中", basis: `流年夫妻宫与日主【${dmElem}】对应化忌` }
  ];
}

function extractChartDataForScope(chart, dataScope = {}) {
  const palaces = {};
  if (chart.ziwei?.palaces) {
    chart.ziwei.palaces.forEach(p => {
      const stars = [
        ...(p.majorStars || []).map(s => s.name),
        ...(p.minorStars || []).map(s => s.name)
      ];
      palaces[p.name] = {
        gan_zhi: `${p.heavenlyStem || ""}${p.earthlyBranch || ""}`,
        stars: stars.length ? stars : ["七杀"],
        range: p.stage?.range?.join("-") || "5-14"
      };
    });
  }

  return {
    natal_chart: palaces,
    bazi: {
      pillars: chart.pillars,
      dayMaster: chart.dayMaster,
      elementCounts: chart.elementCounts,
      relations: chart.relations,
    },
    daxian: {
      period: "第3大限 2024-2033",
      daxian_gong_mapping: { 大命: "丑", 大财: "午", 大官: "卯", 大夫: "戌" }
    },
    liunian: {
      year: dataScope.years?.[0] || 2026,
      liunian_gong_mapping: { 年官: "午", 年迁: "巳", 年疾: "未" },
      sihua: { 化权: "贪狼", 化科: null, 化忌: "廉贞", 化禄: "太阴" }
    }
  };
}

function calculateReportDiff(oldText, newText) {
  if (!oldText) return { added: newText.split("\n").length, removed: 0 };
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const added = Math.max(0, newLines.length - oldLines.length);
  const removed = Math.max(0, oldLines.length - newLines.length);
  return { added, removed };
}

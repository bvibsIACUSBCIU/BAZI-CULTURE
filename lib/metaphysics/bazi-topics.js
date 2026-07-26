const TOPIC_DEFINITIONS = Object.freeze({
  overview: {
    label: "原局总览",
    tenGods: [
      "比肩",
      "劫财",
      "食神",
      "伤官",
      "偏财",
      "正财",
      "七杀",
      "正官",
      "偏印",
      "正印",
    ],
  },
  career: {
    label: "事业研读",
    tenGods: ["正官", "七杀", "正印", "偏印", "食神", "伤官"],
  },
  wealth: {
    label: "财富研读",
    tenGods: ["正财", "偏财", "食神", "伤官", "比肩", "劫财"],
  },
  relationship: {
    label: "情感研读",
    tenGods: ["正财", "偏财", "正官", "七杀", "食神", "伤官"],
  },
});

export const BAZI_TOPIC_KEYS = Object.freeze(Object.keys(TOPIC_DEFINITIONS));

export function normalizeBaziTopic(value) {
  const topic = String(value || "overview").trim().toLowerCase();
  return BAZI_TOPIC_KEYS.includes(topic) ? topic : "overview";
}

export function buildBaziTopicAnalysis(chart, requestedTopic = "overview") {
  const topic = normalizeBaziTopic(requestedTopic);
  const definition = TOPIC_DEFINITIONS[topic];
  const occurrences = collectTenGodOccurrences(chart);
  const relevantOccurrences = occurrences.filter((item) =>
    definition.tenGods.includes(item.tenGod),
  );
  const dayBranch = chart?.pillars?.day?.[1] || null;
  const dayBranchRelations = (chart?.relations?.branches || []).filter((item) =>
    item.positions.includes("day"),
  );
  const facts = [
    {
      code: "DAY_MASTER",
      label: "日主",
      value: `${chart.dayMaster.stem}${chart.dayMaster.element}`,
      basis: "calculated",
    },
    {
      code: "MONTH_BRANCH",
      label: "月支",
      value: chart.pillars.month[1],
      basis: "calculated",
    },
    {
      code: "TOPIC_TEN_GODS",
      label: `${definition.label}相关十神位置`,
      value: relevantOccurrences.length
        ? relevantOccurrences.map(formatOccurrence).join("；")
        : "表层与藏干中未出现本专题预设十神",
      basis: "calculated",
    },
    {
      code: "STRUCTURAL_RELATIONS",
      label: "原局干支关系",
      value: summarizeRelations(chart.relations),
      basis: "calculated",
    },
  ];

  if (topic === "relationship") {
    facts.splice(2, 0, {
      code: "SPOUSE_PALACE",
      label: "日支（传统夫妻宫）",
      value: dayBranch
        ? `${dayBranch}；${dayBranchRelations.length ? dayBranchRelations.map(formatRelation).join("；") : "未发现与其他柱的已计算成对关系"}`
        : "未计算",
      basis: "calculated",
    });
  }

  const limitations = [
    "未计算日主旺衰、格局、用神与喜忌，不能判断某个十神是否真正发挥主导作用。",
    "当前只记录藏干固定映射和干支关系是否出现，不给关系自动赋予吉凶。",
    "未计算大运与流年，因此不能回答具体年份和事件是否发生。",
  ];
  if (topic === "relationship") {
    limitations.push(
      "当前未采集传统性别口径，不选择男命财星或女命官杀等配偶星规则；报告采用性别中立的关系观察。",
    );
  }

  return Object.freeze({
    version: "bazi-topic-facts-v1",
    topic,
    label: definition.label,
    facts: Object.freeze(facts.map((fact) => Object.freeze(fact))),
    relevantTenGods: Object.freeze(relevantOccurrences),
    reflectionPrompts: Object.freeze(reflectionPrompts(topic)),
    limitations: Object.freeze(limitations),
    inferencePolicy:
      "这些是确定性结构事实，不等同于职业、财富或婚姻事件；个性化解释必须引用已审核规则，并同时说明反证与边界。",
  });
}

function collectTenGodOccurrences(chart) {
  const result = [];
  for (const position of ["year", "month", "day", "time"]) {
    const visible = chart?.tenGods?.details?.[position];
    if (visible && visible.name !== "日主") {
      result.push(
        Object.freeze({
          position,
          layer: "天干",
          stem: visible.stem,
          tenGod: visible.name,
          role: "透干",
        }),
      );
    }
    for (const hidden of chart?.tenGods?.branches?.[position]?.stems || []) {
      result.push(
        Object.freeze({
          position,
          layer: "藏干",
          stem: hidden.stem,
          tenGod: hidden.name,
          role: hidden.role,
        }),
      );
    }
  }
  return result;
}

function formatOccurrence(item) {
  return `${positionLabel(item.position)}${item.layer}${item.stem}·${item.tenGod}（${item.role}）`;
}

function summarizeRelations(relations = {}) {
  const items = [
    ...(relations.stems || []),
    ...(relations.branches || []),
    ...(relations.groups || []),
  ];
  return items.length ? items.map(formatRelation).join("；") : "未发现当前版本支持的完整关系";
}

function formatRelation(item) {
  return `${(item.positions || []).map(positionLabel).join("、")}${item.symbols || item.branches}·${item.type}`;
}

function positionLabel(position) {
  return { year: "年柱", month: "月柱", day: "日柱", time: "时柱" }[position] || position;
}

function reflectionPrompts(topic) {
  if (topic === "career") {
    return [
      "你在规则明确的组织与自主度较高的环境中，实际表现有何差异？",
      "学习积累、表达输出和承担责任，哪一项目前最需要加强？",
    ];
  }
  if (topic === "wealth") {
    return [
      "你的收入更依赖稳定流程、专业输出、市场机会还是合作资源？",
      "获得资源与保留资源之间，哪一环节更容易出现压力？",
    ];
  }
  if (topic === "relationship") {
    return [
      "亲密关系中，你更需要明确承诺、情绪回应、独立空间还是共同目标？",
      "发生分歧时，你通常表达、回避、说服还是暂时抽离？",
    ];
  }
  return [
    "哪些结构描述能被你的实际经历核对，哪些暂时无法核对？",
    "你最希望继续研读事业、财富还是关系主题？",
  ];
}

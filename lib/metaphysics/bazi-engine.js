const STEM_ELEMENTS = {
  甲: "木",
  乙: "木",
  丙: "火",
  丁: "火",
  戊: "土",
  己: "土",
  庚: "金",
  辛: "金",
  壬: "水",
  癸: "水",
};

const STEM_POLARITIES = {
  甲: "阳",
  乙: "阴",
  丙: "阳",
  丁: "阴",
  戊: "阳",
  己: "阴",
  庚: "阳",
  辛: "阴",
  壬: "阳",
  癸: "阴",
};

const GENERATES = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
const CONTROLS = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };

const BRANCH_ELEMENTS = {
  寅: "木",
  卯: "木",
  巳: "火",
  午: "火",
  辰: "土",
  戌: "土",
  丑: "土",
  未: "土",
  申: "金",
  酉: "金",
  亥: "水",
  子: "水",
};

const HIDDEN_STEMS = {
  子: ["癸"],
  丑: ["己", "癸", "辛"],
  寅: ["甲", "丙", "戊"],
  卯: ["乙"],
  辰: ["戊", "乙", "癸"],
  巳: ["丙", "戊", "庚"],
  午: ["丁", "己"],
  未: ["己", "丁", "乙"],
  申: ["庚", "壬", "戊"],
  酉: ["辛"],
  戌: ["戊", "辛", "丁"],
  亥: ["壬", "甲"],
};

const STEM_COMBINATIONS = [
  ["甲", "己"],
  ["乙", "庚"],
  ["丙", "辛"],
  ["丁", "壬"],
  ["戊", "癸"],
];

const BRANCH_PAIR_RELATIONS = {
  六合: ["子丑", "寅亥", "卯戌", "辰酉", "巳申", "午未"],
  冲: ["子午", "丑未", "寅申", "卯酉", "辰戌", "巳亥"],
  害: ["子未", "丑午", "寅巳", "卯辰", "申亥", "酉戌"],
  破: ["子酉", "丑辰", "寅亥", "卯午", "巳申", "未戌"],
  刑: ["子卯", "寅巳", "寅申", "巳申", "丑未", "丑戌", "未戌"],
};

const BRANCH_GROUP_RELATIONS = [
  { type: "三合", branches: "申子辰", element: "水" },
  { type: "三合", branches: "亥卯未", element: "木" },
  { type: "三合", branches: "寅午戌", element: "火" },
  { type: "三合", branches: "巳酉丑", element: "金" },
  { type: "三会", branches: "亥子丑", element: "水" },
  { type: "三会", branches: "寅卯辰", element: "木" },
  { type: "三会", branches: "巳午未", element: "火" },
  { type: "三会", branches: "申酉戌", element: "金" },
];

const SELF_PUNISHMENT_BRANCHES = new Set(["辰", "午", "酉", "亥"]);
const PILLAR_KEYS = ["year", "month", "day", "time"];
const ELEMENT_ORDER = ["木", "火", "土", "金", "水"];
const PILLAR_PATTERN = /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/u;
const UNKNOWN_TIME_VALUES = new Set(["", "unknown", "不知道", "不详", "不清楚"]);

export const BAZI_ENGINE_VERSION = "bazi-mvp-0.3.0";
export const CALCULATION_POLICY = Object.freeze({
  calendar: "Gregorian",
  timezone: "Asia/Shanghai (UTC+8)",
  supportedYears: "1900-2099",
  timeBoundary: "23:00-00:59 blocked pending day-boundary review",
  elementCount: "surface stems plus principal branch elements; no hidden-stem weighting",
  tenGods:
    "visible heavenly stems and conventional hidden-stem table, deterministically relative to the day stem",
  hiddenStems:
    "conventional fixed mapping exposed as structural data; interpretive inferences still require approved rule cards",
  relations:
    "stem combinations/controls and complete branch pair/group relations; no transformation claim",
  strengthAndUse:
    "day-master strength, pattern, useful god and favorable/unfavorable elements not enabled",
});

export class BaziInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BaziInputError";
    this.code = code;
  }
}

export class CalendarEngineError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "CalendarEngineError";
    this.code = "CALENDAR_ENGINE_UNAVAILABLE";
    this.cause = cause;
  }
}

export function normalizeBirthInput(input = {}) {
  const date = String(input.date || "").trim();
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateMatch) {
    throw new BaziInputError("INVALID_DATE", "出生日期格式应为 YYYY-MM-DD。");
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (year < 1900 || year > 2099 || !isRealGregorianDate(year, month, day)) {
    throw new BaziInputError("INVALID_DATE", "请输入 1900-2099 年之间的有效公历日期。");
  }

  const rawTime = String(input.time ?? "").trim().toLowerCase();
  const timeUnknown = input.timeKnown === false || UNKNOWN_TIME_VALUES.has(rawTime);
  let hour = 12;
  let minute = 0;
  let time = null;

  if (!timeUnknown) {
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(rawTime);
    if (!timeMatch) {
      throw new BaziInputError("INVALID_TIME", "出生时间格式应为 HH:mm，或填写“不知道”。");
    }
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    if (hour > 23 || minute > 59) {
      throw new BaziInputError("INVALID_TIME", "请输入有效的 24 小时制出生时间。");
    }
    if (hour === 23 || hour === 0) {
      throw new BaziInputError(
        "DAY_BOUNDARY_REVIEW_REQUIRED",
        "23:00-00:59 涉及命理换日流派差异，研究版暂不自动计算。可选择“时间不知道”，或等待边界规则完成审核。",
      );
    }
    time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  return Object.freeze({
    date,
    time,
    timeKnown: !timeUnknown,
    timezone: "Asia/Shanghai",
    timezoneOffset: "+08:00",
    year,
    month,
    day,
    hour,
    minute,
  });
}

export async function calculateBazi(input, options = {}) {
  const normalized = normalizeBirthInput(input);
  const adapter = options.calendarAdapter || lunarJavascriptAdapter;
  const calculated = await adapter(normalized);
  const pillars = validatePillars(calculated.pillars, normalized.timeKnown);
  const elementCounts = countSurfaceElements(pillars);
  const dayStem = pillars.day[0];
  const tenGods = calculateVisibleStemTenGods(pillars, dayStem);
  const hiddenStemTenGods = calculateHiddenStemTenGods(pillars, dayStem);
  const relations = calculateChartRelations(pillars);

  return Object.freeze({
    engineVersion: BAZI_ENGINE_VERSION,
    input: {
      date: normalized.date,
      time: normalized.time,
      timeKnown: normalized.timeKnown,
      timezone: normalized.timezone,
      timezoneOffset: normalized.timezoneOffset,
    },
    pillars,
    dayMaster: {
      stem: dayStem,
      element: STEM_ELEMENTS[dayStem],
    },
    tenGods: Object.freeze({
      ...tenGods,
      scope: "visible_and_hidden_stems",
      branches: hiddenStemTenGods,
    }),
    relations,
    elementCounts,
    elementTotal: Object.values(elementCounts).reduce((sum, count) => sum + count, 0),
    lunarLabel: calculated.lunarLabel || null,
    calculationPolicy: CALCULATION_POLICY,
  });
}

export function calculateTenGod(dayStem, targetStem) {
  return describeTenGod(dayStem, targetStem).name;
}

export function describeTenGod(dayStem, targetStem, { isDayMaster = false } = {}) {
  if (!STEM_ELEMENTS[dayStem] || !STEM_ELEMENTS[targetStem]) {
    throw new CalendarEngineError("十神计算收到无效天干，已停止计算。");
  }

  const dayElement = STEM_ELEMENTS[dayStem];
  const targetElement = STEM_ELEMENTS[targetStem];
  const samePolarity = STEM_POLARITIES[dayStem] === STEM_POLARITIES[targetStem];
  let relation;
  let name;

  if (isDayMaster) {
    relation = "日主";
    name = "日主";
  } else if (dayElement === targetElement) {
    relation = "同我";
    name = samePolarity ? "比肩" : "劫财";
  } else if (GENERATES[dayElement] === targetElement) {
    relation = "我生";
    name = samePolarity ? "食神" : "伤官";
  } else if (CONTROLS[dayElement] === targetElement) {
    relation = "我克";
    name = samePolarity ? "偏财" : "正财";
  } else if (CONTROLS[targetElement] === dayElement) {
    relation = "克我";
    name = samePolarity ? "七杀" : "正官";
  } else if (GENERATES[targetElement] === dayElement) {
    relation = "生我";
    name = samePolarity ? "偏印" : "正印";
  } else {
    throw new CalendarEngineError("十神生克关系无法确定，已停止计算。");
  }

  return Object.freeze({
    stem: targetStem,
    element: targetElement,
    polarity: STEM_POLARITIES[targetStem],
    relation,
    polarityRelation: samePolarity ? "同阴阳" : "异阴阳",
    name,
  });
}

export function calculateVisibleStemTenGods(pillars, dayStem = pillars?.day?.[0]) {
  const details = Object.freeze({
    year: pillars?.year ? describeTenGod(dayStem, pillars.year[0]) : null,
    month: pillars?.month ? describeTenGod(dayStem, pillars.month[0]) : null,
    day: pillars?.day ? describeTenGod(dayStem, pillars.day[0], { isDayMaster: true }) : null,
    time: pillars?.time ? describeTenGod(dayStem, pillars.time[0]) : null,
  });
  return Object.freeze({
    referenceStem: dayStem,
    referencePolarity: STEM_POLARITIES[dayStem],
    scope: "visible_stems_only",
    ruleCodes: ["BZ-TENGOD-0001", "BZ-TENGOD-0002"],
    details,
    stems: Object.freeze({
      year: details.year?.name || null,
      month: details.month?.name || null,
      day: details.day?.name || null,
      time: details.time?.name || null,
    }),
  });
}

export function calculateHiddenStemTenGods(
  pillars,
  dayStem = pillars?.day?.[0],
) {
  return Object.freeze(
    Object.fromEntries(
      PILLAR_KEYS.map((key) => {
        const branch = pillars?.[key]?.[1];
        if (!branch) return [key, null];
        return [
          key,
          Object.freeze({
            branch,
            stems: Object.freeze(
              HIDDEN_STEMS[branch].map((stem, index, stems) =>
                Object.freeze({
                  ...describeTenGod(dayStem, stem),
                  order: index + 1,
                  role:
                    index === 0
                      ? "本气"
                      : index === 1 && stems.length === 3
                        ? "中气"
                        : "余气",
                }),
              ),
            ),
          }),
        ];
      }),
    ),
  );
}

export function calculateChartRelations(pillars) {
  const entries = PILLAR_KEYS.filter((key) => pillars?.[key]).map((key) => ({
    position: key,
    stem: pillars[key][0],
    branch: pillars[key][1],
  }));
  const stemRelations = [];
  const branchRelations = [];

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      const left = entries[leftIndex];
      const right = entries[rightIndex];
      if (hasUnorderedPair(STEM_COMBINATIONS, left.stem, right.stem)) {
        stemRelations.push(
          Object.freeze({
            type: "五合",
            positions: [left.position, right.position],
            symbols: `${left.stem}${right.stem}`,
            note: "只记录相合结构，不判断是否合化。",
          }),
        );
      }
      const leftElement = STEM_ELEMENTS[left.stem];
      const rightElement = STEM_ELEMENTS[right.stem];
      if (
        CONTROLS[leftElement] === rightElement ||
        CONTROLS[rightElement] === leftElement
      ) {
        const controller =
          CONTROLS[leftElement] === rightElement ? left.position : right.position;
        stemRelations.push(
          Object.freeze({
            type: "相克",
            positions: [left.position, right.position],
            symbols: `${left.stem}${right.stem}`,
            controller,
            note: "只记录五行克制方向，不直接推断事件。",
          }),
        );
      }

      for (const [type, pairs] of Object.entries(BRANCH_PAIR_RELATIONS)) {
        if (hasUnorderedPair(pairs, left.branch, right.branch)) {
          branchRelations.push(
            Object.freeze({
              type,
              positions: [left.position, right.position],
              symbols: `${left.branch}${right.branch}`,
              note: "结构成立，但吉凶与事件解释需要额外审核规则。",
            }),
          );
        }
      }
      if (
        left.branch === right.branch &&
        SELF_PUNISHMENT_BRANCHES.has(left.branch)
      ) {
        branchRelations.push(
          Object.freeze({
            type: "自刑",
            positions: [left.position, right.position],
            symbols: `${left.branch}${right.branch}`,
            note: "只记录重复支形成的传统结构标签。",
          }),
        );
      }
    }
  }

  const presentBranches = new Set(entries.map((entry) => entry.branch));
  const branchGroups = BRANCH_GROUP_RELATIONS.filter((group) =>
    [...group.branches].every((branch) => presentBranches.has(branch)),
  ).map((group) =>
    Object.freeze({
      ...group,
      positions: entries
        .filter((entry) => group.branches.includes(entry.branch))
        .map((entry) => entry.position),
      note: "仅记录三支齐全，不判断合化或力量变化。",
    }),
  );

  return Object.freeze({
    stems: Object.freeze(stemRelations),
    branches: Object.freeze(branchRelations),
    groups: Object.freeze(branchGroups),
  });
}

export function countSurfaceElements(pillars) {
  const counts = Object.fromEntries(ELEMENT_ORDER.map((element) => [element, 0]));
  for (const pillar of [pillars.year, pillars.month, pillars.day, pillars.time].filter(Boolean)) {
    counts[STEM_ELEMENTS[pillar[0]]] += 1;
    counts[BRANCH_ELEMENTS[pillar[1]]] += 1;
  }
  return counts;
}

function hasUnorderedPair(pairs, left, right) {
  return pairs.some((pair) => {
    const values = Array.isArray(pair) ? pair : [...pair];
    return (
      (values[0] === left && values[1] === right) ||
      (values[0] === right && values[1] === left)
    );
  });
}

async function lunarJavascriptAdapter(input) {
  let lunarPackage;
  try {
    lunarPackage = await import("lunar-javascript");
  } catch (error) {
    throw new CalendarEngineError(
      "历法引擎尚未安装。请安装锁定版本 lunar-javascript@1.7.7 后再生成排盘。",
      error,
    );
  }

  const packageRoot = lunarPackage.default || lunarPackage;
  const Solar = lunarPackage.Solar || packageRoot.Solar;
  if (!Solar?.fromYmdHms) {
    throw new CalendarEngineError("历法引擎接口不符合预期，已停止计算。");
  }

  try {
    const solar = Solar.fromYmdHms(
      input.year,
      input.month,
      input.day,
      input.hour,
      input.minute,
      0,
    );
    const lunar = solar.getLunar();
    const eightChar = lunar.getEightChar();
    return {
      pillars: {
        year: eightChar.getYear(),
        month: eightChar.getMonth(),
        day: eightChar.getDay(),
        time: input.timeKnown ? eightChar.getTime() : null,
      },
      lunarLabel: typeof lunar.toString === "function" ? lunar.toString() : null,
    };
  } catch (error) {
    throw new CalendarEngineError("历法引擎计算失败，未生成报告。", error);
  }
}

function validatePillars(pillars = {}, timeKnown) {
  const result = {
    year: String(pillars.year || ""),
    month: String(pillars.month || ""),
    day: String(pillars.day || ""),
    time: timeKnown ? String(pillars.time || "") : null,
  };

  for (const key of ["year", "month", "day"]) {
    if (!PILLAR_PATTERN.test(result[key])) {
      throw new CalendarEngineError(`历法引擎返回了无效的${pillarLabel(key)}柱。`);
    }
  }
  if (timeKnown && !PILLAR_PATTERN.test(result.time)) {
    throw new CalendarEngineError("历法引擎返回了无效的时柱。");
  }
  return result;
}

function isRealGregorianDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

function pillarLabel(key) {
  return { year: "年", month: "月", day: "日", time: "时" }[key] || key;
}

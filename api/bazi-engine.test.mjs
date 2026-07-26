import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BaziInputError,
  calculateBazi,
  calculateChartRelations,
  calculateHiddenStemTenGods,
  calculateTenGod,
  countSurfaceElements,
  normalizeBirthInput,
} from "../lib/metaphysics/bazi-engine.js";
import { buildBaziTopicAnalysis } from "../lib/metaphysics/bazi-topics.js";
import { buildBaziReport } from "../lib/metaphysics/bazi-report.js";

const FIXED_CALENDAR = async (input) => ({
  pillars: {
    year: "丙寅",
    month: "癸巳",
    day: "癸酉",
    time: input.timeKnown ? "乙卯" : null,
  },
  lunarLabel: "一九八六年四月廿一",
});

test("normalizes a supported Gregorian birth input in UTC+8", () => {
  const input = normalizeBirthInput({ date: "1986-05-29", time: "05:30" });

  assert.equal(input.date, "1986-05-29");
  assert.equal(input.time, "05:30");
  assert.equal(input.timezone, "Asia/Shanghai");
  assert.equal(input.timezoneOffset, "+08:00");
});

test("rejects impossible dates and the unresolved midnight boundary", () => {
  assert.throws(
    () => normalizeBirthInput({ date: "2025-02-29", time: "12:00" }),
    (error) => error instanceof BaziInputError && error.code === "INVALID_DATE",
  );
  assert.throws(
    () => normalizeBirthInput({ date: "2000-01-01", time: "23:30" }),
    (error) =>
      error instanceof BaziInputError && error.code === "DAY_BOUNDARY_REVIEW_REQUIRED",
  );
  assert.throws(
    () => normalizeBirthInput({ date: "2000-01-01", time: "00:30" }),
    (error) =>
      error instanceof BaziInputError && error.code === "DAY_BOUNDARY_REVIEW_REQUIRED",
  );
});

test("unknown birth time omits the hour pillar", async () => {
  const chart = await calculateBazi(
    { date: "1986-05-29", timeKnown: false },
    { calendarAdapter: FIXED_CALENDAR },
  );

  assert.equal(chart.pillars.time, null);
  assert.equal(chart.elementTotal, 6);
  assert.equal(chart.input.timeKnown, false);
});

test("calculates transparent surface element counts from the four pillars", async () => {
  const chart = await calculateBazi(
    { date: "1986-05-29", time: "05:30" },
    { calendarAdapter: FIXED_CALENDAR },
  );

  assert.deepEqual(chart.elementCounts, {
    木: 3,
    火: 2,
    土: 0,
    金: 1,
    水: 2,
  });
  assert.deepEqual(countSurfaceElements(chart.pillars), chart.elementCounts);
  assert.deepEqual(chart.dayMaster, { stem: "癸", element: "水" });
  assert.deepEqual(chart.tenGods.stems, {
    year: "正财",
    month: "比肩",
    day: "日主",
    time: "食神",
  });
  assert.equal(chart.tenGods.referenceStem, "癸");
  assert.equal(chart.tenGods.referencePolarity, "阴");
  assert.deepEqual(chart.tenGods.details.year, {
    stem: "丙",
    element: "火",
    polarity: "阳",
    relation: "我克",
    polarityRelation: "异阴阳",
    name: "正财",
  });
  assert.equal(chart.tenGods.details.time.relation, "我生");
  assert.deepEqual(
    chart.tenGods.branches.year.stems.map((item) => [
      item.stem,
      item.name,
      item.role,
    ]),
    [
      ["甲", "伤官", "本气"],
      ["丙", "正财", "中气"],
      ["戊", "正官", "余气"],
    ],
  );
  assert.ok(
    chart.relations.branches.some(
      (item) =>
        item.type === "冲" &&
        item.positions.includes("day") &&
        item.positions.includes("time"),
    ),
  );
});

test("maps all ten-god categories deterministically from the day stem", () => {
  assert.deepEqual(
    ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"].map(
      (stem) => calculateTenGod("甲", stem),
    ),
    ["比肩", "劫财", "食神", "伤官", "偏财", "正财", "七杀", "正官", "偏印", "正印"],
  );
});

test("hidden stems and chart relations are deterministic structural facts", () => {
  const pillars = {
    year: "甲子",
    month: "己丑",
    day: "丙午",
    time: "辛未",
  };
  const hidden = calculateHiddenStemTenGods(pillars, "丙");
  const relations = calculateChartRelations(pillars);

  assert.deepEqual(
    hidden.month.stems.map((item) => item.stem),
    ["己", "癸", "辛"],
  );
  assert.ok(
    relations.stems.some(
      (item) => item.type === "五合" && item.symbols === "甲己",
    ),
  );
  assert.ok(
    relations.branches.some(
      (item) => item.type === "冲" && item.symbols === "子午",
    ),
  );
  assert.ok(
    relations.branches.some(
      (item) => item.type === "六合" && item.symbols === "子丑",
    ),
  );
});

test("topic facts separate calculated evidence from unsupported inference", async () => {
  const chart = await calculateBazi(
    { date: "1986-05-29", time: "05:30" },
    { calendarAdapter: FIXED_CALENDAR },
  );
  const career = buildBaziTopicAnalysis(chart, "career");
  const relationship = buildBaziTopicAnalysis(chart, "relationship");

  assert.equal(career.topic, "career");
  assert.match(
    career.facts.find((item) => item.code === "TOPIC_TEN_GODS").value,
    /正官|正印|食神|伤官/,
  );
  assert.equal(relationship.topic, "relationship");
  assert.match(
    relationship.facts.find((item) => item.code === "SPOUSE_PALACE").value,
    /酉/,
  );
  assert.ok(
    relationship.limitations.some((item) => item.includes("性别中立")),
  );
  assert.match(relationship.inferencePolicy, /不等同于.*事件/);
});

test("pinned lunar-javascript calculates the known 1986-05-29 fixture", async () => {
  const chart = await calculateBazi({ date: "1986-05-29", time: "05:30" });

  assert.deepEqual(chart.pillars, {
    year: "丙寅",
    month: "癸巳",
    day: "癸酉",
    time: "乙卯",
  });
  assert.equal(chart.lunarLabel, "一九八六年四月廿一");
  assert.deepEqual(chart.dayMaster, { stem: "癸", element: "水" });
});

test("fixed report separates calculated facts from source limits", async () => {
  const chart = await calculateBazi(
    { date: "1986-05-29", time: "05:30" },
    { calendarAdapter: FIXED_CALENDAR },
  );
  const report = buildBaziReport(chart);

  assert.match(report, /计算结果 CALCULATED/);
  assert.match(report, /文化说明 SOURCED/);
  assert.match(report, /自我核对 REFLECTION/);
  assert.match(report, /天干十神：正财（我克 · 异阴阳）/);
  assert.match(report, /BZ-TENGOD-0001/);
  assert.match(report, /藏干与干支关系作为结构事实展示/);
  assert.match(report, /已审核规则组合使用/);
  assert.match(report, /不用于医疗、投资、法律、婚育/);
  assert.doesNotMatch(report, /保证发财|必定结婚|转运水晶|邀请好友/);
});

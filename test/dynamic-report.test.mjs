import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildDynamicUserReport } from "../lib/agent/ai-service.js";

const fireChart = {
  pillars: { year: "丙子", month: "丁卯", day: "丙午", time: "甲午" },
  dayMaster: { stem: "丙", element: "火" },
  elementCounts: { 木: 2, 火: 4, 土: 0, 金: 0, 水: 2 },
  tenGods: {
    stems: { year: "比肩", month: "劫财", day: "日主", time: "偏印" },
    branches: { year: { stems: [{ stem: "癸", name: "正官", role: "主气" }] } }
  },
  relations: { stems: [{ label: "丙辛合" }], branches: [], groups: [] }
};

const waterChart = {
  pillars: { year: "壬申", month: "癸亥", day: "壬辰", time: "辛丑" },
  dayMaster: { stem: "壬", element: "水" },
  elementCounts: { 木: 0, 火: 0, 土: 2, 金: 2, 水: 4 },
  tenGods: {
    stems: { year: "比肩", month: "劫财", day: "日主", time: "正印" },
    branches: { year: { stems: [{ stem: "庚", name: "偏印", role: "主气" }] } }
  },
  relations: { stems: [], branches: [{ label: "申子辰三合" }], groups: [] }
};

const careerContext = {
  question: "我是否应转向产品管理？",
  topics: [{
    topic: "事业与行业专题",
    groups: [{
      conclusion: "UNTRUSTED_GROUP_PROSE_事业专题仅依据丙子、丁卯、丙午、甲午与已计算十神展开。",
      details: ["年柱丙子", "透干十神含比肩与劫财"]
    }]
  }]
};

const wealthContext = {
  question: "今年如何安排现金流？",
  topics: [{
    topic: "财富专题",
    groups: [{
      conclusion: "UNTRUSTED_GROUP_PROSE_财富专题仅依据壬申、癸亥、壬辰、辛丑与已计算十神展开。",
      details: ["年柱壬申", "透干十神含正印"]
    }]
  }]
};

function countChineseCharacters(value) {
  return (String(value || "").match(/[\p{Script=Han}]/gu) || []).length;
}

test("动态报告随四柱与专题变化且不含遗留静态模板", async () => {
  const career = buildDynamicUserReport(fireChart, careerContext);
  const wealth = buildDynamicUserReport(waterChart, wealthContext);
  const sourcePath = fileURLToPath(new URL("../lib/agent/ai-service.js", import.meta.url));
  const source = await readFile(sourcePath, "utf8");

  assert.notDeepEqual(career, wealth);
  assert.match(career.corePortrait, /丙子/);
  assert.match(career.corePortrait, /日主丙火/);
  assert.match(career.corePortrait, /比肩/);
  assert.match(career.corePortrait, /癸·正官/);
  assert.match(career.corePortrait, /丙辛合/);
  assert.match(career.career, /我是否应转向产品管理/u);
  assert.match(wealth.wealth, /今年如何安排现金流/u);
  assert.doesNotMatch(JSON.stringify(career), /UNTRUSTED_GROUP_PROSE/u);
  assert.doesNotMatch(JSON.stringify(wealth), /UNTRUSTED_GROUP_PROSE/u);
  assert.ok(countChineseCharacters(Object.values(career).join("")) >= 1500);
  assert.ok(countChineseCharacters(Object.values(wealth).join("")) >= 1500);
  assert.doesNotMatch(JSON.stringify(career), /本题未选择/u);
  assert.doesNotMatch(JSON.stringify(wealth), /本题未选择/u);
  assert.doesNotMatch(JSON.stringify(career), /厚积薄发|战略巩固期/);
  assert.doesNotMatch(source, /厚积薄发|战略巩固期/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildReportEvidencePayload } from "../lib/agent/multi-agent-pipeline.js";

test("报告证据载荷保留已计算日柱并只标记 calculated 事实", () => {
  const chart = {
    pillars: { year: "丙子", month: "丁卯", day: "丙午", time: "甲午" },
    dayMaster: { stem: "丙", element: "火" },
    elementCounts: { 木: 2, 火: 4, 土: 0, 金: 0, 水: 2 },
    relations: { stems: [], branches: [], groups: [] },
  };
  const ziwei = { system: "ziwei", palaces: [{ name: "命宫", majorStars: [{ name: "紫微" }] }] };
  const qimen = { system: "qimen", palaces: [{ number: 1, name: "坎", door: "休门" }] };

  const evidence = buildReportEvidencePayload({ chart, ziwei, qimen, year: 2026 });

  assert.equal(evidence.bazi.pillars.day, "丙午");
  assert.deepEqual(evidence.ziwei, ziwei);
  assert.deepEqual(evidence.qimen, qimen);
  assert.equal(evidence.annual.year, 2026);
  assert.equal(evidence.annual.available, false);
  assert.ok(evidence.facts.length > 0);
  assert.ok(evidence.facts.every((fact) => fact.source === "calculated"));
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.bazi));
});

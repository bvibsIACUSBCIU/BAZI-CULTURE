import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateQimen, normalizeQimenInput, QimenInputError } from "../lib/metaphysics/qimen-engine.js";
import { buildQimenReport } from "../lib/metaphysics/qimen-report.js";

test("qimen requires a valid wall-clock date and time", () => {
  assert.throws(
    () => normalizeQimenInput({ date: "2026-02-29", time: "12:00" }),
    (error) => error instanceof QimenInputError && error.code === "INVALID_DATE",
  );
  assert.throws(
    () => normalizeQimenInput({ date: "2026-06-05", time: "" }),
    (error) => error instanceof QimenInputError && error.code === "TIME_REQUIRED",
  );
});

test("pinned qimen benchmark returns the audited 2026-06-05 chart", async () => {
  const chart = await calculateQimen({ date: "2026-06-05", time: "16:52" });
  assert.deepEqual(chart.juShu, {
    jieQiName: "芒种",
    type: "yang",
    number: "6",
    yuan: "上元",
    fullName: "阳遁6局 (上元)",
  });
  assert.deepEqual(chart.zhiFu, { star: "天任", palace: "8" });
  assert.deepEqual(chart.zhiShi, { door: "生门", palace: "8" });
  assert.equal(chart.palaces.find((palace) => palace.number === 8).deity, "值符");
  assert.equal(chart.palaces.find((palace) => palace.number === 1).door, "休门");
  assert.equal("analysis" in chart, false);
  assert.equal("geju" in chart, false);
  assert.match(buildQimenReport(chart), /候选依赖中的吉凶评分、格局断语和建议字段已全部丢弃/u);
});

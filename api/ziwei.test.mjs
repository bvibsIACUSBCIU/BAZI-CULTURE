import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateZiwei, hourToZiweiIndex, normalizeZiweiInput, ZiweiInputError } from "../lib/metaphysics/ziwei-engine.js";
import { buildZiweiReport } from "../lib/metaphysics/ziwei-report.js";

test("ziwei time index distinguishes early and late Zi hour", () => {
  assert.equal(hourToZiweiIndex(0), 0);
  assert.equal(hourToZiweiIndex(3), 2);
  assert.equal(hourToZiweiIndex(22), 11);
  assert.equal(hourToZiweiIndex(23), 12);
});

test("ziwei requires exact birth time and gender", () => {
  assert.throws(
    () => normalizeZiweiInput({ date: "2000-08-16", time: "", gender: "女" }),
    (error) => error instanceof ZiweiInputError && error.code === "TIME_REQUIRED",
  );
  assert.throws(
    () => normalizeZiweiInput({ date: "2000-08-16", time: "03:30" }),
    (error) => error instanceof ZiweiInputError && error.code === "GENDER_REQUIRED",
  );
});

test("iztro official documentation fixture produces stable core fields", async () => {
  const chart = await calculateZiwei({ date: "2000-08-16", time: "03:30", gender: "女" });
  assert.equal(chart.timeLabel, "寅时");
  assert.equal(chart.soul, "破军");
  assert.equal(chart.body, "文昌");
  assert.equal(chart.fiveElementsClass, "木三局");
  assert.equal(chart.soulPalaceBranch, "午");
  assert.equal(chart.bodyPalaceBranch, "戌");
  assert.equal(chart.palaces.length, 12);
  const soulPalace = chart.palaces.find((palace) => palace.name === "命宫");
  assert.equal(soulPalace.earthlyBranch, "午");
  assert.deepEqual(soulPalace.majorStars.map((star) => star.name), ["紫微"]);
  assert.match(buildZiweiReport(chart), /命主：破军｜身主：文昌｜五行局：木三局/u);
});

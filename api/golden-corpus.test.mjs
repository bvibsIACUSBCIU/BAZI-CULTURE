import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import lunarPackage from "lunar-javascript";

import {
  BaziInputError,
  calculateBazi,
  normalizeBirthInput,
} from "../lib/metaphysics/bazi-engine.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CORPUS_DIR = join(ROOT, "testdata", "golden");
const { Solar } = lunarPackage;

async function readJson(name) {
  return JSON.parse(await readFile(join(CORPUS_DIR, name), "utf8"));
}

test("golden corpus has unique, traceable and explicitly reviewed cases", async () => {
  const chartCorpus = await readJson("chart-cases.json");
  const boundaryCorpus = await readJson("input-boundaries.json");
  const sourceRegister = await readJson("source-register.json");
  const cases = [...chartCorpus.cases, ...boundaryCorpus.cases];
  const ids = cases.map((entry) => entry.id);
  const sourceIds = new Set(sourceRegister.sources.map((source) => source.sourceId));

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(sourceIds.size, sourceRegister.sources.length);
  assert.ok(cases.length >= 15);

  for (const entry of cases) {
    assert.match(entry.id, /^GOLDEN-[A-Z]+-\d{3}$/u);
    assert.ok(["approved", "provisional", "quarantined"].includes(entry.reviewState));
    assert.ok(entry.provenance.length > 0);
    for (const source of entry.provenance) {
      assert.ok(source.sourceId);
      assert.ok(source.locator);
      assert.ok(sourceIds.has(source.sourceId), `unregistered source: ${source.sourceId}`);
    }
    if (entry.evidenceLevel === "regression-snapshot") {
      assert.notEqual(entry.reviewState, "approved");
    }
  }
});

test("all active four-pillar fixtures match the pinned engine", async (t) => {
  const { cases } = await readJson("chart-cases.json");
  const active = cases.filter(
    (entry) =>
      entry.reviewState !== "quarantined" &&
      ["four-pillars", "solar-term-boundary"].includes(entry.category),
  );

  for (const entry of active) {
    await t.test(entry.id, async () => {
      const chart = await calculateBazi(entry.input);
      assert.deepEqual(chart.pillars, entry.expected.pillars);
      if (entry.expected.dayMaster) {
        assert.deepEqual(chart.dayMaster, entry.expected.dayMaster);
      }
      if (entry.expected.tenGods?.stems) {
        assert.deepEqual(
          [
            chart.tenGods.stems.year,
            chart.tenGods.stems.month,
            chart.tenGods.stems.day,
            chart.tenGods.stems.time,
          ],
          entry.expected.tenGods.stems,
        );
      }
      if (entry.expected.lunarLabel) {
        assert.equal(chart.lunarLabel, entry.expected.lunarLabel);
      }
    });
  }
});

test("approved hidden-stem and ten-god anchor remains available in the pinned dependency", async () => {
  const { cases } = await readJson("chart-cases.json");
  const entry = cases.find((item) => item.id === "GOLDEN-PILLAR-001");
  const [year, month, day] = entry.input.date.split("-").map(Number);
  const [hour, minute] = entry.input.time.split(":").map(Number);
  const eightChar = Solar.fromYmdHms(year, month, day, hour, minute, 0)
    .getLunar()
    .getEightChar();

  assert.deepEqual(
    [
      eightChar.getYearHideGan(),
      eightChar.getMonthHideGan(),
      eightChar.getDayHideGan(),
      eightChar.getTimeHideGan(),
    ],
    [
      entry.expected.hiddenStems.year,
      entry.expected.hiddenStems.month,
      entry.expected.hiddenStems.day,
      entry.expected.hiddenStems.time,
    ],
  );
  assert.deepEqual(
    [
      eightChar.getYearShiShenGan(),
      eightChar.getMonthShiShenGan(),
      eightChar.getDayShiShenGan(),
      eightChar.getTimeShiShenGan(),
    ],
    entry.expected.tenGods.stems,
  );
  assert.deepEqual(
    [
      eightChar.getYearShiShenZhi(),
      eightChar.getMonthShiShenZhi(),
      eightChar.getDayShiShenZhi(),
      eightChar.getTimeShiShenZhi(),
    ],
    entry.expected.tenGods.branches,
  );
});

test("input-policy corpus produces the documented errors and unknown-time behavior", async (t) => {
  const { cases } = await readJson("input-boundaries.json");

  for (const entry of cases) {
    await t.test(entry.id, async () => {
      if (entry.expected.errorCode) {
        assert.throws(
          () => normalizeBirthInput(entry.input),
          (error) =>
            error instanceof BaziInputError && error.code === entry.expected.errorCode,
        );
        return;
      }

      const chart = await calculateBazi(entry.input);
      assert.equal(chart.input.timeKnown, entry.expected.timeKnown);
      assert.equal(chart.pillars.time, entry.expected.timePillar);
      assert.equal(chart.elementTotal, entry.expected.elementTotal);
    });
  }
});

test("96 generated valid inputs satisfy structural invariants without becoming golden truth", async () => {
  const pillarPattern = /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/u;
  const years = [1901, 1924, 1949, 1966, 1984, 2000, 2024, 2098];
  const months = [1, 2, 4, 6, 8, 10];
  const hours = [1, 5];
  let count = 0;

  for (const year of years) {
    for (const month of months) {
      for (const hour of hours) {
        const date = `${year}-${String(month).padStart(2, "0")}-15`;
        const time = `${String(hour).padStart(2, "0")}:30`;
        const first = await calculateBazi({ date, time });
        const second = await calculateBazi({ date, time });

        assert.deepEqual(first, second);
        assert.equal(first.elementTotal, 8);
        for (const pillar of Object.values(first.pillars)) {
          assert.match(pillar, pillarPattern);
        }
        count += 1;
      }
    }
  }

  assert.equal(count, 96);
});

test("production agent code cannot import the golden corpus", async () => {
  const agentDir = join(ROOT, "lib", "agent");
  const pending = [agentDir];

  while (pending.length) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (/\.(?:js|mjs)$/u.test(entry.name)) {
        const source = await readFile(path, "utf8");
        assert.doesNotMatch(source, /testdata[/"']+golden/u);
      }
    }
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("legacy Ziwei and Qimen URLs redirect into the unified workspace", async () => {
  const [ziwei, qimen, ziweiScript, qimenScript] = await Promise.all([
    readFile(new URL("ziwei.html", root), "utf8"),
    readFile(new URL("qimen.html", root), "utf8"),
    readFile(new URL("ziwei-page.js", root), "utf8"),
    readFile(new URL("qimen-page.js", root), "utf8"),
  ]);

  assert.match(ziwei, /location\.replace\("\/#ziwei"\)/u);
  assert.match(qimen, /location\.replace\("\/#qimen"\)/u);
  assert.match(ziweiScript, /\/api\/ziwei/u);
  assert.match(qimenScript, /\/api\/qimen/u);
});

test("all system navigation switches panels inside one page", async () => {
  const index = await readFile(new URL("index.html", root), "utf8");

  for (const system of ["bazi", "ziwei", "qimen"]) {
    assert.match(
      index,
      new RegExp(`data-system-switch="${system}" href="#${system}"`, "u"),
    );
    assert.match(index, new RegExp(`data-system-panel="${system}"`, "u"));
  }
  assert.doesNotMatch(index, /href="\/(?:ziwei|qimen)\.html"/u);
  assert.match(index, /function activateSystem/u);
  assert.match(index, /history\.replaceState/u);
});

test("public system pages keep research documentation out of the main UI", async () => {
  const pages = await Promise.all(
    ["index.html", "ziwei.html", "qimen.html"].map((name) =>
      readFile(new URL(name, root), "utf8"),
    ),
  );

  for (const page of pages) {
    assert.doesNotMatch(page, /体系说明|方法边界|SYSTEM · ORIGIN/u);
  }
});

test("system background copy is embedded in the unified workspace", async () => {
  const index = await readFile(new URL("index.html", root), "utf8");

  assert.match(index, /子平八字 · Bazi \(Four Pillars\)/u);
  assert.match(index, /紫微斗数 · Ziwei Doushu/u);
  assert.match(index, /奇门遁甲 · Qimen Dunjia/u);
  assert.doesNotMatch(index, /返回首页/u);
});

test("all three systems share the same first-screen product skeleton", async () => {
  const index = await readFile(new URL("index.html", root), "utf8");
  const panels = [...index.matchAll(
    /<div class="system-panel"[^>]*data-system-panel="([^"]+)"[\s\S]*?(?=<div class="system-panel"|<\/main>)/gu,
  )];

  assert.equal(panels.length, 3);
  for (const [, system] of panels) {
    const panel = panels.find((entry) => entry[1] === system)[0];
    for (const className of ["hero", "intro", "tagline", "system-copy", "form-card", "cosmos"]) {
      assert.match(panel, new RegExp(`class="[^"]*\\b${className}\\b`));
    }
  }
});

test("each system keeps its own form, result target, and deterministic endpoint", async () => {
  const [index, ziweiScript, qimenScript] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("ziwei-page.js", root), "utf8"),
    readFile(new URL("qimen-page.js", root), "utf8"),
  ]);

  assert.match(index, /id="birth-form"/u);
  assert.match(index, /id="ziwei-form"/u);
  assert.match(index, /id="qimen-form"/u);
  assert.match(index, /type="module" src="\/ziwei-page\.js"/u);
  assert.match(index, /type="module" src="\/qimen-page\.js"/u);
  assert.match(ziweiScript, /getElementById\("ziwei-chart"\)/u);
  assert.match(qimenScript, /getElementById\("qimen-chart"\)/u);
});

test("Bazi report controls bind expand and copy actions for each rendered report", async () => {
  const index = await readFile(new URL("index.html", root), "utf8");

  assert.match(index, /if \(userReportWrapper && toggleBtn\) \{/u);
  assert.match(index, /toggleBtn\.onclick = \(\) => \{/u);
  assert.match(index, /if \(copyBtn\) \{/u);
  assert.match(index, /const textToCopy = reportText \|\| currentMarkdownReport;/u);
  assert.match(index, /await navigator\.clipboard\.writeText\(textToCopy\)/u);
  assert.match(index, /document\.execCommand\("copy"\)/u);
  assert.doesNotMatch(index, /if \(false && (?:userReportWrapper && toggleBtn|copyBtn)\)/u);
  assert.match(index, /点击展开本轮报告 \(约1000字\) ↓/u);
});

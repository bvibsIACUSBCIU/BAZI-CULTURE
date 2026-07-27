import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Ziwei and Qimen user pages do not cross-promote each other", async () => {
  const [ziwei, qimen, ziweiScript, qimenScript] = await Promise.all([
    readFile(new URL("ziwei.html", root), "utf8"),
    readFile(new URL("qimen.html", root), "utf8"),
    readFile(new URL("ziwei-page.js", root), "utf8"),
    readFile(new URL("qimen-page.js", root), "utf8"),
  ]);

  assert.doesNotMatch(ziwei, /奇门|qimen/iu);
  assert.doesNotMatch(qimen, /紫微|ziwei/iu);
  assert.match(ziweiScript, /\/api\/ziwei/u);
  assert.match(qimenScript, /\/api\/qimen/u);
});

test("Bazi navigation links to independent system pages", async () => {
  const index = await readFile(new URL("index.html", root), "utf8");

  assert.match(index, /href="\/ziwei\.html"/u);
  assert.match(index, /href="\/qimen\.html"/u);
  assert.doesNotMatch(index, /systems\.html#/u);
});

import assert from "node:assert/strict";
import test from "node:test";

import { handleProfileRequest } from "../api/profile.js";
import { handleQuotaRequest } from "../api/quota.js";
import { handleSessionHistoryRequest } from "../api/session-history.js";
import { calculateTenGod } from "../lib/metaphysics/bazi-engine.js";

const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const tenGodNames = new Set(["比肩", "劫财", "食神", "伤官", "偏财", "正财", "七杀", "正官", "偏印", "正印"]);

for (const dayStem of stems) {
  for (const targetStem of stems) {
    test(`十神计算 ${dayStem} 对 ${targetStem} 返回有效确定性名称`, () => {
      assert.ok(tenGodNames.has(calculateTenGod(dayStem, targetStem)));
    });
  }
}

test("命主档案 endpoint 返回 Fetch 标准 JSON Response", async () => {
  const response = await handleProfileRequest(new Request("http://localhost/api/profile?wallet=contract-profile"));
  assert.ok(response instanceof Response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual((await response.json()).profiles, []);
});

test("积分 endpoint 返回 Fetch 标准 JSON Response", async () => {
  const response = await handleQuotaRequest(new Request("http://localhost/api/quota?wallet=contract-quota"));
  assert.ok(response instanceof Response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal((await response.json()).success, true);
});

test("会话 endpoint 以钱包隔离并返回 Fetch 标准 JSON Response", async () => {
  const wallet = "contract-session";
  const created = await handleSessionHistoryRequest(new Request(`http://localhost/api/session-history?wallet=${wallet}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "事业专题", question: "如何推进事业" }),
  }));
  assert.ok(created instanceof Response);
  const session = (await created.json()).session;
  const listed = await handleSessionHistoryRequest(new Request(`http://localhost/api/session-history?wallet=${wallet}`));
  assert.equal((await listed.json()).sessions[0].id, session.id);
});

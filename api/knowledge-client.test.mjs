import assert from "node:assert/strict";
import { test } from "node:test";

import {
  searchApprovedRules,
  searchResearchPassages,
} from "../lib/agent/knowledge-client.js";

test("knowledge search safely reports unavailable without credentials", async () => {
  const result = await searchApprovedRules({ query: "日主", baseUrl: "", secret: "" });
  assert.equal(result.available, false);
  assert.deepEqual(result.rules, []);
});

test("knowledge search returns only bounded approved rule fields", async () => {
  const result = await searchApprovedRules({
    query: "日主",
    baseUrl: "https://knowledge.example",
    secret: "secret",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          ok: true,
          retrievalVersion: "approved-rules-v1",
          rules: [{
            rule_code: "DM-001",
            title: "日主说明",
            topic: "基础",
            conditions: [],
            exclusions: [],
            allowed_inference: "只作分类说明",
            forbidden_inference: "不得决定论",
            evidence: [],
            version: 1,
          }],
        };
      },
    }),
  });
  assert.equal(result.available, true);
  assert.equal(result.rules[0].ruleCode, "DM-001");
  assert.equal(result.rules[0].allowedInference, "只作分类说明");
});

test("research search preserves the non-production boundary", async () => {
  const result = await searchResearchPassages({
    query: "古籍里怎么说月令",
    baseUrl: "https://knowledge.example",
    secret: "secret",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          ok: true,
          researchOnly: true,
          warning: "未经审核",
          retrievalVersion: "research-passages-v1",
          passages: [{
            id: "passage-1",
            source_title: "滴天髓阐微",
            locator: "epub:chapter.xhtml#chars=1-100",
            source_confidence: "medium_low",
            document_review_state: "draft",
            production_eligible: false,
            content: "月令研究片段",
          }],
        };
      },
    }),
  });
  assert.equal(result.available, true);
  assert.equal(result.researchOnly, true);
  assert.equal(result.passages[0].ref, "passage-1");
  assert.equal(result.passages[0].productionEligible, false);
});

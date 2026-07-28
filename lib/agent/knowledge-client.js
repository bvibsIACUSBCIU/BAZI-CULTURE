import { getEnv } from "../runtime/env.js";

export async function searchApprovedRules({
  query,
  topic = "",
  limit = 4,
  fetchImpl = fetch,
  baseUrl = getEnv().KNOWLEDGE_BASE_URL,
  secret = getEnv().KNOWLEDGE_RETRIEVAL_SECRET,
} = {}) {
  if (!baseUrl || !secret) {
    return { available: false, reason: "知识库尚未配置", rules: [] };
  }
  try {
    const response = await fetchImpl(
      `${String(baseUrl).replace(/\/+$/u, "")}/api/agent/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, topic, limit }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      return { available: false, reason: "知识检索暂时不可用", rules: [] };
    }
    return {
      available: true,
      retrievalVersion: payload.retrievalVersion,
      rules: (payload.rules || []).slice(0, limit).map((rule) => ({
        ruleCode: rule.rule_code,
        title: rule.title,
        topic: rule.topic,
        conditions: rule.conditions,
        exclusions: rule.exclusions,
        allowedInference: rule.allowed_inference,
        forbiddenInference: rule.forbidden_inference,
        evidence: (rule.evidence || []).slice(0, 3),
        version: rule.version,
      })),
    };
  } catch {
    return { available: false, reason: "知识检索暂时不可用", rules: [] };
  }
}

export async function searchResearchPassages({
  query,
  limit = 3,
  fetchImpl = fetch,
  baseUrl = getEnv().KNOWLEDGE_BASE_URL,
  secret = getEnv().KNOWLEDGE_RETRIEVAL_SECRET,
} = {}) {
  if (!baseUrl || !secret) {
    return { available: false, reason: "知识库尚未配置", researchOnly: true, passages: [] };
  }
  try {
    const response = await fetchImpl(
      `${String(baseUrl).replace(/\/+$/u, "")}/api/agent/research`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, limit }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || payload.researchOnly !== true) {
      return { available: false, reason: "研究检索暂时不可用", researchOnly: true, passages: [] };
    }
    const passages = (payload.passages || []).slice(0, limit).map((passage) => ({
      ref: String(passage.id || "").slice(0, 80),
      sourceTitle: String(passage.source_title || "").slice(0, 120),
      edition: String(passage.edition || "").slice(0, 120),
      locator: String(passage.locator || "").slice(0, 300),
      sourceConfidence: passage.source_confidence,
      reviewState: passage.document_review_state,
      productionEligible: false,
      excerpt: String(passage.content || "").slice(0, 900),
    }));
    return {
      available: passages.length > 0,
      reason: passages.length ? null : "没有找到匹配的研究片段",
      researchOnly: true,
      warning: String(payload.warning || "研究片段未经生产审核。").slice(0, 160),
      retrievalVersion: payload.retrievalVersion,
      passages,
    };
  } catch {
    return { available: false, reason: "研究检索暂时不可用", researchOnly: true, passages: [] };
  }
}

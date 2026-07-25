import {
  searchApprovedRules,
  searchResearchPassages,
} from "../knowledge-client.js";

export function createKnowledgeTools({
  search = searchApprovedRules,
  searchResearch = searchResearchPassages,
} = {}) {
  return {
    search_approved_rules: {
      description: "只检索经过人工审核并标记为 approved 的命理规则与证据。",
      async execute(input) {
        return search({
          query: String(input?.query || "").slice(0, 300),
          topic: String(input?.topic || "").slice(0, 50),
          limit: Math.min(4, Number(input?.limit || 4)),
        });
      },
    },
    search_research_passages: {
      description:
        "检索未经生产审核的古籍研究片段；只能用于原文、来源、版本和流派比较，不能作为命盘结论。",
      async execute(input) {
        return searchResearch({
          query: String(input?.query || "").slice(0, 300),
          limit: Math.min(3, Number(input?.limit || 3)),
        });
      },
    },
  };
}

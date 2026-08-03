const ROUTES = Object.freeze({
  overview: { label: "原局总览", specialist: "原局总览 Agent", baziTopic: "overview" },
  elements: { label: "日主与五行", specialist: "日主五行 Agent", baziTopic: "overview" },
  career: { label: "事业研读", specialist: "事业 Agent", baziTopic: "career" },
  wealth: { label: "财富研读", specialist: "财富 Agent", baziTopic: "wealth" },
  relationship: { label: "情感研读", specialist: "情感 Agent", baziTopic: "relationship" },
  method: { label: "计算方法说明", specialist: "方法说明 Agent", baziTopic: "overview" },
  research: { label: "来源与研究说明", specialist: "研究资料 Agent", baziTopic: "overview" },
  boundary: { label: "安全边界说明", specialist: "边界说明 Agent", baziTopic: "overview" },
});

const INTENT_PATTERNS = Object.freeze([
  ["boundary", /死亡|寿命|疾病|治疗|怀孕|生育|投资|股票|买入|卖出|赌博|彩票|诉讼|离婚|发财|升职/u],
  ["method", /(?:怎么|如何|为何|为什么).{0,8}(?:算|计算|排盘)|(?:计算|排盘).{0,8}(?:口径|方法|依据)|换日|时区/u],
  ["research", /原文|古籍|哪本书|出处|来源|书里|怎么说|流派|版本|校勘/u],
  ["elements", /日主|五行|金木水火土|元素/u],
  ["career", /事业|职业|工作|求职|岗位|团队|能力|专业/u],
  ["wealth", /财富|财运|收入|资源|薪资|赚钱|资产/u],
  ["relationship", /情感|感情|关系|亲密|伴侣|婚姻|沟通/u],
]);

export function resolveAgentRoute({ topic = "overview", question = "" } = {}) {
  const cleanQuestion = String(question || "").trim();
  const matched = cleanQuestion
    ? INTENT_PATTERNS.find(([, pattern]) => pattern.test(cleanQuestion))
    : null;
  const requested = String(topic || "overview").trim().toLowerCase();
  const key = matched?.[0] || (ROUTES[requested] ? requested : "overview");
  return Object.freeze({ key, question: cleanQuestion, ...ROUTES[key] });
}

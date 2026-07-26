const ELEMENT_ORDER = ["木", "火", "土", "金", "水"];
const PILLAR_LABELS = [
  ["年柱", "year"],
  ["月柱", "month"],
  ["日柱", "day"],
  ["时柱", "time"],
];

export function buildBaziReport(chart, { birthplace = "" } = {}) {
  const hasVisibleTenGods = Boolean(chart.tenGods?.stems);
  const pillarLines = PILLAR_LABELS.map(([label, key]) => {
    const value = chart.pillars[key] || "未计算";
    const tenGod = chart.tenGods?.stems?.[key];
    const detail = chart.tenGods?.details?.[key];
    const relation = detail && key !== "day"
      ? `（${detail.relation} · ${detail.polarityRelation}）`
      : "";
    const hidden = chart.tenGods?.branches?.[key]?.stems
      ?.map((item) => `${item.stem}·${item.name}（${item.role}）`)
      .join("、");
    return `${label}：${value}${tenGod ? `｜天干十神：${tenGod}${relation}` : ""}${hidden ? `｜藏干：${hidden}` : ""}`;
  });
  const elementLine = ELEMENT_ORDER.map(
    (element) => `${element}${chart.elementCounts[element]}`,
  ).join(" · ");

  return [
    "八字文化研究报告 · 子平结构 MVP",
    "",
    "【计算结果 CALCULATED】",
    `公历：${chart.input.date}${chart.input.time ? ` ${chart.input.time}` : "（出生时间不详）"}`,
    `时区：${chart.input.timezone} ${chart.input.timezoneOffset}`,
    birthplace
      ? `出生地：${birthplace}（仅作记录，未参与当前排盘计算）`
      : null,
    ...pillarLines,
    `日主：${chart.dayMaster.stem}（${chart.tenGods?.referencePolarity || ""}${chart.dayMaster.element}）`,
    `表层五行计数：${elementLine}`,
    chart.lunarLabel ? `农历显示：${chart.lunarLabel}` : null,
    "",
    "【结构关系 DETERMINISTIC】",
    hasVisibleTenGods
      ? "十神以日干为唯一参照，由天干五行的生克方向与阴阳同异确定。当前展示透干十神及固定藏干表对应十神；日柱天干标记为日主。"
      : "当前记录来自旧版命盘，尚未包含可见天干十神；重新排盘后可生成该项。",
    hasVisibleTenGods
      ? "“正、偏”是分类名称，不等于好坏；单个十神也不能直接推出性格、亲属、职业、财富或事件。"
      : null,
    hasVisibleTenGods ? "依据规则：BZ-TENGOD-0001 · BZ-TENGOD-0002" : null,
    "",
    "【计算口径 METHOD】",
    "表层五行计数仍只统计四柱天干与地支主元素，不把藏干加入数量或权重。藏干与干支关系作为结构事实展示，但不自动判断力量、吉凶或事件；旺衰、格局、用神、大运和流年仍未计算。",
    chart.input.timeKnown
      ? "出生时间已纳入时柱。"
      : "出生时间不详，因此时柱留空，五行计数只有六个表层字符。",
    "",
    "【文化说明 SOURCED】",
    "专题研读只允许把程序事实与本轮检索到的已审核规则组合使用。不会根据五行数量、单个十神、单组冲合直接判断职业、财富、婚姻结果或吉凶。",
    "",
    "【自我核对 REFLECTION】",
    "1. 请先确认公历日期、时间和四柱是否与可信万年历一致。",
    "2. 哪些部分需要补充解释，哪些内容你认为不应进入报告？",
    "3. 若出生时间不确定，请不要把时柱相关内容当作结论。",
    "",
    "【资料范围】",
    "《三命通会》已建立扫描与文本对校流程；《子平真诠》当前扫描已完成分段；其余现有书籍仅作研究索引或辅助校勘。未审核古籍原文不会自动进入本报告。",
    "",
    "仅供成年人进行传统文化研究与自我观察，不用于医疗、投资、法律、婚育或重大人生决定。",
    `引擎版本：${chart.engineVersion}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function buildMethodText() {
  return [
    "研究版计算与资料说明",
    "",
    "1. 输入：公历出生日期、可选出生时间。",
    "2. 时区：首版固定为 Asia/Shanghai（UTC+8）。",
    "3. 排盘：由 lunar-javascript@1.7.7 确定性计算，AI 不参与四柱计算。",
    "4. 边界：23:00-00:59 暂停自动计算，避免换日流派差异被静默处理。",
    "5. 十神：以日干为参照，由程序计算透干和固定藏干表十神；AI 不参与映射。",
    "6. 关系：程序记录天干五合/相克、地支合冲刑害破及三合三会是否出现，但不判断合化与吉凶。",
    "7. 五行：只做表层字符计数，不给藏干设置权重，也不判断旺衰。",
    "8. 专题：事业、财富、情感只展示结构依据、限制与自我核对，不预测具体事件。",
    "9. 古籍：只有完成人工对校和规则审核的内容才允许进入个性化解释。",
    "10. 隐私：填写过程中的出生资料仅在短时会话中处理；排盘后保留派生命盘和报告，会话会自动过期，可用 /delete 提前清除。",
    "",
    "当前是内部研究 MVP，不是公开发布版本。",
  ].join("\n");
}

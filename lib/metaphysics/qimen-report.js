export function buildQimenReport(chart) {
  const palaceLines = chart.palaces.map((palace) =>
    `${palace.number}宫 ${palace.name}（${palace.direction}）｜天盘${palace.heavenStem || "—"} 地盘${palace.earthStem || "—"}｜${palace.star || "—"} · ${palace.door || "—"} · ${palace.deity || "—"}${palace.isEmpty ? "｜空亡" : ""}${palace.isHorse ? "｜驿马" : ""}`,
  );
  return [
    "时家奇门结构盘 · 研究 MVP", "",
    "【起局信息 CALCULATED】",
    `时间：${chart.input.date} ${chart.input.time}（${chart.input.timezone}）`,
    `四柱：${chart.siZhu.year} ${chart.siZhu.month} ${chart.siZhu.day} ${chart.siZhu.time}`,
    `节气：${chart.juShu.jieQiName}｜${chart.juShu.fullName}`,
    `值符：${chart.zhiFu.star}落${chart.zhiFu.palace}宫｜值使：${chart.zhiShi.door}落${chart.zhiShi.palace}宫`,
    "", "【九宫结构】", ...palaceLines,
    "", "【算法口径 METHOD】",
    "采用锁定提交的时家奇门茅山派转盘实现。当前只返回起局结构；候选依赖中的吉凶评分、格局断语和建议字段已全部丢弃。",
    "", "【解释边界】",
    "奇门存在拆补、置闰、茅山等定局差异。本版不把当前方法包装成唯一标准，也不用于医疗、投资、诉讼、灾祸或重大决策预测。",
    "", `引擎版本：${chart.engineVersion}`,
  ].join("\n");
}

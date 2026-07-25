export function buildZiweiReport(chart) {
  const soulPalace = chart.palaces.find((palace) => palace.name === "命宫");
  const bodyPalace = chart.palaces.find((palace) => palace.isBodyPalace);
  const palaceLines = chart.palaces.map((palace) => {
    const major = palace.majorStars.map(formatStar).join("、") || "无主星";
    const minor = palace.minorStars.map(formatStar).join("、") || "—";
    return `${palace.name}（${palace.heavenlyStem}${palace.earthlyBranch}）｜主星：${major}｜辅星：${minor}${palace.isBodyPalace ? "｜身宫" : ""}`;
  });

  return [
    "紫微斗数出生盘 · 结构研究 MVP",
    "",
    "【基础盘 CALCULATED】",
    `公历：${chart.solarDate} ${chart.input.time}`,
    `农历：${chart.lunarDate}｜${chart.timeLabel}（${chart.timeRange}）`,
    `性别：${chart.input.gender}｜干支：${chart.chineseDate}`,
    `命宫：${soulPalace ? `${soulPalace.heavenlyStem}${soulPalace.earthlyBranch}` : chart.soulPalaceBranch}`,
    `身宫：${bodyPalace ? `${bodyPalace.name} · ${bodyPalace.heavenlyStem}${bodyPalace.earthlyBranch}` : chart.bodyPalaceBranch}`,
    `命主：${chart.soul}｜身主：${chart.body}｜五行局：${chart.fiveElementsClass}`,
    "",
    "【十二宫结构】",
    ...palaceLines,
    "",
    "【算法口径 METHOD】",
    "采用 iztro@2.5.8 默认配置，以阳历、时辰序号和性别生成出生盘；闰月调整开启。出生地目前未参与历史时区或真太阳时校正。",
    "",
    "【解释边界】",
    "当前只展示程序排出的宫位和星曜位置。流派配置、四化规则、星曜亮度解释和运限断语尚未进入已审核知识库，因此不据此预测财富、婚姻、疾病或人生事件。",
    "",
    "仅供成年人进行传统文化研究与自我观察。",
    `引擎版本：${chart.engineVersion}`,
  ].join("\n");
}

function formatStar(star) {
  return `${star.name}${star.brightness ? `〔${star.brightness}〕` : ""}${star.mutagen ? `·化${star.mutagen}` : ""}`;
}

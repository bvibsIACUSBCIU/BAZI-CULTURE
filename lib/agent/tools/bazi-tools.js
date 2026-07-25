import { calculateBazi } from "../../metaphysics/bazi-engine.js";
import {
  buildBaziReport,
  buildMethodText,
} from "../../metaphysics/bazi-report.js";

export function createBaziTools({ calculate = calculateBazi } = {}) {
  return {
    calculate_bazi: {
      description: "使用确定性历法引擎计算四柱；只接受结构化出生输入。",
      async execute(input) {
        return calculate(input);
      },
    },
    get_chart_summary: {
      description: "读取当前会话中已经计算完成的命盘摘要。",
      async execute(_input, context) {
        const chart = context?.session?.chart;
        if (!chart) throw new Error("当前会话没有可读取的命盘。");
        return {
          pillars: chart.pillars,
          dayMaster: chart.dayMaster,
          tenGods: chart.tenGods || null,
          elementCounts: chart.elementCounts,
          elementTotal: chart.elementTotal,
          timeKnown: chart.input?.timeKnown === true,
          lunarLabel: chart.lunarLabel || null,
          calculationScope:
            "含四柱、日主、可见天干十神与表层天干地支主元素计数；未计算藏干、地支内部十神、旺衰、格局、用神、大运或流年。",
        };
      },
    },
    generate_basic_report: {
      description: "根据当前确定性命盘生成固定格式基础报告。",
      async execute(_input, context) {
        if (context?.session?.basicReport) return context.session.basicReport;
        const chart = context?.session?.chart;
        if (!chart) throw new Error("当前会话没有可生成报告的命盘。");
        return buildBaziReport(chart);
      },
    },
    get_calculation_method: {
      description: "返回当前版本的排盘口径、资料边界和隐私说明。",
      async execute() {
        return buildMethodText();
      },
    },
  };
}

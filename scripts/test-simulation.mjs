import { calculateBazi } from "../lib/metaphysics/bazi-engine.js";
import { createAiReportHandler } from "../api/ai-report.js";
import { getEnv } from "../lib/runtime/env.js";

async function runSimulation() {
  const input = {
    date: "1996-08-18",
    time: "09:30",
    timeKnown: true,
    birthplace: "北京",
    consent: true,
    topic: "overview",
  };

  console.log("==================================================");
  console.log("【模拟测试输入】");
  console.log("生日:", input.date);
  console.log("时间:", input.time);
  console.log("地点:", input.birthplace);
  console.log("==================================================\n");

  let result;
  const handler = createAiReportHandler();
  await handler(
    { method: "POST", body: input, socket: { remoteAddress: "127.0.0.1" }, headers: {} },
    {
      setHeader() {},
      status(code) {
        return {
          json(body) {
            result = { code, body };
          },
        };
      },
    },
  );

  if (result && result.code === 200) {
    const { chart, ai } = result.body;
    console.log("【1. 确定性历法排盘结果 (Chart)】");
    console.log("四柱:", `年:${chart.pillars.year} 月:${chart.pillars.month} 日:${chart.pillars.day} 时:${chart.pillars.time}`);
    console.log("日主:", `${chart.dayMaster.stem}·${chart.dayMaster.element}`);
    console.log("表层五行计数:", JSON.stringify(chart.elementCounts));
    console.log("透干十神:", JSON.stringify(chart.tenGods?.stems));

    console.log("\n【2. 多 Agent 推演 Pipeline】");
    ai.agent.pipeline.forEach((p) => {
      console.log(`[${p.agent}] ${p.roleName} -> ${p.action}`);
    });

    console.log("\n【3. 事实依据章节 (Sections)】");
    ai.reading.sections.forEach((s) => {
      console.log(`- 【${s.title}】 (依据: ${s.basis})`);
      console.log(`  正文: ${s.body}`);
      console.log(`  事实依据: ${s.supportingFacts.join("; ")}`);
      console.log(`  限制/反证: ${s.counterpoints.join("; ")}`);
    });

    console.log("\n【4. 1500字动态通俗解盘报告 (User Report)】");
    console.log("\n### 核心画像");
    console.log(ai.reading.userReport.corePortrait);
    console.log("\n### 事业发展模式");
    console.log(ai.reading.userReport.career);
    console.log("\n### 感情与婚姻");
    console.log(ai.reading.userReport.relationship);
    console.log("\n### 健康状况");
    console.log(ai.reading.userReport.health);
    console.log("\n### 财运分析");
    console.log(ai.reading.userReport.wealth);
    console.log("\n### 当前阶段建议");
    console.log(ai.reading.userReport.currentStage);
    console.log("==================================================");
  } else {
    console.error("测试失败:", result);
  }
}

runSimulation();

import { calculateBazi } from "../lib/metaphysics/bazi-engine.js";
import { createAiReportHandler } from "../api/ai-report.js";
import { getEnv } from "../lib/runtime/env.js";
import { generateAiReading } from "../lib/agent/ai-service.js";

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
  const modelStages = [];
  const handler = createAiReportHandler({
    generate: async (input) => {
      const startedAt = Date.now();
      console.log(`【模型阶段开始】${input.phase} · ${input.route?.specialist || "未路由"}`);
      const output = await generateAiReading(input);
      modelStages.push({ phase: input.phase, model: output.model, ms: Date.now() - startedAt });
      console.log(`【模型阶段完成】${input.phase} · ${output.model} · ${Date.now() - startedAt}ms`);
      return output;
    },
  });
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

    console.log("\n【4. 本轮路由与专题化输出】");
    console.log("路由:", `${ai.agent.route?.key || "unknown"} · ${ai.agent.route?.specialist || "unknown"}`);
    console.log("模型阶段:", JSON.stringify(modelStages));
    console.log("章节数:", ai.reading.sections.length);
    const report = ai.reading.userReport || "";
    const reportHasInternalMeta = /回退|服务恢复|研读边界|边界：/u.test(report);
    if (typeof report !== "string" || report.length < 800 || reportHasInternalMeta) {
      throw new Error(
        `报告校验失败：length=${report.length}，包含内部说明=${reportHasInternalMeta}`,
      );
    }
    console.log("报告长度:", `${report.length} 字符`);
    console.log("\n【5. 动态解盘报告】");
    console.log(report);
    console.log("==================================================");
  } else {
    console.error("测试失败:", result);
  }
}

await runSimulation().catch((error) => {
  console.error("模拟测试异常:", error);
  process.exitCode = 1;
});

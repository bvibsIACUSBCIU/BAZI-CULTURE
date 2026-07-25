import { calculateZiwei, ZiweiInputError } from "../lib/metaphysics/ziwei-engine.js";
import { buildZiweiReport } from "../lib/metaphysics/ziwei-report.js";

export function createZiweiHandler({ calculate = calculateZiwei } = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.method === "GET") {
      response.status(200).json({ ok: true, system: "ziwei", required: ["date", "time", "gender", "consent"] });
      return;
    }
    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }
    if (request.body?.consent !== true) {
      response.status(400).json({ ok: false, code: "CONSENT_REQUIRED", error: "排盘前需要同意本次处理出生资料。" });
      return;
    }
    try {
      const chart = await calculate(request.body || {});
      response.status(200).json({ ok: true, chart, report: buildZiweiReport(chart) });
    } catch (error) {
      if (error instanceof ZiweiInputError) {
        response.status(422).json({ ok: false, code: error.code, error: error.message });
        return;
      }
      response.status(500).json({ ok: false, code: "ZIWEI_ENGINE_ERROR", error: "紫微排盘失败，请稍后重试。" });
    }
  };
}

export default createZiweiHandler();

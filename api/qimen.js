import { calculateQimen, QimenInputError } from "../lib/metaphysics/qimen-engine.js";
import { buildQimenReport } from "../lib/metaphysics/qimen-report.js";

export function createQimenHandler({ calculate = calculateQimen } = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    if (request.method === "GET") {
      response.status(200).json({ ok: true, system: "qimen", method: "时家", required: ["date", "time", "consent"] });
      return;
    }
    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }
    if (request.body?.consent !== true) {
      response.status(400).json({ ok: false, code: "CONSENT_REQUIRED", error: "起局前需要同意本次处理时间资料。" });
      return;
    }
    try {
      const chart = await calculate(request.body || {});
      response.status(200).json({ ok: true, chart, report: buildQimenReport(chart) });
    } catch (error) {
      if (error instanceof QimenInputError) {
        response.status(422).json({ ok: false, code: error.code, error: error.message });
        return;
      }
      response.status(500).json({ ok: false, code: "QIMEN_ENGINE_ERROR", error: "奇门起局失败，请稍后重试。" });
    }
  };
}

export default createQimenHandler();

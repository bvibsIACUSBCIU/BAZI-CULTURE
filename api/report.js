import {
  BaziInputError,
  CalendarEngineError,
  calculateBazi,
} from "../lib/metaphysics/bazi-engine.js";
import { buildBaziReport } from "../lib/metaphysics/bazi-report.js";

export function createReportHandler({ calculate = calculateBazi } = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");

    if (request.method === "GET") {
      response.status(200).json({
        ok: true,
        service: "Bazi culture research MVP",
        timezone: "Asia/Shanghai",
        accepts: ["date", "time", "timeKnown", "birthplace", "consent"],
      });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    if (request.body?.consent !== true) {
      response.status(400).json({
        ok: false,
        code: "CONSENT_REQUIRED",
        error: "生成前需要明确同意本次处理出生资料。",
      });
      return;
    }

    try {
      const birthplace = normalizeBirthplace(request.body?.birthplace);
      const chart = await calculate({
        date: request.body?.date,
        time: request.body?.time,
        timeKnown: request.body?.timeKnown,
      });
      response.status(200).json({
        ok: true,
        chart,
        context: {
          birthplace: birthplace || null,
          birthplaceAppliedToCalculation: false,
        },
        report: buildBaziReport(chart, { birthplace }),
      });
    } catch (error) {
      writeError(response, error);
    }
  };
}

function normalizeBirthplace(value) {
  const birthplace = String(value || "").trim().replace(/\s+/gu, " ");
  if (birthplace.length > 80) {
    throw new BaziInputError(
      "BIRTHPLACE_TOO_LONG",
      "出生地请控制在 80 个字符以内。",
    );
  }
  return birthplace;
}

export default createReportHandler();

function writeError(response, error) {
  if (error instanceof BaziInputError) {
    response.status(422).json({ ok: false, code: error.code, error: error.message });
    return;
  }
  if (error instanceof CalendarEngineError) {
    response.status(503).json({ ok: false, code: error.code, error: error.message });
    return;
  }
  response.status(500).json({
    ok: false,
    code: "UNEXPECTED_ERROR",
    error: "生成失败，原始出生资料未被保存。请稍后重试。",
  });
}

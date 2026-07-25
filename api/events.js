const ALLOWED_EVENTS = new Set([
  "confirmation_shown",
  "demo_started",
  "chart_generated",
  "ai_generated",
  "reading_feedback",
  "chart_cleared",
]);

const ALLOWED_CHOICES = new Set([
  "overview",
  "question",
  "helpful",
  "vague",
  "mismatch",
]);

export function createEventsHandler({
  log = (record) => console.info("mvp_event", JSON.stringify(record)),
  now = () => new Date().toISOString(),
} = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const event = String(request.body?.event || "");
    if (!ALLOWED_EVENTS.has(event)) {
      response.status(422).json({
        ok: false,
        code: "INVALID_EVENT",
        error: "无法识别的体验事件。",
      });
      return;
    }

    const requestedChoice = String(request.body?.choice || "");
    const choice = ALLOWED_CHOICES.has(requestedChoice) ? requestedChoice : null;
    const record = Object.freeze({
      event,
      choice,
      demo: request.body?.demo === true,
      occurredAt: now(),
    });

    log(record);
    response.status(202).json({ ok: true });
  };
}

export default createEventsHandler();

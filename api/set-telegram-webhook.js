const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.BOT_PUBLIC_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SETUP_SECRET = process.env.WEBHOOK_SETUP_SECRET;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!SETUP_SECRET) {
    response.status(503).json({ ok: false, error: "Missing WEBHOOK_SETUP_SECRET" });
    return;
  }
  const authorization = String(request.headers?.authorization || "");
  const suppliedSecret =
    request.headers?.["x-setup-secret"] ||
    (authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  if (suppliedSecret !== SETUP_SECRET) {
    response.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  if (!TOKEN) {
    response.status(500).json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" });
    return;
  }
  if (!WEBHOOK_SECRET) {
    response.status(500).json({ ok: false, error: "Missing TELEGRAM_WEBHOOK_SECRET" });
    return;
  }

  if (!PUBLIC_URL) {
    response.status(500).json({ ok: false, error: "Missing BOT_PUBLIC_URL" });
    return;
  }

  const baseUrl = PUBLIC_URL.startsWith("http") ? PUBLIC_URL : `https://${PUBLIC_URL}`;
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram`;
  const telegramResponse = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
      secret_token: WEBHOOK_SECRET,
      drop_pending_updates: false,
    }),
  });

  const webhookJson = await telegramResponse.json();
  const commandsJson = await setCommands();
  response.status(200).json({ ...webhookJson, webhookUrl, commands: commandsJson });
}

async function setCommands() {
  const commands = [
    { command: "start", description: "开始两仪命理智能体" },
    { command: "bazi", description: "输入公历日期和时间" },
    { command: "method", description: "查看计算与资料口径" },
    { command: "delete", description: "清除当前会话资料" },
    { command: "cancel", description: "取消当前填写" },
  ];

  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  return response.json();
}

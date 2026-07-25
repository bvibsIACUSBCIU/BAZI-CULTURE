import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnv(path.join(rootDir, ".env"));

const publicUrl = requiredEnv("BOT_PUBLIC_URL").replace(/\/+$/u, "");
const setupSecret = requiredEnv("WEBHOOK_SETUP_SECRET");
const response = await fetch(`${publicUrl}/api/set-telegram-webhook`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${setupSecret}`,
    "Content-Type": "application/json",
  },
});
const payload = await response.json().catch(() => ({}));

if (!response.ok || !payload.ok) {
  throw new Error(payload.error || payload.description || "Webhook setup failed");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      webhookUrl: payload.webhookUrl,
      commandsConfigured: payload.commands?.ok === true,
    },
    null,
    2,
  ),
);

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const name = trimmed.slice(0, separator).trim();
    if (process.env[name] === undefined) {
      process.env[name] = trimmed.slice(separator + 1).trim();
    }
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnv(path.join(rootDir, ".env"));

const token = requiredEnv("TELEGRAM_BOT_TOKEN");
const { default: handler } = await import("../api/telegram.js");
let offset = 0;

console.log("Bazi Culture MVP local polling started.");

while (true) {
  try {
    const updates = await telegram("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message", "callback_query"],
    });

    for (const update of updates.result || []) {
      offset = update.update_id + 1;
      await handler(
        { method: "POST", body: update },
        {
          status(code) {
            return {
              json(payload) {
                if (code >= 400) console.error(payload);
              },
            };
          },
        },
      );
    }
  } catch (error) {
    console.error(error.message);
    await sleep(2500);
  }
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${method} failed: ${json.description || response.statusText}`);
  return json;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    process.env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Telegram supplies this header only for webhooks configured with secret_token.

export function verifyTelegramWebhook(request, expectedSecret) {
  if (!expectedSecret) return true;
  const received = readHeader(request, "x-telegram-bot-api-secret-token");
  return safeEqual(received, expectedSecret);
}

export function readHeader(request, name) {
  if (typeof request.get === "function") return request.get(name) || "";
  if (typeof request.headers?.get === "function") {
    return request.headers.get(name) || "";
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers || {})) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] || "" : String(value || "");
    }
  }
  return "";
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

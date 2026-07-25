import {
  BaziInputError,
  CalendarEngineError,
  calculateBazi,
  normalizeBirthInput,
} from "../lib/metaphysics/bazi-engine.js";
import { buildBaziReport, buildMethodText } from "../lib/metaphysics/bazi-report.js";
import { AiServiceError, generateAiReading } from "../lib/agent/ai-service.js";
import { createAgentRuntime } from "../lib/agent/agent-runtime.js";
import { AGENT_LIMITS } from "../lib/agent/agent-policy.js";
import { ToolRegistry } from "../lib/agent/tool-registry.js";
import { createBaziTools } from "../lib/agent/tools/bazi-tools.js";
import { createSessionTools } from "../lib/agent/tools/session-tools.js";
import { createKnowledgeTools } from "../lib/agent/tools/knowledge-tools.js";
import { KeyedSerialQueue } from "../lib/runtime/chat-queue.js";
import {
  FixedWindowRateLimiter,
  RateLimitError,
} from "../lib/runtime/rate-limiter.js";
import { createSessionStore } from "../lib/runtime/session-store.js";
import { UpdateDeduplicator } from "../lib/runtime/update-deduplicator.js";
import { verifyTelegramWebhook } from "../lib/runtime/webhook-security.js";

const INTRO_TEXT = [
  "两仪命理智能体 · AI 测试版",
  "",
  "由确定性历法程序计算四柱，再由 AI 围绕命盘作受约束的文化解释与有限问答。",
  "",
  "需要处理：",
  "- 公历出生日期",
  "- 出生时间（可以选择不知道）",
  "",
  "首版固定使用中国标准时间 UTC+8。填写过程中的出生资料只作短时会话处理；排盘完成后仅保留派生命盘和报告，会话会自动过期。AI 不参与排盘，也不会收到你的 Telegram 用户名。",
  "",
  "继续即表示你同意本次处理上述资料。你可以随时发送 /delete 清除当前会话。",
  "",
  "这是测试产品，内容可能存在错误，不用于医疗、投资、法律、婚育或重大人生决定。",
].join("\n");

export function createHandler(options = {}) {
  const send = options.send || telegram;
  const calculate = options.calculate || calculateBazi;
  const generate = options.generate || generateAiReading;
  const sessionStore = options.sessionStore || createSessionStore();
  const queue = options.queue || new KeyedSerialQueue();
  const deduplicator =
    options.deduplicator || new UpdateDeduplicator({ store: sessionStore });
  const webhookLimiter =
    options.webhookLimiter ||
    new FixedWindowRateLimiter({
      store: sessionStore,
      scope: "telegram-rate",
      limit: 40,
      windowSeconds: 60,
    });
  const aiLimiter =
    options.aiLimiter ||
    new FixedWindowRateLimiter({
      store: sessionStore,
      scope: "telegram-ai-rate",
      limit: 6,
      windowSeconds: 10 * 60,
    });
  const toolRegistry =
    options.toolRegistry ||
    new ToolRegistry(
      {
        ...createBaziTools({ calculate }),
        ...createSessionTools({ sessionStore }),
        ...createKnowledgeTools(),
      },
      { maxCalls: AGENT_LIMITS.maxToolCalls },
    );
  const agentRuntime =
    options.agentRuntime || createAgentRuntime({ generate, toolRegistry });
  const webhookSecret =
    options.webhookSecret ?? process.env.TELEGRAM_WEBHOOK_SECRET;

  return async function handler(request, response) {
    if (request.method === "GET") {
      response.status(200).json({
        ok: true,
        service: "Bazi culture research Telegram MVP",
        telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        session_store: sessionStore.mode,
        agent_runtime: "minimum-runtime-v1",
      });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    if (!verifyTelegramWebhook(request, webhookSecret)) {
      response.status(401).json({ ok: false, error: "Invalid webhook signature" });
      return;
    }

    try {
      const update = request.body || {};
      if (!(await deduplicator.claim(update.update_id))) {
        response.status(200).json({ ok: true, duplicate: true });
        return;
      }
      const chatId = getChatId(update);
      if (chatId) await webhookLimiter.consume(chatId);
      const task = () =>
        handleUpdate(update, {
          send,
          calculate,
          sessionStore,
          agentRuntime,
          aiLimiter,
        });
      if (chatId) await queue.run(chatId, task);
      else await task();
      response.status(200).json({ ok: true });
    } catch (error) {
      if (error instanceof RateLimitError) {
        const chatId = getChatId(request.body || {});
        if (chatId) {
          await sendMessage(send, chatId, error.message, mainKeyboard()).catch(
            () => undefined,
          );
        }
        response.status(200).json({ ok: true, rate_limited: true });
        return;
      }
      console.error("Telegram update failed:", error.message);
      response.status(500).json({ ok: false, error: "Telegram update failed" });
    }
  };
}

export default createHandler();

async function handleUpdate(
  update,
  { send, calculate, sessionStore, agentRuntime, aiLimiter },
) {
  if (update.callback_query) {
    await handleCallback(update.callback_query, {
      send,
      calculate,
      sessionStore,
      agentRuntime,
      aiLimiter,
    });
    return;
  }

  const message = update.message;
  if (!message?.chat?.id || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();

  if (command === "/start" || command === "/new") {
    await sendConsentIntro(chatId, send, sessionStore);
    return;
  }
  if (command === "/method") {
    await sendMessage(send, chatId, buildMethodText(), mainKeyboard());
    return;
  }
  if (command === "/delete") {
    await sessionStore.delete("session", chatId);
    await sendMessage(
      send,
      chatId,
      "当前会话中的出生资料、命盘和 AI 上下文已清除。",
      restartKeyboard(),
    );
    return;
  }
  if (command === "/cancel") {
    const session = (await sessionStore.get("session", chatId)) || {};
    await sessionStore.set("session", chatId, { ...session, step: null });
    await sendMessage(
      send,
      chatId,
      "本次填写已取消。",
      session.chart ? chartKeyboard() : mainKeyboard(),
    );
    return;
  }
  if (command === "/bazi") {
    await handleDirectCommand(
      chatId,
      text,
      send,
      calculate,
      sessionStore,
    );
    return;
  }

  const session = await sessionStore.get("session", chatId);
  if (!session?.consented) {
    await sendConsentIntro(chatId, send, sessionStore);
    return;
  }
  if (session.step === "date") {
    await handleDate(chatId, text, session, send, sessionStore);
    return;
  }
  if (session.step === "time") {
    await handleTime(chatId, text, session, send, calculate, sessionStore);
    return;
  }
  if (session.step === "question" && session.chart) {
    await handleAiQuestion(
      chatId,
      text,
      session,
      send,
      agentRuntime,
      sessionStore,
      aiLimiter,
    );
    return;
  }

  await sendMessage(
    send,
    chatId,
    session.chart
      ? "可以点击“生成 AI 解读”或“继续问这份命盘”。"
      : "请选择“开始排盘”，或发送 /bazi YYYY-MM-DD HH:mm。出生时间不详可写 unknown。",
    session.chart ? chartKeyboard() : mainKeyboard(),
  );
}

async function handleCallback(
  callback,
  { send, calculate, sessionStore, agentRuntime, aiLimiter },
) {
  const chatId = callback.message?.chat?.id;
  if (!chatId) return;

  await send("answerCallbackQuery", { callback_query_id: callback.id });

  if (callback.data === "consent:yes") {
    await sessionStore.set("session", chatId, {
      consented: true,
      step: "date",
    });
    await sendMessage(
      send,
      chatId,
      "请输入公历出生日期。\n\n格式：YYYY-MM-DD\n示例：1990-06-15",
      cancelKeyboard(),
    );
    return;
  }
  if (callback.data === "consent:no") {
    await sessionStore.delete("session", chatId);
    await sendMessage(send, chatId, "已取消，未处理出生资料。", restartKeyboard());
    return;
  }
  if (callback.data === "flow:new") {
    const session = await sessionStore.get("session", chatId);
    if (!session?.consented) {
      await sendConsentIntro(chatId, send, sessionStore);
      return;
    }
    await sessionStore.set("session", chatId, {
      consented: true,
      step: "date",
    });
    await sendMessage(
      send,
      chatId,
      "请输入公历出生日期。\n\n格式：YYYY-MM-DD",
      cancelKeyboard(),
    );
    return;
  }
  if (callback.data === "flow:cancel") {
    const session = (await sessionStore.get("session", chatId)) || {};
    await sessionStore.set("session", chatId, { ...session, step: null });
    await sendMessage(
      send,
      chatId,
      "本次填写已取消。",
      session.chart ? chartKeyboard() : mainKeyboard(),
    );
    return;
  }
  if (callback.data === "delete:session") {
    await sessionStore.delete("session", chatId);
    await sendMessage(
      send,
      chatId,
      "当前会话中的命盘和出生资料已清除。",
      restartKeyboard(),
    );
    return;
  }
  if (callback.data === "time:unknown") {
    const session = await sessionStore.get("session", chatId);
    if (!session?.consented || !session.date) {
      await sendConsentIntro(chatId, send, sessionStore);
      return;
    }
    await generateAndSend(
      chatId,
      { date: session.date, timeKnown: false },
      send,
      calculate,
      sessionStore,
    );
    return;
  }
  if (callback.data === "ai:reading") {
    const session = await sessionStore.get("session", chatId);
    if (!session?.chart) {
      await sendMessage(send, chatId, "请先完成一次排盘。", mainKeyboard());
      return;
    }
    await generateAndSendAi(
      chatId,
      session,
      send,
      agentRuntime,
      sessionStore,
      aiLimiter,
    );
    return;
  }
  if (callback.data === "ai:ask") {
    const session = await sessionStore.get("session", chatId);
    if (!session?.chart) {
      await sendMessage(send, chatId, "请先完成一次排盘。", mainKeyboard());
      return;
    }
    await sessionStore.set("session", chatId, {
      ...session,
      step: "question",
    });
    await sendMessage(
      send,
      chatId,
      "请直接输入你的问题。\n\n例如：\n- 癸水日主是什么意思？\n- 为什么五行数量不能直接判断缺什么？\n- 把刚才的解释说得简单一点。",
      cancelKeyboard(),
    );
    return;
  }
  if (callback.data === "method") {
    await sendMessage(send, chatId, buildMethodText(), mainKeyboard());
  }
}

async function handleDate(chatId, text, session, send, sessionStore) {
  try {
    const normalized = normalizeBirthInput({ date: text, timeKnown: false });
    await sessionStore.set("session", chatId, {
      ...session,
      date: normalized.date,
      step: "time",
    });
    await sendMessage(
      send,
      chatId,
      "请输入出生时间。\n\n格式：HH:mm，例如 14:30。\n研究版暂不处理 23:00-00:59；时间不详可以点击下方按钮。",
      timeKeyboard(),
    );
  } catch (error) {
    await sendKnownError(send, chatId, error, cancelKeyboard());
  }
}

async function handleTime(
  chatId,
  text,
  session,
  send,
  calculate,
  sessionStore,
) {
  await generateAndSend(
    chatId,
    { date: session.date, time: text, timeKnown: true },
    send,
    calculate,
    sessionStore,
  );
}

async function handleDirectCommand(
  chatId,
  text,
  send,
  calculate,
  sessionStore,
) {
  const session = await sessionStore.get("session", chatId);
  if (!session?.consented) {
    await sendConsentIntro(chatId, send, sessionStore);
    return;
  }

  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await sendMessage(
      send,
      chatId,
      "命令格式：/bazi YYYY-MM-DD HH:mm\n时间不详：/bazi YYYY-MM-DD unknown",
      mainKeyboard(),
    );
    return;
  }

  const timeKnown = !["unknown", "不知道", "不详"].includes(
    String(parts[2] || "unknown").toLowerCase(),
  );
  await generateAndSend(
    chatId,
    { date: parts[1], time: parts[2], timeKnown },
    send,
    calculate,
    sessionStore,
  );
}

async function generateAndSend(
  chatId,
  input,
  send,
  calculate,
  sessionStore,
) {
  try {
    const chart = await calculate(input);
    const basicReport = buildBaziReport(chart);
    await sessionStore.set("session", chatId, {
      consented: true,
      step: null,
      chart: sanitizeChartForSession(chart),
    });
    await sendMessage(send, chatId, basicReport, chartKeyboard());
  } catch (error) {
    const current =
      (await sessionStore.get("session", chatId)) || { consented: true };
    await sessionStore.set("session", chatId, {
      ...current,
      step: input.timeKnown === false ? "date" : "time",
      date: input.date,
    });
    await sendKnownError(send, chatId, error, timeKeyboard());
  }
}

async function generateAndSendAi(
  chatId,
  session,
  send,
  agentRuntime,
  sessionStore,
  aiLimiter,
  question = "",
) {
  try {
    await aiLimiter.consume(chatId);
    await send("sendChatAction", { chat_id: chatId, action: "typing" });
    const result = await agentRuntime.run({
      chatId,
      session,
      userText: question,
      mode: question ? "question" : "reading",
    });
    await sessionStore.set("session", chatId, {
      ...session,
      step: null,
      aiText: result.text,
    });
    await sendMessage(send, chatId, result.text, aiKeyboard());
  } catch (error) {
    if (error instanceof RateLimitError) {
      await sendMessage(send, chatId, error.message, aiKeyboard());
      return;
    }
    console.error("AI Telegram response failed:", error.code || error.message);
    const message =
      error instanceof AiServiceError
        ? error.message
        : "AI 解读暂时不可用，基础命盘仍然有效，请稍后重试。";
    await sendMessage(send, chatId, message, chartKeyboard());
  }
}

async function handleAiQuestion(
  chatId,
  text,
  session,
  send,
  agentRuntime,
  sessionStore,
  aiLimiter,
) {
  if (text.length > 300) {
    await sendMessage(send, chatId, "问题请控制在 300 字以内。", cancelKeyboard());
    return;
  }
  await generateAndSendAi(
    chatId,
    session,
    send,
    agentRuntime,
    sessionStore,
    aiLimiter,
    text,
  );
}

async function sendKnownError(send, chatId, error, keyboard) {
  if (error instanceof BaziInputError || error instanceof CalendarEngineError) {
    await sendMessage(send, chatId, error.message, keyboard);
    return;
  }
  await sendMessage(
    send,
    chatId,
    "生成失败，原始出生资料未被保存。请稍后重试。",
    mainKeyboard(),
  );
}

async function sendConsentIntro(chatId, send, sessionStore) {
  await sessionStore.delete("session", chatId);
  await sendMessage(send, chatId, INTRO_TEXT, {
    inline_keyboard: [
      [{ text: "同意并开始", callback_data: "consent:yes" }],
      [{ text: "不同意", callback_data: "consent:no" }],
      [{ text: "查看计算与资料说明", callback_data: "method" }],
    ],
  });
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "开始排盘", callback_data: "flow:new" }],
      [{ text: "计算与资料说明", callback_data: "method" }],
    ],
  };
}

function chartKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✨ 生成 AI 文化解读", callback_data: "ai:reading" }],
      [
        { text: "继续问这份命盘", callback_data: "ai:ask" },
        { text: "重新排盘", callback_data: "flow:new" },
      ],
      [{ text: "删除本次资料", callback_data: "delete:session" }],
    ],
  };
}

function aiKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "💬 继续问这份命盘", callback_data: "ai:ask" }],
      [
        { text: "重新生成解读", callback_data: "ai:reading" },
        { text: "重新排盘", callback_data: "flow:new" },
      ],
    ],
  };
}

function restartKeyboard() {
  return {
    inline_keyboard: [[{ text: "重新开始", callback_data: "flow:new" }]],
  };
}

function cancelKeyboard() {
  return {
    keyboard: [[{ text: "/cancel" }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function timeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "出生时间不知道", callback_data: "time:unknown" }],
      [{ text: "取消", callback_data: "flow:cancel" }],
    ],
  };
}

async function telegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`${method} failed: ${payload.description || response.statusText}`);
  }
  return payload;
}

async function sendMessage(send, chatId, text, replyMarkup) {
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await send("sendMessage", body);
}

function getChatId(update) {
  return update.callback_query?.message?.chat?.id || update.message?.chat?.id || null;
}

function sanitizeChartForSession(chart) {
  return {
    ...chart,
    lunarLabel: null,
    input: {
      timeKnown: chart.input?.timeKnown === true,
      timezone: chart.input?.timezone,
      timezoneOffset: chart.input?.timezoneOffset,
    },
  };
}

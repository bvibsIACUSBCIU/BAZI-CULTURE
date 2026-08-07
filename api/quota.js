const userQuotaStore = new Map();
import { authRequiredResponse, requireAuth } from '../lib/http/auth-context.js';

function getQuota(wallet = "default") {
  const key = wallet.toLowerCase();
  if (!userQuotaStore.has(key)) {
    userQuotaStore.set(key, {
      points: 1580,
      checkinTaskProgress: 3,
      totalCheckinDays: 5,
      checkedInToday: false
    });
  }
  return userQuotaStore.get(key);
}

export async function handleQuotaRequest(req, { env } = {}) {
  if (env?.DB && env?.AUTH_KV) return handleCloudflareQuotaRequest(req, env);
  return handleLegacyQuotaRequest(req);
}

async function handleLegacyQuotaRequest(req) {
  const method = (req.method || "GET").toUpperCase();
  const rawUrl = typeof req.url === "string" ? req.url : "http://localhost/api/quota";
  const url = new URL(rawUrl, "http://localhost");
  const wallet = url.searchParams.get("wallet") || "default";

  let body = {};
  if (method === "POST") {
    if (typeof req.json === "function") {
      body = await req.json().catch(() => ({}));
    } else if (req.body) {
      body = req.body;
    }
  }

  const quota = getQuota(wallet);

  try {
    if (method === "GET") {
      return createJsonResponse({
        ok: true,
        success: true,
        ...quota
      });
    }

    if (method === "POST") {
      if (quota.checkedInToday) {
        return createJsonResponse({
          ok: false,
          success: false,
          error: "ALREADY_CHECKED_IN",
          ...quota
        }, 400);
      }

      quota.points += 100;
      quota.checkinTaskProgress = Math.min(
        quota.totalCheckinDays,
        quota.checkinTaskProgress + 1
      );
      quota.checkedInToday = true;

      return createJsonResponse({
        ok: true,
        success: true,
        ...quota
      });
    }

    return createJsonResponse({ ok: false, success: false, error: "NOT_FOUND" }, 404);
  } catch (err) {
    return createJsonResponse({ ok: false, success: false, error: err.message }, 500);
  }
}

async function handleCloudflareQuotaRequest(req, env) {
  const auth = await requireAuth(req, env);
  if (!auth) return authRequiredResponse();
  const method = (req.method || 'GET').toUpperCase();
  try {
    if (method === 'GET') return quotaResponse(auth);
    if (method === 'POST') {
      const body = typeof req.json === 'function' ? await req.json().catch(() => ({})) : (req.body || {});
      if (body.action && body.action !== 'checkin') return createJsonResponse({ ok: false, success: false, error: 'INVALID_QUOTA_ACTION' }, 400);
      const recorded = await auth.repositories.checkins.recordToday(auth.userId, 100);
      if (!recorded) return createJsonResponse({ ok: false, success: false, error: 'ALREADY_CHECKED_IN', ...(await quotaPayload(auth)) }, 400);
      const checkinStatus = await auth.repositories.checkins.getStatus(auth.userId);
      await auth.repositories.credits.recordOnce({
        userId: auth.userId,
        amount: 100,
        reason: 'daily_checkin',
        idempotencyKey: `daily-checkin:${new Date().toISOString().slice(0, 10)}`,
      });
      return createJsonResponse({ ok: true, success: true, ...(await quotaPayload(auth, checkinStatus)) });
    }
    return createJsonResponse({ ok: false, success: false, error: 'NOT_FOUND' }, 404);
  } catch (error) {
    return createJsonResponse({ ok: false, success: false, error: error.code || 'QUOTA_ERROR' }, 400);
  }
}

async function quotaResponse(auth) {
  return createJsonResponse({ ok: true, success: true, ...(await quotaPayload(auth)) });
}

async function quotaPayload(auth, status = null) {
  const [points, checkins] = await Promise.all([
    auth.repositories.credits.getBalance(auth.userId),
    status || auth.repositories.checkins.getStatus(auth.userId),
  ]);
  return {
    points,
    checkinTaskProgress: Math.min(checkins.totalCheckinDays, 5),
    totalCheckinDays: 5,
    checkedInToday: checkins.checkedInToday,
  };
}

function createJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const quotaHandler = handleQuotaRequest;
export default handleQuotaRequest;

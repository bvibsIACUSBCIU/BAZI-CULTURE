const userQuotaStore = new Map();

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

export async function handleQuotaRequest(req) {
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

function createJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const quotaHandler = handleQuotaRequest;
export default handleQuotaRequest;

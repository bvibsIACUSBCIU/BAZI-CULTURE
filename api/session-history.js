const userSessionStore = new Map();

function getSessions(wallet = "default") {
  const key = wallet.toLowerCase();
  if (!userSessionStore.has(key)) {
    const defaults = [
      { id: "sess-001", profileId: "prof-hanli", profileName: "韩立", title: "八字详批 - 庚午年", topic: "overview", timestamp: "2026-07-30T10:15:00Z", bookmarked: true },
      { id: "sess-002", profileId: "prof-hanli", profileName: "韩立", title: "事业运势 - 丙午流年", topic: "career", timestamp: "2026-07-31T14:20:00Z", bookmarked: false }
    ];
    userSessionStore.set(key, defaults);
  }
  return userSessionStore.get(key);
}

export async function handleSessionHistoryRequest(req) {
  const method = (req.method || "GET").toUpperCase();
  const rawUrl = typeof req.url === "string" ? req.url : "http://localhost/api/session-history";
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

  const sessions = getSessions(wallet);

  try {
    if (method === "GET") {
      const bookmarks = sessions.filter(s => s.bookmarked);
      return createJsonResponse({
        ok: true,
        success: true,
        sessions,
        bookmarks
      });
    }

    if (method === "POST") {
      const action = body.action || (url.pathname.endsWith("/bookmark") ? "bookmark" : "add");

      if (action === "bookmark") {
        const target = sessions.find(s => s.id === body.sessionId);
        if (!target) {
          return createJsonResponse({ ok: false, success: false, error: "SESSION_NOT_FOUND" }, 404);
        }
        target.bookmarked = !target.bookmarked;
        const bookmarks = sessions.filter(s => s.bookmarked);
        return createJsonResponse({
          ok: true,
          success: true,
          session: target,
          sessions,
          bookmarks
        });
      }

      if (action === "add" || !body.action) {
        const newSess = {
          id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          profileId: body.profileId || "prof-hanli",
          profileName: body.profileName || "韩立",
          title: body.title || "新命理对话",
          topic: body.topic || "overview",
          timestamp: new Date().toISOString(),
          bookmarked: false
        };
        sessions.unshift(newSess);
        const bookmarks = sessions.filter(s => s.bookmarked);
        return createJsonResponse({
          ok: true,
          success: true,
          session: newSess,
          sessions,
          bookmarks
        });
      }
    }

    return createJsonResponse({ ok: false, success: false, error: "NOT_FOUND" }, 404);
  } catch (err) {
    return createJsonResponse({ ok: false, success: false, error: err.message }, 500);
  }
}

function createJsonResponse(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return data;
    }
  };
}

export const sessionHistoryHandler = handleSessionHistoryRequest;
export default handleSessionHistoryRequest;

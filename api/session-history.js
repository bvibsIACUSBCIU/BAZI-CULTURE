import { defaultSessionHistoryService } from '../lib/runtime/session-history-service.js';

export async function handleSessionHistoryRequest(req) {
  const method = (req.method || "GET").toUpperCase();
  const rawUrl = typeof req.url === "string" ? req.url : "http://localhost/api/session-history";
  const url = new URL(rawUrl, "http://localhost");
  const wallet = url.searchParams.get("wallet") || "default";

  let body = {};
  if (method === "POST" || method === "DELETE") {
    if (typeof req.json === "function") {
      body = await req.json().catch(() => ({}));
    } else if (req.body) {
      body = req.body;
    }
  }

  try {
    if (method === "GET") {
      const sessions = defaultSessionHistoryService.getSessions(wallet);
      const bookmarks = defaultSessionHistoryService.getBookmarks(wallet);
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
        const target = defaultSessionHistoryService.toggleBookmark(wallet, body.sessionId);
        const sessions = defaultSessionHistoryService.getSessions(wallet);
        const bookmarks = defaultSessionHistoryService.getBookmarks(wallet);
        return createJsonResponse({
          ok: true,
          success: true,
          session: target,
          sessions,
          bookmarks
        });
      }

      if (action === "add" || !body.action) {
        const id = defaultSessionHistoryService.addSession(wallet, body);
        const sessions = defaultSessionHistoryService.getSessions(wallet);
        const bookmarks = defaultSessionHistoryService.getBookmarks(wallet);
        const newSess = sessions.find(s => s.id === id);
        return createJsonResponse({
          ok: true,
          success: true,
          session: newSess,
          sessions,
          bookmarks
        });
      }
    }

    if (method === "DELETE") {
      const sessionId = body.sessionId || url.searchParams.get("sessionId");
      if (sessionId) {
        const sessions = defaultSessionHistoryService.getSessions(wallet);
        const idx = sessions.findIndex(s => s.id === sessionId);
        if (idx !== -1) sessions.splice(idx, 1);
      }
      const sessions = defaultSessionHistoryService.getSessions(wallet);
      const bookmarks = defaultSessionHistoryService.getBookmarks(wallet);
      return createJsonResponse({ ok: true, success: true, sessions, bookmarks });
    }

    return createJsonResponse({ ok: false, success: false, error: "NOT_FOUND" }, 404);
  } catch (err) {
    return createJsonResponse({ ok: false, success: false, error: err.message }, 500);
  }
}

function createJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const sessionHistoryHandler = handleSessionHistoryRequest;
export default handleSessionHistoryRequest;

import { defaultSessionHistoryService } from '../lib/runtime/session-history-service.js';
import { authRequiredResponse, requireAuth } from '../lib/http/auth-context.js';

export async function handleSessionHistoryRequest(req, { env } = {}) {
  if (env?.DB && env?.AUTH_KV) return handleCloudflareSessionHistoryRequest(req, env);
  return handleLegacySessionHistoryRequest(req);
}

async function handleLegacySessionHistoryRequest(req) {
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

async function handleCloudflareSessionHistoryRequest(req, env) {
  const auth = await requireAuth(req, env);
  if (!auth) return authRequiredResponse();
  const method = (req.method || 'GET').toUpperCase();
  const url = new URL(req.url || 'http://localhost/api/session-history', 'http://localhost');
  const body = method === 'POST' || method === 'DELETE' ? await readJson(req) : {};
  try {
    if (method === 'GET') return cloudSessionList(auth);
    if (method === 'POST') {
      const action = body.action || (url.pathname.endsWith('/bookmark') ? 'bookmark' : 'add');
      if (action === 'bookmark') {
        const session = await auth.repositories.conversations.toggleBookmark(auth.userId, body.sessionId);
        if (!session) return createJsonResponse({ ok: false, success: false, error: 'SESSION_NOT_FOUND' }, 404);
        const response = await cloudSessionList(auth);
        const payload = await response.json();
        return createJsonResponse({ ...payload, session });
      }
      if (action === 'add') {
        const session = await auth.repositories.conversations.create(auth.userId, body);
        const response = await cloudSessionList(auth);
        const payload = await response.json();
        return createJsonResponse({ ...payload, session });
      }
    }
    if (method === 'DELETE') {
      const sessionId = body.sessionId || url.searchParams.get('sessionId');
      if (!sessionId) return createJsonResponse({ ok: false, success: false, error: 'MISSING_SESSION_ID' }, 400);
      if (!await auth.repositories.conversations.remove(auth.userId, sessionId)) {
        return createJsonResponse({ ok: false, success: false, error: 'SESSION_NOT_FOUND' }, 404);
      }
      return cloudSessionList(auth);
    }
    return createJsonResponse({ ok: false, success: false, error: 'NOT_FOUND' }, 404);
  } catch (error) {
    return createJsonResponse({ ok: false, success: false, error: error.code || 'SESSION_HISTORY_ERROR' }, 400);
  }
}

async function cloudSessionList(auth) {
  const sessions = await auth.repositories.conversations.list(auth.userId);
  return createJsonResponse({
    ok: true,
    success: true,
    sessions,
    bookmarks: sessions.filter((session) => session.bookmarked),
  });
}

async function readJson(req) {
  return typeof req.json === 'function' ? req.json().catch(() => ({})) : (req.body || {});
}

function createJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const sessionHistoryHandler = handleSessionHistoryRequest;
export default handleSessionHistoryRequest;

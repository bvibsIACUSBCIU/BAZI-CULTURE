import { handleAuthRequest } from '../api/auth.js';
import { handleProfileRequest } from '../api/profile.js';
import handleSessionHistoryRequest from '../api/session-history.js';
import handlePreferencesRequest from '../api/preferences.js';
import { handleChatRequest } from '../api/chat.js';

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const response = await route(request, env);
    return withSecurityHeaders(response, request, env);
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (url.pathname === '/api/health') {
    return json({ ok: true, service: 'liangyi-bazi-api', environment: env.ENVIRONMENT || 'development' });
  }
  if (url.pathname.startsWith('/api/auth')) return handleAuthRequest(request, { env });
  if (url.pathname === '/api/profile' || url.pathname.startsWith('/api/profile/')) return handleProfileRequest(request, { env });
  if (url.pathname === '/api/session-history' || url.pathname.startsWith('/api/session-history/')) {
    return handleSessionHistoryRequest(request, { env });
  }
  if (url.pathname === '/api/preferences') return handlePreferencesRequest(request, { env });
  if (url.pathname === '/api/chat') return handleChatRequest(request, { env });
  return json({ ok: false, error: 'NOT_FOUND' }, 404);
}

function withSecurityHeaders(response, request, env) {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('cache-control', response.headers.get('cache-control') || 'no-store');

  const origin = request.headers.get('origin');
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    headers.set('access-control-allow-headers', 'Content-Type');
    headers.append('vary', 'Origin');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

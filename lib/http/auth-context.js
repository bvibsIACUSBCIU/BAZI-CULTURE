import { createRepositories } from '../cloudflare/repositories/index.js';
import { createSessionService } from '../auth/session-service.js';

export async function requireAuth(request, env) {
  if (!env?.DB || !env?.AUTH_KV) return null;
  const repositories = createRepositories(env.DB);
  const sessionService = createSessionService({
    sessions: repositories.sessions,
    environment: env.ENVIRONMENT || 'development',
    cookieName: env.SESSION_COOKIE_NAME || 'liangyi_session',
    ttlSeconds: Number(env.SESSION_TTL_SECONDS) || 6 * 60 * 60,
  });
  const session = await sessionService.resolve(request);
  if (!session) return null;
  return { userId: session.userId, walletAddress: session.walletAddress, repositories, session };
}

export function authRequiredResponse() {
  return new Response(JSON.stringify({ ok: false, success: false, error: 'AUTH_REQUIRED' }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

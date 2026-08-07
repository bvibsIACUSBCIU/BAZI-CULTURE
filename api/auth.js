import { defaultAuthService } from '../lib/runtime/auth-service.js';
import { defaultSessionHistoryService } from '../lib/runtime/session-history-service.js';
import { createChallengeService } from '../lib/auth/challenge-service.js';
import { createSessionService } from '../lib/auth/session-service.js';
import { createRepositories } from '../lib/cloudflare/repositories/index.js';

/**
 * 客户端 IP 获取助手
 * @param {Request} req 
 * @returns {string}
 */
export function getClientIp(req) {
  const headers = req.headers || {};
  const cfIp = typeof headers.get === 'function' ? headers.get('cf-connecting-ip') : (headers['cf-connecting-ip'] || headers['CF-Connecting-IP']);
  const forwardedFor = typeof headers.get === 'function' ? headers.get('x-forwarded-for') : (headers['x-forwarded-for'] || headers['X-Forwarded-For']);
  const realIp = typeof headers.get === 'function' ? headers.get('x-real-ip') : (headers['x-real-ip'] || headers['X-Real-IP']);

  if (cfIp) return String(cfIp).trim();
  if (forwardedFor) return String(forwardedFor.split(',')[0]).trim();
  if (realIp) return String(realIp).trim();
  return '127.0.0.1';
}

function buildAccountResponse(account) {
  const sessionCount = defaultSessionHistoryService.getSessions(account.walletAddress).length;
  return {
    walletAddress: account.walletAddress,
    credits: account.credits,
    remainingDialogues: Math.floor(account.credits / 10),
    masterProfile: account.masterProfile,
    registeredIp: account.registeredIp,
    profileCount: account.masterProfile ? 1 : 0,
    username: account.username || null,
    sessionCount
  };
}

function getHeader(req, name) {
  const headers = req.headers || {};
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase());
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || null;
}

function getRequestOrigin(req, url) {
  return getHeader(req, 'origin') || url.origin;
}

/**
 * Auth API Endpoint Handler
 */
export async function handleAuthRequest(req, { env } = {}) {
  if (env?.DB && env?.AUTH_KV) return handleCloudflareAuthRequest(req, env);
  return handleLegacyAuthRequest(req);
}

async function handleLegacyAuthRequest(req) {
  const method = (req.method || 'GET').toUpperCase();
  const rawUrl = typeof req.url === 'string' ? req.url : 'http://localhost/api/auth';
  const url = new URL(rawUrl, 'http://localhost');
  const path = url.pathname;
  const clientIp = getClientIp(req);
  const requestOrigin = getRequestOrigin(req, url);

  let body = {};
  if (method === 'POST') {
    if (typeof req.json === 'function') {
      body = await req.json().catch(() => ({}));
    } else if (req.body) {
      body = req.body;
    }
  }

  try {
    // 1. GET /api/auth/challenge
    if (path.endsWith('/challenge') && method === 'GET') {
      const wallet = url.searchParams.get('wallet');
      const operation = url.searchParams.get('operation');
      const username = url.searchParams.get('username');
      if (!wallet || !operation || !username) {
        return createJsonResponse({ error: 'INVALID_CHALLENGE_REQUEST' }, 400);
      }
      const challengeData = defaultAuthService.generateChallenge(wallet, {
        operation,
        username,
        origin: requestOrigin
      });
      return createJsonResponse({ success: true, ok: true, ...challengeData });
    }

    // 2. POST /api/auth/register and /api/auth/login
    const authOperation = path.endsWith('/register') ? 'register' : (path.endsWith('/login') ? 'login' : null);
    if (authOperation && method === 'POST') {
      const { challengeId, wallet, signature, username } = body || {};

      if (!challengeId || !wallet || !signature || !username) {
        return createJsonResponse({ error: `INVALID_${authOperation.toUpperCase()}_PAYLOAD` }, 400);
      }

      const isValid = defaultAuthService.verifySignature(challengeId, wallet, signature, {
        operation: authOperation,
        username,
        origin: requestOrigin
      });
      if (!isValid) {
        return createJsonResponse({ error: 'SIGNATURE_VERIFICATION_FAILED' }, 401);
      }

      const account = authOperation === 'register'
        ? defaultAuthService.register(wallet, username, clientIp)
        : defaultAuthService.login(wallet, username);
      return createJsonResponse({
        success: true,
        ok: true,
        account: buildAccountResponse(account)
      });
    }

    // 3. POST /api/auth/profile
    if (path.endsWith('/profile') && method === 'POST') {
      const { wallet, profile } = body || {};

      if (!wallet || !profile) {
        return createJsonResponse({ error: 'INVALID_PROFILE_PAYLOAD' }, 400);
      }

      const updatedAccount = defaultAuthService.setMasterProfile(wallet, profile);
      return createJsonResponse({
        success: true,
        ok: true,
        account: buildAccountResponse(updatedAccount)
      });
    }

    // 4. GET /api/auth/account
    if (path.endsWith('/account') && method === 'GET') {
      const wallet = url.searchParams.get('wallet');
      if (!wallet) {
        return createJsonResponse({ error: 'MISSING_WALLET_ADDRESS' }, 400);
      }
      const account = defaultAuthService.getAccount(wallet);
      if (!account) {
        return createJsonResponse({ error: 'ACCOUNT_NOT_FOUND' }, 404);
      }
      return createJsonResponse({
        success: true,
        ok: true,
        account: buildAccountResponse(account)
      });
    }

    return createJsonResponse({ error: 'NOT_FOUND' }, 404);
  } catch (err) {
    const statusCode = err.code === 'IP_REGISTRATION_LIMIT_EXCEEDED' ? 429 : 400;
    return createJsonResponse({
      error: err.code || 'AUTH_ERROR',
      message: err.message,
      details: err.details
    }, statusCode);
  }
}

async function handleCloudflareAuthRequest(req, env) {
  const method = (req.method || 'GET').toUpperCase();
  const rawUrl = typeof req.url === 'string' ? req.url : 'http://localhost/api/auth';
  const url = new URL(rawUrl, 'http://localhost');
  const path = url.pathname;
  const requestOrigin = getRequestOrigin(req, url);
  const repositories = createRepositories(env.DB);
  const challengeService = createChallengeService({
    kv: env.AUTH_KV,
    canonicalOrigin: env.ALLOWED_ORIGIN || requestOrigin,
  });
  const sessionService = createSessionService({
    sessions: repositories.sessions,
    environment: env.ENVIRONMENT || 'development',
    cookieName: env.SESSION_COOKIE_NAME || 'liangyi_session',
    ttlSeconds: Number(env.SESSION_TTL_SECONDS) || 6 * 60 * 60,
  });
  let body = {};
  if (method === 'POST') body = await readJson(req);

  try {
    if (path.endsWith('/challenge') && method === 'GET') {
      const walletAddress = url.searchParams.get('wallet');
      const operation = url.searchParams.get('operation');
      if (!walletAddress || !operation) return createJsonResponse({ error: 'INVALID_CHALLENGE_REQUEST' }, 400);
      const challenge = await challengeService.issue({ walletAddress, operation, origin: requestOrigin });
      return createJsonResponse({ ok: true, success: true, ...challenge });
    }

    const operation = path.endsWith('/register') ? 'register' : (path.endsWith('/login') ? 'login' : null);
    if (operation && method === 'POST') {
      const { challengeId, wallet, signature, username } = body;
      if (!challengeId || !wallet || !signature) return createJsonResponse({ error: `INVALID_${operation.toUpperCase()}_PAYLOAD` }, 400);
      const verified = await challengeService.consume({
        challengeId,
        walletAddress: wallet,
        signature,
        operation,
        origin: requestOrigin,
      });
      const existing = await repositories.users.findByWallet(verified.walletAddress);
      if (operation === 'login' && !existing) return createJsonResponse({ error: 'ACCOUNT_NOT_FOUND' }, 404);
      if (operation === 'register' && existing) return createJsonResponse({ error: 'ACCOUNT_ALREADY_REGISTERED' }, 409);
      const user = existing || await repositories.users.findOrCreate(verified.walletAddress, { username });
      if (!existing) {
        await repositories.credits.recordOnce({
          userId: user.id,
          amount: 100,
          reason: 'welcome',
          idempotencyKey: `welcome:${user.id}`,
        });
      }
      const issued = await sessionService.issue({
        userId: user.id,
        userAgent: getHeader(req, 'user-agent') || '',
        clientIp: getClientIp(req),
      });
      return createJsonResponse(
        { ok: true, success: true, account: await buildCloudAccountResponse(repositories, user) },
        200,
        { 'set-cookie': issued.cookie },
      );
    }

    if (path.endsWith('/me') && method === 'GET') {
      const session = await sessionService.resolve(req);
      if (!session) return createJsonResponse({ error: 'AUTH_REQUIRED' }, 401);
      const user = await repositories.users.findByWallet(session.walletAddress);
      if (!user) return createJsonResponse({ error: 'AUTH_REQUIRED' }, 401);
      return createJsonResponse({ ok: true, success: true, account: await buildCloudAccountResponse(repositories, user) });
    }

    if (path.endsWith('/logout') && method === 'POST') {
      await sessionService.revoke(req);
      return createJsonResponse({ ok: true, success: true }, 200, { 'set-cookie': sessionService.clearCookie() });
    }

    return createJsonResponse({ error: 'NOT_FOUND' }, 404);
  } catch (error) {
    const code = error?.code || 'AUTH_ERROR';
    const status = code === 'SIGNATURE_VERIFICATION_FAILED' ? 401
      : code === 'ACCOUNT_NOT_FOUND' ? 404
        : code === 'ACCOUNT_ALREADY_REGISTERED' ? 409 : 400;
    return createJsonResponse({ error: code }, status);
  }
}

async function buildCloudAccountResponse(repositories, user) {
  const [profiles, conversations, credits, preferences] = await Promise.all([
    repositories.profiles.list(user.id),
    repositories.conversations.list(user.id),
    repositories.credits.getBalance(user.id),
    repositories.preferences.get(user.id),
  ]);
  return {
    walletAddress: user.walletAddress,
    username: user.username,
    credits,
    remainingDialogues: Math.floor(credits / 10),
    profileCount: profiles.length,
    sessionCount: conversations.length,
    preferences,
  };
}

async function readJson(req) {
  if (typeof req.json === 'function') return req.json().catch(() => ({}));
  return req.body || {};
}

function createJsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

export const authHandler = handleAuthRequest;
export default handleAuthRequest;

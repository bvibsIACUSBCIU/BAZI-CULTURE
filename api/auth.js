import { defaultAuthService } from '../lib/runtime/auth-service.js';
import { defaultSessionHistoryService } from '../lib/runtime/session-history-service.js';

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
    sessionCount
  };
}

/**
 * Auth API Endpoint Handler
 */
export async function handleAuthRequest(req) {
  const method = (req.method || 'GET').toUpperCase();
  const rawUrl = typeof req.url === 'string' ? req.url : 'http://localhost/api/auth';
  const url = new URL(rawUrl, 'http://localhost');
  const path = url.pathname;
  const clientIp = getClientIp(req);

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
      if (!wallet) {
        return createJsonResponse({ error: 'MISSING_WALLET_ADDRESS' }, 400);
      }
      const challengeData = defaultAuthService.generateChallenge(wallet);
      return createJsonResponse({ success: true, ok: true, ...challengeData });
    }

    // 2. POST /api/auth/login
    if (path.endsWith('/login') && method === 'POST') {
      const { challengeId, wallet, signature } = body || {};

      if (!challengeId || !wallet || !signature) {
        return createJsonResponse({ error: 'INVALID_LOGIN_PAYLOAD' }, 400);
      }

      const isValid = defaultAuthService.verifySignature(challengeId, wallet, signature);
      if (!isValid) {
        return createJsonResponse({ error: 'SIGNATURE_VERIFICATION_FAILED' }, 401);
      }

      // 执行登录/注册及 IP 限制检查
      const account = defaultAuthService.loginOrRegister(wallet, clientIp);
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

function createJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export const authHandler = handleAuthRequest;
export default handleAuthRequest;

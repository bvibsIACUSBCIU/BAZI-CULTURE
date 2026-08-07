import { authRequiredResponse, requireAuth } from '../lib/http/auth-context.js';

export async function handlePreferencesRequest(req, { env } = {}) {
  if (!env?.DB || !env?.AUTH_KV) return json({ ok: false, success: false, error: 'PERSISTENT_STORAGE_REQUIRED' }, 503);
  const auth = await requireAuth(req, env);
  if (!auth) return authRequiredResponse();
  const method = (req.method || 'GET').toUpperCase();

  try {
    if (method === 'GET') {
      return json({ ok: true, success: true, preferences: await auth.repositories.preferences.get(auth.userId) });
    }
    if (method === 'PATCH') {
      const body = await readJson(req);
      const current = await auth.repositories.preferences.get(auth.userId);
      const activeProfileId = body.activeProfileId === undefined ? current.activeProfileId : body.activeProfileId;
      if (activeProfileId && !await auth.repositories.profiles.findById(auth.userId, activeProfileId)) {
        return json({ ok: false, success: false, error: 'PROFILE_NOT_FOUND' }, 404);
      }
      const settings = body.settings === undefined ? current.settings : body.settings;
      const preferences = await auth.repositories.preferences.save(auth.userId, { activeProfileId, settings });
      return json({ ok: true, success: true, preferences });
    }
    return json({ ok: false, success: false, error: 'NOT_FOUND' }, 404);
  } catch (error) {
    return json({ ok: false, success: false, error: error.code || 'PREFERENCES_ERROR' }, 400);
  }
}

async function readJson(req) {
  return typeof req.json === 'function' ? req.json().catch(() => ({})) : (req.body || {});
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default handlePreferencesRequest;

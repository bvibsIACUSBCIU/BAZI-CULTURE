import { defaultProfileService } from "../lib/runtime/profile-service.js";
import { authRequiredResponse, requireAuth } from '../lib/http/auth-context.js';

export async function handleProfileRequest(req, { env } = {}) {
  if (env?.DB && env?.AUTH_KV) return handleCloudflareProfileRequest(req, env);
  return handleLegacyProfileRequest(req);
}

async function handleLegacyProfileRequest(req) {
  const method = (req.method || "GET").toUpperCase();
  const rawUrl = typeof req.url === "string" ? req.url : "http://localhost/api/profile";
  const url = new URL(rawUrl, "http://localhost");
  let wallet = url.searchParams.get("wallet") || "default";
  const searchQ = url.searchParams.get("q") || url.searchParams.get("query") || "";

  let body = {};
  if (method === "POST" || method === "DELETE") {
    if (typeof req.json === "function") {
      body = await req.json().catch(() => ({}));
    } else if (req.body) {
      body = req.body;
    }
  }
  wallet = body.wallet || wallet;

  try {
    if (method === "GET") {
      const userStore = defaultProfileService.getProfiles(wallet);
      let profiles = userStore.profiles;
      if (searchQ.trim()) {
        const q = searchQ.trim().toLowerCase();
        profiles = profiles.filter(p => p.name.toLowerCase().includes(q));
      }
      const activeProfile = defaultProfileService.getActiveProfile(wallet) || null;

      return createJsonResponse({
        ok: true,
        success: true,
        profiles,
        activeProfile,
        activeProfileId: activeProfile ? activeProfile.id : null
      });
    }

    if (method === "POST") {
      const action = body.action || (url.pathname.endsWith("/switch") ? "switch" : "add");
      if (action === "switch") {
        const activeProfile = defaultProfileService.switchProfile(wallet, body.profileId);
        const userStore = defaultProfileService.getProfiles(wallet);
        return createJsonResponse({
          ok: true,
          success: true,
          profiles: userStore.profiles,
          activeProfile,
          activeProfileId: activeProfile.id
        });
      }

      if (action === "add" || !body.action) {
        if (!body.name) {
          return createJsonResponse({ ok: false, success: false, error: "MISSING_NAME" }, 400);
        }
        const profile = defaultProfileService.addProfile(wallet, body);
        const userStore = defaultProfileService.getProfiles(wallet);
        return createJsonResponse({
          ok: true,
          success: true,
          profile,
          profiles: userStore.profiles,
          activeProfile: profile,
          activeProfileId: profile.id
        });
      }
    }

    if (method === "DELETE") {
      const profileId = body.profileId || url.searchParams.get("profileId");
      if (!profileId) {
        return createJsonResponse({ ok: false, success: false, error: "MISSING_PROFILE_ID" }, 400);
      }
      if (!defaultProfileService.deleteProfile(wallet, profileId)) {
        return createJsonResponse({ ok: false, success: false, error: "PROFILE_NOT_FOUND" }, 404);
      }
      const userStore = defaultProfileService.getProfiles(wallet);
      const activeProfile = defaultProfileService.getActiveProfile(wallet) || null;
      return createJsonResponse({
        ok: true,
        success: true,
        profiles: userStore.profiles,
        activeProfile,
        activeProfileId: activeProfile?.id || null,
      });
    }

    return createJsonResponse({ ok: false, success: false, error: "NOT_FOUND" }, 404);
  } catch (err) {
    return createJsonResponse({ ok: false, success: false, error: err.message }, 500);
  }
}

async function handleCloudflareProfileRequest(req, env) {
  const auth = await requireAuth(req, env);
  if (!auth) return authRequiredResponse();
  const method = (req.method || 'GET').toUpperCase();
  const url = new URL(req.url || 'http://localhost/api/profile', 'http://localhost');
  const searchQ = url.searchParams.get('q') || url.searchParams.get('query') || '';
  const body = method === 'POST' || method === 'DELETE' ? await readJson(req) : {};

  try {
    if (method === 'GET') {
      let profiles = await auth.repositories.profiles.list(auth.userId);
      if (searchQ.trim()) {
        const query = searchQ.trim().toLowerCase();
        profiles = profiles.filter((profile) => profile.name.toLowerCase().includes(query));
      }
      const preferences = await auth.repositories.preferences.get(auth.userId);
      const activeProfile = profiles.find((profile) => profile.id === preferences.activeProfileId) || profiles[0] || null;
      return createJsonResponse({ ok: true, success: true, profiles, activeProfile, activeProfileId: activeProfile?.id || null });
    }

    if (method === 'POST') {
      const action = body.action || (url.pathname.endsWith('/switch') ? 'switch' : 'add');
      if (action === 'switch') {
        const activeProfile = await auth.repositories.profiles.findById(auth.userId, body.profileId);
        if (!activeProfile) return createJsonResponse({ ok: false, success: false, error: 'PROFILE_NOT_FOUND' }, 404);
        const preferences = await auth.repositories.preferences.get(auth.userId);
        await auth.repositories.preferences.save(auth.userId, { activeProfileId: activeProfile.id, settings: preferences.settings });
        const profiles = await auth.repositories.profiles.list(auth.userId);
        return createJsonResponse({ ok: true, success: true, profiles, activeProfile, activeProfileId: activeProfile.id });
      }
      if (action === 'add') {
        if (!body.name) return createJsonResponse({ ok: false, success: false, error: 'MISSING_NAME' }, 400);
        const profile = await auth.repositories.profiles.create(auth.userId, body);
        const preferences = await auth.repositories.preferences.get(auth.userId);
        await auth.repositories.preferences.save(auth.userId, { activeProfileId: profile.id, settings: preferences.settings });
        const profiles = await auth.repositories.profiles.list(auth.userId);
        return createJsonResponse({ ok: true, success: true, profile, profiles, activeProfile: profile, activeProfileId: profile.id });
      }
    }

    if (method === 'DELETE') {
      const profileId = body.profileId || url.searchParams.get('profileId');
      if (!profileId) return createJsonResponse({ ok: false, success: false, error: 'MISSING_PROFILE_ID' }, 400);
      if (!await auth.repositories.profiles.remove(auth.userId, profileId)) {
        return createJsonResponse({ ok: false, success: false, error: 'PROFILE_NOT_FOUND' }, 404);
      }
      const profiles = await auth.repositories.profiles.list(auth.userId);
      const preferences = await auth.repositories.preferences.get(auth.userId);
      const activeProfile = profiles.find((profile) => profile.id === preferences.activeProfileId) || profiles[0] || null;
      if (preferences.activeProfileId !== activeProfile?.id) {
        await auth.repositories.preferences.save(auth.userId, { activeProfileId: activeProfile?.id || null, settings: preferences.settings });
      }
      return createJsonResponse({ ok: true, success: true, profiles, activeProfile, activeProfileId: activeProfile?.id || null });
    }

    return createJsonResponse({ ok: false, success: false, error: 'NOT_FOUND' }, 404);
  } catch (error) {
    return createJsonResponse({ ok: false, success: false, error: error.code || 'PROFILE_ERROR' }, 400);
  }
}

async function readJson(req) {
  return typeof req.json === 'function' ? req.json().catch(() => ({})) : (req.body || {});
}

function createJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const profileHandler = handleProfileRequest;
export default handleProfileRequest;

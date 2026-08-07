import { defaultProfileService } from "../lib/runtime/profile-service.js";

export async function handleProfileRequest(req) {
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

function createJsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const profileHandler = handleProfileRequest;
export default handleProfileRequest;

import { defaultProfileService } from "../lib/runtime/profile-service.js";

export async function handleProfileRequest(req) {
  const method = (req.method || "GET").toUpperCase();
  const rawUrl = typeof req.url === "string" ? req.url : "http://localhost/api/profile";
  const url = new URL(rawUrl, "http://localhost");
  const wallet = url.searchParams.get("wallet") || "default";
  const searchQ = url.searchParams.get("q") || url.searchParams.get("query") || "";

  let body = {};
  if (method === "POST") {
    if (typeof req.json === "function") {
      body = await req.json().catch(() => ({}));
    } else if (req.body) {
      body = req.body;
    }
  }

  try {
    if (method === "GET") {
      const userStore = defaultProfileService.getProfiles(wallet);
      let profiles = userStore.profiles;
      if (searchQ.trim()) {
        const q = searchQ.trim().toLowerCase();
        profiles = profiles.filter(p => p.name.toLowerCase().includes(q));
      }
      const activeProfile = defaultProfileService.getActiveProfile(wallet);

      return createJsonResponse({
        ok: true,
        success: true,
        profiles,
        activeProfile,
        activeProfileId: activeProfile.id
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

export const profileHandler = handleProfileRequest;
export default handleProfileRequest;

import handleProfileRequest from "../../api/profile.js";

export async function onRequest(context) {
  const { request, env } = context;
  return handleProfileRequest(request, { env });
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

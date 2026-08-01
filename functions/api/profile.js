import handleProfileRequest from "../../api/profile.js";

export async function onRequest(context) {
  const { request } = context;
  return handleProfileRequest(request);
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

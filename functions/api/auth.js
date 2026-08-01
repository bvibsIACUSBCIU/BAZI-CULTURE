import { handleAuthRequest } from "../../api/auth.js";

export async function onRequest(context) {
  const { request } = context;
  return handleAuthRequest(request);
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

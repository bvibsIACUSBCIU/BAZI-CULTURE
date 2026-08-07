import handleQuotaRequest from "../../api/quota.js";

export async function onRequest(context) {
  const { request, env } = context;
  return handleQuotaRequest(request, { env });
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

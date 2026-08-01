import handleQuotaRequest from "../../api/quota.js";

export async function onRequest(context) {
  const { request } = context;
  return handleQuotaRequest(request);
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

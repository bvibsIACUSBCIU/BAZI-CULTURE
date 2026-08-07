import handleSessionHistoryRequest from "../../api/session-history.js";

export async function onRequest(context) {
  const { request, env } = context;
  return handleSessionHistoryRequest(request, { env });
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

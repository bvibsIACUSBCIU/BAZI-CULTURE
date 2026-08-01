import handleSessionHistoryRequest from "../../api/session-history.js";

export async function onRequest(context) {
  const { request } = context;
  return handleSessionHistoryRequest(request);
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

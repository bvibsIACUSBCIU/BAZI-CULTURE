import reportHandler from "../../api/report.js";
import aiReportHandler from "../../api/ai-report.js";
import eventsHandler from "../../api/events.js";
import ziweiHandler from "../../api/ziwei.js";
import qimenHandler from "../../api/qimen.js";
import profileHandler from "../../api/profile.js";
import quotaHandler from "../../api/quota.js";
import sessionHistoryHandler from "../../api/session-history.js";
import { parseRequest, createFunctionResponse, withEnv } from "./worker-utils.js";

const routeMap = {
  "/api/report": reportHandler,
  "/api/ai-report": aiReportHandler,
  "/api/events": eventsHandler,
  "/api/ziwei": ziweiHandler,
  "/api/qimen": qimenHandler,
  "/api/profile": profileHandler,
  "/api/profile/switch": profileHandler,
  "/api/profile/add": profileHandler,
  "/api/quota": quotaHandler,
  "/api/quota/checkin": quotaHandler,
  "/api/session-history": sessionHistoryHandler,
  "/api/session-history/bookmark": sessionHistoryHandler,
  "/api/session-history/add": sessionHistoryHandler,
};

export async function onRequest(context) {
  const { request, env } = context;
  return withEnv(env, async () => {
    const url = new URL(request.url);
    const handler = routeMap[url.pathname];
    if (!handler) {
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    const requestData = await parseRequest(request);
    const response = createFunctionResponse();

    await handler(requestData, response);
    return response.toResponse();
  });
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

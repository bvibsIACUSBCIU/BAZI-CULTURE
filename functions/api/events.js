import eventsHandler from "../../api/events.js";
import { parseRequest, createFunctionResponse, withEnv } from "./worker-utils.js";

export async function onRequest(context) {
  const { request, env } = context;
  return withEnv(env, async () => {
    const requestData = await parseRequest(request);
    const response = createFunctionResponse();
    await eventsHandler(requestData, response);
    return response.toResponse();
  });
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

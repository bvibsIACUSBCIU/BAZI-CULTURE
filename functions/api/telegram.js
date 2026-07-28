import { createHandler } from "../../api/telegram.js";
import { parseRequest, createFunctionResponse, withEnv } from "./worker-utils.js";

const handler = createHandler();

export async function onRequest(context) {
  const { request, env } = context;
  return withEnv(env, async () => {
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

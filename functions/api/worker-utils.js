export async function parseRequest(request) {
  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  return {
    method: request.method,
    body,
    headers: request.headers,
    socket: {
      remoteAddress:
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    },
  };
}

export function createFunctionResponse() {
  const headers = new Headers();
  let statusCode = 200;
  let payload = null;

  return {
    setHeader(name, value) {
      headers.set(name, String(value));
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = JSON.stringify(data);
      return this;
    },
    toResponse() {
      return new Response(payload === null ? '' : payload, {
        status: statusCode,
        headers,
      });
    },
  };
}

export async function withEnv(env, callback) {
  const previous = globalThis.__BCL_ENV__;
  globalThis.__BCL_ENV__ = env || {};
  try {
    return await callback();
  } finally {
    globalThis.__BCL_ENV__ = previous;
  }
}

import handlePreferencesRequest from '../../api/preferences.js';

export async function onRequest(context) {
  return handlePreferencesRequest(context.request, { env: context.env });
}

export default {
  async fetch(request, env) {
    return onRequest({ request, env });
  },
};

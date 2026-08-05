import handleChatRequest from '../../api/chat.js';
export async function onRequest(context) {
  return handleChatRequest(context.request);
}

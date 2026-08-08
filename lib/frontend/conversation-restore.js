export async function restoreOwnedConversation({ sessions, persistedConversationId = null, loadDetail }) {
  if (!Array.isArray(sessions) || sessions.length === 0 || typeof loadDetail !== 'function') return null;
  const selected = sessions.find((session) => session?.id === persistedConversationId)
    || sessions.find((session) => typeof session?.id === 'string' && session.id)
    || null;
  if (!selected) return null;
  return loadDetail(selected.id);
}

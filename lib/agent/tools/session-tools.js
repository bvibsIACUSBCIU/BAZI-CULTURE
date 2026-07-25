// Session deletion remains explicit and is never inferred from ambiguous text.
export function createSessionTools({ sessionStore }) {
  return {
    clear_session: {
      description: "删除指定聊天当前保存的会话资料。",
      async execute(_input, context) {
        if (!context?.chatId) throw new Error("缺少聊天标识。");
        await sessionStore.delete("session", context.chatId);
        return { cleared: true };
      },
    },
  };
}

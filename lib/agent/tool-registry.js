// The registry is the only path from an agent turn to application capabilities.
export class AgentToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentToolError";
    this.code = code;
  }
}

export class ToolRegistry {
  constructor(tools, { maxCalls = 2 } = {}) {
    this.tools = new Map(Object.entries(tools));
    this.maxCalls = maxCalls;
  }

  createTurn() {
    let callCount = 0;
    const used = [];
    return {
      execute: async (name, input, context) => {
        if (callCount >= this.maxCalls) {
          throw new AgentToolError("TOOL_LIMIT", "本轮工具调用次数已达到上限。");
        }
        const tool = this.tools.get(name);
        if (!tool) {
          throw new AgentToolError("TOOL_NOT_ALLOWED", "该工具不在允许列表中。");
        }
        callCount += 1;
        const output = await tool.execute(input, context);
        used.push(name);
        return output;
      },
      usedTools: () => [...used],
    };
  }
}

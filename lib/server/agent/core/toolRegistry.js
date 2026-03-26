export class ToolRegistry {
  constructor() {
    this.executors = new Map();
  }

  registerBuiltin(identifier, executor) {
    if (typeof identifier !== "string" || !identifier.trim()) {
      throw new Error("Tool identifier invalid");
    }
    if (!executor || typeof executor !== "object") {
      throw new Error("Tool executor invalid");
    }
    this.executors.set(identifier.trim(), executor);
    return this;
  }

  async execute(toolCall, context = {}) {
    const identifier = typeof toolCall?.identifier === "string" ? toolCall.identifier.trim() : "";
    const apiName = typeof toolCall?.apiName === "string" ? toolCall.apiName.trim() : "";
    if (!identifier || !apiName) {
      throw new Error("Tool call invalid");
    }

    const executor = this.executors.get(identifier);
    if (!executor) {
      throw new Error(`未注册的工具：${identifier}`);
    }

    const handler = executor?.[apiName];
    if (typeof handler !== "function") {
      throw new Error(`工具接口不存在：${identifier}.${apiName}`);
    }

    return handler.call(executor, toolCall.arguments || {}, context);
  }
}

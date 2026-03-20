export const CLAUDE_SONNET_MODEL = "claude-sonnet-4-6";
export const CLAUDE_OPUS_MODEL = "claude-opus-4-6";
export const MIMO_V2_PRO_MODEL = "mimo-v2-pro";
export const MINIMAX_M2_7_HIGHSPEED_MODEL = "minimax-m2.7-highspeed";
export const GEMINI_FLASH_MODEL = "gemini-3-flash-preview";
export const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
export const DEEPSEEK_CHAT_MODEL = "deepseek-chat";
export const DEEPSEEK_REASONER_MODEL = "deepseek-reasoner";
export const OPENAI_PRIMARY_MODEL = "gpt-5.4";
export const SEED_MODEL_ID = "doubao-seed-2-0-pro-260215";
export const LEGACY_SEED_MODEL_ID = "volcengine/doubao-seed-2.0-pro";
export const LEGACY_PREFIXED_SEED_MODEL_ID = `volcengine/${SEED_MODEL_ID}`;
export const AGENT_MODEL_ID = "agent";
export const AGENT_PROVIDER = "vectaix";
export const COUNCIL_MODEL_ID = "council";
export const COUNCIL_PROVIDER = "council";
export const COUNCIL_MAX_ROUNDS = 8;
export const DEFAULT_SEED_THINKING_LEVEL = "high";
export const DEFAULT_AGENT_THINKING_LEVEL = "high";
export const DEFAULT_AGENT_DRIVER_MODEL = SEED_MODEL_ID;

export const SEED_REASONING_LEVELS = ["minimal", "low", "medium", "high"];
export const SEED_REASONING_LABELS = {
  minimal: "最小",
  low: "低",
  medium: "中",
  high: "高",
};

export const MODEL_GROUP_ORDER = ["vectaix", "gemini", "claude", "openai", "seed", "deepseek", "xiaomi", "minimax"];

export const CHAT_MODELS = Object.freeze([
  {
    id: AGENT_MODEL_ID,
    name: "Agent",
    provider: AGENT_PROVIDER,
    contextWindow: 256000,
    supportsImages: true,
    supportsDocuments: true,
    supportsWebSearch: true,
    supportsAgentRuntime: true,
    supportsPlanning: true,
    supportsToolUse: true,
    supportsApprovalFlow: false,
    supportsMemory: true,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: false,
    defaultThinkingLevel: DEFAULT_AGENT_THINKING_LEVEL,
  },
  {
    id: COUNCIL_MODEL_ID,
    name: "Council",
    provider: COUNCIL_PROVIDER,
    contextWindow: 0,
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: false,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
    isCouncil: true,
  },
  {
    id: GEMINI_FLASH_MODEL,
    name: "Gemini 3.0 Flash",
    provider: "gemini",
    contextWindow: 1000000,
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "HIGH",
  },
  {
    id: GEMINI_PRO_MODEL,
    name: "Gemini 3.1 Pro",
    provider: "gemini",
    contextWindow: 1000000,
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "HIGH",
  },
  {
    id: CLAUDE_SONNET_MODEL,
    name: "Claude Sonnet 4.6",
    provider: "claude",
    contextWindow: 200000,
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "max",
  },
  {
    id: CLAUDE_OPUS_MODEL,
    name: "Claude Opus 4.6",
    provider: "claude",
    contextWindow: 200000,
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "max",
  },
  {
    id: MIMO_V2_PRO_MODEL,
    name: "MiMo-V2-Pro",
    provider: "xiaomi",
    contextWindow: 1048576,
    supportsImages: false,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: true,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: false,
    defaultThinkingLevel: "enabled",
  },
  {
    id: MINIMAX_M2_7_HIGHSPEED_MODEL,
    name: "MiniMax-M2.7",
    provider: "minimax",
    contextWindow: 204800,
    supportsImages: false,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: true,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "enabled",
  },
  {
    id: OPENAI_PRIMARY_MODEL,
    name: "ChatGPT 5.4",
    provider: "openai",
    contextWindow: 272000,
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "high",
  },
  {
    id: SEED_MODEL_ID,
    name: "Seed 2.0 Pro",
    provider: "seed",
    contextWindow: 256000,
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: true,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "high",
  },
  {
    id: DEEPSEEK_REASONER_MODEL,
    name: "DeepSeek V3.2",
    provider: "deepseek",
    contextWindow: 128000,
    supportsImages: false,
    supportsDocuments: false,
    supportsWebSearch: true,
    supportsAgentRuntime: false,
    supportsPlanning: false,
    supportsToolUse: false,
    supportsApprovalFlow: false,
    supportsMemory: false,
    supportsThinkingLevelControl: false,
    supportsMaxTokensControl: true,
    defaultThinkingLevel: "medium",
  },
]);

export const DEFAULT_MODEL = DEEPSEEK_REASONER_MODEL;

export const DEFAULT_THINKING_LEVELS = Object.freeze(
  CHAT_MODELS.reduce((acc, model) => {
    if (model.defaultThinkingLevel) {
      acc[model.id] = model.defaultThinkingLevel;
    }
    return acc;
  }, {})
);

const AGENT_DRIVER_MODELS = Object.freeze(
  CHAT_MODELS.filter((model) => model.id !== AGENT_MODEL_ID && model.id !== COUNCIL_MODEL_ID)
);
const AGENT_DRIVER_MODEL_IDS = new Set(AGENT_DRIVER_MODELS.map((model) => model.id));

const COUNCIL_EXPERT_BASES = Object.freeze([
  {
    key: "gpt",
    modelId: OPENAI_PRIMARY_MODEL,
    label: "ChatGPT 5.4",
    provider: "openai",
  },
  {
    key: "opus",
    modelId: CLAUDE_OPUS_MODEL,
    label: "Claude Opus 4.6",
    provider: "claude",
  },
  {
    key: "pro",
    modelId: GEMINI_PRO_MODEL,
    label: "Gemini 3.1 Pro",
    provider: "gemini",
  },
]);

export function getCouncilExpertConfigs() {
  return COUNCIL_EXPERT_BASES.map((expert) => ({
    ...expert,
    thinkingLevel: getDefaultThinkingLevel(expert.modelId),
  }));
}

export const COUNCIL_EXPERTS = Object.freeze(getCouncilExpertConfigs());

const COUNCIL_EXPERT_DISPLAY_LABELS = Object.freeze({
  gpt: "GPT",
  opus: "Claude",
  pro: "Gemini",
  [OPENAI_PRIMARY_MODEL]: "GPT",
  [CLAUDE_OPUS_MODEL]: "Claude",
  [CLAUDE_SONNET_MODEL]: "Claude",
  [GEMINI_PRO_MODEL]: "Gemini",
  [GEMINI_FLASH_MODEL]: "Gemini",
});

export function normalizeSeedModelId(model) {
  if (typeof model !== "string" || !model) return model;
  if (model === LEGACY_SEED_MODEL_ID || model === LEGACY_PREFIXED_SEED_MODEL_ID) {
    return SEED_MODEL_ID;
  }
  return model;
}

export function resolveSeedRuntimeModelId(model) {
  if (model === AGENT_MODEL_ID) return SEED_MODEL_ID;
  return normalizeSeedModelId(model);
}

export function normalizeModelId(model) {
  return normalizeSeedModelId(model);
}

export function isSeedModel(model) {
  const normalized = normalizeSeedModelId(model);
  return typeof normalized === "string" && normalized.startsWith("doubao-seed-");
}

export function isCouncilModel(model) {
  return typeof model === "string" && model === COUNCIL_MODEL_ID;
}

export function countCompletedCouncilRounds(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  let rounds = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const userMessage = messages[index];
    const modelMessage = messages[index + 1];
    if (userMessage?.role !== "user") continue;
    if (modelMessage?.role !== "model") continue;
    rounds += 1;
    index += 1;
  }

  return rounds;
}

export function getModelConfig(modelId) {
  const normalized = normalizeModelId(modelId);
  return CHAT_MODELS.find((model) => model.id === normalized) || null;
}

export function getModelProvider(modelId) {
  return getModelConfig(modelId)?.provider || "gemini";
}

export function getProviderModels(provider) {
  return CHAT_MODELS.filter((model) => model.provider === provider);
}

export function getAgentDriverModels() {
  return AGENT_DRIVER_MODELS;
}

export function isAgentDriverModelId(modelId) {
  const normalized = normalizeModelId(modelId);
  return typeof normalized === "string" && AGENT_DRIVER_MODEL_IDS.has(normalized);
}

export function normalizeAgentDriverModelId(modelId) {
  const normalized = normalizeModelId(modelId);
  if (typeof normalized === "string" && AGENT_DRIVER_MODEL_IDS.has(normalized)) {
    return normalized;
  }
  return DEFAULT_AGENT_DRIVER_MODEL;
}

export function getDefaultThinkingLevel(modelId) {
  return DEFAULT_THINKING_LEVELS[normalizeModelId(modelId)];
}

export function getCouncilExpertDisplayLabel(expert) {
  const key = typeof expert?.key === "string" ? expert.key : "";
  const modelId = normalizeModelId(expert?.modelId);
  const rawLabel = typeof expert?.label === "string" ? expert.label : "";

  if (key && COUNCIL_EXPERT_DISPLAY_LABELS[key]) {
    return COUNCIL_EXPERT_DISPLAY_LABELS[key];
  }
  if (modelId && COUNCIL_EXPERT_DISPLAY_LABELS[modelId]) {
    return COUNCIL_EXPERT_DISPLAY_LABELS[modelId];
  }
  if (/gpt|chatgpt/i.test(rawLabel)) return "GPT";
  if (/claude/i.test(rawLabel)) return "Claude";
  if (/gemini/i.test(rawLabel)) return "Gemini";
  if (/seed|doubao/i.test(rawLabel)) return "Seed";
  return rawLabel || "专家";
}

export function getDefaultMaxTokensForModel(modelId) {
  const normalized = normalizeModelId(modelId);
  if (typeof normalized !== "string" || !normalized) return 64000;
  if (
    normalized.startsWith("gpt-")
    || normalized.startsWith(CLAUDE_OPUS_MODEL)
  ) {
    return 128000;
  }
  if (
    normalized === MIMO_V2_PRO_MODEL
    || normalized === MINIMAX_M2_7_HIGHSPEED_MODEL
  ) {
    return 131072;
  }
  return 64000;
}

export const CLAUDE_OPUS_MODEL = "claude-opus-4-6";
export const CLAUDE_OPUS_OPENROUTER_MODEL = "anthropic/claude-opus-4.6";
export const MIMO_V2_FLASH_MODEL = "xiaomi/mimo-v2-flash";
export const MINIMAX_M2_5_MODEL = "minimax/minimax-m2.5";
export const GEMINI_PRO_MODEL = "gemini-2.5-pro";
export const GEMINI_PRO_OPENROUTER_MODEL = "google/gemini-2.5-pro";
export const DEEPSEEK_CHAT_MODEL = "deepseek-chat";
export const DEEPSEEK_REASONER_MODEL = "deepseek-reasoner";
export const OPENAI_PRIMARY_MODEL = "gpt-5.4";
export const OPENAI_PRIMARY_OPENROUTER_MODEL = "openai/gpt-5.4";
export const SEED_MODEL_ID = "doubao-seed-2-0-pro-260215";
export const COUNCIL_MODEL_ID = "council";
export const COUNCIL_PROVIDER = "council";
export const COUNCIL_MAX_ROUNDS = 8;
export const DEFAULT_SEED_THINKING_LEVEL = "high";

export const SEED_REASONING_LEVELS = ["minimal", "low", "medium", "high"];
export const SEED_REASONING_LABELS = {
  minimal: "最小",
  low: "低",
  medium: "中",
  high: "高",
};

export const MODEL_GROUP_ORDER = ["gemini", "claude", "openai", "seed", "deepseek", "xiaomi", "minimax"];

export const MODEL_GROUP_TITLES = Object.freeze({
  gemini: "Google",
  claude: "Anthropic",
  openai: "OpenAI",
  seed: "ByteDance",
  deepseek: "DeepSeek",
  xiaomi: "Xiaomi / OpenRouter",
  minimax: "MiniMax / OpenRouter",
});

export const CHAT_MODELS = Object.freeze([
  {
    id: COUNCIL_MODEL_ID,
    name: "Council",
    provider: COUNCIL_PROVIDER,
    contextWindow: 0,
    supportsImages: true,
    supportsDocuments: false,
    supportsWebSearch: true,
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
    id: GEMINI_PRO_MODEL,
    name: "Gemini 2.5 Pro",
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
    id: MIMO_V2_FLASH_MODEL,
    name: "MiMo V2 Flash (OpenRouter)",
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
    id: MINIMAX_M2_5_MODEL,
    name: "MiniMax M2.5 (OpenRouter)",
    provider: "minimax",
    contextWindow: 196608,
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
    name: "GPT-5.4",
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

export const PRIMARY_CHAT_MODELS = Object.freeze(CHAT_MODELS);
const PRIMARY_CHAT_MODEL_IDS = new Set(PRIMARY_CHAT_MODELS.map((model) => model.id));

export const DEFAULT_MODEL = SEED_MODEL_ID;

export const DEFAULT_THINKING_LEVELS = Object.freeze(
  CHAT_MODELS.reduce((acc, model) => {
    if (model.defaultThinkingLevel) {
      acc[model.id] = model.defaultThinkingLevel;
    }
    return acc;
  }, {})
);

const OPENROUTER_MODEL_IDS = Object.freeze({
  [OPENAI_PRIMARY_MODEL]: OPENAI_PRIMARY_OPENROUTER_MODEL,
  [CLAUDE_OPUS_MODEL]: CLAUDE_OPUS_OPENROUTER_MODEL,
  [GEMINI_PRO_MODEL]: GEMINI_PRO_OPENROUTER_MODEL,
  [MIMO_V2_FLASH_MODEL]: MIMO_V2_FLASH_MODEL,
  [MINIMAX_M2_5_MODEL]: MINIMAX_M2_5_MODEL,
});

const OPENROUTER_ONLY_MODEL_IDS = new Set([
  MIMO_V2_FLASH_MODEL,
  MINIMAX_M2_5_MODEL,
]);

const COUNCIL_EXPERT_BASES = Object.freeze([
  {
    key: "gpt",
    modelId: OPENAI_PRIMARY_MODEL,
    label: "GPT-5.4",
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
    label: "Gemini 2.5 Pro",
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
  [GEMINI_PRO_MODEL]: "Gemini",
});

export function normalizeModelId(model) {
  if (typeof model !== "string") return model;
  return model.trim();
}

export function getOpenRouterModelId(modelId) {
  const normalized = normalizeModelId(modelId);
  return typeof normalized === "string" ? (OPENROUTER_MODEL_IDS[normalized] || "") : "";
}

export function isOpenRouterOnlyModel(modelId) {
  const normalized = normalizeModelId(modelId);
  return typeof normalized === "string" && OPENROUTER_ONLY_MODEL_IDS.has(normalized);
}

export function isSeedModel(model) {
  const normalized = normalizeModelId(model);
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
  return getModelConfig(modelId)?.provider || "";
}

export function getModelRouteKey(modelId) {
  const provider = getModelProvider(modelId);
  if (provider === "openai") return "openai";
  if (provider === "claude") return "anthropic";
  if (provider === "gemini") return "gemini";
  return "";
}

export function getProviderModels(provider) {
  return CHAT_MODELS.filter((model) => model.provider === provider);
}

export function isPrimaryChatModelId(modelId) {
  const normalized = normalizeModelId(modelId);
  return typeof normalized === "string" && PRIMARY_CHAT_MODEL_IDS.has(normalized);
}

export function getSelectableChatModels() {
  return PRIMARY_CHAT_MODELS;
}

export function isAgentBackedModelId(modelId) {
  const normalized = normalizeModelId(modelId);
  return Boolean(getModelConfig(normalized)) && normalized !== COUNCIL_MODEL_ID;
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
    normalized === MIMO_V2_FLASH_MODEL
    || normalized === MINIMAX_M2_5_MODEL
  ) {
    return 131072;
  }
  return 64000;
}

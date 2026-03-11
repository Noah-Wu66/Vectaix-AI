export const CLAUDE_SONNET_MODEL = "claude-sonnet-4-6";
export const CLAUDE_OPUS_MODEL = "claude-opus-4-6";
export const GEMINI_FLASH_MODEL = "gemini-3-flash-preview";
export const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
export const DEEPSEEK_CHAT_MODEL = "deepseek-chat";
export const DEEPSEEK_REASONER_MODEL = "deepseek-reasoner";
export const OPENAI_PRIMARY_MODEL = "gpt-5.4";
export const SEED_MODEL_ID = "doubao-seed-2-0-pro-260215";
export const LEGACY_SEED_MODEL_ID = "volcengine/doubao-seed-2.0-pro";
export const LEGACY_PREFIXED_SEED_MODEL_ID = `volcengine/${SEED_MODEL_ID}`;
export const COUNCIL_MODEL_ID = "council";
export const COUNCIL_PROVIDER = "council";
export const COUNCIL_MAX_ROUNDS = 8;

export const SEED_REASONING_LEVELS = ["minimal", "low", "medium", "high"];
export const SEED_REASONING_LABELS = {
  minimal: "最小",
  low: "低",
  medium: "中",
  high: "高",
};

export const MODEL_GROUP_ORDER = ["council", "gemini", "claude", "openai", "seed", "deepseek"];

export const CHAT_MODELS = Object.freeze([
  {
    id: COUNCIL_MODEL_ID,
    name: "Council",
    shortName: "Council",
    provider: COUNCIL_PROVIDER,
    contextWindow: 0,
    supportsImages: false,
    supportsWebSearch: false,
    isCouncil: true,
  },
  {
    id: GEMINI_FLASH_MODEL,
    name: "Flash",
    shortName: "Flash",
    provider: "gemini",
    contextWindow: 1000000,
    supportsImages: true,
    supportsWebSearch: true,
    defaultThinkingLevel: "HIGH",
  },
  {
    id: GEMINI_PRO_MODEL,
    name: "Pro",
    shortName: "Pro",
    provider: "gemini",
    contextWindow: 1000000,
    supportsImages: true,
    supportsWebSearch: true,
    defaultThinkingLevel: "HIGH",
  },
  {
    id: CLAUDE_SONNET_MODEL,
    name: "Sonnet",
    shortName: "Sonnet",
    provider: "claude",
    contextWindow: 200000,
    supportsImages: true,
    supportsWebSearch: true,
    defaultThinkingLevel: "max",
  },
  {
    id: CLAUDE_OPUS_MODEL,
    name: "Opus",
    shortName: "Opus",
    provider: "claude",
    contextWindow: 200000,
    supportsImages: true,
    supportsWebSearch: true,
    defaultThinkingLevel: "max",
  },
  {
    id: OPENAI_PRIMARY_MODEL,
    name: "GPT",
    shortName: "GPT",
    provider: "openai",
    contextWindow: 1050000,
    supportsImages: true,
    supportsWebSearch: true,
    defaultThinkingLevel: "xhigh",
  },
  {
    id: SEED_MODEL_ID,
    name: "Seed",
    shortName: "Seed",
    provider: "seed",
    contextWindow: 256000,
    supportsImages: true,
    supportsWebSearch: true,
    defaultThinkingLevel: "high",
  },
  {
    id: DEEPSEEK_REASONER_MODEL,
    name: "DeepSeek",
    shortName: "DeepSeek",
    provider: "deepseek",
    contextWindow: 128000,
    supportsImages: true,
    supportsWebSearch: true,
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

export const COUNCIL_EXPERTS = Object.freeze([
  {
    key: "gpt",
    modelId: OPENAI_PRIMARY_MODEL,
    label: "GPT",
    provider: "openai",
    thinkingLevel: DEFAULT_THINKING_LEVELS[OPENAI_PRIMARY_MODEL],
  },
  {
    key: "opus",
    modelId: CLAUDE_OPUS_MODEL,
    label: "Opus",
    provider: "claude",
    thinkingLevel: DEFAULT_THINKING_LEVELS[CLAUDE_OPUS_MODEL],
  },
  {
    key: "pro",
    modelId: GEMINI_PRO_MODEL,
    label: "Pro",
    provider: "gemini",
    thinkingLevel: DEFAULT_THINKING_LEVELS[GEMINI_PRO_MODEL],
  },
]);

export function normalizeSeedModelId(model) {
  if (typeof model !== "string" || !model) return model;
  if (model === LEGACY_SEED_MODEL_ID || model === LEGACY_PREFIXED_SEED_MODEL_ID) {
    return SEED_MODEL_ID;
  }
  return model;
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

export function getDefaultThinkingLevel(modelId) {
  return DEFAULT_THINKING_LEVELS[normalizeModelId(modelId)];
}

export function getDefaultMaxTokensForModel(modelId) {
  const normalized = normalizeModelId(modelId);
  if (typeof normalized !== "string" || !normalized) return 64000;
  if (normalized.startsWith("gpt-") || normalized.startsWith(CLAUDE_OPUS_MODEL)) {
    return 128000;
  }
  return 64000;
}

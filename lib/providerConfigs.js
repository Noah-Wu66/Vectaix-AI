const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const MINIMAX_API_BASE_URL = "https://api.minimax.io/anthropic";
const DEFAULT_MINIMAX_MODEL_ID = "MiniMax-M2.5";
const DEFAULT_MIMO_MODEL_ID = "XiaomiMiMo/MiMo-7B-RL-0530";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function readOptionalEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

export function resolveOpenAIProviderConfig() {
  return {
    apiKey: requireEnv("OPENAI_API_KEY"),
    baseUrl: OPENAI_API_BASE_URL,
    providerLabel: "OpenAI 官方",
    transport: "openai-responses",
  };
}

export function resolveAnthropicProviderConfig() {
  return {
    apiKey: requireEnv("ANTHROPIC_API_KEY"),
    baseUrl: null,
    providerLabel: "Anthropic 官方",
    transport: "anthropic-messages",
  };
}

export function resolveGeminiProviderConfig() {
  return {
    apiKey: requireEnv("GEMINI_API_KEY"),
    baseUrl: null,
    providerLabel: "Google 官方",
    transport: "google-genai",
  };
}

export function resolveMiniMaxProviderConfig() {
  return {
    apiKey: requireEnv("MINIMAX_API_KEY"),
    baseUrl: MINIMAX_API_BASE_URL,
    providerLabel: "MiniMax 官方",
    transport: "anthropic-messages",
    modelId: readOptionalEnv("MINIMAX_MODEL_ID") || DEFAULT_MINIMAX_MODEL_ID,
  };
}

export function resolveMiMoProviderConfig() {
  return {
    apiKey: readOptionalEnv("MIMO_API_KEY"),
    baseUrl: normalizeBaseUrl(requireEnv("MIMO_API_BASE_URL")),
    providerLabel: "Xiaomi MiMo 官方部署",
    transport: "openai-chat-completions",
    modelId: readOptionalEnv("MIMO_MODEL_ID") || DEFAULT_MIMO_MODEL_ID,
  };
}

export function resolveCouncilProviderConfigs() {
  return {
    openai: resolveOpenAIProviderConfig(),
    anthropic: resolveAnthropicProviderConfig(),
    gemini: resolveGeminiProviderConfig(),
  };
}

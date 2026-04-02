const ZENMUX_API_KEY = process.env.ZENMUX_API_KEY;
const ZENMUX_OPENAI_BASE_URL = "https://zenmux.ai/api/v1";
const ZENMUX_ANTHROPIC_BASE_URL = "https://zenmux.ai/api/anthropic";

export function resolveOpenAIProviderConfig() {
  if (!ZENMUX_API_KEY) {
    throw new Error("ZENMUX_API_KEY is not set");
  }
  return {
    baseUrl: ZENMUX_OPENAI_BASE_URL,
    apiKey: ZENMUX_API_KEY,
  };
}

export function resolveOpusProviderConfig() {
  if (!ZENMUX_API_KEY) {
    throw new Error("ZENMUX_API_KEY is not set");
  }
  return {
    baseUrl: ZENMUX_ANTHROPIC_BASE_URL,
    apiKey: ZENMUX_API_KEY,
  };
}

export function resolveGeminiProviderConfig() {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return {
    baseUrl: null,
    apiKey: geminiApiKey,
    useNativeGoogle: true,
  };
}

export function resolveDeepSeekProviderConfig() {
  if (!ZENMUX_API_KEY) {
    throw new Error("ZENMUX_API_KEY is not set");
  }
  return {
    baseUrl: ZENMUX_OPENAI_BASE_URL,
    apiKey: ZENMUX_API_KEY,
  };
}

export function resolveSeedProviderConfig() {
  if (!ZENMUX_API_KEY) {
    throw new Error("ZENMUX_API_KEY is not set");
  }
  return {
    baseUrl: ZENMUX_OPENAI_BASE_URL,
    apiKey: ZENMUX_API_KEY,
  };
}

export function resolveQwenProviderConfig() {
  if (!ZENMUX_API_KEY) {
    throw new Error("ZENMUX_API_KEY is not set");
  }
  return {
    baseUrl: ZENMUX_OPENAI_BASE_URL,
    apiKey: ZENMUX_API_KEY,
  };
}

export function resolveCouncilProviderRoutes() {
  return {
    openai: resolveOpenAIProviderConfig(),
    opus: resolveOpusProviderConfig(),
    gemini: resolveGeminiProviderConfig(),
  };
}

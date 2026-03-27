import {
  CLAUDE_OPUS_MODEL,
  GEMINI_PRO_MODEL,
  MINIMAX_M2_5_MODEL,
} from "@/lib/shared/models";
import { createGeminiApiClient } from "@/lib/server/chat/geminiRestClient";
import {
  resolveAnthropicProviderConfig as resolveOfficialAnthropicProviderConfig,
  resolveGeminiProviderConfig as resolveOfficialGeminiProviderConfig,
  resolveMiniMaxProviderConfig,
} from "@/lib/providerConfigs";

export function isAnthropicCompatibleProvider(provider) {
  return provider === "claude" || provider === "minimax";
}

export function resolveAnthropicApiModel(model, providerConfig) {
  if (typeof model !== "string") return model;
  if (model === MINIMAX_M2_5_MODEL) {
    return providerConfig?.modelId || "MiniMax-M2.5";
  }
  if (model.startsWith(CLAUDE_OPUS_MODEL)) return CLAUDE_OPUS_MODEL;
  return model;
}

export function resolveAnthropicProviderConfig(model) {
  if (model === MINIMAX_M2_5_MODEL) {
    return resolveMiniMaxProviderConfig();
  }
  return resolveOfficialAnthropicProviderConfig();
}

export function resolveGeminiApiModel() {
  return GEMINI_PRO_MODEL;
}

export function resolveGeminiProviderConfigForUser() {
  return resolveOfficialGeminiProviderConfig();
}

export function createGeminiClient() {
  const providerConfig = resolveOfficialGeminiProviderConfig();
  if (!providerConfig?.apiKey) {
    throw new Error("Gemini provider apiKey is not set");
  }
  return createGeminiApiClient({ apiKey: providerConfig.apiKey });
}

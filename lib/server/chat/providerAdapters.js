import { GoogleGenAI } from "@google/genai";
import {
  CLAUDE_OPUS_MODEL,
  GEMINI_PRO_MODEL,
  MIMO_V2_FLASH_MODEL,
  MINIMAX_M2_5_MODEL,
  getOpenRouterModelId,
} from "@/lib/shared/models";
import {
  getModelRoutes,
  resolveAnthropicProviderConfig as resolveAnthropicRouteConfig,
  resolveGeminiProviderConfig,
} from "@/lib/modelRoutes";

export function isClaudeModel(model) {
  return typeof model === "string" && model.startsWith(CLAUDE_OPUS_MODEL);
}

export function isMiMoModel(model) {
  return model === MIMO_V2_FLASH_MODEL;
}

export function isMiniMaxModel(model) {
  return model === MINIMAX_M2_5_MODEL;
}

export function isOpenRouterOnlyAnthropicModel(model) {
  return isMiMoModel(model) || isMiniMaxModel(model);
}

export function isAnthropicCompatibleProvider(provider) {
  return provider === "claude" || provider === "xiaomi" || provider === "minimax";
}

export function resolveAnthropicApiModel(model, providerConfig) {
  if (typeof model !== "string") return model;
  if (providerConfig?.route === "openrouter" || isOpenRouterOnlyAnthropicModel(model)) {
    return getOpenRouterModelId(model) || model;
  }
  if (model.startsWith(CLAUDE_OPUS_MODEL)) return CLAUDE_OPUS_MODEL;
  return model;
}

export function getAnthropicProviderLabel(model) {
  if (isMiMoModel(model)) return "MiMo";
  if (isMiniMaxModel(model)) return "MiniMax";
  return "Claude";
}

export async function resolveAnthropicProviderConfig(model, userId) {
  if (isOpenRouterOnlyAnthropicModel(model)) {
    return resolveAnthropicRouteConfig({ anthropic: "openrouter" });
  }
  const modelRoutes = await getModelRoutes(userId);
  return resolveAnthropicRouteConfig(modelRoutes);
}

export function resolveGeminiApiModel(model, providerConfig) {
  if (providerConfig?.route === "openrouter") {
    return getOpenRouterModelId(model) || getOpenRouterModelId(GEMINI_PRO_MODEL);
  }
  return GEMINI_PRO_MODEL;
}

export async function resolveGeminiProviderConfigForUser(userId) {
  const modelRoutes = await getModelRoutes(userId);
  return resolveGeminiProviderConfig(modelRoutes);
}

export async function createGeminiClient(userId) {
  const providerConfig = await resolveGeminiProviderConfigForUser(userId);
  if (!providerConfig?.apiKey) {
    throw new Error("Gemini provider apiKey is not set");
  }
  if (providerConfig.route !== "official") {
    throw new Error("Gemini OpenRouter 模式不能使用 Google 官方客户端");
  }
  return new GoogleGenAI({ apiKey: providerConfig.apiKey });
}

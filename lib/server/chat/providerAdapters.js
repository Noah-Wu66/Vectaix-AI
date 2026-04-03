import { GoogleGenAI } from "@google/genai";
import {
  CLAUDE_OPUS_MODEL,
  GEMINI_PRO_MODEL,
} from "@/lib/shared/models";
import {
  resolveGeminiProviderConfig,
  resolveOpusProviderConfig,
  resolveDeepSeekProviderConfig,
  resolveSeedProviderConfig,
} from "@/lib/modelRoutes";

export { resolveDeepSeekProviderConfig, resolveSeedProviderConfig };

export function isClaudeModel(model) {
  return typeof model === "string" && model.startsWith(CLAUDE_OPUS_MODEL);
}

export function isAnthropicCompatibleProvider(provider) {
  return provider === "claude";
}

export function resolveAnthropicApiModel(model) {
  if (typeof model !== "string") return model;
  if (model.startsWith(CLAUDE_OPUS_MODEL)) return CLAUDE_OPUS_MODEL;
  return model;
}

export async function resolveAnthropicProviderConfig() {
  return resolveOpusProviderConfig();
}

export function resolveGeminiApiModel(model) {
  // 当前只有一个 Gemini 模型，直接返回
  return GEMINI_PRO_MODEL;
}

export async function createGeminiClient() {
  const providerConfig = resolveGeminiProviderConfig();
  if (!providerConfig?.apiKey) {
    throw new Error("Gemini provider apiKey is not set");
  }
  return new GoogleGenAI({ apiKey: providerConfig.apiKey });
}

import { GoogleGenAI } from "@google/genai";
import {
  CLAUDE_OPUS_MODEL,
  GEMINI_PRO_MODEL,
} from "@/lib/shared/models";
import {
  getModelRoutes,
  resolveGeminiProviderConfig,
  resolveOpusProviderConfig,
} from "@/lib/modelRoutes";

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

export function getAnthropicProviderLabel(model) {
  return "Claude";
}

export async function resolveAnthropicProviderConfig(model, userId) {
  const modelRoutes = await getModelRoutes(userId);
  return resolveOpusProviderConfig(modelRoutes);
}

export function resolveGeminiApiModel(model) {
  return GEMINI_PRO_MODEL;
}

export async function createGeminiClient(userId) {
  const modelRoutes = await getModelRoutes(userId);
  const providerConfig = resolveGeminiProviderConfig(modelRoutes);
  if (!providerConfig?.apiKey) {
    throw new Error("Gemini provider apiKey is not set");
  }
  if (providerConfig.baseUrl) {
    return new GoogleGenAI({
      apiKey: providerConfig.apiKey,
      httpOptions: {
        baseUrl: providerConfig.baseUrl,
      },
    });
  }
  return new GoogleGenAI({ apiKey: providerConfig.apiKey });
}

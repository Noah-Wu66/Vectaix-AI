import { GoogleGenAI } from "@google/genai";
import {
  CLAUDE_OPUS_MODEL,
  GEMINI_PRO_MODEL,
  MIMO_V2_PRO_MODEL,
  MINIMAX_M2_7_HIGHSPEED_MODEL,
} from "@/lib/shared/models";
import { getModelRoutes, resolveOpusProviderConfig } from "@/lib/modelRoutes";

export function isClaudeModel(model) {
  return typeof model === "string" && model.startsWith(CLAUDE_OPUS_MODEL);
}

export function isMiMoModel(model) {
  return model === MIMO_V2_PRO_MODEL;
}

export function isMiniMaxModel(model) {
  return model === MINIMAX_M2_7_HIGHSPEED_MODEL;
}

export function isZenmuxAnthropicModel(model) {
  return isMiMoModel(model) || isMiniMaxModel(model);
}

export function isAnthropicCompatibleProvider(provider) {
  return provider === "claude" || provider === "xiaomi" || provider === "minimax";
}

export function resolveAnthropicApiModel(model) {
  if (typeof model !== "string") return model;
  if (model.startsWith(CLAUDE_OPUS_MODEL)) return CLAUDE_OPUS_MODEL;
  if (isMiMoModel(model)) return `xiaomi/${model}`;
  if (isMiniMaxModel(model)) return `minimax/${model}`;
  return model;
}

export function getAnthropicProviderLabel(model) {
  if (isMiMoModel(model)) return "MiMo";
  if (isMiniMaxModel(model)) return "MiniMax";
  return "Claude";
}

export async function resolveAnthropicProviderConfig(model) {
  if (isZenmuxAnthropicModel(model)) {
    return resolveOpusProviderConfig({ opus: "zenmux" });
  }
  const modelRoutes = await getModelRoutes();
  return resolveOpusProviderConfig(modelRoutes);
}

export function resolveGeminiApiModel(model) {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  const modelWithoutProvider = normalizedModel.startsWith("google/")
    ? normalizedModel.slice("google/".length)
    : normalizedModel;

  if (modelWithoutProvider === GEMINI_PRO_MODEL) {
    return GEMINI_PRO_MODEL;
  }

  return GEMINI_PRO_MODEL;
}

export function createGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenAI({ apiKey });
}

import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  normalizeWebSearchSettings,
} from "@/lib/shared/webSearch";

const OPENAI_REASONING_LEVELS = new Set(["none", "low", "medium", "high", "xhigh"]);
const CLAUDE_THINKING_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
const GEMINI_FLASH_THINKING_LEVELS = new Set(["minimal", "low", "medium", "high"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseMaxTokens(value) {
  const maxTokens = Number.parseInt(value, 10);
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new Error("maxTokens invalid");
  }
  return maxTokens;
}

export function clampMaxTokens(maxTokens, cap) {
  return Math.min(maxTokens, cap);
}

export function parseSystemPrompt(value) {
  return typeof value === "string" ? value : "";
}

export function parseWebSearchEnabled(value) {
  return parseWebSearchConfig(value).enabled;
}

export function parseWebSearchConfig(value) {
  if (value == null) {
    return {
      ...DEFAULT_WEB_SEARCH_SETTINGS,
      enabled: false,
    };
  }
  if (!isPlainObject(value)) {
    throw new Error("webSearch invalid");
  }

  if (typeof value.enabled !== "boolean") {
    throw new Error("webSearch.enabled invalid");
  }
  return normalizeWebSearchSettings(value, { defaultEnabled: false });
}

export function parseOpenAIThinkingLevel(value) {
  const thinkingLevel = normalizeString(value);
  if (!OPENAI_REASONING_LEVELS.has(thinkingLevel)) {
    throw new Error("thinkingLevel invalid");
  }
  return thinkingLevel;
}

export function parseClaudeThinkingLevel(value) {
  const thinkingLevel = normalizeString(value);
  if (!CLAUDE_THINKING_LEVELS.has(thinkingLevel)) {
    throw new Error("thinkingLevel invalid");
  }
  return thinkingLevel;
}

export function parseGeminiThinkingLevel(value) {
  const thinkingLevel = normalizeString(value).toLowerCase();
  if (!GEMINI_FLASH_THINKING_LEVELS.has(thinkingLevel)) {
    throw new Error("thinkingLevel invalid");
  }

  return thinkingLevel;
}

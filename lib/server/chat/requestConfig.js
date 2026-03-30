import { SEED_REASONING_LEVELS } from "@/lib/shared/models";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  WEB_SEARCH_MAX_COUNT,
  XCRAWL_DEVICE_OPTIONS,
  XCRAWL_JS_RENDER_WAIT_UNTIL_OPTIONS,
  normalizeWebSearchSettings,
} from "@/lib/shared/webSearch";

const OPENAI_REASONING_LEVELS = new Set(["none", "low", "medium", "high", "xhigh"]);
const CLAUDE_THINKING_LEVELS = new Set(["low", "medium", "high", "max"]);
const GEMINI_PRO_THINKING_LEVELS = new Set(["LOW", "MEDIUM", "HIGH"]);
const SEED_THINKING_LEVELS = new Set(SEED_REASONING_LEVELS);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidOptionalString(value, { maxLength = 64, pattern = null } = {}) {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > maxLength) return false;
  if (pattern && !pattern.test(trimmed)) return false;
  return true;
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

  const normalized = normalizeWebSearchSettings(value, { defaultEnabled: false });
  const count = Number.parseInt(value.count, 10);
  if (!Number.isFinite(count) || count <= 0 || count > WEB_SEARCH_MAX_COUNT) {
    throw new Error("webSearch.count invalid");
  }

  if (typeof value.enabled !== "boolean") {
    throw new Error("webSearch.enabled invalid");
  }
  if (typeof value.onlyMainContent !== "boolean") {
    throw new Error("webSearch.onlyMainContent invalid");
  }
  if (typeof value.blockAds !== "boolean") {
    throw new Error("webSearch.blockAds invalid");
  }
  if (typeof value.skipTlsVerification !== "boolean") {
    throw new Error("webSearch.skipTlsVerification invalid");
  }
  if (typeof value.jsRenderEnabled !== "boolean") {
    throw new Error("webSearch.jsRenderEnabled invalid");
  }
  if (!XCRAWL_DEVICE_OPTIONS.includes(normalized.device)) {
    throw new Error("webSearch.device invalid");
  }
  if (!XCRAWL_JS_RENDER_WAIT_UNTIL_OPTIONS.includes(normalized.jsRenderWaitUntil)) {
    throw new Error("webSearch.jsRenderWaitUntil invalid");
  }
  if (!isValidOptionalString(value.location, { maxLength: 80 })) {
    throw new Error("webSearch.location invalid");
  }
  if (!isValidOptionalString(value.language, { maxLength: 16, pattern: /^[a-z]{2,3}(?:-[a-z]{2,8})?$/i })) {
    throw new Error("webSearch.language invalid");
  }
  if (!isValidOptionalString(value.locale, { maxLength: 32 })) {
    throw new Error("webSearch.locale invalid");
  }
  if (!isValidOptionalString(value.proxyLocation, { maxLength: 8, pattern: /^[a-z]{2}$/i })) {
    throw new Error("webSearch.proxyLocation invalid");
  }

  return {
    ...normalized,
    count,
  };
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
  const thinkingLevel = normalizeString(value).toUpperCase();
  if (!GEMINI_PRO_THINKING_LEVELS.has(thinkingLevel)) {
    throw new Error("thinkingLevel invalid");
  }

  return thinkingLevel;
}

export function parseSeedThinkingLevel(value, { allowMinimal = true } = {}) {
  const thinkingLevel = normalizeString(value).toLowerCase();
  if (thinkingLevel === "minimal") {
    if (allowMinimal) return thinkingLevel;
    throw new Error("thinkingLevel invalid");
  }
  if (!SEED_THINKING_LEVELS.has(thinkingLevel)) {
    throw new Error("thinkingLevel invalid");
  }
  return thinkingLevel;
}

const MIMO_THINKING_LEVELS = new Set(["enabled", "disabled"]);

export function parseMiMoThinkingLevel(value) {
  const thinkingLevel = normalizeString(value).toLowerCase();
  if (!thinkingLevel) {
    return "enabled";
  }
  if (!MIMO_THINKING_LEVELS.has(thinkingLevel)) {
    throw new Error("thinkingLevel invalid");
  }
  return thinkingLevel;
}

export function parseMiniMaxThinkingLevel(value) {
  const thinkingLevel = normalizeString(value).toLowerCase();
  if (!thinkingLevel) {
    return "enabled";
  }
  if (!MIMO_THINKING_LEVELS.has(thinkingLevel)) {
    throw new Error("thinkingLevel invalid");
  }
  return thinkingLevel;
}

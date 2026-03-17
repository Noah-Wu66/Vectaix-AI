import {
  GEMINI_FLASH_MODEL,
  SEED_REASONING_LEVELS,
} from "@/lib/shared/models";

const OPENAI_REASONING_LEVELS = new Set(["none", "low", "medium", "high", "xhigh"]);
const CLAUDE_THINKING_LEVELS = new Set(["low", "medium", "high", "max"]);
const GEMINI_FLASH_THINKING_LEVELS = new Set(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
const GEMINI_PRO_THINKING_LEVELS = new Set(["LOW", "MEDIUM", "HIGH"]);
const SEED_THINKING_LEVELS = new Set(SEED_REASONING_LEVELS);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
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
  return value === true;
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

export function parseGeminiThinkingLevel(value, model) {
  const thinkingLevel = normalizeString(value).toUpperCase();
  const allowedLevels = model === GEMINI_FLASH_MODEL
    ? GEMINI_FLASH_THINKING_LEVELS
    : GEMINI_PRO_THINKING_LEVELS;

  if (!allowedLevels.has(thinkingLevel)) {
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

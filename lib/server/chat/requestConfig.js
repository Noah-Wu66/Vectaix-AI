import {
  GEMINI_FLASH_MODEL,
  SEED_REASONING_LEVELS,
} from "@/lib/shared/models";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  WEB_SEARCH_AUTH_INFO_LEVELS,
  WEB_SEARCH_INDUSTRIES,
  WEB_SEARCH_MAX_COUNT,
  WEB_SEARCH_MAX_HOSTS,
  buildCustomTimeRange,
  isValidTimeRange,
  normalizeHostList,
  normalizeWebSearchSettings,
} from "@/lib/shared/webSearch";

const OPENAI_REASONING_LEVELS = new Set(["none", "low", "medium", "high", "xhigh"]);
const CLAUDE_THINKING_LEVELS = new Set(["low", "medium", "high", "max"]);
const GEMINI_FLASH_THINKING_LEVELS = new Set(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
const GEMINI_PRO_THINKING_LEVELS = new Set(["LOW", "MEDIUM", "HIGH"]);
const SEED_THINKING_LEVELS = new Set(SEED_REASONING_LEVELS);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function splitHostEntries(value) {
  if (typeof value !== "string") return [];
  return value.split("|").map((item) => item.trim()).filter(Boolean);
}

function isValidHostEntry(value) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
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

  const timeRange = normalizeString(value.timeRange);
  if (!isValidTimeRange(timeRange)) {
    throw new Error("webSearch.timeRange invalid");
  }
  if (timeRange && timeRange.includes("..")) {
    const [startDate = "", endDate = ""] = timeRange.split("..");
    if (buildCustomTimeRange(startDate, endDate) !== timeRange) {
      throw new Error("webSearch.timeRange invalid");
    }
  }

  const sites = normalizeHostList(value.sites);
  const blockHosts = normalizeHostList(value.blockHosts);
  const siteEntries = splitHostEntries(value.sites);
  const blockHostEntries = splitHostEntries(value.blockHosts);
  if (siteEntries.length > WEB_SEARCH_MAX_HOSTS) {
    throw new Error("webSearch.sites invalid");
  }
  if (blockHostEntries.length > WEB_SEARCH_MAX_HOSTS) {
    throw new Error("webSearch.blockHosts invalid");
  }
  if (siteEntries.some((item) => !isValidHostEntry(item))) {
    throw new Error("webSearch.sites invalid");
  }
  if (blockHostEntries.some((item) => !isValidHostEntry(item))) {
    throw new Error("webSearch.blockHosts invalid");
  }

  if (!WEB_SEARCH_AUTH_INFO_LEVELS.includes(Number(value.authInfoLevel))) {
    throw new Error("webSearch.authInfoLevel invalid");
  }

  const industry = normalizeString(value.industry);
  if (!WEB_SEARCH_INDUSTRIES.includes(industry)) {
    throw new Error("webSearch.industry invalid");
  }

  if (typeof value.enabled !== "boolean") {
    throw new Error("webSearch.enabled invalid");
  }
  if (typeof value.needContent !== "boolean") {
    throw new Error("webSearch.needContent invalid");
  }
  if (typeof value.needUrl !== "boolean") {
    throw new Error("webSearch.needUrl invalid");
  }
  if (typeof value.queryRewrite !== "boolean") {
    throw new Error("webSearch.queryRewrite invalid");
  }

  return {
    ...normalized,
    count,
    timeRange,
    sites,
    blockHosts,
    industry,
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

export const WEB_SEARCH_PRESET_TIME_RANGES = Object.freeze([
  "",
  "OneDay",
  "OneWeek",
  "OneMonth",
  "OneYear",
]);

export const WEB_SEARCH_INDUSTRIES = Object.freeze(["", "finance", "game"]);
export const WEB_SEARCH_AUTH_INFO_LEVELS = Object.freeze([0, 1]);
export const WEB_SEARCH_MAX_COUNT = 50;
export const WEB_SEARCH_MAX_HOSTS = 5;

export const DEFAULT_WEB_SEARCH_SETTINGS = Object.freeze({
  enabled: true,
  count: 20,
  timeRange: "",
  needContent: false,
  needUrl: false,
  sites: "",
  blockHosts: "",
  authInfoLevel: 1,
  queryRewrite: false,
  industry: "",
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeCount(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, WEB_SEARCH_MAX_COUNT);
}

export function isValidWebSearchDate(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
}

export function buildCustomTimeRange(startDate, endDate) {
  const start = typeof startDate === "string" ? startDate.trim() : "";
  const end = typeof endDate === "string" ? endDate.trim() : "";
  if (!isValidWebSearchDate(start) || !isValidWebSearchDate(end)) return "";
  if (start > end) return "";
  return `${start}..${end}`;
}

export function splitCustomTimeRange(value) {
  if (typeof value !== "string") {
    return { startDate: "", endDate: "" };
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (!match) {
    return { startDate: "", endDate: "" };
  }
  return {
    startDate: match[1],
    endDate: match[2],
  };
}

export function isValidTimeRange(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (WEB_SEARCH_PRESET_TIME_RANGES.includes(trimmed)) return true;
  const { startDate, endDate } = splitCustomTimeRange(trimmed);
  return buildCustomTimeRange(startDate, endDate) === trimmed;
}

export function normalizeHostList(value) {
  if (typeof value !== "string") return "";
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, WEB_SEARCH_MAX_HOSTS)
    .join("|");
}

export function normalizeWebSearchSettings(value, { defaultEnabled = DEFAULT_WEB_SEARCH_SETTINGS.enabled } = {}) {
  const base = {
    ...DEFAULT_WEB_SEARCH_SETTINGS,
    enabled: defaultEnabled,
  };

  if (!isPlainObject(value)) {
    return base;
  }

  const timeRange = typeof value.timeRange === "string" && isValidTimeRange(value.timeRange)
    ? value.timeRange.trim()
    : base.timeRange;
  const industry = typeof value.industry === "string" && WEB_SEARCH_INDUSTRIES.includes(value.industry.trim())
    ? value.industry.trim()
    : base.industry;
  const authInfoLevel = WEB_SEARCH_AUTH_INFO_LEVELS.includes(Number(value.authInfoLevel))
    ? Number(value.authInfoLevel)
    : base.authInfoLevel;

  return {
    enabled: normalizeBoolean(value.enabled, base.enabled),
    count: normalizeCount(value.count, base.count),
    timeRange,
    needContent: normalizeBoolean(value.needContent, base.needContent),
    needUrl: normalizeBoolean(value.needUrl, base.needUrl),
    sites: normalizeHostList(value.sites),
    blockHosts: normalizeHostList(value.blockHosts),
    authInfoLevel,
    queryRewrite: normalizeBoolean(value.queryRewrite, base.queryRewrite),
    industry,
  };
}

export function isWebSearchEnabled(value) {
  return normalizeWebSearchSettings(value, { defaultEnabled: false }).enabled === true;
}

export function formatWebSearchSummary(settings) {
  const normalized = normalizeWebSearchSettings(settings, { defaultEnabled: false });
  const timeRangeLabel = {
    OneDay: "最近一天",
    OneWeek: "最近一周",
    OneMonth: "最近一月",
    OneYear: "最近一年",
  }[normalized.timeRange] || normalized.timeRange;
  const parts = [];
  parts.push(`${normalized.count}条`);
  if (timeRangeLabel) parts.push(timeRangeLabel);
  if (normalized.needContent) parts.push("带正文");
  if (normalized.needUrl) parts.push("带链接");
  if (normalized.authInfoLevel === 1) parts.push("仅非常权威");
  if (normalized.queryRewrite) parts.push("改写检索词");
  if (normalized.industry) parts.push(normalized.industry);
  if (normalized.sites) parts.push(`站点:${normalized.sites}`);
  if (normalized.blockHosts) parts.push(`屏蔽:${normalized.blockHosts}`);
  return parts.join(" · ");
}

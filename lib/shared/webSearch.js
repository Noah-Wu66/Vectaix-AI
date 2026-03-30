export const WEB_SEARCH_MAX_COUNT = 50;
export const XCRAWL_DEVICE_OPTIONS = Object.freeze(["desktop", "mobile"]);
export const XCRAWL_JS_RENDER_WAIT_UNTIL_OPTIONS = Object.freeze(["load", "domcontentloaded", "networkidle"]);

export const DEFAULT_WEB_SEARCH_SETTINGS = Object.freeze({
  enabled: true,
  count: 30,
  location: "",
  language: "",
  locale: "",
  device: "desktop",
  proxyLocation: "",
  onlyMainContent: true,
  blockAds: true,
  skipTlsVerification: true,
  jsRenderEnabled: true,
  jsRenderWaitUntil: "networkidle",
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

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeWebSearchSettings(value, { defaultEnabled = DEFAULT_WEB_SEARCH_SETTINGS.enabled } = {}) {
  const base = {
    ...DEFAULT_WEB_SEARCH_SETTINGS,
    enabled: defaultEnabled,
  };

  if (!isPlainObject(value)) {
    return base;
  }

  return {
    enabled: normalizeBoolean(value.enabled, base.enabled),
    count: normalizeCount(value.count, base.count),
    location: normalizeString(value.location, base.location),
    language: normalizeString(value.language, base.language),
    locale: normalizeString(value.locale, base.locale),
    device: XCRAWL_DEVICE_OPTIONS.includes(value.device) ? value.device : base.device,
    proxyLocation: normalizeString(value.proxyLocation, base.proxyLocation).toUpperCase(),
    onlyMainContent: normalizeBoolean(value.onlyMainContent, base.onlyMainContent),
    blockAds: normalizeBoolean(value.blockAds, base.blockAds),
    skipTlsVerification: normalizeBoolean(value.skipTlsVerification, base.skipTlsVerification),
    jsRenderEnabled: normalizeBoolean(value.jsRenderEnabled, base.jsRenderEnabled),
    jsRenderWaitUntil: XCRAWL_JS_RENDER_WAIT_UNTIL_OPTIONS.includes(value.jsRenderWaitUntil)
      ? value.jsRenderWaitUntil
      : base.jsRenderWaitUntil,
  };
}

export function isWebSearchEnabled(value) {
  return normalizeWebSearchSettings(value, { defaultEnabled: false }).enabled === true;
}

export function formatWebSearchSummary(settings) {
  const normalized = normalizeWebSearchSettings(settings, { defaultEnabled: false });
  const parts = [];
  parts.push(`${normalized.count}条`);
  if (normalized.location) parts.push(`地区:${normalized.location}`);
  if (normalized.language) parts.push(`语言:${normalized.language}`);
  if (normalized.device) parts.push(normalized.device === "mobile" ? "移动端" : "桌面端");
  if (normalized.proxyLocation) parts.push(`代理:${normalized.proxyLocation}`);
  if (normalized.onlyMainContent) parts.push("正文优先");
  if (!normalized.blockAds) parts.push("不过滤广告");
  if (!normalized.skipTlsVerification) parts.push("严格 TLS");
  if (!normalized.jsRenderEnabled) parts.push("关闭 JS 渲染");
  return parts.join(" · ");
}

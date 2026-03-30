export const WEB_SEARCH_MAX_COUNT = 50;

export const DEFAULT_WEB_SEARCH_SETTINGS = Object.freeze({
  enabled: true,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
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
  };
}

export function isWebSearchEnabled(value) {
  return normalizeWebSearchSettings(value, { defaultEnabled: false }).enabled === true;
}

export function formatWebSearchSummary(settings) {
  const normalized = normalizeWebSearchSettings(settings, { defaultEnabled: false });
  return normalized.enabled ? "已启用固定联网策略" : "已关闭";
}

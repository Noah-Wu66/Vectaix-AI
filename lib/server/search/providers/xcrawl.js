import { WEB_SEARCH_LIMIT } from "@/lib/server/chat/webSearchConfig";
import { WEB_SEARCH_MAX_COUNT } from "@/lib/shared/webSearch";

const XCRAWL_BASE_URL = "https://run.xcrawl.com";
const XCRAWL_SEARCH_TIMEOUT_MS = 30000;
const XCRAWL_SCRAPE_TIMEOUT_MS = 60000;
const DEFAULT_SEARCH_COUNT = 30;
const DEFAULT_DESKTOP_DEVICE = "desktop";
const DEFAULT_JS_RENDER_WAIT_UNTIL = "networkidle";

function getXCrawlApiKey() {
  const apiKey = typeof process.env.XCRAWL_API_KEY === "string" ? process.env.XCRAWL_API_KEY.trim() : "";
  if (!apiKey) {
    throw new Error("XCRAWL_API_KEY is not set");
  }
  return apiKey;
}

function buildRequestSignal({ timeoutMs, signal } = {}) {
  if (signal) {
    return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  }
  return AbortSignal.timeout(timeoutMs);
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function requestXCrawl(endpoint, body, { signal, timeoutMs } = {}) {
  const response = await fetch(`${XCRAWL_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getXCrawlApiKey()}`,
    },
    body: JSON.stringify(body),
    signal: buildRequestSignal({ timeoutMs, signal }),
  });

  const rawText = await response.text();
  const payload = parseJsonSafe(rawText);
  if (!response.ok) {
    const errorMessage = typeof payload?.error === "string"
      ? payload.error
      : rawText || `XCrawl request failed (${response.status})`;
    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("XCrawl returned invalid JSON");
  }

  return payload;
}

function normalizeQuery(query) {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) {
    throw new Error("Search query is empty");
  }
  return normalized;
}

function looksChineseQuery(query) {
  return /[\u3400-\u9fff]/.test(typeof query === "string" ? query : "");
}

function looksJapaneseQuery(query) {
  return /[\u3040-\u30ff]/.test(typeof query === "string" ? query : "");
}

function normalizeLanguageCode(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const [primary = ""] = trimmed.split(/[-_]/);
  return primary;
}

function normalizeCountryCode(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^[a-z]{2}$/i.test(trimmed)) return "";
  return trimmed.toUpperCase();
}

function inferLocaleFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.endsWith(".cn") || hostname.endsWith(".com.cn")) {
      return { location: "CN", language: "zh" };
    }
    if (hostname.endsWith(".jp")) {
      return { location: "JP", language: "ja" };
    }
    if (hostname.endsWith(".kr")) {
      return { location: "KR", language: "ko" };
    }
  } catch {}
  return { location: "", language: "" };
}

function resolveSearchLocale(query, options = {}) {
  const explicitLanguage = normalizeLanguageCode(options.language);
  const inferredLanguage = looksChineseQuery(query)
    ? "zh"
    : (looksJapaneseQuery(query) ? "ja" : "en");
  const language = explicitLanguage || inferredLanguage;

  const explicitLocation = typeof options.location === "string" && options.location.trim()
    ? options.location.trim()
    : "";
  const location = explicitLocation || (language === "zh" ? "CN" : (language === "ja" ? "JP" : "US"));
  return { location, language };
}

function resolveLocaleHeader({ locale, language, location }) {
  if (typeof locale === "string" && locale.trim()) {
    return locale.trim();
  }

  const normalizedLanguage = normalizeLanguageCode(language);
  const normalizedCountry = normalizeCountryCode(location);

  if (normalizedLanguage === "zh") {
    return `zh-${normalizedCountry || "CN"},zh;q=0.9,en;q=0.6`;
  }
  if (normalizedLanguage === "ja") {
    return `ja-${normalizedCountry || "JP"},ja;q=0.9,en;q=0.6`;
  }
  if (normalizedLanguage === "ko") {
    return `ko-${normalizedCountry || "KR"},ko;q=0.9,en;q=0.6`;
  }
  if (normalizedLanguage) {
    return normalizedCountry
      ? `${normalizedLanguage}-${normalizedCountry},${normalizedLanguage};q=0.9,en;q=0.6`
      : `${normalizedLanguage},${normalizedLanguage};q=0.9,en;q=0.6`;
  }
  return "en-US,en;q=0.9";
}

function resolveProxyLocation({ proxyLocation, location }) {
  const explicitProxy = normalizeCountryCode(proxyLocation);
  if (explicitProxy) return explicitProxy;
  return normalizeCountryCode(location);
}

function resolveSearchConfig(query, options = {}) {
  const { location, language } = resolveSearchLocale(query, options);
  return {
    location,
    language,
    limit: normalizeSearchLimit({ count: Number.isFinite(options?.count) ? options.count : DEFAULT_SEARCH_COUNT }),
  };
}

function resolveScrapeConfig(targetUrl, options = {}) {
  const inferredFromUrl = inferLocaleFromUrl(targetUrl);
  const searchDefaults = resolveSearchConfig("", {
    ...options,
    location: options?.location || inferredFromUrl.location,
    language: options?.language || inferredFromUrl.language,
  });
  const location = typeof options.location === "string" && options.location.trim()
    ? options.location.trim()
    : (inferredFromUrl.location || searchDefaults.location);
  const language = normalizeLanguageCode(options.language) || searchDefaults.language;

  return {
    proxyLocation: resolveProxyLocation({ proxyLocation: options.proxyLocation, location }),
    locale: resolveLocaleHeader({ locale: options.locale, language, location }),
    device: DEFAULT_DESKTOP_DEVICE,
    onlyMainContent: true,
    blockAds: true,
    skipTlsVerification: true,
    jsRenderEnabled: true,
    jsRenderWaitUntil: DEFAULT_JS_RENDER_WAIT_UNTIL,
  };
}

function normalizeSearchLimit(options = {}) {
  const count = Number.isFinite(options?.count) ? Number(options.count) : WEB_SEARCH_LIMIT;
  const normalized = Math.max(1, Math.floor(count || WEB_SEARCH_LIMIT));
  return Math.min(normalized, WEB_SEARCH_MAX_COUNT);
}

function toUniformSearchResult(item) {
  const position = Number.isFinite(item?.position) ? Number(item.position) : 0;
  const url = typeof item?.url === "string" ? item.url.trim() : "";
  return {
    category: "general",
    content: typeof item?.description === "string" ? item.description : "",
    engines: ["xcrawl-search"],
    parsedUrl: url,
    publishedDate: "",
    score: position > 0 ? 1 / position : 1,
    title: typeof item?.title === "string" ? item.title : "",
    url,
  };
}

export async function xcrawlSearch(query, options = {}) {
  const normalizedQuery = normalizeQuery(query);
  const resolved = resolveSearchConfig(normalizedQuery, options);
  const payload = await requestXCrawl("/v1/search", {
    query: normalizedQuery,
    location: resolved.location,
    language: resolved.language,
    limit: resolved.limit,
  }, {
    signal: options?.signal,
    timeoutMs: XCRAWL_SEARCH_TIMEOUT_MS,
  });

  const items = Array.isArray(payload?.data?.data) ? payload.data.data : [];
  return {
    payload,
    resolved,
    results: items.map(toUniformSearchResult).filter((item) => item.url),
  };
}

function extractSiteName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function normalizeContentType(value) {
  const contentType = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (contentType.includes("json")) return "json";
  return "text";
}

export async function xcrawlScrape(url, options = {}) {
  const targetUrl = typeof url === "string" ? url.trim() : "";
  if (!targetUrl) {
    throw new Error("Scrape url is empty");
  }

  const resolved = resolveScrapeConfig(targetUrl, options);

  const payload = await requestXCrawl("/v1/scrape", {
    url: targetUrl,
    mode: "sync",
    ...(resolved.proxyLocation
      ? { proxy: { location: resolved.proxyLocation } }
      : {}),
    request: {
      locale: resolved.locale,
      device: resolved.device,
      only_main_content: resolved.onlyMainContent,
      block_ads: resolved.blockAds,
      skip_tls_verification: resolved.skipTlsVerification,
    },
    js_render: {
      enabled: resolved.jsRenderEnabled,
      wait_until: resolved.jsRenderWaitUntil,
    },
    output: {
      formats: ["markdown"],
    },
  }, {
    signal: options?.signal,
    timeoutMs: XCRAWL_SCRAPE_TIMEOUT_MS,
  });

  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const finalUrl = typeof metadata.final_url === "string"
    ? metadata.final_url
    : (typeof metadata.url === "string" ? metadata.url : targetUrl);
  const content = typeof data?.markdown === "string" ? data.markdown.trim() : "";

  if (payload?.status !== "completed" && !content) {
    throw new Error(typeof payload?.status === "string" ? `XCrawl scrape ${payload.status}` : "XCrawl scrape failed");
  }

  return {
    crawler: "xcrawl",
    resolved,
    data: {
      content,
      contentType: normalizeContentType(metadata.content_type || metadata.contentType),
      description: typeof metadata.description === "string" ? metadata.description : "",
      length: content.length,
      siteName: extractSiteName(finalUrl),
      title: typeof metadata.title === "string" && metadata.title.trim() ? metadata.title.trim() : finalUrl,
      url: finalUrl,
    },
    originalUrl: targetUrl,
    status: Number.isFinite(metadata.status_code)
      ? Number(metadata.status_code)
      : (Number.isFinite(metadata.statusCode) ? Number(metadata.statusCode) : 200),
  };
}

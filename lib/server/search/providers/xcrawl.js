import { WEB_SEARCH_LIMIT } from "@/lib/server/chat/webSearchConfig";
import { WEB_SEARCH_MAX_COUNT } from "@/lib/shared/webSearch";

const XCRAWL_BASE_URL = "https://run.xcrawl.com";
const XCRAWL_SEARCH_TIMEOUT_MS = 30000;
const XCRAWL_SCRAPE_TIMEOUT_MS = 60000;
const FIXED_SEARCH_LIMIT = WEB_SEARCH_LIMIT;
const FIXED_SCRAPE_DEVICE = "desktop";
const FIXED_SCRAPE_ONLY_MAIN_CONTENT = true;
const FIXED_SCRAPE_BLOCK_ADS = true;
const FIXED_SCRAPE_SKIP_TLS_VERIFICATION = true;
const FIXED_SCRAPE_JS_RENDER_ENABLED = true;
const FIXED_SCRAPE_JS_RENDER_WAIT_UNTIL = "networkidle";
const FIXED_SCRAPE_VIEWPORT = Object.freeze({ width: 1920, height: 1080 });

function clipLogValue(value, maxLength = 240) {
  if (typeof value !== "string") return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function summarizeXCrawlBody(endpoint, body) {
  if (endpoint === "/v1/search") {
    return {
      query: clipLogValue(body?.query || ""),
      location: body?.location || "",
      language: body?.language || "",
      limit: body?.limit || 0,
    };
  }

  if (endpoint === "/v1/scrape") {
    return {
      url: clipLogValue(body?.url || ""),
      mode: body?.mode || "sync",
      proxyLocation: body?.proxy?.location || "",
      stickySession: body?.proxy?.sticky_session || "",
      locale: body?.request?.locale || "",
      device: body?.request?.device || "",
      waitUntil: body?.js_render?.wait_until || "",
      viewport: body?.js_render?.viewport || null,
      formats: Array.isArray(body?.output?.formats) ? body.output.formats : [],
    };
  }

  return { endpoint };
}

function summarizeXCrawlPayload(endpoint, payload) {
  if (endpoint === "/v1/search") {
    return {
      status: payload?.status || "",
      resultCount: Array.isArray(payload?.data?.data) ? payload.data.data.length : 0,
      upstreamStatus: payload?.data?.status || "",
      creditsUsed: payload?.data?.credits_used ?? payload?.total_credits_used ?? null,
    };
  }

  if (endpoint === "/v1/scrape") {
    return {
      status: payload?.status || "",
      hasMarkdown: typeof payload?.data?.markdown === "string" && payload.data.markdown.trim().length > 0,
      finalUrl: payload?.data?.metadata?.final_url || payload?.data?.metadata?.url || "",
      title: payload?.data?.metadata?.title || "",
      statusCode: payload?.data?.metadata?.status_code ?? payload?.data?.metadata?.statusCode ?? null,
      creditsUsed: payload?.data?.credits_used ?? payload?.total_credits_used ?? null,
    };
  }

  return { status: payload?.status || "" };
}

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
  console.info("[XCrawl] Request start", {
    endpoint,
    body: summarizeXCrawlBody(endpoint, body),
    timeoutMs,
  });

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
    console.error("[XCrawl] Request failed", {
      endpoint,
      status: response.status,
      body: summarizeXCrawlBody(endpoint, body),
      payload: payload && typeof payload === "object" ? summarizeXCrawlPayload(endpoint, payload) : clipLogValue(rawText || ""),
    });
    const errorMessage = typeof payload?.error === "string"
      ? payload.error
      : rawText || `XCrawl request failed (${response.status})`;
    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
  }

  if (!payload || typeof payload !== "object") {
    console.error("[XCrawl] Invalid JSON response", {
      endpoint,
      status: response.status,
      body: summarizeXCrawlBody(endpoint, body),
      rawText: clipLogValue(rawText || ""),
    });
    throw new Error("XCrawl returned invalid JSON");
  }

  console.info("[XCrawl] Request success", {
    endpoint,
    status: response.status,
    payload: summarizeXCrawlPayload(endpoint, payload),
  });

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

function resolveSearchLocale(query) {
  const inferredLanguage = looksChineseQuery(query)
    ? "zh"
    : (looksJapaneseQuery(query) ? "ja" : "en");
  const language = inferredLanguage;
  const location = language === "zh" ? "CN" : (language === "ja" ? "JP" : "US");
  return { location, language };
}

function resolveLocaleHeader({ language, location }) {
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

function resolveProxyLocation({ location }) {
  return normalizeCountryCode(location);
}

function resolveSearchConfig(query) {
  const { location, language } = resolveSearchLocale(query);
  return {
    location,
    language,
    limit: normalizeSearchLimit(),
  };
}

function resolveScrapeConfig(targetUrl, options = {}) {
  const inferredFromUrl = inferLocaleFromUrl(targetUrl);
  const preferredLocation = normalizeCountryCode(options.preferredLocation);
  const preferredLanguage = normalizeLanguageCode(options.preferredLanguage);
  const searchDefaults = resolveSearchConfig("");
  const location = inferredFromUrl.location || preferredLocation || searchDefaults.location;
  const language = inferredFromUrl.language || preferredLanguage || searchDefaults.language;

  return {
    proxyLocation: resolveProxyLocation({ location }),
    proxyStickySession: typeof options.proxyStickySession === "string" ? options.proxyStickySession.trim() : "",
    locale: resolveLocaleHeader({ language, location }),
    device: FIXED_SCRAPE_DEVICE,
    onlyMainContent: FIXED_SCRAPE_ONLY_MAIN_CONTENT,
    blockAds: FIXED_SCRAPE_BLOCK_ADS,
    skipTlsVerification: FIXED_SCRAPE_SKIP_TLS_VERIFICATION,
    jsRenderEnabled: FIXED_SCRAPE_JS_RENDER_ENABLED,
    jsRenderWaitUntil: FIXED_SCRAPE_JS_RENDER_WAIT_UNTIL,
    jsRenderViewportWidth: FIXED_SCRAPE_VIEWPORT.width,
    jsRenderViewportHeight: FIXED_SCRAPE_VIEWPORT.height,
  };
}

function normalizeSearchLimit() {
  const normalized = Math.max(1, Math.floor(FIXED_SEARCH_LIMIT || WEB_SEARCH_LIMIT));
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
  const resolved = resolveSearchConfig(normalizedQuery);
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
  if (items.length === 0) {
    console.warn("[XCrawl] Search returned no results", {
      query: clipLogValue(normalizedQuery),
      resolved,
      payload: summarizeXCrawlPayload("/v1/search", payload),
    });
  }
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
  const proxy = {};
  if (resolved.proxyLocation) proxy.location = resolved.proxyLocation;
  if (resolved.proxyStickySession) proxy.sticky_session = resolved.proxyStickySession;

  const jsRender = {
    enabled: resolved.jsRenderEnabled,
    wait_until: resolved.jsRenderWaitUntil,
  };
  if (resolved.jsRenderViewportWidth || resolved.jsRenderViewportHeight) {
    jsRender.viewport = {};
    if (resolved.jsRenderViewportWidth) jsRender.viewport.width = resolved.jsRenderViewportWidth;
    if (resolved.jsRenderViewportHeight) jsRender.viewport.height = resolved.jsRenderViewportHeight;
  }

  const payload = await requestXCrawl("/v1/scrape", {
    url: targetUrl,
    mode: "sync",
    ...(Object.keys(proxy).length > 0 ? { proxy } : {}),
    request: {
      locale: resolved.locale,
      device: resolved.device,
      only_main_content: resolved.onlyMainContent,
      block_ads: resolved.blockAds,
      skip_tls_verification: resolved.skipTlsVerification,
    },
    js_render: jsRender,
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

  if (!content) {
    console.warn("[XCrawl] Scrape returned empty content", {
      url: clipLogValue(targetUrl),
      resolved,
      payload: summarizeXCrawlPayload("/v1/scrape", payload),
    });
  }

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

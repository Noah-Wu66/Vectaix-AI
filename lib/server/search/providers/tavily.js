import { tavily } from "@tavily/core";
import { WEB_SEARCH_LIMIT } from "@/lib/server/chat/webSearchConfig";
import { WEB_SEARCH_MAX_COUNT } from "@/lib/shared/webSearch";

const TAVILY_SEARCH_TIMEOUT_MS = 30000;
const TAVILY_EXTRACT_TIMEOUT_MS = 60000;
const TAVILY_SEARCH_DEPTH = "advanced";
const TAVILY_EXTRACT_DEPTH = "advanced";
const TAVILY_EXTRACT_FORMAT = "markdown";

function getTavilyApiKey() {
  const apiKey = typeof process.env.TAVILY_API_KEY === "string" ? process.env.TAVILY_API_KEY.trim() : "";
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not set");
  }
  return apiKey;
}

function createTavilyClient() {
  return tavily({ apiKey: getTavilyApiKey() });
}

function createAbortError() {
  const error = new Error("Tavily request aborted");
  error.name = "AbortError";
  return error;
}

async function withTimeout(operation, { signal, timeoutMs, timeoutMessage }) {
  if (signal?.aborted) {
    throw createAbortError();
  }

  let timeoutId = null;
  let abortHandler = null;
  const control = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(timeoutMessage || "Tavily request timed out");
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);

    if (signal) {
      abortHandler = () => reject(createAbortError());
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });

  try {
    return await Promise.race([operation(), control]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

function normalizeQuery(query) {
  const normalized = typeof query === "string" ? query.trim() : "";
  if (!normalized) {
    throw new Error("Search query is empty");
  }
  return normalized.slice(0, 400);
}

function normalizeSearchLimit() {
  const normalized = Math.max(1, Math.floor(WEB_SEARCH_LIMIT || 20));
  return Math.min(normalized, WEB_SEARCH_MAX_COUNT, 20);
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toUniformSearchResult(item) {
  const url = normalizeText(item?.url);
  return {
    category: "general",
    content: normalizeText(item?.content || item?.rawContent || item?.raw_content),
    engines: ["tavily-search"],
    parsedUrl: url,
    publishedDate: normalizeText(item?.publishedDate || item?.published_date || item?.date),
    score: normalizeScore(item?.score),
    title: normalizeText(item?.title) || url,
    url,
  };
}

export async function tavilySearch(query, options = {}) {
  const normalizedQuery = normalizeQuery(query);
  const limit = normalizeSearchLimit();
  const client = createTavilyClient();
  const payload = await withTimeout(
    () => client.search(normalizedQuery, {
      searchDepth: TAVILY_SEARCH_DEPTH,
      topic: "general",
      maxResults: limit,
      includeAnswer: false,
      includeRawContent: false,
      includeImages: false,
    }),
    {
      signal: options?.signal,
      timeoutMs: TAVILY_SEARCH_TIMEOUT_MS,
      timeoutMessage: "Tavily search timed out",
    }
  );

  const items = Array.isArray(payload?.results) ? payload.results : [];
  return {
    payload,
    resolved: {
      limit,
      searchDepth: TAVILY_SEARCH_DEPTH,
    },
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

function getFailedExtractMessage(payload, targetUrl) {
  const failedResults = Array.isArray(payload?.failedResults)
    ? payload.failedResults
    : (Array.isArray(payload?.failed_results) ? payload.failed_results : []);
  const failed = failedResults.find((item) => item?.url === targetUrl) || failedResults[0];
  return normalizeText(failed?.error) || "Tavily extract failed";
}

export async function tavilyExtract(url, options = {}) {
  const targetUrl = normalizeText(url);
  if (!targetUrl) {
    throw new Error("Extract url is empty");
  }

  const client = createTavilyClient();
  const payload = await withTimeout(
    () => client.extract([targetUrl], {
      extractDepth: TAVILY_EXTRACT_DEPTH,
      format: TAVILY_EXTRACT_FORMAT,
      includeImages: false,
    }),
    {
      signal: options?.signal,
      timeoutMs: TAVILY_EXTRACT_TIMEOUT_MS,
      timeoutMessage: "Tavily extract timed out",
    }
  );

  const results = Array.isArray(payload?.results) ? payload.results : [];
  const item = results.find((entry) => normalizeText(entry?.url) === targetUrl) || results[0];
  if (!item) {
    throw new Error(getFailedExtractMessage(payload, targetUrl));
  }

  const finalUrl = normalizeText(item?.url) || targetUrl;
  const content = normalizeText(item?.rawContent || item?.raw_content || item?.content);
  if (!content) {
    throw new Error(getFailedExtractMessage(payload, targetUrl));
  }

  return {
    crawler: "tavily",
    resolved: {
      extractDepth: TAVILY_EXTRACT_DEPTH,
      format: TAVILY_EXTRACT_FORMAT,
    },
    data: {
      content,
      contentType: "text",
      description: "",
      length: content.length,
      siteName: extractSiteName(finalUrl),
      title: normalizeText(item?.title) || finalUrl,
      url: finalUrl,
    },
    originalUrl: targetUrl,
    status: 200,
  };
}

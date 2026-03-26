import { volcengineWebSearchResults } from "@/lib/server/search/providers/volcengine";
import {
  WEB_BROWSING_CRAWL_CONTENT_LIMIT,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
} from "@/lib/server/webBrowsing/types";

const DEFAULT_CRAWL_CONCURRENCY = 3;
const DEFAULT_FETCH_TIMEOUT_MS = 20000;
const TEXT_LIKE_CONTENT_TYPE_PATTERN = /^(text\/|application\/(json|xml|xhtml\+xml))/i;

function mapSearchTimeRange(value) {
  switch (value) {
    case "day":
      return "OneDay";
    case "week":
      return "OneWeek";
    case "month":
      return "OneMonth";
    case "year":
      return "OneYear";
    default:
      return "";
  }
}

function normalizeVolcengineTimeRange(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "anytime") return "";
  return mapSearchTimeRange(trimmed) || trimmed;
}

function buildSearchConstraints(webSearchOptions = {}) {
  return {
    authInfoLevel: Number(webSearchOptions?.authInfoLevel) === 1 ? 1 : 0,
    blockHosts: typeof webSearchOptions?.blockHosts === "string" ? webSearchOptions.blockHosts : "",
    count: Number.isFinite(webSearchOptions?.count) ? webSearchOptions.count : undefined,
    industry: typeof webSearchOptions?.industry === "string" ? webSearchOptions.industry : "",
    needContent: true,
    needUrl: true,
    queryRewrite: webSearchOptions?.queryRewrite === true,
    sites: typeof webSearchOptions?.sites === "string" ? webSearchOptions.sites : "",
    timeRange: normalizeVolcengineTimeRange(webSearchOptions?.timeRange),
  };
}

function buildSearchTimeRange(searchTimeRange, webSearchOptions = {}) {
  const constrained = buildSearchConstraints(webSearchOptions).timeRange;
  if (constrained) return constrained;
  return normalizeVolcengineTimeRange(searchTimeRange);
}

function buildUniformSearchResult(item) {
  return {
    category: "general",
    content: typeof item?.snippet === "string" ? item.snippet : "",
    engines: ["volcengine"],
    parsedUrl: typeof item?.url === "string" ? item.url : "",
    publishedDate: typeof item?.datePublished === "string" ? item.datePublished : "",
    score: 1,
    title: typeof item?.title === "string" ? item.title : "",
    url: typeof item?.url === "string" ? item.url : "",
  };
}

function decodeHtmlEntities(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function stripHtmlToText(html) {
  if (typeof html !== "string" || !html) return "";
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|canvas|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|tr|table|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function extractHtmlTitle(html) {
  if (typeof html !== "string" || !html) return "";
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(titleMatch?.[1] || "").trim();
}

function extractMetaDescription(html) {
  if (typeof html !== "string" || !html) return "";
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);
  return decodeHtmlEntities(match?.[1] || "").trim();
}

function extractSiteName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function buildCrawlSuccessResult(url, response, rawText, contentType) {
  const text = TEXT_LIKE_CONTENT_TYPE_PATTERN.test(contentType)
    ? rawText
    : "";
  const isHtml = /html/i.test(contentType);
  const normalizedContent = (isHtml ? stripHtmlToText(text) : text).slice(0, WEB_BROWSING_CRAWL_CONTENT_LIMIT);
  const title = isHtml ? extractHtmlTitle(text) : "";
  const description = isHtml ? extractMetaDescription(text) : "";

  return {
    crawler: "fetch",
    data: {
      content: normalizedContent,
      contentType: /json/i.test(contentType) ? "json" : "text",
      description,
      length: normalizedContent.length,
      siteName: extractSiteName(url),
      title: title || url,
      url,
    },
    originalUrl: url,
    status: response.status,
  };
}

function buildCrawlErrorResult(url, error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown crawl error");
  const name = error instanceof Error ? error.name : "FetchError";
  return {
    crawler: "fetch",
    data: {
      content: `Fail to crawl the page. Error type: ${name}, error message: ${message}`,
      errorMessage: message,
      errorType: name,
    },
    originalUrl: url,
  };
}

async function fetchPage(url, { signal } = {}) {
  try {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)])
      : AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "Vectaix-AI-WebBrowsing/1.0",
      },
      redirect: "follow",
      signal: requestSignal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!TEXT_LIKE_CONTENT_TYPE_PATTERN.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
    }

    const rawText = await response.text();
    return buildCrawlSuccessResult(url, response, rawText, contentType);
  } catch (error) {
    return buildCrawlErrorResult(url, error);
  }
}

async function mapWithConcurrency(items, worker, concurrency) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(concurrency) || DEFAULT_CRAWL_CONCURRENCY);
  const results = new Array(list.length);
  let cursor = 0;

  const run = async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, list.length || 1) }, run));
  return results;
}

export class SearchService {
  constructor(options = {}) {
    this.webSearchOptions = options?.webSearchOptions || {};
    this.crawlConcurrency = options?.crawlConcurrency || DEFAULT_CRAWL_CONCURRENCY;
  }

  async webSearch({ query, searchCategories, searchEngines, searchTimeRange }, options = {}) {
    try {
      const constraints = buildSearchConstraints(this.webSearchOptions);
      const startedAt = Date.now();
      const data = await volcengineWebSearchResults(query, {
        ...constraints,
        count: constraints.count,
        needContent: true,
        needUrl: true,
        signal: options?.signal,
        timeRange: buildSearchTimeRange(searchTimeRange, this.webSearchOptions),
      });
      const results = (Array.isArray(data?.results) ? data.results : [])
        .slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT)
        .map(buildUniformSearchResult)
        .filter((item) => item.url);

      return {
        costTime: Date.now() - startedAt,
        query,
        resultNumbers: results.length,
        results,
        searchCategories: Array.isArray(searchCategories) ? searchCategories : undefined,
        searchEngines: Array.isArray(searchEngines) ? searchEngines : undefined,
      };
    } catch (error) {
      return {
        costTime: 0,
        errorDetail: error instanceof Error ? error.message : String(error || "Search failed"),
        query,
        resultNumbers: 0,
        results: [],
      };
    }
  }

  async crawlPages({ urls }, options = {}) {
    const safeUrls = Array.isArray(urls)
      ? urls.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [];
    const results = await mapWithConcurrency(
      safeUrls,
      (url) => fetchPage(url, { signal: options?.signal }),
      this.crawlConcurrency
    );
    return { results };
  }
}

import { xcrawlScrape, xcrawlSearch } from "@/lib/server/search/providers/xcrawl";
import {
  WEB_BROWSING_CRAWL_CONTENT_LIMIT,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
} from "@/lib/server/webBrowsing/types";

const DEFAULT_CRAWL_CONCURRENCY = 3;

function createStickySessionId() {
  return `vectaix_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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
    this.proxyStickySession = createStickySessionId();
    this.lastResolvedSearchContext = null;
  }

  async webSearch({ query }, options = {}) {
    try {
      const startedAt = Date.now();
      console.info("[WebSearch] Search start", {
        query,
      });
      const data = await xcrawlSearch(query, {
        ...this.webSearchOptions,
        signal: options?.signal,
      });
      const results = (Array.isArray(data?.results) ? data.results : []).slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT);
      this.lastResolvedSearchContext = {
        location: typeof data?.resolved?.location === "string" ? data.resolved.location : "",
        language: typeof data?.resolved?.language === "string" ? data.resolved.language : "",
      };

      console.info("[WebSearch] Search complete", {
        query,
        resultCount: results.length,
        location: this.lastResolvedSearchContext.location,
        language: this.lastResolvedSearchContext.language,
        costTimeMs: Date.now() - startedAt,
      });

      return {
        costTime: Date.now() - startedAt,
        query,
        resultNumbers: results.length,
        results,
        location: data?.resolved?.location,
        language: data?.resolved?.language,
      };
    } catch (error) {
      console.error("[WebSearch] Search failed", {
        query,
        message: error instanceof Error ? error.message : String(error || "Search failed"),
      });
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
      async (url) => {
        try {
          console.info("[WebSearch] Scrape start", {
            url,
            preferredLocation: this.lastResolvedSearchContext?.location || "",
            preferredLanguage: this.lastResolvedSearchContext?.language || "",
          });
          const result = await xcrawlScrape(url, {
            ...this.webSearchOptions,
            preferredLocation: this.lastResolvedSearchContext?.location || "",
            preferredLanguage: this.lastResolvedSearchContext?.language || "",
            proxyStickySession: this.proxyStickySession,
            signal: options?.signal,
          });
          if (typeof result?.data?.content === "string") {
            result.data.content = result.data.content.slice(0, WEB_BROWSING_CRAWL_CONTENT_LIMIT);
            result.data.length = result.data.content.length;
          }
          console.info("[WebSearch] Scrape complete", {
            url,
            finalUrl: result?.data?.url || "",
            title: result?.data?.title || "",
            contentLength: result?.data?.length || 0,
            status: result?.status || 0,
          });
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "Unknown crawl error");
          const name = error instanceof Error ? error.name : "XCrawlScrapeError";
          console.error("[WebSearch] Scrape failed", {
            url,
            errorType: name,
            message,
          });
          return {
            crawler: "xcrawl",
            data: {
              content: `Fail to crawl the page. Error type: ${name}, error message: ${message}`,
              errorMessage: message,
              errorType: name,
            },
            originalUrl: url,
          };
        }
      },
      this.crawlConcurrency
    );
    return { results };
  }
}

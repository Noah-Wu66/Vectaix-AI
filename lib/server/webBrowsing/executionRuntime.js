import { crawlResultsPrompt } from "@/lib/server/webBrowsing/crawlResultsPrompt";
import { searchResultsPrompt } from "@/lib/server/webBrowsing/searchResultsPrompt";
import {
  WEB_BROWSING_CRAWL_CONTENT_LIMIT,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
} from "@/lib/server/webBrowsing/types";

export class WebBrowsingExecutionRuntime {
  constructor(options = {}) {
    this.searchService = options?.searchService;
  }

  async search(args, options = {}) {
    try {
      const data = await this.searchService.webSearch(args || {}, options);

      if (data?.errorDetail) {
        return {
          content: data.errorDetail,
          error: { message: data.errorDetail },
          state: data,
          success: false,
        };
      }

      const searchContent = Array.isArray(data?.results)
        ? data.results.slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT).map((item) => ({
          title: item.title,
          url: item.url,
          ...(item.content ? { content: item.content } : {}),
          ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
          ...(item.imgSrc ? { imgSrc: item.imgSrc } : {}),
          ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}),
        }))
        : [];

      return {
        content: searchResultsPrompt(searchContent),
        state: data,
        success: true,
      };
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : String(error || "Search failed"),
        error,
        success: false,
      };
    }
  }

  async crawlSinglePage(args, options = {}) {
    const url = typeof args?.url === "string" ? args.url : "";
    return this.crawlMultiPages({ urls: url ? [url] : [] }, options);
  }

  async crawlMultiPages(args, options = {}) {
    const response = await this.searchService.crawlPages({
      urls: Array.isArray(args?.urls) ? args.urls : [],
    }, options);

    const content = Array.isArray(response?.results)
      ? response.results.map((item) => {
        const data = item?.data || {};
        if (data?.errorMessage) {
          return {
            errorMessage: data.errorMessage,
            errorType: data.errorType || "FetchError",
            url: item?.originalUrl || "",
          };
        }

        return {
          content: typeof data?.content === "string"
            ? data.content.slice(0, WEB_BROWSING_CRAWL_CONTENT_LIMIT)
            : "",
          contentType: data?.contentType || "text",
          description: data?.description || "",
          length: Number.isFinite(data?.length) ? data.length : undefined,
          siteName: data?.siteName || "",
          title: data?.title || item?.originalUrl || "",
          url: data?.url || item?.originalUrl || "",
        };
      })
      : [];

    return {
      content: crawlResultsPrompt(content),
      state: response,
      success: true,
    };
  }
}

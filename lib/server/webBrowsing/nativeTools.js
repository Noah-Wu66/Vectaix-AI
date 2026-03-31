import { WebBrowsingExecutionRuntime } from "@/lib/server/webBrowsing/executionRuntime";
import { SearchService } from "@/lib/server/webBrowsing/searchService";
import {
  WEB_BROWSING_IDENTIFIER,
  WEB_BROWSING_MAX_ROUNDS,
  WEB_BROWSING_SEARCH_ITEM_LIMIT,
  WebBrowsingApiName,
} from "@/lib/server/webBrowsing/types";

function buildSearchParameters() {
  return {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query in the user's language.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  };
}

function buildCrawlSingleParameters() {
  return {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "A single URL to fetch and read.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  };
}

function buildCrawlMultiParameters() {
  return {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "A small list of URLs to fetch and read.",
      },
    },
    required: ["urls"],
    additionalProperties: false,
  };
}

export function createWebBrowsingRuntime({ webSearchOptions } = {}) {
  return new WebBrowsingExecutionRuntime({
    searchService: new SearchService({ webSearchOptions }),
  });
}

function buildSharedToolDefinitions() {
  return [
    {
      name: WebBrowsingApiName.search,
      description: "Search the web for fresh information before answering.",
      parameters: buildSearchParameters(),
    },
    {
      name: WebBrowsingApiName.crawlSinglePage,
      description: "Fetch one page when an official source or exact page needs reading.",
      parameters: buildCrawlSingleParameters(),
    },
    {
      name: WebBrowsingApiName.crawlMultiPages,
      description: "Fetch a few exact pages when multiple sources need verification.",
      parameters: buildCrawlMultiParameters(),
    },
  ];
}

export function getDeepSeekWebTools() {
  return buildSharedToolDefinitions().map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function getOpenAIWebTools() {
  return buildSharedToolDefinitions().map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  }));
}

export function getAnthropicWebTools() {
  return buildSharedToolDefinitions().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

export function getGeminiWebTools() {
  return [{
    functionDeclarations: buildSharedToolDefinitions(),
  }];
}

function normalizeSearchArguments(input) {
  const args = input && typeof input === "object" ? input : {};
  return {
    query: typeof args.query === "string" ? args.query.trim() : "",
  };
}

function normalizeCrawlSingleArguments(input) {
  const args = input && typeof input === "object" ? input : {};
  return {
    url: typeof args.url === "string" ? args.url.trim() : "",
  };
}

function normalizeCrawlMultiArguments(input) {
  const args = input && typeof input === "object" ? input : {};
  return {
    urls: Array.isArray(args.urls)
      ? args.urls.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [],
  };
}

function buildEventSearchResults(results) {
  if (!Array.isArray(results)) return [];
  return results
    .slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT)
    .map((item) => ({
      url: item?.url || "",
      title: item?.title || item?.url || "",
      datePublished: item?.publishedDate || "",
      siteName: (() => {
        try {
          return new URL(item?.url || "").hostname.replace(/^www\./i, "");
        } catch {
          return "";
        }
      })(),
    }))
    .filter((item) => item.url);
}

function buildEventPageResults(results) {
  if (!Array.isArray(results)) return [];
  return results
    .slice(0, WEB_BROWSING_SEARCH_ITEM_LIMIT)
    .map((item) => {
      const data = item?.data || {};
      return {
        title: data?.title || item?.originalUrl || "",
        url: data?.url || item?.originalUrl || "",
        errorMessage: data?.errorMessage || "",
      };
    })
    .filter((item) => item.url || item.errorMessage);
}

function pushSearchCitations(pushCitations, state) {
  if (typeof pushCitations !== "function") return;
  const citations = Array.isArray(state?.results)
    ? state.results
      .filter((item) => item?.url)
      .map((item) => ({
        url: item.url,
        title: item.title || item.url,
        cited_text: typeof item?.content === "string" ? item.content : "",
      }))
    : [];
  if (citations.length > 0) pushCitations(citations);
}

function pushCrawlCitations(pushCitations, state) {
  if (typeof pushCitations !== "function") return;
  const citations = Array.isArray(state?.results)
    ? state.results
      .map((item) => {
        const data = item?.data || {};
        const url = data?.url || item?.originalUrl || "";
        if (!url) return null;
        return {
          url,
          title: data?.title || url,
          cited_text: typeof data?.content === "string" ? data.content : "",
        };
      })
      .filter(Boolean)
    : [];
  if (citations.length > 0) pushCitations(citations);
}

function buildToolRecord({ apiName, args, result }) {
  return {
    id: `${WEB_BROWSING_IDENTIFIER}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    identifier: WEB_BROWSING_IDENTIFIER,
    apiName,
    arguments: args,
    type: "builtin",
    status: result?.success === false ? "error" : "success",
    content: typeof result?.content === "string" ? result.content : "",
    state: result?.state,
  };
}

function parseArguments(argumentsInput) {
  if (typeof argumentsInput === "string") {
    try {
      return JSON.parse(argumentsInput);
    } catch {
      return {};
    }
  }
  return argumentsInput && typeof argumentsInput === "object" ? argumentsInput : {};
}

function summarizeToolResult(result) {
  const success = result?.success !== false;
  return {
    success,
    resultCount: Array.isArray(result?.state?.results) ? result.state.results.length : 0,
    hasContent: success && typeof result?.content === "string" && result.content.trim().length > 0,
    errorMessage: success ? "" : (result?.content || ""),
  };
}

export async function executeWebBrowsingNativeToolCall({
  apiName,
  argumentsInput,
  runtime,
  sendEvent,
  pushCitations,
  round = 1,
  signal,
}) {
  const rawArgs = parseArguments(argumentsInput);

  if (apiName === WebBrowsingApiName.search) {
    const args = normalizeSearchArguments(rawArgs);
    console.info("[WebSearchTool] Execute search", {
      round,
      query: args.query,
    });
    sendEvent?.({ type: "search_start", round, query: args.query });
    const result = await runtime.search(args, { signal });
    console.info("[WebSearchTool] Search result", {
      round,
      query: args.query,
      summary: summarizeToolResult(result),
    });
    if (result.success) {
      pushSearchCitations(pushCitations, result.state);
      sendEvent?.({
        type: "search_result",
        round,
        query: args.query,
        results: buildEventSearchResults(result.state?.results),
      });
    } else {
      sendEvent?.({
        type: "search_error",
        round,
        query: args.query,
        message: result?.content || "联网搜索失败",
      });
    }
    return {
      args,
      result,
      toolRecord: buildToolRecord({ apiName, args, result }),
      outputText: typeof result?.content === "string" ? result.content : "",
    };
  }

  if (apiName === WebBrowsingApiName.crawlSinglePage || apiName === WebBrowsingApiName.crawlMultiPages) {
    const args = apiName === WebBrowsingApiName.crawlSinglePage
      ? normalizeCrawlSingleArguments(rawArgs)
      : normalizeCrawlMultiArguments(rawArgs);
    const urls = apiName === WebBrowsingApiName.crawlSinglePage ? [args.url] : args.urls;
    console.info("[WebSearchTool] Execute scrape", {
      round,
      apiName,
      urls,
    });
    sendEvent?.({
      type: "page_fetch_start",
      round,
      urls,
      url: urls[0] || "",
    });
    const result = apiName === WebBrowsingApiName.crawlSinglePage
      ? await runtime.crawlSinglePage(args, { signal })
      : await runtime.crawlMultiPages(args, { signal });
    console.info("[WebSearchTool] Scrape result", {
      round,
      apiName,
      urls,
      summary: summarizeToolResult(result),
    });
    if (result.success) {
      pushCrawlCitations(pushCitations, result.state);
      sendEvent?.({
        type: "page_fetch_result",
        round,
        urls,
        url: urls[0] || "",
        results: buildEventPageResults(result.state?.results),
      });
    } else {
      sendEvent?.({
        type: "page_fetch_error",
        round,
        urls,
        url: urls[0] || "",
        message: result?.content || "页面抓取失败",
      });
    }
    return {
      args,
      result,
      toolRecord: buildToolRecord({ apiName, args, result }),
      outputText: typeof result?.content === "string" ? result.content : "",
    };
  }

  return {
    args: {},
    result: {
      success: false,
      content: `Unsupported tool: ${apiName || "unknown"}`,
      state: null,
    },
    toolRecord: buildToolRecord({
      apiName,
      args: {},
      result: {
        success: false,
        content: `Unsupported tool: ${apiName || "unknown"}`,
        state: null,
      },
    }),
    outputText: `Unsupported tool: ${apiName || "unknown"}`,
  };
}

export { WEB_BROWSING_MAX_ROUNDS };

import {
  WEB_BROWSING_IDENTIFIER,
  WEB_BROWSING_SEARCH_CATEGORIES,
  WEB_BROWSING_SEARCH_ENGINES,
  WEB_BROWSING_TIME_RANGES,
  WebBrowsingApiName,
} from "@/lib/server/webBrowsing/types";

export const WebBrowsingManifest = Object.freeze({
  api: [
    {
      description: "a search service. Useful for current information lookups. Input should be a search query. Output is a structured XML search result list.",
      name: WebBrowsingApiName.search,
      parameters: {
        properties: {
          query: {
            description: "The search query",
            type: "string",
          },
          searchCategories: {
            description: "The search categories you can set",
            items: {
              enum: [...WEB_BROWSING_SEARCH_CATEGORIES],
              type: "string",
            },
            type: "array",
          },
          searchEngines: {
            description: "The search engines you can use",
            items: {
              enum: [...WEB_BROWSING_SEARCH_ENGINES],
              type: "string",
            },
            type: "array",
          },
          searchTimeRange: {
            description: "The time range you can set",
            enum: [...WEB_BROWSING_TIME_RANGES],
            type: "string",
          },
        },
        required: ["query"],
        type: "object",
      },
    },
    {
      description: "A crawler can visit page content. Output is a structured XML object containing title, content, url and metadata.",
      name: WebBrowsingApiName.crawlSinglePage,
      parameters: {
        properties: {
          url: {
            description: "The url to be crawled",
            type: "string",
          },
        },
        required: ["url"],
        type: "object",
      },
    },
    {
      description: "A crawler can visit multiple pages. If you need to inspect several pages, use this one. Output is a structured XML list of pages.",
      name: WebBrowsingApiName.crawlMultiPages,
      parameters: {
        properties: {
          urls: {
            items: {
              description: "The urls to be crawled",
              type: "string",
            },
            type: "array",
          },
        },
        required: ["urls"],
        type: "object",
      },
    },
  ],
  identifier: WEB_BROWSING_IDENTIFIER,
  meta: {
    avatar: "🌐",
    description: "Search the web for current information and crawl web pages to extract content.",
    readme: "Search the web for current information and crawl web pages to extract content.",
    title: "Web Browsing",
  },
  type: "builtin",
});

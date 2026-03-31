import {
  WEB_BROWSING_IDENTIFIER,
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

import {
  WEB_BROWSING_IDENTIFIER,
  WebBrowsingApiName,
} from "@/lib/server/webBrowsing/types";

export const WebBrowsingManifest = Object.freeze({
  api: [
    {
      description: "A search service for current information lookups. One answer may use at most five rounds, and each round may search once.",
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
      description: "A crawler can read exactly one page from the latest search results. Output is a structured XML object containing title, content, url and metadata.",
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

export const WebBrowsingApiName = Object.freeze({
  search: "search",
  crawlSinglePage: "crawlSinglePage",
  crawlMultiPages: "crawlMultiPages",
});

export const WEB_BROWSING_IDENTIFIER = "lobe-web-browsing";
export const WEB_BROWSING_SEARCH_ITEM_LIMIT = 20;
export const WEB_BROWSING_CRAWL_CONTENT_LIMIT = 25000;
export const WEB_BROWSING_MAX_ROUNDS = 5;
export const WEB_BROWSING_ACTION_MAX_OUTPUT_TOKENS = 900;

export const WEB_BROWSING_SEARCH_CATEGORIES = Object.freeze([
  "general",
  "images",
  "news",
  "science",
  "videos",
]);

export const WEB_BROWSING_SEARCH_ENGINES = Object.freeze([
  "google",
  "bilibili",
  "bing",
  "duckduckgo",
  "npm",
  "pypi",
  "github",
  "arxiv",
  "google scholar",
  "z-library",
  "reddit",
  "imdb",
  "brave",
  "wikipedia",
  "pinterest",
  "unsplash",
  "vimeo",
  "youtube",
]);

export const WEB_BROWSING_TIME_RANGES = Object.freeze([
  "anytime",
  "day",
  "week",
  "month",
  "year",
]);

export const WebBrowsingApiName = Object.freeze({
  search: "search",
  crawlSinglePage: "crawlSinglePage",
  crawlMultiPages: "crawlMultiPages",
});

export const WEB_BROWSING_IDENTIFIER = "vectaix-web-browsing";

export function isWebBrowsingIdentifier(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === WEB_BROWSING_IDENTIFIER || normalized.endsWith("-web-browsing");
}

export function normalizeWebBrowsingIdentifier(value) {
  if (isWebBrowsingIdentifier(value)) return WEB_BROWSING_IDENTIFIER;
  return typeof value === "string" ? value.trim() : "";
}

export function getWebBrowsingToolTitle(apiName) {
  if (apiName === WebBrowsingApiName.search) return "联网搜索";
  if (apiName === WebBrowsingApiName.crawlSinglePage) return "浏览网页";
  if (apiName === WebBrowsingApiName.crawlMultiPages) return "浏览网页";
  return "联网工具";
}

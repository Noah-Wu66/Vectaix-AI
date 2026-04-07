export const WEB_SEARCH_PROVIDER = "xcrawl";
export const WEB_SEARCH_LIMIT = 30;
export const WEB_SEARCH_UPSTREAM_QPS = 5;
export const WEB_SEARCH_MIN_REQUEST_INTERVAL_MS = Math.ceil(1000 / WEB_SEARCH_UPSTREAM_QPS);
export const WEB_SEARCH_GUIDE_TEXT = [
  "When a factual statement depends on web results, cite the supporting source within the same section of the reply.",
  "Do not place citations inside sentences or immediately after a clause.",
  "For each major section, numbered item, or top-level bullet, collect the supporting sources and place them on a dedicated final line in that section, for example: 来源：juejin.cn、36kr.com。",
  "Use only the hostname or subdomain. Never include protocol, path, query string, or a full URL, and omit a leading www. when present.",
  "Do not attach every source to the very end of the whole answer mechanically. Keep citations scoped to the section they support.",
  "Each section should include at most two hostnames on its final citation line.",
].join(" ");

export function buildWebSearchGuide(enableWebSearch) {
  return enableWebSearch ? `\n\n${WEB_SEARCH_GUIDE_TEXT}` : "";
}

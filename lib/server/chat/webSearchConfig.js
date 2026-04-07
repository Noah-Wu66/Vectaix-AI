export const WEB_SEARCH_PROVIDER = "xcrawl";
export const WEB_SEARCH_LIMIT = 30;
export const WEB_SEARCH_UPSTREAM_QPS = 5;
export const WEB_SEARCH_MIN_REQUEST_INTERVAL_MS = Math.ceil(1000 / WEB_SEARCH_UPSTREAM_QPS);
export const WEB_SEARCH_GUIDE_TEXT = [
  "When a factual statement depends on web results, cite the supporting source within the same section of the reply.",
  "Do not place citations inside sentences or immediately after a clause.",
  "For each major section, numbered item, or top-level bullet, place the supporting sources on a dedicated final line in that section with no prefix or label.",
  "That final source line must contain only Markdown links whose visible label is the hostname or subdomain, for example: [cn.wsj.com](https://cn.wsj.com) · [news.cn](https://news.cn).",
  "The visible text must be only the hostname or subdomain. Omit a leading www. when present. Do not show protocol, path, query string, or any other extra text.",
  "Do not attach every source to the very end of the whole answer mechanically. Keep citations scoped to the section they support.",
  "Each section should include at most two source links on its final citation line.",
].join(" ");

export function buildWebSearchGuide(enableWebSearch) {
  return enableWebSearch ? `\n\n${WEB_SEARCH_GUIDE_TEXT}` : "";
}

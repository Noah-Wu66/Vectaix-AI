export const WEB_SEARCH_PROVIDER = "xcrawl";
export const WEB_SEARCH_LIMIT = 30;
export const WEB_SEARCH_UPSTREAM_QPS = 5;
export const WEB_SEARCH_MIN_REQUEST_INTERVAL_MS = Math.ceil(1000 / WEB_SEARCH_UPSTREAM_QPS);
export const WEB_SEARCH_GUIDE_TEXT = [
  "When a factual statement depends on web results, cite the supporting source inline in the reply itself.",
  "Place the citation immediately after the relevant sentence or bullet using only the source hostname in parentheses, for example: （juejin.cn）.",
  "Use only the hostname or subdomain. Never include protocol, path, query string, or a full URL.",
  "Do not attach every source to the end of the answer mechanically. Only cite the specific sentence, clause, or bullet that is supported by that source.",
  "If one sentence is supported by multiple sources, include at most two hostnames.",
].join(" ");

export function buildWebSearchGuide(enableWebSearch) {
  return enableWebSearch ? `\n\n${WEB_SEARCH_GUIDE_TEXT}` : "";
}

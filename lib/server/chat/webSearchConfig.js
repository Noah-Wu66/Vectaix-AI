export const WEB_SEARCH_PROVIDER = "volcengine";
export const WEB_SEARCH_LIMIT = 20;
export const WEB_SEARCH_UPSTREAM_QPS = 5;
export const WEB_SEARCH_MIN_REQUEST_INTERVAL_MS = Math.ceil(1000 / WEB_SEARCH_UPSTREAM_QPS);
export const WEB_SEARCH_GUIDE_TEXT = "Do not add source domains or URLs in parentheses in your reply.";

export function buildWebSearchGuide(enableWebSearch) {
  return enableWebSearch ? `\n\n${WEB_SEARCH_GUIDE_TEXT}` : "";
}

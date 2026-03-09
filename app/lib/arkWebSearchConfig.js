export const ARK_WEB_SEARCH_MAX_KEYWORD = 2;
export const ARK_WEB_SEARCH_LIMIT = 20;
export const ARK_WEB_SEARCH_MAX_TOOL_CALLS = 3;
export const ARK_WEB_SEARCH_SINGLE_ROUND_TOOL_CALLS = 1;
export const ARK_WEB_SEARCH_MAX_ROUNDS = 3;

export function createArkWebSearchTool(overrides = {}) {
  return {
    type: 'web_search',
    max_keyword: ARK_WEB_SEARCH_MAX_KEYWORD,
    limit: ARK_WEB_SEARCH_LIMIT,
    ...overrides,
  };
}

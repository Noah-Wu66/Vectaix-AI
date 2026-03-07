import {
  bochaSearch,
  buildBochaContext,
  buildBochaCitations,
  buildBochaSearchEventResults,
} from '@/app/api/chat/bochaSearch';

const CONTEXTUAL_QUERY_PATTERNS = [
  /^(那|这个|这个问题|这个事情|它|他|她|继续|然后|还有|再说|展开|详细说|那现在|现在呢)/i,
  /(怎么样|如何|还有吗|继续说|再展开|再具体一点)\s*[?？!！]*$/i,
];

const FORCE_SEARCH_PATTERNS = [
  /(帮我查|帮我搜|查一下|搜一下|搜索一下|检索一下)/i,
  /(最新|最近|当前|现在|实时|今日|今天|刚刚|截至)/i,
  /(新闻|公告|报道|官网|官方文档|官方说明|政策|法规|价格|股价|汇率|天气|赛程|比分|票房|排名|版本|发布|更新日志|release|changelog)/i,
  /(总统|首相|ceo|市值|融资|财报|票价|机票|酒店|餐厅)/i,
];

const ONE_DAY_PATTERNS = [
  /(今天|今日|现在|当前|实时|刚刚|最新消息|breaking|live)/i,
];

const ONE_WEEK_PATTERNS = [
  /(最新|最近|近况|本周|这一周|过去一周|这几天|最近几天)/i,
];

const ONE_MONTH_PATTERNS = [
  /(本月|这个月|最近一个月|近一个月|过去一个月)/i,
];

const ONE_YEAR_PATTERNS = [
  /(今年|近一年|过去一年|这一年)/i,
];

function normalizeMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content.trim();
  }
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => (typeof part?.text === 'string' ? part.text.trim() : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function buildRecentConversation(historyMessages, maxItems = 4) {
  const list = Array.isArray(historyMessages) ? historyMessages : [];
  return list
    .slice(-maxItems)
    .map((item) => {
      const text = normalizeMessageText(item);
      if (!text) return '';
      const role = item?.role === 'model' ? '助手' : '用户';
      return `${role}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');
}

function inferFreshness(text) {
  if (ONE_DAY_PATTERNS.some((pattern) => pattern.test(text))) return 'oneDay';
  if (ONE_WEEK_PATTERNS.some((pattern) => pattern.test(text))) return 'oneWeek';
  if (ONE_MONTH_PATTERNS.some((pattern) => pattern.test(text))) return 'oneMonth';
  if (ONE_YEAR_PATTERNS.some((pattern) => pattern.test(text))) return 'oneYear';
  return 'noLimit';
}

function cleanQuery(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/^[\s,，。；;:：]+/, '')
    .replace(/^(请|帮我|麻烦|顺便|再|然后|那就|那你|你再)\s*/u, '')
    .replace(/[?？!！]+$/u, '')
    .trim()
    .slice(0, 160);
}

function buildSearchQuery(prompt, historyMessages) {
  const current = cleanQuery(prompt);
  if (!current) return '';

  const isContextual = CONTEXTUAL_QUERY_PATTERNS.some((pattern) => pattern.test(current)) || current.length <= 10;
  if (!isContextual) return current;

  const recentUserTexts = (Array.isArray(historyMessages) ? historyMessages : [])
    .slice(-4)
    .filter((item) => item?.role === 'user')
    .map((item) => normalizeMessageText(item))
    .filter(Boolean);

  if (recentUserTexts.length === 0) return current;

  const joined = cleanQuery(`${recentUserTexts.join(' ')} ${current}`);
  return joined || current;
}

function planWebSearch({ prompt, historyMessages }) {
  const currentPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!currentPrompt) {
    return { needSearch: false, query: '', freshness: 'noLimit' };
  }

  const recentConversation = buildRecentConversation(historyMessages);
  const combinedText = `${recentConversation}\n用户当前问题: ${currentPrompt}`.trim();
  const needSearch = FORCE_SEARCH_PATTERNS.some((pattern) => pattern.test(combinedText));
  const query = needSearch ? buildSearchQuery(currentPrompt, historyMessages) : '';
  const freshness = inferFreshness(combinedText);

  return { needSearch, query, freshness };
}

export function buildWebSearchGuide(enableWebSearch) {
  return enableWebSearch
    ? '\n\nDo not add source domains or URLs in parentheses in your reply.'
    : '';
}

export async function runWebSearchOrchestration(options) {
  const {
    enableWebSearch,
    prompt,
    historyMessages,
    sendEvent,
    pushCitations,
    sendSearchError,
    isClientAborted,
    providerLabel = 'AI',
    model,
    conversationId,
    logDecision = false,
    warnOnNoContext = false,
  } = options || {};

  const aborted = () => typeof isClientAborted === 'function' && isClientAborted() === true;
  if (!enableWebSearch || aborted()) {
    return { searchContextText: '' };
  }

  const decision = planWebSearch({ prompt, historyMessages });
  const needSearch = decision.needSearch === true;
  const nextQuery = typeof decision.query === 'string' ? decision.query.trim() : '';
  const freshness = typeof decision.freshness === 'string' ? decision.freshness.trim() : 'noLimit';

  if (logDecision) {
    console.info(`${providerLabel} bocha search decision`, {
      needSearch,
      hasQuery: Boolean(nextQuery),
      freshness,
      model,
      conversationId,
    });
  }

  if (!needSearch) {
    return { searchContextText: '' };
  }

  if (!nextQuery) {
    const message = '搜索规划失败，请稍后再试';
    sendSearchError?.(message);
    throw new Error(message);
  }

  if (aborted()) {
    return { searchContextText: '' };
  }

  sendEvent({ type: 'search_start', query: nextQuery });

  let searchData;
  try {
    searchData = await bochaSearch(nextQuery, {
      summary: true,
      count: 8,
      freshness,
    });
  } catch (searchError) {
    console.error(`${providerLabel} bocha web search failed`, {
      query: nextQuery,
      freshness,
      message: searchError?.message,
      name: searchError?.name,
    });
    const message = searchError?.message?.includes('BOCHA_API_KEY')
      ? '未配置博查搜索服务'
      : '博查搜索失败，请稍后再试';
    sendSearchError?.(message);
    throw new Error(message);
  }

  const results = Array.isArray(searchData?.results) ? searchData.results : [];
  const summary = typeof searchData?.summary === 'string' ? searchData.summary : '';

  sendEvent({
    type: 'search_result',
    query: nextQuery,
    results: buildBochaSearchEventResults(results),
  });

  if (typeof pushCitations === 'function') {
    pushCitations(buildBochaCitations(results));
  }

  const searchContextText = buildBochaContext(summary, results, {
    maxResults: 5,
    maxSnippetChars: 280,
  });

  if (warnOnNoContext && !searchContextText) {
    console.warn(`${providerLabel} bocha search produced no context`, {
      needSearch,
      freshness,
      lastQuery: nextQuery,
      resultCount: results.length,
    });
  }

  return { searchContextText };
}
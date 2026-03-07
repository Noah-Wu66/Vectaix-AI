import { parseJsonFromText } from '@/app/api/chat/jsonUtils';
import { injectCurrentTimeSystemReminder } from '@/app/api/chat/utils';
import {
  bochaSearch,
  buildBochaContext,
  buildBochaCitations,
  buildBochaSearchEventResults,
} from '@/app/api/chat/bochaSearch';

const VALID_FRESHNESS_VALUES = new Set(['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit']);

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

function getRecentDecisionMessages(historyMessages) {
  const list = Array.isArray(historyMessages) ? historyMessages : [];
  return list
    .filter((item) => item?.role === 'user' || item?.role === 'model')
    .slice(-4)
    .map((item) => {
      const text = normalizeMessageText(item);
      if (!text) return null;
      return {
        role: item.role === 'model' ? 'assistant' : 'user',
        text: text.slice(0, 500),
      };
    })
    .filter(Boolean);
}

export async function buildWebSearchDecisionPrompts({ prompt, historyMessages }) {
  const currentPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const recentMessages = getRecentDecisionMessages(historyMessages);
  const conversationText = recentMessages.length > 0
    ? recentMessages.map((item, index) => `${index + 1}. [${item.role}] ${item.text}`).join('\n')
    : '(无最近对话)';

  const systemText = await injectCurrentTimeSystemReminder(`你是“是否需要博查联网”的判断器。你的唯一任务，是判断当前用户这句话在回答前是否必须先做一次博查 Web Search。

判断原则：
1. 默认保守。除非确实需要外部信息、最新信息、会变化的信息、官网链接、官方文档、新闻公告、价格行情、实时数据，否则一律 needSearch=false。
2. 用户明确要求“查一下、搜一下、去官网、找官方文档、看最新消息、看最近动态、帮我检索资料”等，通常 needSearch=true。
3. 如果当前消息是指代型追问，例如“那价格呢”“那官网呢”，你可以结合最近对话补全搜索意图；但像“继续”“展开说说”“再详细一点”“谢谢”“翻译一下”“润色一下”这种，不要联网。
4. 常识解释、代码问题、数学题、创作、改写、翻译、总结用户已提供内容、基于已有上下文继续展开，这些通常 needSearch=false。
5. query 必须是适合搜索引擎的一句话关键词，不要加解释，不要加 site: 等高级语法。
6. freshness 只能是 oneDay、oneWeek、oneMonth、oneYear、noLimit 之一。
7. 如果 needSearch=false，query 必须是空字符串，freshness 必须是 noLimit。
8. 只输出 JSON，不要输出任何别的文字。

返回格式：
{"needSearch":true,"query":"搜索词","freshness":"oneWeek"}`);

  const userText = `请只根据下面信息做判断。\n\n最近对话（最多 4 条）：\n${conversationText}\n\n当前用户消息：\n[user] ${currentPrompt}`;

  return { systemText, userText };
}

export function normalizeWebSearchDecision(rawDecision) {
  const candidate = typeof rawDecision === 'string'
    ? parseJsonFromText(rawDecision)
    : rawDecision;

  if (!candidate || typeof candidate !== 'object') return null;
  if (candidate.needSearch !== true && candidate.needSearch !== false) return null;

  if (candidate.needSearch === false) {
    return {
      needSearch: false,
      query: '',
      freshness: 'noLimit',
    };
  }

  const query = typeof candidate.query === 'string'
    ? candidate.query.trim().slice(0, 160)
    : '';
  const freshness = typeof candidate.freshness === 'string'
    ? candidate.freshness.trim()
    : '';

  if (!query) return null;
  if (!VALID_FRESHNESS_VALUES.has(freshness)) return null;

  return {
    needSearch: true,
    query,
    freshness,
  };
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
    decisionRunner,
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

  const currentPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!currentPrompt) {
    return { searchContextText: '' };
  }

  if (typeof decisionRunner !== 'function') {
    const message = '未配置联网判断模型';
    sendSearchError?.(message);
    throw new Error(message);
  }

  let decision;
  try {
    const rawDecision = await decisionRunner({
      prompt: currentPrompt,
      historyMessages,
      providerLabel,
      model,
      conversationId,
    });

    decision = normalizeWebSearchDecision(rawDecision);
    if (!decision) {
      throw new Error('搜索判断模型未返回合法 JSON');
    }
  } catch (decisionError) {
    if (aborted()) {
      return { searchContextText: '' };
    }
    console.error(`${providerLabel} bocha search decision failed`, {
      message: decisionError?.message,
      name: decisionError?.name,
      model,
      conversationId,
    });
    const message = '联网判断失败，请稍后再试';
    sendSearchError?.(message);
    throw new Error(message);
  }

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
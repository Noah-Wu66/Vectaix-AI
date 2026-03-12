import { parseJsonFromText } from '@/app/api/chat/jsonUtils';
import { injectCurrentTimeSystemReminder } from '@/app/api/chat/utils';
import {
  WEB_SEARCH_LIMIT,
  WEB_SEARCH_MAX_ROUNDS,
  WEB_SEARCH_DECISION_HISTORY_MESSAGE_LIMIT,
  WEB_SEARCH_DECISION_MESSAGE_CHAR_LIMIT,
  WEB_SEARCH_DECISION_SYSTEM_PROMPT,
  buildWebSearchDecisionUserText,
  WEB_SEARCH_PROVIDER,
} from '@/lib/server/chat/webSearchConfig';
import {
  perplexitySearch,
  buildSearchContext,
  buildSearchEventResults,
} from '@/app/api/chat/perplexitySearch';

const VALID_FRESHNESS_VALUES = new Set(['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit']);
const EXPLICIT_SEARCH_KEYWORDS = [
  '查一下',
  '查一查',
  '搜一下',
  '搜一搜',
  '搜索',
  '检索',
  '联网',
  '上网',
  '官网',
  '官方文档',
  '官方说明',
  '最新',
  '最近',
  '实时',
  '新闻',
  '公告',
  '价格',
  '股价',
  '汇率',
  '天气',
  '航班',
  '比分',
  '开奖',
];
const EXPLICIT_SEARCH_KEYWORDS_EN = [
  'search',
  'look up',
  'google',
  'official site',
  'official docs',
  'latest',
  'recent',
  'news',
  'announcement',
  'price',
  'weather',
  'stock price',
  'exchange rate',
  'release note',
  'changelog',
];
const NON_SEARCH_REPLY_KEYWORDS = [
  '继续',
  '展开说说',
  '再详细一点',
  '详细说说',
  '翻译一下',
  '润色一下',
  '总结一下',
  '概括一下',
  '改写一下',
  '谢谢',
  '谢了',
  '好的',
  '收到',
];
const FOLLOW_UP_SEARCH_KEYWORDS = ['价格', '官网', '文档', '教程', '资料', '来源', '新闻', '消息', '更新', '进展', '最新', '最近'];
const CONTEXT_REFERENCE_KEYWORDS = ['上面那段话', '上面的内容', '上文', '这段话', '这一段', '这句话', '这段内容', '刚才那段', '刚刚那段', '上一条', '上一段', '上一个回答', '上面的回答', '刚才的回答'];
const REWRITE_TASK_KEYWORDS = ['润色', '翻译', '总结', '概括', '改写', '重写', '续写', '扩写', '精简'];
const GENERIC_SEARCH_QUERY_TERMS = [
  '官网',
  '官方网站',
  '官方文档',
  '官方说明',
  '文档',
  '教程',
  '资料',
  '来源',
  '新闻',
  '消息',
  '最新',
  '最近',
  '更新',
  '进展',
  '最新消息',
  '价格',
  '股价',
  '汇率',
  '天气',
  '航班',
  '比分',
  '开奖',
  'official site',
  'official website',
  'official docs',
  'docs',
  'documentation',
  'news',
  'latest',
  'recent',
  'price',
  'weather',
];
const TOPIC_CUT_KEYWORDS = [
  '官方网站',
  '官网',
  '官方文档',
  '官方说明',
  '文档',
  '教程',
  '资料',
  '来源',
  '最新消息',
  '新闻',
  '消息',
  '更新',
  '进展',
  '最新',
  '最近',
  '价格',
  '股价',
  '汇率',
  '天气',
  '航班',
  '比分',
  '开奖',
  '发布时间',
  '发布日期',
  '什么时候发布',
  '何时发布',
  '什么时候',
  '在哪里',
  '在哪',
  '是什么',
  '是啥',
  '怎么样',
];
const MAX_FINAL_QUERY_LENGTH = 48;
const MULTI_CLAUSE_QUERY_PATTERN = /[，,；;。]|顺便|另外|然后|再帮我|顺带|以及|并且|同时|\b(and also|also|then|by the way)\b/u;
const ENGLISH_LEADING_POLITE_PATTERN = /^(please|can you|could you|would you|help me|show me|tell me|look up|search for|find)\b[\s,:-]*/i;
const ENGLISH_SEARCH_VERB_PATTERN = /^(look up|search for|search|google|find)\b[\s,:-]*/i;

function findKeywordIndex(text, keywords) {
  if (typeof text !== 'string' || !text) return -1;

  let bestIndex = -1;
  for (const keyword of keywords) {
    if (typeof keyword !== 'string' || !keyword) continue;
    const index = text.indexOf(keyword);
    if (index <= 0) continue;
    if (bestIndex === -1 || index < bestIndex) bestIndex = index;
  }

  return bestIndex;
}

function normalizeComparableText(text) {
  if (typeof text !== 'string') return '';
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function stripLeadingChatter(text) {
  if (typeof text !== 'string') return '';

  let query = text.trim();
  let previous = '';

  while (query && query !== previous) {
    previous = query;
    query = query.replace(/^(请问|请你|请|麻烦你|麻烦|帮我|你帮我|帮忙|可以帮我|能不能帮我|能否帮我|给我|替我|请帮我|请你帮我|我想知道|想问下|想问一下|那个|那就|那麻烦你)+/u, '').trim();
    query = query.replace(/^(去)?(查一下|查一查|搜一下|搜一搜|搜索一下|搜索|检索一下|检索|联网查一下|上网查一下|上网搜一下|看看|看一下|找一下|找找|查查|搜搜)/u, '').trim();
    query = query.replace(ENGLISH_LEADING_POLITE_PATTERN, '').trim();
    query = query.replace(ENGLISH_SEARCH_VERB_PATTERN, '').trim();
  }

  return query;
}

function includesAnyKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeBooleanDecisionValue(value) {
  if (value === true || value === false) return value;
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'need', 'needed', '需要', '是'].includes(normalized)) return true;
  if (['false', 'no', '0', 'none', '无需', '不需要', '否'].includes(normalized)) return false;
  return null;
}

function isClearlyNonSearchReply(text) {
  if (typeof text !== 'string') return false;
  const normalized = text.replace(/[？?。！!]/g, '').trim();
  return NON_SEARCH_REPLY_KEYWORDS.includes(normalized);
}

function normalizeFreshnessValue(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (VALID_FRESHNESS_VALUES.has(trimmed)) return trimmed;

  const compact = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  const aliasMap = {
    day: 'oneDay',
    today: 'oneDay',
    oneday: 'oneDay',
    daily: 'oneDay',
    week: 'oneWeek',
    weekly: 'oneWeek',
    oneweek: 'oneWeek',
    recent: 'oneWeek',
    month: 'oneMonth',
    monthly: 'oneMonth',
    onemonth: 'oneMonth',
    year: 'oneYear',
    yearly: 'oneYear',
    oneyear: 'oneYear',
    nolimit: 'noLimit',
    none: 'noLimit',
    all: 'noLimit',
    any: 'noLimit',
  };

  return aliasMap[compact] || null;
}

function extractDecisionQuery(candidate) {
  const raw = candidate?.query
    ?? candidate?.searchQuery
    ?? candidate?.search_query
    ?? candidate?.keyword
    ?? candidate?.keywords
    ?? '';

  if (Array.isArray(raw)) {
    return raw
      .filter((item) => typeof item === 'string')
      .join(' ')
      .trim()
      .slice(0, 160);
  }

  return typeof raw === 'string'
    ? raw.trim().slice(0, 160)
    : '';
}

function cleanupQueryText(text) {
  if (typeof text !== 'string') return '';

  let query = text.replace(/\s+/g, ' ').trim();
  query = stripLeadingChatter(query);
  query = query.replace(/[？?。！!]+$/u, '').trim();
  query = query.replace(/^(关于|有关)/u, '').trim();
  query = query.replace(/^(那|那它|那这个|那这个东西|这个|这个东西|那边)\s*/u, '').trim();
  query = query.replace(/(是什么|是啥|吗|呢|可以吗)$/u, '').trim();
  return query.slice(0, 160);
}

function shouldForceSkipSearch(text) {
  if (typeof text !== 'string') return false;
  const current = text.trim();
  if (!current) return false;

  const hasContextReference = includesAnyKeyword(current, CONTEXT_REFERENCE_KEYWORDS);
  const hasRewriteAction = includesAnyKeyword(current, REWRITE_TASK_KEYWORDS);
  return hasContextReference && hasRewriteAction;
}

function isGenericSearchQuery(text) {
  const normalized = normalizeComparableText(cleanupQueryText(text));
  if (!normalized) return true;

  return GENERIC_SEARCH_QUERY_TERMS.some((term) => normalizeComparableText(term) === normalized);
}

function isQueryNearlySameAsPrompt(query, prompt) {
  const normalizedQuery = normalizeComparableText(cleanupQueryText(query));
  const normalizedPrompt = normalizeComparableText(cleanupQueryText(prompt));
  if (!normalizedQuery || !normalizedPrompt) return false;

  return normalizedQuery === normalizedPrompt
    || (normalizedQuery.length >= 8 && normalizedPrompt.includes(normalizedQuery))
    || (normalizedPrompt.length >= 8 && normalizedQuery.includes(normalizedPrompt));
}

function isCompactSearchQuery(text) {
  const cleaned = cleanupQueryText(text);
  if (!cleaned) return false;
  if (cleaned.length > MAX_FINAL_QUERY_LENGTH) return false;
  if (isGenericSearchQuery(cleaned)) return false;
  if (MULTI_CLAUSE_QUERY_PATTERN.test(cleaned)) return false;
  return true;
}

function extractTopicFromText(text) {
  let topic = cleanupQueryText(text);
  if (!topic) return '';

  topic = topic.split(/[，,；;。!?！？\n]/u)[0].trim();
  topic = topic.replace(/^(那|那它|那这个|那这个东西|这个|这个东西|那边|然后|另外|还有)\s*/u, '').trim();

  const cutIndex = findKeywordIndex(topic, TOPIC_CUT_KEYWORDS);
  if (cutIndex > 0) {
    topic = topic.slice(0, cutIndex).trim();
  }

  topic = topic.replace(/(是什么|是啥|怎么样|怎么用|好不好|吗|呢)$/u, '').trim();
  topic = topic.replace(/[的\s]+$/u, '').trim();

  if (!topic || isGenericSearchQuery(topic)) return '';
  return topic.slice(0, MAX_FINAL_QUERY_LENGTH);
}

function pushUniqueToken(tokens, token) {
  if (!token || tokens.includes(token)) return;
  tokens.push(token);
}

function extractIntentTokens(text) {
  const source = cleanupQueryText(text);
  const lower = source.toLowerCase();
  const tokens = [];

  if (!source) return tokens;

  if (includesAnyKeyword(source, ['官网', '官方网站']) || /\b(official site|official website)\b/.test(lower)) {
    pushUniqueToken(tokens, '官网');
  }
  if (includesAnyKeyword(source, ['官方文档', '官方说明']) || /\b(official docs|documentation|manual)\b/.test(lower)) {
    pushUniqueToken(tokens, '官方文档');
  } else if (includesAnyKeyword(source, ['文档']) || /\bdocs\b/.test(lower)) {
    pushUniqueToken(tokens, '文档');
  }
  if (includesAnyKeyword(source, ['教程']) || /\b(tutorial|guide|guides)\b/.test(lower)) {
    pushUniqueToken(tokens, '教程');
  }
  if (includesAnyKeyword(source, ['资料', '来源']) || /\b(resource|resources|reference)\b/.test(lower)) {
    pushUniqueToken(tokens, '资料');
  }
  if (includesAnyKeyword(source, ['价格', '股价', '汇率', '报价', '费用', '售价']) || /\b(price|pricing|stock price|exchange rate)\b/.test(lower)) {
    pushUniqueToken(tokens, '价格');
  }
  if (includesAnyKeyword(source, ['天气']) || /\bweather\b/.test(lower)) {
    pushUniqueToken(tokens, '天气');
  }
  if (includesAnyKeyword(source, ['航班']) || /\bflight\b/.test(lower)) {
    pushUniqueToken(tokens, '航班');
  }
  if (includesAnyKeyword(source, ['比分']) || /\bscore\b/.test(lower)) {
    pushUniqueToken(tokens, '比分');
  }
  if (includesAnyKeyword(source, ['开奖']) || /\blottery\b/.test(lower)) {
    pushUniqueToken(tokens, '开奖');
  }
  if (
    includesAnyKeyword(source, ['发布时间', '发布日期', '什么时候发布', '何时发布', '发布', '上线', '发售', '推出'])
    || /\b(release date|launch date|launch|release)\b/.test(lower)
  ) {
    pushUniqueToken(tokens, '发布时间');
  }
  if (
    includesAnyKeyword(source, ['新闻', '消息', '动态', '进展', '公告', '更新'])
    || /\b(news|announcement|announcements|update|updates|release note|changelog)\b/.test(lower)
  ) {
    pushUniqueToken(tokens, '最新消息');
  } else if (includesAnyKeyword(source, ['最新', '最近']) || /\b(latest|recent)\b/.test(lower)) {
    pushUniqueToken(tokens, '最新');
  }

  return tokens.slice(0, 3);
}

function buildQueryFromTopic({ topic, intentTokens, freshness }) {
  const parts = [];
  const tokens = Array.isArray(intentTokens) ? intentTokens : [];

  if (topic) parts.push(topic);
  for (const token of tokens) {
    if (!token) continue;
    if (parts.includes(token)) continue;
    parts.push(token);
  }

  const shouldAppendFreshness = freshness === 'oneWeek'
    && !tokens.some((token) => token.includes('最新'));

  if (shouldAppendFreshness && !parts.includes('最新')) {
    parts.push('最新');
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FINAL_QUERY_LENGTH);
}

function finalizeSearchQuery({ prompt, historyMessages, rawQuery, freshness }) {
  const cleanedQuery = cleanupQueryText(rawQuery);
  const promptIsCompact = isCompactSearchQuery(prompt);

  if (
    cleanedQuery
    && cleanedQuery.length <= MAX_FINAL_QUERY_LENGTH
    && !isGenericSearchQuery(cleanedQuery)
    && !MULTI_CLAUSE_QUERY_PATTERN.test(cleanedQuery)
    && (promptIsCompact || !isQueryNearlySameAsPrompt(cleanedQuery, prompt))
  ) {
    return cleanedQuery;
  }

  const topic = extractTopicFromText(prompt)
    || extractTopicFromText(rawQuery)
    || getRecentTopicHint(historyMessages);
  const intentTokens = extractIntentTokens(`${rawQuery || ''}\n${prompt || ''}`);
  const rebuiltQuery = buildQueryFromTopic({ topic, intentTokens, freshness });

  if (rebuiltQuery && isCompactSearchQuery(rebuiltQuery)) {
    return rebuiltQuery;
  }

  if (!rebuiltQuery && topic && isCompactSearchQuery(topic)) {
    return topic;
  }

  return '';
}

function inferFreshnessFromQuery(text) {
  const source = typeof text === 'string' ? text : '';
  const lower = source.toLowerCase();

  if (
    includesAnyKeyword(source, ['今天', '今日', '刚刚', '刚才', '现在', '实时', '目前', '股价', '汇率', '天气', '航班', '比分', '开奖', '热搜'])
    || /\b(today|now|live|real-time|realtime)\b/.test(lower)
  ) {
    return 'oneDay';
  }

  if (
    includesAnyKeyword(source, ['最新', '最近', '新闻', '公告', '动态', '进展', '近况', '更新', '发布'])
    || /\b(latest|recent|news|update|updates|announcement|announcements)\b/.test(lower)
  ) {
    return 'oneWeek';
  }

  if (includesAnyKeyword(source, ['本月', '这个月', '近一个月', '近30天']) || /\bthis month\b/.test(lower)) {
    return 'oneMonth';
  }

  if (includesAnyKeyword(source, ['今年', '近一年', '过去一年']) || /\bthis year\b/.test(lower)) {
    return 'oneYear';
  }

  return 'noLimit';
}

function isLikelySearchFollowUp(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (/^(那|那它|那这个|那这个东西|这个|这个东西|那边|然后)(.+)?呢[？?]?$/u.test(trimmed)) return true;
  if (/^(那|这个)?(价格|官网|文档|教程|资料|来源|新闻|消息|更新|进展|最新|最近)(呢)?[？?]?$/u.test(trimmed)) return true;
  return false;
}

function getRecentTopicHint(historyMessages) {
  const recentMessages = getRecentDecisionMessages(historyMessages);

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const item = recentMessages[index];
    if (item?.role !== 'user') continue;
    const text = extractTopicFromText(item.text) || cleanupQueryText(item.text);
    if (text) return text;
  }

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const text = extractTopicFromText(recentMessages[index]?.text) || cleanupQueryText(recentMessages[index]?.text);
    if (text) return text;
  }

  return '';
}

function buildHeuristicWebSearchDecision({ prompt, historyMessages }) {
  const currentPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!currentPrompt) return null;

  if (isClearlyNonSearchReply(currentPrompt) || shouldForceSkipSearch(currentPrompt)) {
    return { needSearch: false, query: '', freshness: 'noLimit' };
  }

  const lowerPrompt = currentPrompt.toLowerCase();
  const hasExplicitIntent = includesAnyKeyword(currentPrompt, EXPLICIT_SEARCH_KEYWORDS)
    || includesAnyKeyword(lowerPrompt, EXPLICIT_SEARCH_KEYWORDS_EN);
  const isFollowUp = isLikelySearchFollowUp(currentPrompt)
    || (currentPrompt.length <= 12 && includesAnyKeyword(currentPrompt, FOLLOW_UP_SEARCH_KEYWORDS));

  if (!hasExplicitIntent && !isFollowUp) {
    return null;
  }

  const topicHint = isFollowUp ? getRecentTopicHint(historyMessages) : '';
  if (isFollowUp && !topicHint) {
    return null;
  }

  const mergedQuery = cleanupQueryText(topicHint ? `${topicHint} ${currentPrompt}` : currentPrompt);
  if (!mergedQuery) {
    return null;
  }

  return {
    needSearch: true,
    query: mergedQuery,
    freshness: inferFreshnessFromQuery(mergedQuery),
  };
}

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

function clipHelperText(text, maxLen = 0) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!Number.isFinite(maxLen) || maxLen <= 0 || trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

function buildSearchRoundsDecisionText(searchRounds) {
  const rounds = Array.isArray(searchRounds) ? searchRounds : [];
  if (rounds.length === 0) return '(暂无已完成的联网检索结果)';

  return rounds.map((round) => {
    const titles = Array.isArray(round?.results)
      ? round.results
        .slice(0, 3)
        .map((item) => item?.title || item?.url || '')
        .filter(Boolean)
      : [];

    const lines = [
      `第 ${round.round} 轮`,
      `搜索词：${round.query || '(空)'}`,
      `时效：${round.freshness || 'noLimit'}`,
      `结果数：${Array.isArray(round?.results) ? round.results.length : 0}`,
    ];

    const summary = clipHelperText(round?.summary, 420);
    if (summary) lines.push(`摘要：${summary}`);
    if (titles.length > 0) lines.push(`主要来源：${titles.join('；')}`);

    return lines.join('\n');
  }).join('\n\n');
}

function buildAccumulatedSearchContext(searchRounds) {
  const rounds = Array.isArray(searchRounds) ? searchRounds : [];
  if (rounds.length === 0) return '';

  return rounds
    .map((round) => {
      const lines = [`第${round.round}轮联网检索（关键词：${round.query || '(空)'}）`];
      if (round.freshness && round.freshness !== 'noLimit') {
        lines.push(`时效要求：${round.freshness}`);
      }
      if (round.contextText) {
        lines.push(round.contextText);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function hasSeenQuery(searchRounds, query) {
  const normalized = normalizeComparableText(cleanupQueryText(query));
  if (!normalized) return false;
  return (Array.isArray(searchRounds) ? searchRounds : []).some((round) => {
    const previous = normalizeComparableText(cleanupQueryText(round?.query || ''));
    return previous === normalized;
  });
}

function getRecentDecisionMessages(historyMessages) {
  const list = Array.isArray(historyMessages) ? historyMessages : [];
  return list
    .filter((item) => item?.role === 'user' || item?.role === 'model')
    .slice(-WEB_SEARCH_DECISION_HISTORY_MESSAGE_LIMIT)
    .map((item) => {
      const text = normalizeMessageText(item);
      if (!text) return null;
      return {
        role: item.role === 'model' ? 'assistant' : 'user',
        text: text.slice(0, WEB_SEARCH_DECISION_MESSAGE_CHAR_LIMIT),
      };
    })
    .filter(Boolean);
}

export async function buildWebSearchDecisionPrompts({ prompt, historyMessages, searchRounds }) {
  const currentPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const recentMessages = getRecentDecisionMessages(historyMessages);
  const completedSearchRounds = Array.isArray(searchRounds) ? searchRounds : [];
  const conversationText = recentMessages.length > 0
    ? recentMessages.map((item, index) => `${index + 1}. [${item.role}] ${item.text}`).join('\n')
    : '(无最近对话)';
  const searchRoundsText = buildSearchRoundsDecisionText(completedSearchRounds);

  const systemText = await injectCurrentTimeSystemReminder(WEB_SEARCH_DECISION_SYSTEM_PROMPT);

  const userText = buildWebSearchDecisionUserText({
    conversationText,
    searchRoundsText,
    currentPrompt,
  });

  return { systemText, userText };
}

export function normalizeWebSearchDecision(rawDecision) {
  const candidate = typeof rawDecision === 'string'
    ? parseJsonFromText(rawDecision)
    : rawDecision;

  if (!candidate || typeof candidate !== 'object') return null;
  const needSearch = normalizeBooleanDecisionValue(candidate.needSearch ?? candidate.need_search);
  if (needSearch !== true && needSearch !== false) return null;

  if (needSearch === false) {
    return {
      needSearch: false,
      query: '',
      freshness: 'noLimit',
    };
  }

  const query = extractDecisionQuery(candidate);
  const freshness = normalizeFreshnessValue(candidate.freshness) || inferFreshnessFromQuery(query);

  if (!query) return null;
  if (!VALID_FRESHNESS_VALUES.has(freshness)) return null;

  return {
    needSearch: true,
    query,
    freshness,
  };
}

function isMissingWebSearchCredential(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  return message.includes('PERPLEXITY_API_KEY');
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
    warnOnNoContext = false,
    allowHeuristicFallback = true,
  } = options || {};

  const aborted = () => typeof isClientAborted === 'function' && isClientAborted() === true;
  if (!enableWebSearch || aborted()) {
    return { searchContextText: '' };
  }

  const currentPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!currentPrompt) {
    return { searchContextText: '' };
  }
  if (isClearlyNonSearchReply(currentPrompt) || shouldForceSkipSearch(currentPrompt)) {
    return { searchContextText: '' };
  }

  if (typeof decisionRunner !== 'function') {
    const message = '未配置联网判断模型';
    sendSearchError?.(message);
    throw new Error(message);
  }

  const searchRounds = [];

  for (let roundIndex = 0; roundIndex < WEB_SEARCH_MAX_ROUNDS; roundIndex += 1) {
    let decision;

    try {
      const rawDecision = await decisionRunner({
        prompt: currentPrompt,
        historyMessages,
        providerLabel,
        model,
        conversationId,
        searchRounds,
        accumulatedSearchContextText: buildAccumulatedSearchContext(searchRounds),
      });

      decision = normalizeWebSearchDecision(rawDecision);
      if (!decision) {
        throw new Error('搜索判断模型未返回合法 JSON');
      }
    } catch (decisionError) {
      if (aborted()) {
        return {
          searchContextText: buildAccumulatedSearchContext(searchRounds),
          searchRounds,
        };
      }

      const fallbackDecision = allowHeuristicFallback && searchRounds.length === 0
        ? buildHeuristicWebSearchDecision({
            prompt: currentPrompt,
            historyMessages,
          })
        : null;

      if (fallbackDecision) {
        console.warn(`${providerLabel} web search decision fallback`, {
          round: roundIndex + 1,
          message: decisionError?.message,
          model,
          conversationId,
          needSearch: fallbackDecision.needSearch,
          freshness: fallbackDecision.freshness,
        });
        decision = fallbackDecision;
      } else {
        console.error(`${providerLabel} web search decision failed`, {
          round: roundIndex + 1,
          message: decisionError?.message,
          name: decisionError?.name,
          model,
          conversationId,
          priorSearchRounds: searchRounds.length,
        });
        break;
      }
    }

    const needSearch = decision.needSearch === true;
    const rawQuery = typeof decision.query === 'string' ? decision.query.trim() : '';
    const nextQuery = needSearch
      ? finalizeSearchQuery({
          prompt: currentPrompt,
          historyMessages,
          rawQuery,
          freshness: decision.freshness,
        })
      : '';
    const freshness = typeof decision.freshness === 'string' ? decision.freshness.trim() : 'noLimit';
    const finalFreshness = freshness !== 'noLimit'
      ? freshness
      : inferFreshnessFromQuery(nextQuery);
    const duplicateQuery = needSearch && hasSeenQuery(searchRounds, nextQuery);

    console.info(`${providerLabel} web search decision`, {
      round: roundIndex + 1,
      needSearch,
      rawQuery: rawQuery || null,
      finalQuery: nextQuery || null,
      queryChanged: rawQuery !== nextQuery,
      queryDiscarded: needSearch && !nextQuery,
      duplicateQuery,
      freshness: finalFreshness,
      model,
      conversationId,
      priorSearchRounds: searchRounds.length,
    });

    if (!needSearch) {
      break;
    }

    if (!nextQuery) {
      console.warn(`${providerLabel} web search skipped invalid query`, {
        round: roundIndex + 1,
        rawQuery: rawQuery || null,
        finalQuery: null,
        freshness: finalFreshness,
        model,
        conversationId,
      });
      break;
    }

    if (duplicateQuery) {
      console.warn(`${providerLabel} web search skipped duplicate query`, {
        round: roundIndex + 1,
        query: nextQuery,
        freshness: finalFreshness,
        model,
        conversationId,
      });
      break;
    }

    if (aborted()) {
      return {
        searchContextText: buildAccumulatedSearchContext(searchRounds),
        searchRounds,
      };
    }

    const round = searchRounds.length + 1;
    sendEvent({ type: 'search_start', query: nextQuery, round, provider: WEB_SEARCH_PROVIDER, mode: 'search' });

    let searchData;
    try {
      searchData = await perplexitySearch(nextQuery, {
        count: WEB_SEARCH_LIMIT,
        freshness: finalFreshness,
      });
    } catch (searchError) {
      console.error(`${providerLabel} web search failed`, {
        round,
        rawQuery: rawQuery || null,
        query: nextQuery,
        freshness: finalFreshness,
        message: searchError?.message,
        name: searchError?.name,
      });
      const message = searchError?.message?.includes('PERPLEXITY_API_KEY')
        ? '未配置 Perplexity 联网搜索服务'
        : '联网搜索失败，请稍后再试';
      sendSearchError?.(message, { round, query: nextQuery, provider: WEB_SEARCH_PROVIDER, mode: 'search' });
      if (isMissingWebSearchCredential(searchError)) {
        break;
      }
      throw new Error(message);
    }

    const results = Array.isArray(searchData?.results) ? searchData.results : [];
    const summary = typeof searchData?.summary === 'string' ? searchData.summary : '';
    const citations = Array.isArray(searchData?.citations) ? searchData.citations : [];

    sendEvent({
      type: 'search_result',
      query: nextQuery,
      round,
      provider: WEB_SEARCH_PROVIDER,
      mode: 'search',
      results: buildSearchEventResults(results),
    });

    if (typeof pushCitations === 'function') {
      pushCitations(citations);
    }

    const roundContextText = buildSearchContext(summary, results, {
      maxResults: WEB_SEARCH_LIMIT,
      maxSnippetChars: 280,
    });

    if (warnOnNoContext && !roundContextText) {
      console.warn(`${providerLabel} web search produced no context`, {
        round,
        needSearch,
        rawQuery: rawQuery || null,
        finalQuery: nextQuery,
        freshness: finalFreshness,
        lastQuery: nextQuery,
        resultCount: results.length,
      });
    }

    searchRounds.push({
      round,
      query: nextQuery,
      freshness: finalFreshness,
      summary,
      results,
      contextText: roundContextText,
    });

    if (aborted()) {
      break;
    }
  }

  return {
    searchContextText: buildAccumulatedSearchContext(searchRounds),
    searchRounds,
  };
}

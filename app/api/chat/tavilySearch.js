import { isNonEmptyString } from '@/app/api/chat/utils';
import {
  WEB_SEARCH_LIMIT,
  WEB_SEARCH_PROVIDER,
} from '@/lib/server/chat/webSearchConfig';

const TAVILY_API_BASE_URL = 'https://api.tavily.com';
const TAVILY_TIMEOUT_MS = 30000;
const TAVILY_MAX_RETRIES = 2;
const DEFAULT_MAX_RESULTS = WEB_SEARCH_LIMIT;
const ADVANCED_SEARCH_KEYWORDS = [
  '官网',
  '官方网站',
  '官方文档',
  '官方说明',
  '文档',
  '教程',
  '资料',
  '来源',
  '价格',
  '股价',
  '汇率',
  '财报',
  '费用',
  '售价',
  '发布时间',
  '发布日期',
  '什么时候发布',
  '何时发布',
  '新闻',
  '消息',
  '动态',
  '公告',
  '更新',
  '进展',
  '最新',
  '最近',
  'official site',
  'official website',
  'official docs',
  'documentation',
  'docs',
  'tutorial',
  'guide',
  'price',
  'pricing',
  'stock price',
  'exchange rate',
  'financial',
  'earnings',
  'release date',
  'launch date',
  'news',
  'announcement',
  'update',
  'latest',
  'recent',
];
const NEWS_TOPIC_KEYWORDS = [
  '最新',
  '最近',
  '新闻',
  '公告',
  '发布',
  '动态',
  '更新',
  '进展',
  '消息',
  'latest',
  'recent',
  'news',
  'announcement',
  'release',
  'update',
];
const OFFICIAL_SOURCE_KEYWORDS = [
  '官网',
  '官方网站',
  '官方文档',
  '官方说明',
  '文档',
  '教程',
  '资料',
  '来源',
  'changelog',
  'release notes',
  'release note',
  'documentation',
  'docs',
  'official site',
  'official website',
  'official docs',
  'guide',
  'manual',
];
const FINANCE_TOPIC_KEYWORDS = [
  '价格',
  '股价',
  '汇率',
  '财报',
  '市值',
  '市盈率',
  '报价',
  '费用',
  '售价',
  'price',
  'pricing',
  'stock',
  'stock price',
  'exchange rate',
  'finance',
  'financial',
  'earnings',
  'market cap',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clipText(text, maxLen) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!Number.isFinite(maxLen) || maxLen <= 0) return trimmed;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
}

function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeTextValue(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        if (item && typeof item.content === 'string') return item.content;
        return '';
      })
      .join('')
      .trim();
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text.trim();
    if (typeof value.content === 'string') return value.content.trim();
  }
  return '';
}

function dedupeByUrl(items) {
  const list = [];
  const seenUrls = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    list.push(item);
  }

  return list;
}

function normalizeTavilyResult(item) {
  if (!item || typeof item !== 'object') return null;

  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!url) return null;

  const title = normalizeTextValue(item.title) || url;
  const snippet = normalizeTextValue(
    item.content
    ?? item.snippet
    ?? item.description
    ?? item.summary
  );
  const datePublished = normalizeTextValue(
    item.published_date
    ?? item.published_at
    ?? item.date
  );

  return {
    title,
    url,
    snippet,
    siteName: extractHostname(url),
    datePublished,
    score: Number.isFinite(item.score) ? item.score : null,
  };
}

function buildCitationsFromResults(results) {
  return dedupeByUrl(
    (Array.isArray(results) ? results : [])
      .map((item) => ({
        url: item.url,
        title: item.title || item.url,
        cited_text: item.snippet || '',
      }))
      .filter((item) => item.url)
  );
}

function hasKeyword(text, keywords) {
  if (typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function inferTavilyTopic(query) {
  if (hasKeyword(query, FINANCE_TOPIC_KEYWORDS)) return 'finance';
  if (hasKeyword(query, OFFICIAL_SOURCE_KEYWORDS)) return 'general';
  if (hasKeyword(query, NEWS_TOPIC_KEYWORDS)) return 'news';
  return 'general';
}

function inferTavilySearchDepth(query) {
  return hasKeyword(query, ADVANCED_SEARCH_KEYWORDS) ? 'advanced' : 'basic';
}

function mapFreshnessToTimeRange(freshness) {
  const normalized = typeof freshness === 'string' ? freshness.trim() : 'noLimit';
  return {
    oneDay: 'day',
    oneWeek: 'week',
    oneMonth: 'month',
    oneYear: 'year',
  }[normalized] || null;
}

function normalizeDomains(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, 20);
}

function buildTavilySearchRequestBody(query, options = {}) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  const maxResults = Number.isFinite(options.count) && options.count > 0
    ? Math.min(Math.floor(options.count), DEFAULT_MAX_RESULTS)
    : DEFAULT_MAX_RESULTS;
  const topic = typeof options.topic === 'string' && options.topic.trim()
    ? options.topic.trim()
    : inferTavilyTopic(normalizedQuery);
  const searchDepth = typeof options.searchDepth === 'string' && options.searchDepth.trim()
    ? options.searchDepth.trim()
    : inferTavilySearchDepth(normalizedQuery);
  const includeDomains = normalizeDomains(options.includeDomains ?? options.include_domains);
  const excludeDomains = normalizeDomains(options.excludeDomains ?? options.exclude_domains);
  const timeRange = typeof options.timeRange === 'string' && options.timeRange.trim()
    ? options.timeRange.trim()
    : mapFreshnessToTimeRange(options.freshness);
  const includeAnswer = typeof options.includeAnswer === 'string' && options.includeAnswer.trim()
    ? options.includeAnswer.trim()
    : (searchDepth === 'advanced' ? 'advanced' : 'basic');
  const body = {
    query: normalizedQuery,
    topic,
    search_depth: searchDepth,
    auto_parameters: false,
    max_results: maxResults,
    include_answer: includeAnswer,
    include_raw_content: false,
    include_images: false,
    include_image_descriptions: false,
    include_favicon: false,
  };

  if (includeDomains.length > 0) body.include_domains = includeDomains;
  if (excludeDomains.length > 0) body.exclude_domains = excludeDomains;
  if (timeRange) body.time_range = timeRange;
  if (typeof options.country === 'string' && options.country.trim()) body.country = options.country.trim();
  if (typeof options.startDate === 'string' && options.startDate.trim()) body.start_date = options.startDate.trim();
  if (typeof options.endDate === 'string' && options.endDate.trim()) body.end_date = options.endDate.trim();
  if (typeof options.start_date === 'string' && options.start_date.trim()) body.start_date = options.start_date.trim();
  if (typeof options.end_date === 'string' && options.end_date.trim()) body.end_date = options.end_date.trim();
  if (Number.isFinite(options.days) && options.days > 0) body.days = Math.floor(options.days);

  return body;
}

function buildTavilyHeaders() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not set');
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const projectId = process.env.TAVILY_PROJECT_ID;
  if (typeof projectId === 'string' && projectId.trim()) {
    headers['X-Project-ID'] = projectId.trim();
  }

  return headers;
}

async function requestTavily(path, { method = 'POST', body, timeoutMs = TAVILY_TIMEOUT_MS, streamResponse = false } = {}) {
  const url = `${TAVILY_API_BASE_URL}${path}`;
  const headers = buildTavilyHeaders();
  let response = null;
  let lastError = null;

  for (let attempt = 0; attempt < TAVILY_MAX_RETRIES; attempt += 1) {
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body == null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastError = null;
    } catch (error) {
      lastError = error;
      if (attempt >= TAVILY_MAX_RETRIES - 1) {
        throw error;
      }
      await sleep(800 * (attempt + 1));
      continue;
    }

    if (response.ok) break;

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (!shouldRetry || attempt >= TAVILY_MAX_RETRIES - 1) break;
    await sleep(800 * (attempt + 1));
  }

  if (!response?.ok) {
    if (lastError) throw lastError;

    const rawText = response ? await response.text() : '';
    let message = rawText.trim();
    try {
      const payload = JSON.parse(rawText);
      message = normalizeTextValue(payload?.detail ?? payload?.error ?? payload?.message) || message;
    } catch {
      // ignore non-json error body
    }
    throw new Error(`Tavily API error: ${response?.status || 500} ${message}`.trim());
  }

  if (streamResponse) {
    return response;
  }

  const raw = await response.json();
  console.info('Tavily request completed', {
    provider: WEB_SEARCH_PROVIDER,
    path,
    requestId: raw?.request_id || null,
    responseTime: raw?.response_time || null,
    usage: raw?.usage || null,
  });
  return raw;
}

export function createTavilyClient() {
  return {
    search(body, options = {}) {
      return requestTavily('/search', { method: 'POST', body, ...options });
    },
    extract(body, options = {}) {
      return requestTavily('/extract', { method: 'POST', body, ...options });
    },
    crawl(body, options = {}) {
      return requestTavily('/crawl', { method: 'POST', body, ...options });
    },
    map(body, options = {}) {
      return requestTavily('/map', { method: 'POST', body, ...options });
    },
    createResearch(body, options = {}) {
      return requestTavily('/research', {
        method: 'POST',
        body,
        streamResponse: body?.stream === true,
        ...options,
      });
    },
    getResearch(requestId, options = {}) {
      return requestTavily(`/research/${requestId}`, { method: 'GET', ...options });
    },
    getUsage(options = {}) {
      return requestTavily('/usage', { method: 'GET', ...options });
    },
  };
}

export function buildSearchContext(summary, results, options = {}) {
  const maxResults = Number.isFinite(options.maxResults) && options.maxResults > 0 ? options.maxResults : 5;
  const maxSnippetChars = Number.isFinite(options.maxSnippetChars) && options.maxSnippetChars > 0
    ? options.maxSnippetChars
    : 280;
  const lines = [];
  const normalizedSummary = typeof summary === 'string' ? summary.trim() : '';
  const list = Array.isArray(results) ? results.slice(0, maxResults) : [];

  if (normalizedSummary) {
    lines.push('联网摘要:');
    lines.push(normalizedSummary);
  }

  if (list.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('联网来源:');
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      lines.push(`【${index + 1}】${item.title || item.url}`);
      lines.push(`URL: ${item.url}`);
      if (item.siteName) lines.push(`站点: ${item.siteName}`);
      const snippet = clipText(item.snippet, maxSnippetChars);
      if (snippet) lines.push(`摘录: ${snippet}`);
      if (index < list.length - 1) lines.push('');
    }
  }

  return lines.join('\n').trim();
}

export function buildSearchEventResults(results, maxItems = 0) {
  const list = Array.isArray(results)
    ? (maxItems > 0 ? results.slice(0, maxItems) : results)
    : [];

  return list
    .map((item) => ({
      url: item.url,
      title: item.title || item.url,
      siteName: item.siteName || '',
      datePublished: item.datePublished || '',
    }))
    .filter((item) => item.url);
}

export async function tavilySearch(query, options = {}) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (!normalizedQuery) {
    throw new Error('Search query is empty');
  }

  const client = createTavilyClient();
  const requestBody = buildTavilySearchRequestBody(normalizedQuery, options);
  const raw = await client.search(requestBody);
  const results = dedupeByUrl(
    (Array.isArray(raw?.results) ? raw.results : [])
      .map(normalizeTavilyResult)
      .filter(Boolean)
  );
  const citations = buildCitationsFromResults(results);
  const summary = normalizeTextValue(raw?.answer);

  if (!summary && results.length === 0) {
    throw new Error('Tavily Search returned no usable content');
  }

  return {
    summary,
    results,
    citations,
    contextText: buildSearchContext(summary, results, {
      maxResults: Number.isFinite(options.count) ? options.count : WEB_SEARCH_LIMIT,
      maxSnippetChars: 280,
    }),
    requestId: normalizeTextValue(raw?.request_id),
    raw,
  };
}

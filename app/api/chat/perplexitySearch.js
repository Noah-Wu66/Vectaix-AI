import {
  WEB_SEARCH_LIMIT,
  WEB_SEARCH_PROVIDER,
} from '@/lib/server/chat/webSearchConfig';

const PERPLEXITY_SEARCH_API_URL = 'https://api.perplexity.ai/search';
const PERPLEXITY_TIMEOUT_MS = 30000;
const PERPLEXITY_MAX_RETRIES = 3;
const DEFAULT_MAX_RESULTS = WEB_SEARCH_LIMIT;
const DEFAULT_MAX_TOKENS = 10000;
const DEFAULT_MAX_TOKENS_PER_PAGE = 4096;

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

function normalizePerplexityResult(item) {
  if (!item || typeof item !== 'object') return null;

  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!url) return null;

  const title = normalizeTextValue(item.title) || url;
  const snippet = normalizeTextValue(item.snippet ?? item.description ?? item.summary);
  const datePublished = normalizeTextValue(item.date ?? item.published_date ?? item.published_at);
  const lastUpdated = normalizeTextValue(item.last_updated ?? item.lastUpdated);

  return {
    title,
    url,
    snippet,
    siteName: extractHostname(url),
    datePublished,
    lastUpdated,
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

function normalizeDomains(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, 20);
}

function normalizeLanguageFilter(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length === 2)
    .slice(0, 20);
}

function normalizeQueryInput(query) {
  if (typeof query === 'string') {
    const trimmed = query.trim();
    return trimmed ? trimmed : '';
  }

  if (!Array.isArray(query)) return '';

  const list = query
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, 5);

  return list.length > 0 ? list : '';
}

function parseDateParts(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      month: value.getMonth() + 1,
      day: value.getDate(),
      year: value.getFullYear(),
    };
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return {
      month: Number.parseInt(slashMatch[1], 10),
      day: Number.parseInt(slashMatch[2], 10),
      year: Number.parseInt(slashMatch[3], 10),
    };
  }

  const dashMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dashMatch) {
    return {
      month: Number.parseInt(dashMatch[2], 10),
      day: Number.parseInt(dashMatch[3], 10),
      year: Number.parseInt(dashMatch[1], 10),
    };
  }

  return null;
}

function formatDateFilter(value) {
  const parts = parseDateParts(value);
  if (!parts) return '';

  const { month, day, year } = parts;
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000) return '';

  return `${month}/${day}/${year}`;
}

function mapFreshnessToRecency(freshness) {
  const normalized = typeof freshness === 'string' ? freshness.trim() : 'noLimit';
  return {
    oneDay: 'day',
    oneWeek: 'week',
    oneMonth: 'month',
    oneYear: 'year',
  }[normalized] || '';
}

function resolveDomainFilter(options = {}) {
  const explicitFilter = normalizeDomains(options.searchDomainFilter ?? options.search_domain_filter);
  if (explicitFilter.length > 0) {
    const hasAllow = explicitFilter.some((item) => !item.startsWith('-'));
    const hasDeny = explicitFilter.some((item) => item.startsWith('-'));
    if (hasAllow && hasDeny) {
      throw new Error('Perplexity search_domain_filter 不能混用白名单和黑名单');
    }
    return explicitFilter;
  }

  const includeDomains = normalizeDomains(options.includeDomains ?? options.include_domains);
  const excludeDomains = normalizeDomains(options.excludeDomains ?? options.exclude_domains)
    .map((item) => (item.startsWith('-') ? item : `-${item}`));

  if (includeDomains.length > 0 && excludeDomains.length > 0) {
    throw new Error('Perplexity 域名白名单和黑名单不能同时传入');
  }

  return includeDomains.length > 0 ? includeDomains : excludeDomains;
}

function flattenRawResults(results) {
  if (!Array.isArray(results)) return [];
  if (results.some(Array.isArray)) {
    return results.flatMap((group) => (Array.isArray(group) ? group : []));
  }
  return results;
}

function buildPerplexitySearchRequestBody(query, options = {}) {
  const normalizedQuery = normalizeQueryInput(query);
  if (!normalizedQuery || (Array.isArray(normalizedQuery) && normalizedQuery.length === 0)) {
    throw new Error('Search query is empty');
  }

  const maxResultsRaw = Number.isFinite(options.count)
    ? options.count
    : (Number.isFinite(options.maxResults) ? options.maxResults : options.max_results);
  const maxResults = Number.isFinite(maxResultsRaw) && maxResultsRaw > 0
    ? Math.min(Math.floor(maxResultsRaw), 20)
    : DEFAULT_MAX_RESULTS;

  const maxTokensRaw = Number.isFinite(options.maxTokens)
    ? options.maxTokens
    : options.max_tokens;
  const maxTokens = Number.isFinite(maxTokensRaw) && maxTokensRaw > 0
    ? Math.min(Math.floor(maxTokensRaw), 1000000)
    : DEFAULT_MAX_TOKENS;

  const maxTokensPerPageRaw = Number.isFinite(options.maxTokensPerPage)
    ? options.maxTokensPerPage
    : options.max_tokens_per_page;
  const maxTokensPerPage = Number.isFinite(maxTokensPerPageRaw) && maxTokensPerPageRaw > 0
    ? Math.min(Math.floor(maxTokensPerPageRaw), 1000000)
    : DEFAULT_MAX_TOKENS_PER_PAGE;

  const country = typeof options.country === 'string' ? options.country.trim().toUpperCase() : '';
  const searchLanguageFilter = normalizeLanguageFilter(
    options.searchLanguageFilter ?? options.search_language_filter
  );
  const searchDomainFilter = resolveDomainFilter(options);

  const searchAfterDateFilter = formatDateFilter(
    options.searchAfterDateFilter ?? options.search_after_date_filter ?? options.startDate ?? options.start_date
  );
  const searchBeforeDateFilter = formatDateFilter(
    options.searchBeforeDateFilter ?? options.search_before_date_filter ?? options.endDate ?? options.end_date
  );
  const lastUpdatedAfterFilter = formatDateFilter(
    options.lastUpdatedAfterFilter ?? options.last_updated_after_filter
  );
  const lastUpdatedBeforeFilter = formatDateFilter(
    options.lastUpdatedBeforeFilter ?? options.last_updated_before_filter
  );

  const searchRecencyFilter = typeof (options.searchRecencyFilter ?? options.search_recency_filter) === 'string'
    ? (options.searchRecencyFilter ?? options.search_recency_filter).trim()
    : mapFreshnessToRecency(options.freshness);

  const hasDateFilter = Boolean(
    searchAfterDateFilter
    || searchBeforeDateFilter
    || lastUpdatedAfterFilter
    || lastUpdatedBeforeFilter
  );

  if (searchRecencyFilter && hasDateFilter) {
    throw new Error('Perplexity search_recency_filter 不能和具体日期过滤同时使用');
  }

  const body = {
    query: normalizedQuery,
    max_results: maxResults,
    max_tokens: maxTokens,
    max_tokens_per_page: maxTokensPerPage,
  };

  if (country && country.length === 2) body.country = country;
  if (searchLanguageFilter.length > 0) body.search_language_filter = searchLanguageFilter;
  if (searchDomainFilter.length > 0) body.search_domain_filter = searchDomainFilter;
  if (searchAfterDateFilter) body.search_after_date_filter = searchAfterDateFilter;
  if (searchBeforeDateFilter) body.search_before_date_filter = searchBeforeDateFilter;
  if (lastUpdatedAfterFilter) body.last_updated_after_filter = lastUpdatedAfterFilter;
  if (lastUpdatedBeforeFilter) body.last_updated_before_filter = lastUpdatedBeforeFilter;
  if (searchRecencyFilter) body.search_recency_filter = searchRecencyFilter;

  return body;
}

function buildPerplexityHeaders() {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY is not set');
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function requestPerplexity(body, { timeoutMs = PERPLEXITY_TIMEOUT_MS } = {}) {
  const headers = buildPerplexityHeaders();
  let response = null;
  let lastError = null;

  for (let attempt = 0; attempt < PERPLEXITY_MAX_RETRIES; attempt += 1) {
    try {
      response = await fetch(PERPLEXITY_SEARCH_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastError = null;
    } catch (error) {
      lastError = error;
      if (attempt >= PERPLEXITY_MAX_RETRIES - 1) {
        throw error;
      }
      await sleep((500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
      continue;
    }

    if (response.ok) break;

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (!shouldRetry || attempt >= PERPLEXITY_MAX_RETRIES - 1) break;
    await sleep((500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
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
    throw new Error(`Perplexity API error: ${response?.status || 500} ${message}`.trim());
  }

  const raw = await response.json();
  console.info('Perplexity request completed', {
    provider: WEB_SEARCH_PROVIDER,
    id: raw?.id || null,
    serverTime: raw?.server_time || null,
  });
  return raw;
}

function buildDeterministicSummary(results, options = {}) {
  const maxItems = Number.isFinite(options.maxItems) && options.maxItems > 0 ? options.maxItems : 3;
  const maxSnippetChars = Number.isFinite(options.maxSnippetChars) && options.maxSnippetChars > 0
    ? options.maxSnippetChars
    : 180;

  const parts = [];
  for (const item of Array.isArray(results) ? results.slice(0, maxItems) : []) {
    const snippet = clipText(item?.snippet, maxSnippetChars);
    const title = normalizeTextValue(item?.title);
    if (snippet && title) {
      parts.push(`${title}：${snippet}`);
    } else if (snippet) {
      parts.push(snippet);
    } else if (title) {
      parts.push(title);
    }
  }

  return parts.join('；').trim();
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
      if (item.datePublished) lines.push(`发布时间: ${item.datePublished}`);
      if (item.lastUpdated) lines.push(`更新时间: ${item.lastUpdated}`);
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

export async function perplexitySearch(query, options = {}) {
  const requestBody = buildPerplexitySearchRequestBody(query, options);
  const raw = await requestPerplexity(requestBody);
  const results = dedupeByUrl(
    flattenRawResults(raw?.results)
      .map(normalizePerplexityResult)
      .filter(Boolean)
  );
  const citations = buildCitationsFromResults(results);
  const summary = buildDeterministicSummary(results, {
    maxItems: 3,
    maxSnippetChars: 180,
  });

  if (!summary && results.length === 0) {
    throw new Error('Perplexity Search returned no usable content');
  }

  return {
    summary,
    results,
    citations,
    contextText: buildSearchContext(summary, results, {
      maxResults: Number.isFinite(options.count) ? options.count : WEB_SEARCH_LIMIT,
      maxSnippetChars: 280,
    }),
    requestId: normalizeTextValue(raw?.id),
    raw,
  };
}

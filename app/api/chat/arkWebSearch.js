import { isNonEmptyString } from '@/app/api/chat/utils';
import {
  ARK_WEB_SEARCH_LIMIT,
  ARK_WEB_SEARCH_SINGLE_ROUND_TOOL_CALLS,
  createArkWebSearchTool,
} from '@/app/lib/arkWebSearchConfig';
import { SEED_MODEL_ID } from '@/app/lib/seedModel';

const ARK_API_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const ARK_WEB_SEARCH_TIMEOUT_MS = 30000;
const ARK_WEB_SEARCH_MAX_RETRIES = 2;
const DEFAULT_MAX_RESULTS = ARK_WEB_SEARCH_LIMIT;

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
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item.text === 'string') return item.text;
      if (item && typeof item.content === 'string') return item.content;
      return '';
    }).join('');
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
  }
  return '';
}

export function isArkWebSearchOutputItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (typeof item.type === 'string' && item.type.includes('web_search_call')) return true;
  return typeof item.id === 'string' && item.id.startsWith('ws_');
}

export function normalizeArkCitation(annotation) {
  if (!annotation || typeof annotation !== 'object') return null;

  const url = annotation.url
    ?? annotation.uri
    ?? annotation?.source?.url
    ?? annotation?.url_citation?.url
    ?? annotation?.web_search_result?.url;
  const title = annotation.title
    ?? annotation?.source?.title
    ?? annotation?.url_citation?.title
    ?? annotation?.web_search_result?.title
    ?? url;
  const citedText = annotation.cited_text
    ?? annotation.quote
    ?? annotation.text
    ?? annotation?.url_citation?.text;

  if (!isNonEmptyString(url)) return null;

  const citation = {
    url,
    title: isNonEmptyString(title) ? title : url,
  };

  if (isNonEmptyString(citedText)) {
    citation.cited_text = citedText.trim();
  }

  return citation;
}

function extractCitationsFromContent(content) {
  const items = Array.isArray(content) ? content : [];
  return items
    .flatMap((item) => Array.isArray(item?.annotations) ? item.annotations : [])
    .map(normalizeArkCitation)
    .filter(Boolean);
}

function extractCitationsFromOutputItem(item) {
  if (!item || typeof item !== 'object') return [];
  if (item.type !== 'message') return [];
  return extractCitationsFromContent(item.content);
}

export function extractArkCitationsFromResponsePayload(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  return outputs.flatMap((item) => extractCitationsFromOutputItem(item));
}

function dedupeCitations(items) {
  const citations = [];
  const seenUrls = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    citations.push(item);
  }

  return citations;
}

export function buildArkSearchResults(citations, maxItems = 0) {
  const list = Array.isArray(citations)
    ? (maxItems > 0 ? citations.slice(0, maxItems) : citations)
    : [];

  return list
    .map((item) => ({
      title: item.title || item.url,
      url: item.url,
      snippet: isNonEmptyString(item.cited_text) ? item.cited_text.trim() : '',
      siteName: extractHostname(item.url),
      datePublished: '',
    }))
    .filter((item) => item.url);
}

export function buildArkSearchContext(summary, results, options = {}) {
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

export function buildArkSearchEventResults(results, maxItems = 0) {
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

export function extractArkResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  return outputs
    .filter((item) => item?.type === 'message')
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((item) => normalizeTextValue(item?.text ?? item))
    .join('')
    .trim();
}

function buildArkWebSearchRequestBody(query, options = {}) {
  const limit = Number.isFinite(options.count) && options.count > 0
    ? Math.min(Math.floor(options.count), 50)
    : DEFAULT_MAX_RESULTS;
  const maxToolCalls = Number.isFinite(options.maxToolCalls) && options.maxToolCalls > 0
    ? Math.min(Math.floor(options.maxToolCalls), 10)
    : ARK_WEB_SEARCH_SINGLE_ROUND_TOOL_CALLS;
  const freshness = typeof options.freshness === 'string' ? options.freshness.trim() : 'noLimit';
  const freshnessHint = {
    oneDay: '优先关注最近 24 小时内的信息。',
    oneWeek: '优先关注最近一周内的信息。',
    oneMonth: '优先关注最近一个月内的信息。',
    oneYear: '优先关注最近一年内的重要变化。',
    noLimit: '',
  }[freshness] || '';
  const inputLines = [
    `搜索词：${query}`,
    freshnessHint,
    '请必须先使用 web_search 工具联网检索这个搜索词，再输出一段可供下游模型引用的简洁事实摘要。只依据联网结果总结，不要编造，不要输出链接列表。',
  ].filter(Boolean);

  return {
    model: SEED_MODEL_ID,
    stream: false,
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: inputLines.join('\n'),
      }],
    }],
    instructions: '你是联网搜索整理助手。你必须先使用 web_search 工具检索，再基于检索结果输出简洁可靠的纯文本摘要。优先保留最新事实、官方信息和关键数字；如果不同来源说法冲突，要明确说明。输出使用简体中文，不要使用 Markdown 标题。',
    max_output_tokens: 900,
    temperature: 0.2,
    top_p: 0.95,
    thinking: { type: 'disabled' },
    tools: [createArkWebSearchTool({ limit })],
    max_tool_calls: maxToolCalls,
  };
}

export async function arkWebSearch(query, options = {}) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    throw new Error('ARK_API_KEY is not set');
  }

  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (!normalizedQuery) {
    throw new Error('Search query is empty');
  }

  const requestBody = buildArkWebSearchRequestBody(normalizedQuery, options);
  const url = `${ARK_API_BASE_URL}/responses`;

  let response = null;
  let lastError = null;
  for (let attempt = 0; attempt < ARK_WEB_SEARCH_MAX_RETRIES; attempt += 1) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(ARK_WEB_SEARCH_TIMEOUT_MS),
      });
      lastError = null;
    } catch (error) {
      lastError = error;
      if (attempt >= ARK_WEB_SEARCH_MAX_RETRIES - 1) {
        throw error;
      }
      await sleep(800 * (attempt + 1));
      continue;
    }

    if (response.ok) break;
    if (response.status < 500 || attempt >= ARK_WEB_SEARCH_MAX_RETRIES - 1) break;
    await sleep(800 * (attempt + 1));
  }

  if (!response?.ok) {
    if (lastError) throw lastError;
    const errorText = response ? await response.text() : '';
    throw new Error(`Ark Web Search error: ${response?.status || 500} ${errorText}`.trim());
  }

  const raw = await response.json();
  const citations = dedupeCitations(extractArkCitationsFromResponsePayload(raw));
  const results = buildArkSearchResults(citations, Number.isFinite(options.count) ? options.count : 0);
  const summary = extractArkResponseText(raw);
  const outputs = Array.isArray(raw?.output) ? raw.output : [];
  const usedWebSearch = outputs.some((item) => isArkWebSearchOutputItem(item)) || citations.length > 0;

  if (!usedWebSearch) {
    throw new Error('Ark Web Search did not invoke web_search tool');
  }

  if (!summary && results.length === 0) {
    throw new Error('Ark Web Search returned no usable content');
  }

  return {
    summary,
    results,
    citations,
    raw,
    usedWebSearch,
  };
}

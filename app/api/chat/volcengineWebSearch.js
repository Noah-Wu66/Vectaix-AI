import {
  WEB_SEARCH_LIMIT,
  WEB_SEARCH_MIN_REQUEST_INTERVAL_MS,
  WEB_SEARCH_PROVIDER,
} from '@/lib/server/chat/webSearchConfig';
import { WEB_SEARCH_MAX_COUNT } from '@/lib/shared/webSearch';

const VOLCENGINE_WEB_SEARCH_API_URL = 'https://open.feedcoopapi.com/search_api/web_search';
const VOLCENGINE_TIMEOUT_MS = 30000;
const VOLCENGINE_MAX_RETRIES = 3;
const DEFAULT_MAX_RESULTS = WEB_SEARCH_LIMIT;

let volcengineSearchQueue = Promise.resolve();
let lastVolcengineRequestStartedAt = 0;

function toAbortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof signal?.reason === 'string' && signal.reason) {
    return new Error(signal.reason);
  }
  return new Error('Request aborted');
}

function enqueueVolcengineSearch(task, { signal } = {}) {
  const previousTask = volcengineSearchQueue.catch(() => undefined);
  const queuedTask = previousTask.then(async () => {
    if (signal?.aborted) {
      throw toAbortError(signal);
    }
    return task();
  });

  volcengineSearchQueue = queuedTask.catch(() => undefined);
  return queuedTask;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepWithSignal(ms, signal) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  if (!signal) {
    await sleep(ms);
    return;
  }
  if (signal.aborted) {
    throw toAbortError(signal);
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(toAbortError(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForVolcengineRequestSlot(signal) {
  const waitMs = Math.max(0, (lastVolcengineRequestStartedAt + WEB_SEARCH_MIN_REQUEST_INTERVAL_MS) - Date.now());
  await sleepWithSignal(waitMs, signal);
  lastVolcengineRequestStartedAt = Date.now();
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

function normalizeVolcengineResult(item) {
  if (!item || typeof item !== 'object') return null;

  const url = typeof item.Url === 'string' ? item.Url.trim() : '';
  if (!url) return null;

  const title = normalizeTextValue(item.Title) || url;
  const snippet = normalizeTextValue(item.Snippet ?? item.Summary ?? item.Content);
  const datePublished = normalizeTextValue(item.PublishTime);

  return {
    title,
    url,
    snippet,
    siteName: normalizeTextValue(item.SiteName) || extractHostname(url),
    datePublished,
    lastUpdated: '',
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

function normalizeQueryInput(query) {
  if (typeof query !== 'string') return '';
  return query.trim().slice(0, 100);
}

function buildVolcengineSearchRequestBody(query, options = {}) {
  const normalizedQuery = normalizeQueryInput(query);
  if (!normalizedQuery) {
    throw new Error('Search query is empty');
  }

  const maxResultsRaw = Number.isFinite(options.count)
    ? options.count
    : (Number.isFinite(options.maxResults) ? options.maxResults : options.max_results);
  const maxResults = Number.isFinite(maxResultsRaw) && maxResultsRaw > 0
    ? Math.min(Math.floor(maxResultsRaw), WEB_SEARCH_MAX_COUNT)
    : DEFAULT_MAX_RESULTS;
  const timeRange = typeof options.timeRange === 'string' ? options.timeRange.trim() : '';
  const needContent = options.needContent === true;
  const needUrl = options.needUrl === true;
  const sites = typeof options.sites === 'string' ? options.sites.trim() : '';
  const blockHosts = typeof options.blockHosts === 'string' ? options.blockHosts.trim() : '';
  const authInfoLevel = Number(options.authInfoLevel) === 1 ? 1 : 0;
  const queryRewrite = options.queryRewrite === true;
  const industry = typeof options.industry === 'string' ? options.industry.trim() : '';

  const body = {
    Query: normalizedQuery,
    SearchType: 'web_summary',
    Count: maxResults,
    Filter: {
      NeedContent: needContent,
      NeedUrl: needUrl,
      AuthInfoLevel: authInfoLevel,
    },
    NeedSummary: true,
  };

  if (timeRange) {
    body.TimeRange = timeRange;
  }
  if (sites) {
    body.Filter.Sites = sites;
  }
  if (blockHosts) {
    body.Filter.BlockHosts = blockHosts;
  }
  if (queryRewrite) {
    body.QueryControl = { QueryRewrite: true };
  }
  if (industry) {
    body.Industry = industry;
  }

  return body;
}

function buildVolcengineHeaders() {
  const apiKey = process.env.VOLCENGINE_WEB_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error('VOLCENGINE_WEB_SEARCH_API_KEY is not set');
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };
}

function buildRequestSignal({ timeoutMs = VOLCENGINE_TIMEOUT_MS, signal } = {}) {
  const hasFiniteTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  if (signal && hasFiniteTimeout) {
    return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  }
  if (signal) return signal;
  if (hasFiniteTimeout) return AbortSignal.timeout(timeoutMs);
  return undefined;
}

function extractJsonObjects(rawText) {
  const text = typeof rawText === 'string' ? rawText : '';
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start < 0) {
      if (char === '{') {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function parseVolcenginePayloads(rawText) {
  const jsonObjects = extractJsonObjects(rawText);
  if (jsonObjects.length === 0) {
    throw new Error('火山联网搜索返回了空响应');
  }

  return jsonObjects
    .map((item) => {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getVolcengineErrorText(payload) {
  const errorMeta = payload?.ResponseMetadata?.Error;
  if (!errorMeta) return '';
  const code = normalizeTextValue(errorMeta.Code ?? errorMeta.CodeN);
  const message = normalizeTextValue(errorMeta.Message);
  return [code, message].filter(Boolean).join(' ').trim();
}

function summarizeVolcengineResponse(rawText) {
  const payloads = parseVolcenginePayloads(rawText);
  let requestId = '';
  let summaryFromDelta = '';
  let summaryFromMessage = '';
  const rawResults = [];

  for (const payload of payloads) {
    const errorText = getVolcengineErrorText(payload);
    if (errorText) {
      throw new Error(`Volcengine API error: ${errorText}`);
    }

    requestId ||= normalizeTextValue(
      payload?.ResponseMetadata?.RequestId ?? payload?.Result?.LogId
    );

    const webResults = Array.isArray(payload?.Result?.WebResults) ? payload.Result.WebResults : [];
    if (webResults.length > 0) {
      rawResults.push(...webResults);
    }

    const choices = Array.isArray(payload?.Result?.Choices) ? payload.Result.Choices : [];
    for (const choice of choices) {
      const deltaText = normalizeTextValue(choice?.Delta?.Content ?? choice?.Delta);
      if (deltaText) {
        summaryFromDelta += deltaText;
      }

      const messageText = normalizeTextValue(choice?.Message?.Content ?? choice?.Message);
      if (messageText && messageText.length > summaryFromMessage.length) {
        summaryFromMessage = messageText;
      }
    }
  }

  const results = dedupeByUrl(rawResults.map(normalizeVolcengineResult).filter(Boolean));
  const citations = buildCitationsFromResults(results);
  const summary = (summaryFromDelta || summaryFromMessage).trim();

  if (!summary && results.length === 0) {
    throw new Error('Volcengine Search returned no usable content');
  }

  return {
    summary,
    results,
    citations,
    requestId,
    raw: payloads,
  };
}

async function requestVolcengine(body, { timeoutMs = VOLCENGINE_TIMEOUT_MS, signal } = {}) {
  return enqueueVolcengineSearch(async () => {
    const headers = buildVolcengineHeaders();
    let response = null;
    let lastError = null;

    for (let attempt = 0; attempt < VOLCENGINE_MAX_RETRIES; attempt += 1) {
      if (signal?.aborted) {
        throw toAbortError(signal);
      }

      try {
        await waitForVolcengineRequestSlot(signal);
        response = await fetch(VOLCENGINE_WEB_SEARCH_API_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: buildRequestSignal({ timeoutMs, signal }),
        });
        lastError = null;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) {
          throw toAbortError(signal);
        }
        if (attempt >= VOLCENGINE_MAX_RETRIES - 1) {
          throw error;
        }
        await sleep((500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
        continue;
      }

      if (response.ok) break;

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || attempt >= VOLCENGINE_MAX_RETRIES - 1) break;
      await sleep((500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
    }

    if (!response?.ok) {
      if (lastError) throw lastError;

      const rawText = response ? await response.text() : '';
      let message = rawText.trim();
      try {
        const payload = JSON.parse(rawText);
        message = getVolcengineErrorText(payload) || message;
      } catch {
        // ignore non-json error body
      }
      throw new Error(`Volcengine API error: ${response?.status || 500} ${message}`.trim());
    }

    return response.text();
  }, { signal });
}

export function buildSearchContext(summary) {
  const normalizedSummary = typeof summary === 'string' ? summary.trim() : '';
  if (!normalizedSummary) return '';
  return `联网摘要:\n${normalizedSummary}`;
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

export async function volcengineWebSearch(query, options = {}) {
  const requestBody = buildVolcengineSearchRequestBody(query, options);
  const rawText = await requestVolcengine(requestBody, {
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  const parsed = summarizeVolcengineResponse(rawText);

  console.info('Volcengine request completed', {
    provider: WEB_SEARCH_PROVIDER,
    requestId: parsed.requestId || null,
  });

  return {
    summary: parsed.summary,
    results: parsed.results,
    citations: parsed.citations,
    contextText: buildSearchContext(parsed.summary),
    requestId: parsed.requestId,
    raw: parsed.raw,
  };
}

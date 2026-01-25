const DEFAULT_SCOPE = "webpage";
const DEFAULT_SIZE = 20;
const DEFAULT_TIMEOUT_MS = 15000;

function clipText(text, maxLen) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLen) || maxLen <= 0) return trimmed;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
}

export function normalizeMetasoResults(webpages) {
  if (!Array.isArray(webpages)) return [];
  return webpages
    .map((item) => {
      const url = item?.link || item?.url || "";
      return {
        title: typeof item?.title === "string" ? item.title : "",
        url,
        summary: typeof item?.summary === "string" ? item.summary : "",
        snippet: typeof item?.snippet === "string" ? item.snippet : "",
        score: typeof item?.score === "string" ? item.score : "",
        date: typeof item?.date === "string" ? item.date : "",
      };
    })
    .filter((item) => typeof item.url === "string" && item.url.trim());
}

export function buildMetasoContext(results, options = {}) {
  const maxItems = Number.isFinite(options.maxItems) ? options.maxItems : 8;
  const maxSummaryChars = Number.isFinite(options.maxSummaryChars) ? options.maxSummaryChars : 320;
  const maxSnippetChars = Number.isFinite(options.maxSnippetChars) ? options.maxSnippetChars : 320;
  const items = Array.isArray(results) ? results.slice(0, maxItems) : [];
  return items
    .map((item, idx) => {
      const lines = [];
      const title = item.title || "未命名";
      lines.push(`【${idx + 1}】${title}`);
      lines.push(`URL: ${item.url}`);
      const summary = clipText(item.summary, maxSummaryChars);
      if (summary) lines.push(`摘要: ${summary}`);
      const snippet = clipText(item.snippet, maxSnippetChars);
      if (snippet && snippet !== summary) lines.push(`片段: ${snippet}`);
      if (item.date) lines.push(`日期: ${item.date}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function buildMetasoCitations(results) {
  const citations = [];
  const seen = new Set();
  for (const item of results || []) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    citations.push({ url: item.url, title: item.title || null });
  }
  return citations;
}

export function buildMetasoSearchEventResults(results, maxItems = 10) {
  const list = Array.isArray(results) ? results.slice(0, maxItems) : [];
  return list
    .map((item) => ({ url: item.url, title: item.title || null }))
    .filter((item) => item.url);
}

export async function metasoSearch(query, options = {}) {
  const apiKey = process.env.METASO_API_KEY;
  if (!apiKey) {
    throw new Error("METASO_API_KEY is not set");
  }
  const baseUrl = process.env.METASO_BASE_URL || "https://metaso.cn";
  const size = Number.isFinite(options.size) ? options.size : DEFAULT_SIZE;
  const scope = typeof options.scope === "string" ? options.scope : DEFAULT_SCOPE;
  const includeSummary = options.includeSummary !== false;
  const includeRawContent = options.includeRawContent === true;
  const conciseSnippet = options.conciseSnippet === true;
  const searchFile = options.searchFile === true;

  const payload = {
    q: query,
    scope,
    includeSummary,
    size,
    includeRawContent,
    conciseSnippet,
    searchFile,
  };

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/v1/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`MetaSo API error: ${res.status} ${errorText}`);
    }

    const data = await res.json();
    const results = normalizeMetasoResults(data?.webpages || []);
    return {
      credits: data?.credits ?? null,
      results,
      raw: data || null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

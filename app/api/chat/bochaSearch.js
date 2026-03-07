function clipText(text, maxLen) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(maxLen) || maxLen <= 0) return trimmed;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
}

function normalizeSummary(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item.text === "string") return item.text.trim();
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (typeof value.content === "string") return value.content.trim();
  }
  return "";
}

function normalizeDatePublished(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function normalizeBochaResults(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const url = typeof item?.url === "string"
        ? item.url.trim()
        : (typeof item?.link === "string" ? item.link.trim() : "");
      const title = typeof item?.name === "string"
        ? item.name.trim()
        : (typeof item?.title === "string" ? item.title.trim() : "");
      const snippet = typeof item?.snippet === "string"
        ? item.snippet.trim()
        : (typeof item?.summary === "string"
          ? item.summary.trim()
          : (typeof item?.description === "string" ? item.description.trim() : ""));
      const siteName = typeof item?.siteName === "string"
        ? item.siteName.trim()
        : (typeof item?.site === "string" ? item.site.trim() : "");
      const datePublished = normalizeDatePublished(item?.datePublished || item?.date || item?.publishedAt);

      return {
        title: title || url,
        url,
        snippet,
        siteName: siteName || extractHostname(url),
        datePublished,
      };
    })
    .filter((item) => item.url);
}

export function buildBochaContext(summary, results, options = {}) {
  const maxResults = Number.isFinite(options.maxResults) && options.maxResults > 0 ? options.maxResults : 5;
  const maxSnippetChars = Number.isFinite(options.maxSnippetChars) && options.maxSnippetChars > 0
    ? options.maxSnippetChars
    : 280;
  const lines = [];
  const normalizedSummary = normalizeSummary(summary);
  const list = Array.isArray(results) ? results.slice(0, maxResults) : [];

  if (normalizedSummary) {
    lines.push("博查摘要:");
    lines.push(normalizedSummary);
  }

  if (list.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("博查结果:");
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      lines.push(`【${index + 1}】${item.title || item.url}`);
      lines.push(`URL: ${item.url}`);
      if (item.siteName) lines.push(`站点: ${item.siteName}`);
      if (item.datePublished) lines.push(`发布时间: ${item.datePublished}`);
      const snippet = clipText(item.snippet, maxSnippetChars);
      if (snippet) lines.push(`摘要: ${snippet}`);
      if (index < list.length - 1) lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export function buildBochaCitations(results) {
  const citations = [];
  const seen = new Set();
  for (const item of Array.isArray(results) ? results : []) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    citations.push({ url: item.url, title: item.title || item.url });
  }
  return citations;
}

export function buildBochaSearchEventResults(results, maxItems = 0) {
  const list = Array.isArray(results)
    ? (maxItems > 0 ? results.slice(0, maxItems) : results)
    : [];

  return list
    .map((item) => ({
      url: item.url,
      title: item.title || item.url,
      siteName: item.siteName || "",
      datePublished: item.datePublished || "",
    }))
    .filter((item) => item.url);
}

export async function bochaSearch(query, options = {}) {
  const apiKey = process.env.BOCHA_API_KEY;
  if (!apiKey) {
    throw new Error("BOCHA_API_KEY is not set");
  }

  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (!normalizedQuery) {
    throw new Error("Search query is empty");
  }

  const payload = {
    query: normalizedQuery,
    summary: options.summary !== false,
    count: Number.isFinite(options.count) && options.count > 0 ? options.count : 8,
    stream: false,
  };

  if (typeof options.freshness === "string" && options.freshness.trim()) {
    payload.freshness = options.freshness.trim();
  }

  const response = await fetch("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bocha API error: ${response.status} ${errorText}`);
  }

  const raw = await response.json();
  const root = raw?.data && typeof raw.data === "object" ? raw.data : raw;
  const webPages = root?.webPages && typeof root.webPages === "object" ? root.webPages : {};
  const summary = normalizeSummary(root?.summary || webPages?.summary);
  const results = normalizeBochaResults(webPages?.value || root?.value || root?.results);

  return {
    summary,
    results,
    raw,
  };
}
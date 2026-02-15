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
      const url = item?.link;
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
  const maxItems = options.maxItems;
  const maxSummaryChars = options.maxSummaryChars;
  const maxSnippetChars = options.maxSnippetChars;
  const items = Array.isArray(results)
    ? (maxItems > 0 ? results.slice(0, maxItems) : results)
    : results;
  return items
    .map((item, idx) => {
      const lines = [];
      const title = item.title;
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
  for (const item of results) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    citations.push({ url: item.url, title: item.title });
  }
  return citations;
}

export function buildMetasoSearchEventResults(results, maxItems = 0) {
  const list = Array.isArray(results)
    ? (maxItems > 0 ? results.slice(0, maxItems) : results)
    : results;
  return list
    .map((item) => ({ url: item.url, title: item.title }))
    .filter((item) => item.url);
}

export function buildMetasoReaderContext(page, options = {}) {
  const url = typeof page?.url === "string" ? page.url.trim() : "";
  if (!url) return "";
  const title = typeof page?.title === "string" ? page.title.trim() : "";
  const content = clipText(page?.content, options.maxContentChars);
  if (!content) return "";

  const lines = [];
  lines.push(`【全文】${title || url}`);
  lines.push(`URL: ${url}`);
  lines.push("正文:");
  lines.push(content);
  return lines.join("\n");
}

export async function metasoReader(url) {
  const apiKey = process.env.METASO_API_KEY;
  if (!apiKey) {
    throw new Error("METASO_API_KEY is not set");
  }

  const normalizedUrl = typeof url === "string" ? url.trim() : "";

  const baseUrl = "https://metaso.cn";

  console.info("MetaSo reader request", {
    url: normalizedUrl,
    baseUrl,
  });

  const res = await fetch(`${baseUrl}/api/v1/reader`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "text/plain",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: normalizedUrl }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("MetaSo reader response error", {
      status: res.status,
      statusText: res.statusText,
      errorText,
    });
    throw new Error(`MetaSo reader error: ${res.status} ${errorText}`);
  }

  const content = await res.text();
  const normalizedContent = typeof content === "string" ? content.trim() : "";
  console.info("MetaSo reader response ok", {
    status: res.status,
    contentChars: normalizedContent.length,
  });

  return {
    content: normalizedContent,
  };
}

export async function metasoSearch(query, options = {}) {
  const apiKey = process.env.METASO_API_KEY;
  if (!apiKey) {
    throw new Error("METASO_API_KEY is not set");
  }
  const baseUrl = "https://metaso.cn";
  const size = options.size;
  const scope = options.scope;
  const includeSummary = options.includeSummary !== false;
  const includeRawContent = options.includeRawContent === true;
  const conciseSnippet = options.conciseSnippet === true;
  const payload = {
    q: query,
    scope,
    includeSummary,
    size,
    includeRawContent,
    conciseSnippet,
  };

  console.info("MetaSo search request", {
    query,
    baseUrl,
    scope,
    size,
    includeSummary,
    includeRawContent,
    conciseSnippet,
  });

  const res = await fetch(`${baseUrl}/api/v1/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("MetaSo search response error", {
      status: res.status,
      statusText: res.statusText,
      errorText,
    });
    throw new Error(`MetaSo API error: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  const results = normalizeMetasoResults(data?.webpages);
  console.info("MetaSo search response ok", {
    status: res.status,
    credits: data?.credits,
    resultCount: Array.isArray(results) ? results.length : 0,
  });
  return {
    credits: data?.credits,
    results,
    raw: data,
  };
}

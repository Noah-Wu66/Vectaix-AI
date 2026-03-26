const MAX_TOOLS = 20;
const MAX_ARTIFACTS = 20;

function clipText(text, maxLength = 8000) {
  if (typeof text !== "string") return "";
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (typeof value === "string") return clipText(value, 4000);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 12)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return undefined;
  const next = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    const sanitized = sanitizeJsonValue(item, depth + 1);
    if (sanitized !== undefined) next[key] = sanitized;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeTimeline(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((step) => step && typeof step === "object")
    .map((step) => ({
      id: typeof step.id === "string" ? step.id : "",
      kind: typeof step.kind === "string" ? step.kind : "thought",
      status: typeof step.status === "string" ? step.status : "done",
      title: typeof step.title === "string" ? clipText(step.title, 300) : "",
      content: typeof step.content === "string" ? clipText(step.content, 20000) : "",
      message: typeof step.message === "string" ? clipText(step.message, 1000) : "",
      query: typeof step.query === "string" ? clipText(step.query, 500) : "",
      url: typeof step.url === "string" ? clipText(step.url, 2048) : "",
      round: Number.isFinite(step.round) ? step.round : null,
      resultCount: Number.isFinite(step.resultCount) ? step.resultCount : null,
      synthetic: step.synthetic === true,
    }));
}

function sanitizeCitations(citations) {
  if (!Array.isArray(citations)) return [];
  return citations
    .filter((item) => item && typeof item === "object" && typeof item.url === "string" && item.url)
    .slice(0, 20)
    .map((item) => ({
      url: clipText(item.url, 2048),
      title: typeof item.title === "string" ? clipText(item.title, 200) : "",
      ...(typeof item.cited_text === "string" && item.cited_text
        ? { cited_text: clipText(item.cited_text, 1000) }
        : {}),
    }));
}

function sanitizeArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .filter((item) => item && typeof item === "object" && typeof item.url === "string" && item.url)
    .slice(0, MAX_ARTIFACTS)
    .map((item) => ({
      url: clipText(item.url, 2048),
      title: typeof item.title === "string" ? clipText(item.title, 200) : "",
      pathname: typeof item.pathname === "string" ? clipText(item.pathname, 512) : "",
      mimeType: typeof item.mimeType === "string" ? clipText(item.mimeType, 120) : "",
      extension: typeof item.extension === "string" ? clipText(item.extension, 32) : "",
      size: Number.isFinite(item.size) ? Math.max(0, Math.floor(item.size)) : 0,
    }));
}

function sanitizeTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((item) => item && typeof item === "object" && typeof item.id === "string" && item.id)
    .slice(0, MAX_TOOLS)
    .map((item) => {
      const out = {
        id: item.id,
        identifier: typeof item.identifier === "string" ? clipText(item.identifier, 120) : "",
        apiName: typeof item.apiName === "string" ? clipText(item.apiName, 120) : "",
        type: typeof item.type === "string" ? clipText(item.type, 32) : "builtin",
        status: typeof item.status === "string" ? clipText(item.status, 32) : "success",
      };

      if (typeof item.title === "string" && item.title) out.title = clipText(item.title, 300);
      if (typeof item.summary === "string" && item.summary) out.summary = clipText(item.summary, 4000);
      if (typeof item.content === "string" && item.content) out.content = clipText(item.content, 8000);
      if (typeof item.startedAt === "string" && item.startedAt) out.startedAt = item.startedAt;
      if (typeof item.finishedAt === "string" && item.finishedAt) out.finishedAt = item.finishedAt;

      const args = sanitizeJsonValue(item.arguments);
      if (args !== undefined) out.arguments = args;

      const state = sanitizeJsonValue(item.state);
      if (state !== undefined) out.state = state;

      const citations = sanitizeCitations(item.citations);
      if (citations.length > 0) out.citations = citations;

      const artifacts = sanitizeArtifacts(item.artifacts);
      if (artifacts.length > 0) out.artifacts = artifacts;

      return out;
    });
}

export function serializeRuntimeState(state = {}) {
  const content = typeof state.content === "string" ? state.content : "";
  if (!content.trim()) {
    throw new Error("Agent 未生成结果");
  }

  const out = {
    content,
    thought: typeof state.thought === "string" ? state.thought : "",
    citations: sanitizeCitations(state.citations),
    thinkingTimeline: sanitizeTimeline(state.thinkingTimeline),
    tools: sanitizeTools(state.tools),
    artifacts: sanitizeArtifacts(state.artifacts),
  };

  if (Number.isFinite(state.searchContextTokens) && state.searchContextTokens > 0) {
    out.searchContextTokens = Math.max(0, Math.floor(state.searchContextTokens));
  }

  return out;
}

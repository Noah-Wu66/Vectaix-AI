function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function upsertById(list, entry) {
  const next = Array.isArray(list) ? list.slice() : [];
  if (!entry?.id) {
    next.push(entry);
    return next;
  }
  const index = next.findIndex((item) => item?.id === entry.id);
  if (index >= 0) {
    next[index] = { ...next[index], ...entry };
    return next;
  }
  next.push(entry);
  return next;
}

function closeStreamingThoughtSteps(list) {
  return (Array.isArray(list) ? list : []).map((item) => {
    if (item?.kind === "thought" && item?.status === "streaming") {
      return { ...item, status: "done" };
    }
    return item;
  });
}

function appendThoughtStep(list, deltaText) {
  const base = Array.isArray(list) ? list : [];
  if (!deltaText) return base;

  if (base.length > 0) {
    const last = base[base.length - 1];
    if (last?.kind === "thought" && last?.status === "streaming") {
      const next = base.slice();
      next[next.length - 1] = {
        ...last,
        synthetic: false,
        content: `${typeof last.content === "string" ? last.content : ""}${deltaText}`,
      };
      return next;
    }
  }

  return [
    ...base,
    {
      id: `timeline_thought_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: "thought",
      status: "streaming",
      content: deltaText,
      synthetic: false,
    },
  ];
}

function mergeCitations(target, items) {
  const next = Array.isArray(target) ? target.slice() : [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.url) continue;
    if (!next.some((citation) => citation.url === item.url)) {
      next.push(item);
    }
  }
  return next.length > 0 ? next : null;
}

function buildTimelineFromTool(tool, statusOverride = "") {
  if (!tool?.id || !tool?.identifier || !tool?.apiName) return null;
  const status = statusOverride || tool.status || "done";

  if (tool.identifier === "lobe-web-browsing" && tool.apiName === "search") {
    return {
      id: `timeline_${tool.id}`,
      kind: "search",
      status,
      title: status === "running" ? "联网搜索中" : (status === "error" ? "联网搜索失败" : "联网搜索完成"),
      query: typeof tool.arguments?.query === "string" ? tool.arguments.query : "",
      resultCount: Number.isFinite(tool.state?.resultNumbers)
        ? tool.state.resultNumbers
        : (Array.isArray(tool.state?.results) ? tool.state.results.length : null),
      message: status === "error" ? (tool.content || tool.summary || "联网搜索失败") : "",
    };
  }

  if (tool.identifier === "lobe-web-browsing" && (tool.apiName === "crawlSinglePage" || tool.apiName === "crawlMultiPages")) {
    const urls = tool.apiName === "crawlSinglePage"
      ? [typeof tool.arguments?.url === "string" ? tool.arguments.url : ""]
      : (Array.isArray(tool.arguments?.urls) ? tool.arguments.urls : []);
    return {
      id: `timeline_${tool.id}`,
      kind: "reader",
      status,
      title: status === "running" ? "抓取网页中" : (status === "error" ? "网页抓取失败" : "网页抓取完成"),
      url: urls[0] || "",
      resultCount: Array.isArray(tool.state?.results) ? tool.state.results.length : null,
      message: status === "error" ? (tool.content || tool.summary || "网页抓取失败") : "",
    };
  }

  if (tool.identifier === "vectaix-vercel-sandbox" && tool.apiName === "exec") {
    return {
      id: `timeline_${tool.id}`,
      kind: "sandbox",
      status,
      title: status === "running" ? "正在执行沙盒命令" : (status === "error" ? "沙盒命令执行失败" : "沙盒命令已执行"),
      content: typeof tool.summary === "string" ? tool.summary : (typeof tool.content === "string" ? tool.content : ""),
      message: status === "error" ? (tool.content || tool.summary || "沙盒命令执行失败") : "",
    };
  }

  if (tool.identifier === "vectaix-vercel-sandbox" && tool.apiName === "uploadBlob") {
    return {
      id: `timeline_${tool.id}`,
      kind: "upload",
      status,
      title: status === "running" ? "正在上传文件到沙盒" : (status === "error" ? "上传文件到沙盒失败" : "文件已上传到沙盒"),
      content: typeof tool.summary === "string" ? tool.summary : "",
      message: status === "error" ? (tool.content || tool.summary || "上传失败") : "",
    };
  }

  return {
    id: `timeline_${tool.id}`,
    kind: "tool",
    status,
    title: typeof tool.title === "string" ? tool.title : "工具已执行",
    content: typeof tool.summary === "string" ? tool.summary : (typeof tool.content === "string" ? tool.content : ""),
    message: status === "error" ? (tool.content || tool.summary || "工具执行失败") : "",
  };
}

function hasProgress(state) {
  return Boolean(
    state.content
    || state.thought
    || state.searchError
    || (Array.isArray(state.thinkingTimeline) && state.thinkingTimeline.length > 0)
    || (Array.isArray(state.tools) && state.tools.length > 0)
    || (Array.isArray(state.artifacts) && state.artifacts.length > 0)
  );
}

export function createAgentEventState({ inheritedMessage } = {}) {
  return {
    artifacts: Array.isArray(inheritedMessage?.artifacts) ? inheritedMessage.artifacts : null,
    citations: Array.isArray(inheritedMessage?.citations) ? inheritedMessage.citations : null,
    content: typeof inheritedMessage?.content === "string" ? inheritedMessage.content : "",
    hasReceivedContent: false,
    runtimeEnded: false,
    runtimeError: null,
    searchError: null,
    searchQuery: null,
    searchResults: null,
    thinkingEnded: false,
    thinkingTimeline: Array.isArray(inheritedMessage?.thinkingTimeline) ? inheritedMessage.thinkingTimeline : [],
    thought: typeof inheritedMessage?.thought === "string" ? inheritedMessage.thought : "",
    tools: Array.isArray(inheritedMessage?.tools) ? inheritedMessage.tools : null,
  };
}

export function applyAgentRuntimeEvent(state, event) {
  if (!state || !isPlainObject(event)) return state;

  const type = typeof event.type === "string" ? event.type : "";
  const data = isPlainObject(event.data) ? event.data : {};

  if (type === "step_start" || type === "step_complete") {
    const step = isPlainObject(data.step) ? data.step : null;
    if (step) {
      state.thinkingTimeline = upsertById(state.thinkingTimeline, step);
    }
  } else if (type === "stream_chunk") {
    if (data.channel === "answer" && typeof data.content === "string") {
      state.content += data.content;
      if (state.content.trim()) {
        state.thinkingEnded = true;
        state.thinkingTimeline = closeStreamingThoughtSteps(state.thinkingTimeline);
      }
    } else if (data.channel === "reasoning" && typeof data.content === "string") {
      state.thought += data.content;
      state.thinkingTimeline = appendThoughtStep(state.thinkingTimeline, data.content);
    }
  } else if (type === "stream_end") {
    if (data.channel === "reasoning") {
      state.thinkingEnded = true;
      state.thinkingTimeline = closeStreamingThoughtSteps(state.thinkingTimeline);
    }
  } else if (type === "tool_start") {
    const toolCall = isPlainObject(data.toolCall) ? data.toolCall : null;
    if (toolCall) {
      state.tools = upsertById(state.tools, toolCall);
      const timelineStep = buildTimelineFromTool(toolCall, "running");
      if (timelineStep) state.thinkingTimeline = upsertById(state.thinkingTimeline, timelineStep);
      if (toolCall.identifier === "lobe-web-browsing" && toolCall.apiName === "search") {
        state.searchQuery = typeof toolCall.arguments?.query === "string" ? toolCall.arguments.query : null;
        state.searchError = null;
      }
    }
  } else if (type === "tool_end") {
    const toolRun = isPlainObject(data.toolRun) ? data.toolRun : null;
    if (toolRun) {
      state.tools = upsertById(state.tools, toolRun);
      const timelineStep = buildTimelineFromTool(toolRun, toolRun.status || "done");
      if (timelineStep) state.thinkingTimeline = upsertById(state.thinkingTimeline, timelineStep);
      if (Array.isArray(toolRun.artifacts) && toolRun.artifacts.length > 0) {
        const base = Array.isArray(state.artifacts) ? state.artifacts : [];
        const seen = new Set(base.map((item) => item?.url).filter(Boolean));
        const next = base.slice();
        for (const artifact of toolRun.artifacts) {
          if (!artifact?.url || seen.has(artifact.url)) continue;
          seen.add(artifact.url);
          next.push(artifact);
        }
        state.artifacts = next;
      }
      if (Array.isArray(toolRun.citations) && toolRun.citations.length > 0) {
        state.citations = mergeCitations(state.citations, toolRun.citations);
      }
      if (toolRun.identifier === "lobe-web-browsing" && toolRun.apiName === "search") {
        state.searchQuery = typeof toolRun.arguments?.query === "string" ? toolRun.arguments.query : state.searchQuery;
        state.searchResults = Array.isArray(toolRun.state?.results) ? toolRun.state.results : state.searchResults;
        state.searchError = toolRun.status === "error" ? (toolRun.content || toolRun.summary || "联网搜索失败") : null;
      }
    }
  } else if (type === "agent_runtime_end") {
    state.runtimeEnded = true;
    state.thinkingEnded = true;
    state.thinkingTimeline = closeStreamingThoughtSteps(state.thinkingTimeline);
    if (Array.isArray(data.state?.citations)) state.citations = data.state.citations;
    if (Array.isArray(data.state?.tools)) state.tools = data.state.tools;
    if (Array.isArray(data.state?.artifacts)) state.artifacts = data.state.artifacts;
  } else if (type === "error") {
    state.runtimeError = typeof data.message === "string" ? data.message : "Unknown error";
  }

  if (hasProgress(state)) {
    state.hasReceivedContent = true;
  }

  return state;
}

export function buildAgentMessageSnapshot(baseMessage, state) {
  return {
    ...baseMessage,
    content: state.content,
    parts: state.content.length > 0 ? [{ text: state.content }] : baseMessage.parts,
    thought: state.thought,
    isSearching: Array.isArray(state.tools)
      ? state.tools.some((tool) => tool?.identifier === "lobe-web-browsing" && tool?.status === "running")
      : false,
    isThinkingStreaming: !state.thinkingEnded && !state.runtimeEnded,
    isWaitingFirstChunk: !state.hasReceivedContent,
    searchError: state.searchError,
    searchQuery: state.searchQuery,
    searchResults: state.searchResults,
    thinkingTimeline: state.thinkingTimeline,
    citations: state.citations,
    tools: state.tools,
    artifacts: state.artifacts,
  };
}

export function normalizeResponsesChunkText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item.text === "string") return item.text;
        if (item && typeof item.content === "string") return item.content;
        return "";
      })
      .join("");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

function cloneEventValue(value) {
  if (value == null) return value;
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) {
      return value.map((item) => cloneEventValue(item));
    }
    if (typeof value === "object") {
      const next = {};
      for (const [key, item] of Object.entries(value)) {
        next[key] = cloneEventValue(item);
      }
      return next;
    }
    return value;
  }
}

function normalizeEventIndex(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function mergeOutputItem(existing, next) {
  if (!next || typeof next !== "object") {
    return existing && typeof existing === "object" ? existing : null;
  }

  if (!existing || typeof existing !== "object") {
    return cloneEventValue(next);
  }

  const clonedNext = cloneEventValue(next);
  const merged = {
    ...existing,
    ...clonedNext,
  };

  if (Array.isArray(clonedNext.content)) {
    merged.content = clonedNext.content;
  } else if (Array.isArray(existing.content)) {
    merged.content = existing.content;
  }

  if (Array.isArray(clonedNext.summary)) {
    merged.summary = clonedNext.summary;
  } else if (Array.isArray(existing.summary)) {
    merged.summary = existing.summary;
  }

  return merged;
}

function mergePart(existing, next) {
  if (!next || typeof next !== "object") {
    return existing && typeof existing === "object" ? existing : null;
  }

  if (!existing || typeof existing !== "object") {
    return cloneEventValue(next);
  }

  const clonedNext = cloneEventValue(next);
  return {
    ...existing,
    ...clonedNext,
    text: typeof clonedNext.text === "string"
      ? clonedNext.text
      : (typeof existing.text === "string" ? existing.text : clonedNext.text),
  };
}

function ensureOutputItem(outputItems, outputIndex, defaults = {}) {
  const normalizedIndex = normalizeEventIndex(outputIndex);
  const existing = outputItems.get(normalizedIndex);
  const item = existing && typeof existing === "object" ? existing : {};

  if (defaults?.id && !item.id) item.id = defaults.id;
  if (defaults?.type && !item.type) item.type = defaults.type;
  if (defaults?.role && !item.role) item.role = defaults.role;
  if (defaults?.call_id && !item.call_id) item.call_id = defaults.call_id;
  if (defaults?.name && !item.name) item.name = defaults.name;
  if (defaults?.status && !item.status) item.status = defaults.status;

  outputItems.set(normalizedIndex, item);
  return item;
}

function ensureMessageContentPart(outputItems, event, partType = "output_text") {
  const item = ensureOutputItem(outputItems, event?.output_index, {
    id: typeof event?.item_id === "string" ? event.item_id : "",
    type: "message",
    role: "assistant",
  });
  const contentIndex = normalizeEventIndex(event?.content_index);
  const content = Array.isArray(item.content) ? item.content : [];
  item.content = content;
  while (content.length <= contentIndex) {
    content.push(null);
  }
  const existing = content[contentIndex];
  if (!existing || typeof existing !== "object") {
    content[contentIndex] = { type: partType };
  } else if (partType && !existing.type) {
    existing.type = partType;
  }
  return content[contentIndex];
}

function ensureReasoningSummaryPart(outputItems, event) {
  const item = ensureOutputItem(outputItems, event?.output_index, {
    id: typeof event?.item_id === "string" ? event.item_id : "",
    type: "reasoning",
  });
  const summaryIndex = normalizeEventIndex(event?.summary_index);
  const summary = Array.isArray(item.summary) ? item.summary : [];
  item.summary = summary;
  while (summary.length <= summaryIndex) {
    summary.push(null);
  }
  const existing = summary[summaryIndex];
  if (!existing || typeof existing !== "object") {
    summary[summaryIndex] = { type: "summary_text", text: "" };
  }
  return summary[summaryIndex];
}

function ensureReasoningContentPart(outputItems, event) {
  const item = ensureOutputItem(outputItems, event?.output_index, {
    id: typeof event?.item_id === "string" ? event.item_id : "",
    type: "reasoning",
  });
  const contentIndex = normalizeEventIndex(event?.content_index);
  const content = Array.isArray(item.content) ? item.content : [];
  item.content = content;
  while (content.length <= contentIndex) {
    content.push(null);
  }
  const existing = content[contentIndex];
  if (!existing || typeof existing !== "object") {
    content[contentIndex] = { type: "reasoning_text", text: "" };
  }
  return content[contentIndex];
}

function ensureFunctionCallItem(outputItems, event) {
  const item = ensureOutputItem(outputItems, event?.output_index, {
    id: typeof event?.item_id === "string" ? event.item_id : "",
    type: "function_call",
    call_id: typeof event?.call_id === "string" ? event.call_id : "",
    name: typeof event?.name === "string" ? event.name : "",
  });
  if (!item.type) item.type = "function_call";
  if (typeof event?.call_id === "string" && event.call_id) item.call_id = event.call_id;
  if (typeof event?.name === "string" && event.name) item.name = event.name;
  if (typeof item.arguments !== "string") item.arguments = "";
  return item;
}

function buildFallbackResponse(latestResponse, outputItems, normalizeText) {
  const fallback = latestResponse && typeof latestResponse === "object"
    ? cloneEventValue(latestResponse)
    : {};
  const output = Array.from(outputItems.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, item]) => item)
    .filter((item) => item && typeof item === "object")
    .map((item) => cloneEventValue(item));

  if (output.length > 0) {
    fallback.output = output;
  } else if (!Array.isArray(fallback.output)) {
    fallback.output = [];
  }

  if (!fallback.object) {
    fallback.object = "response";
  }

  const status = typeof fallback.status === "string" ? fallback.status : "";
  if (!status || status === "created" || status === "in_progress" || status === "queued") {
    fallback.status = "completed";
  }

  if (typeof fallback.output_text !== "string" || !fallback.output_text.trim()) {
    const text = fallback.output
      .filter((item) => item?.type === "message")
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .map((item) => normalizeText(item?.text ?? item))
      .join("")
      .trim();
    if (text) {
      fallback.output_text = text;
    }
  }

  if (fallback.id || fallback.output.length > 0 || fallback.output_text) {
    return fallback;
  }

  return null;
}

export async function consumeStrictResponsesStream({
  response,
  signal,
  normalizeText = normalizeResponsesChunkText,
  onEvent,
  onParseError,
  onDone,
  onThoughtDelta,
  onTextDelta,
  emptyBodyMessage = "Responses 上游未返回有效流响应体",
  missingCompletedMessage = "Responses 上游缺少 response.completed 事件",
}) {
  if (!response?.body) {
    throw new Error(emptyBodyMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completedResponse = null;
  let latestResponse = null;
  let failedResponse = null;
  let incompleteResponse = null;
  let streamError = null;
  const outputItems = new Map();

  const emitDelta = (handler, value) => {
    if (typeof handler !== "function") return;
    const text = normalizeText(value);
    if (!text) return;
    handler(text);
  };

  const rememberResponseSnapshot = (value) => {
    if (!value || typeof value !== "object") return;

    const snapshot = cloneEventValue(value);
    latestResponse = latestResponse && typeof latestResponse === "object"
      ? { ...latestResponse, ...snapshot }
      : snapshot;

    if (Array.isArray(snapshot.output)) {
      latestResponse.output = snapshot.output;
      snapshot.output.forEach((item, outputIndex) => {
        if (!item || typeof item !== "object") return;
        outputItems.set(outputIndex, mergeOutputItem(outputItems.get(outputIndex), item));
      });
    }
  };

  const handleEvent = (event) => {
    if (typeof onEvent === "function") {
      onEvent(event);
    }

    const eventType = typeof event?.type === "string" ? event.type : "";
    rememberResponseSnapshot(event?.response);

    if (eventType === "response.reasoning_summary_text.delta") {
      emitDelta(onThoughtDelta, event?.delta);
      const summaryPart = ensureReasoningSummaryPart(outputItems, event);
      summaryPart.text = `${typeof summaryPart.text === "string" ? summaryPart.text : ""}${normalizeText(event?.delta)}`;
      return;
    }

    if (eventType === "response.reasoning_summary_text.done") {
      const summaryPart = ensureReasoningSummaryPart(outputItems, event);
      summaryPart.text = normalizeText(event?.text ?? event?.delta ?? event?.part);
      return;
    }

    if (eventType === "response.reasoning_summary_part.added" || eventType === "response.reasoning_summary_part.done") {
      const item = ensureOutputItem(outputItems, event?.output_index, {
        id: typeof event?.item_id === "string" ? event.item_id : "",
        type: "reasoning",
      });
      const summaryIndex = normalizeEventIndex(event?.summary_index);
      const summary = Array.isArray(item.summary) ? item.summary : [];
      item.summary = summary;
      while (summary.length <= summaryIndex) {
        summary.push(null);
      }
      summary[summaryIndex] = mergePart(summary[summaryIndex], event?.part) || summary[summaryIndex];
      return;
    }

    if (eventType === "response.reasoning_text.delta") {
      const contentPart = ensureReasoningContentPart(outputItems, event);
      contentPart.text = `${typeof contentPart.text === "string" ? contentPart.text : ""}${normalizeText(event?.delta)}`;
      return;
    }

    if (eventType === "response.reasoning_text.done") {
      const contentPart = ensureReasoningContentPart(outputItems, event);
      contentPart.text = normalizeText(event?.text ?? event?.delta ?? event?.part);
      return;
    }

    if (eventType === "response.output_text.delta") {
      emitDelta(onTextDelta, event?.delta);
      const contentPart = ensureMessageContentPart(outputItems, event, "output_text");
      contentPart.text = `${typeof contentPart.text === "string" ? contentPart.text : ""}${normalizeText(event?.delta)}`;
      return;
    }

    if (eventType === "response.output_text.done") {
      const contentPart = ensureMessageContentPart(outputItems, event, "output_text");
      contentPart.text = normalizeText(event?.text ?? event?.delta ?? event?.part);
      return;
    }

    if (eventType === "response.content_part.added" || eventType === "response.content_part.done") {
      const item = ensureOutputItem(outputItems, event?.output_index, {
        id: typeof event?.item_id === "string" ? event.item_id : "",
        type: "message",
        role: "assistant",
      });
      const contentIndex = normalizeEventIndex(event?.content_index);
      const content = Array.isArray(item.content) ? item.content : [];
      item.content = content;
      while (content.length <= contentIndex) {
        content.push(null);
      }
      content[contentIndex] = mergePart(content[contentIndex], event?.part) || content[contentIndex];
      return;
    }

    if (eventType === "response.output_item.added" || eventType === "response.output_item.done") {
      const outputIndex = normalizeEventIndex(event?.output_index);
      const mergedItem = mergeOutputItem(outputItems.get(outputIndex), event?.item);
      if (mergedItem) {
        outputItems.set(outputIndex, mergedItem);
      }
      return;
    }

    if (eventType === "response.function_call_arguments.delta") {
      const item = ensureFunctionCallItem(outputItems, event);
      item.arguments = `${typeof item.arguments === "string" ? item.arguments : ""}${normalizeText(event?.delta)}`;
      return;
    }

    if (eventType === "response.function_call_arguments.done") {
      const item = ensureFunctionCallItem(outputItems, event);
      if (typeof event?.arguments === "string") {
        item.arguments = event.arguments;
      }
      return;
    }

    if (eventType === "response.completed") {
      completedResponse = event?.response ?? latestResponse ?? null;
      return;
    }

    if (eventType === "response.failed") {
      failedResponse = event?.response ?? latestResponse ?? null;
      return;
    }

    if (eventType === "response.incomplete") {
      incompleteResponse = event?.response ?? latestResponse ?? null;
      return;
    }

    if (eventType === "error") {
      streamError = event;
    }
  };

  const consumeSseBuffer = (final = false) => {
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : (blocks.pop() || "");

    for (const block of blocks) {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) continue;

      const lines = trimmedBlock.split(/\r?\n/);
      const dataLines = [];
      for (const line of lines) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^\s*/, ""));
        }
      }

      if (!dataLines.length) continue;
      const dataStr = dataLines.join("\n");
      if (dataStr === "[DONE]") {
        if (typeof onDone === "function") {
          onDone();
        }
        continue;
      }

      try {
        handleEvent(JSON.parse(dataStr));
      } catch {
        if (typeof onParseError === "function") {
          onParseError(dataStr);
        }
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done || signal?.aborted) break;

    buffer += decoder.decode(value, { stream: true });
    consumeSseBuffer(false);
  }

  buffer += decoder.decode();
  consumeSseBuffer(true);

  if (streamError) {
    const message = typeof streamError?.message === "string" && streamError.message.trim()
      ? streamError.message.trim()
      : "Responses 上游返回错误事件";
    throw new Error(message);
  }

  if (failedResponse) {
    const message = typeof failedResponse?.error?.message === "string" && failedResponse.error.message.trim()
      ? failedResponse.error.message.trim()
      : "Responses 上游返回失败状态";
    throw new Error(message);
  }

  if (incompleteResponse) {
    const reason = typeof incompleteResponse?.incomplete_details?.reason === "string"
      ? incompleteResponse.incomplete_details.reason.trim()
      : "";
    throw new Error(reason ? `Responses 上游响应未完成：${reason}` : "Responses 上游响应未完成");
  }

  if (completedResponse) {
    return buildFallbackResponse(completedResponse, outputItems, normalizeText) || completedResponse;
  }

  const fallbackResponse = buildFallbackResponse(latestResponse, outputItems, normalizeText);
  if (fallbackResponse) {
    return fallbackResponse;
  }
  throw new Error(missingCompletedMessage);
}

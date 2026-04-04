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

  const emitDelta = (handler, value) => {
    if (typeof handler !== "function") return;
    const text = normalizeText(value);
    if (!text) return;
    handler(text);
  };

  const handleEvent = (event) => {
    if (typeof onEvent === "function") {
      onEvent(event);
    }

    const eventType = typeof event?.type === "string" ? event.type : "";
    if (eventType === "response.reasoning_summary_text.delta") {
      emitDelta(onThoughtDelta, event?.delta);
      return;
    }

    if (eventType === "response.output_text.delta") {
      emitDelta(onTextDelta, event?.delta);
      return;
    }

    if (eventType === "response.completed") {
      completedResponse = event?.response ?? null;
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

  if (!completedResponse) {
    throw new Error(missingCompletedMessage);
  }

  return completedResponse;
}

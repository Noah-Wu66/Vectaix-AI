const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function normalizeStringChunk(value) {
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

function extractDeltaText(delta) {
  if (!delta || typeof delta !== "object") return "";
  if (typeof delta.content === "string") return delta.content;
  if (typeof delta.text === "string") return delta.text;
  return normalizeStringChunk(delta.content);
}

function extractDeltaReasoning(delta) {
  if (!delta || typeof delta !== "object") return "";
  if (typeof delta.reasoning === "string") return delta.reasoning;
  if (typeof delta.reasoning_content === "string") return delta.reasoning_content;
  if (Array.isArray(delta.reasoning)) return normalizeStringChunk(delta.reasoning);
  if (Array.isArray(delta.reasoning_content)) return normalizeStringChunk(delta.reasoning_content);
  return "";
}

export function extractOpenRouterResponseText(payload) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const message = choices[0]?.message;
  if (!message) return "";
  if (typeof message.content === "string") return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text" && typeof item.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

export async function consumeOpenRouterStream({
  response,
  signal,
  onTextDelta,
  onReasoningDelta,
}) {
  if (!response.body) {
    throw new Error("OpenRouter 返回了空响应体");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const consume = (final = false) => {
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : (blocks.pop() || "");

    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const dataLines = [];
      for (const line of lines) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^\s*/, ""));
        }
      }

      if (!dataLines.length) continue;
      const dataStr = dataLines.join("\n");
      if (dataStr === "[DONE]") continue;

      try {
        const event = JSON.parse(dataStr);
        const choice = Array.isArray(event?.choices) ? event.choices[0] : null;
        const delta = choice?.delta;
        const reasoning = extractDeltaReasoning(delta);
        if (reasoning) {
          onReasoningDelta?.(reasoning);
        }
        const text = extractDeltaText(delta);
        if (text) {
          fullText += text;
          onTextDelta?.(text);
        }
      } catch {
        // ignore malformed SSE payloads
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
    }
    buffer += decoder.decode(value, { stream: true });
    consume(false);
  }

  buffer += decoder.decode();
  consume(true);
  return fullText.trim();
}

export async function requestOpenRouterChatCompletion({
  apiKey,
  model,
  messages,
  stream = false,
  maxTokens,
  temperature,
  reasoningEffort,
  signal,
}) {
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const requestBody = {
    model,
    messages,
    stream,
  };

  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    requestBody.max_tokens = maxTokens;
  }
  if (typeof temperature === "number") {
    requestBody.temperature = temperature;
  }
  if (typeof reasoningEffort === "string" && reasoningEffort) {
    requestBody.reasoning = {
      effort: reasoningEffort,
    };
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `OpenRouter 请求失败（${response.status}）`);
  }

  return response;
}

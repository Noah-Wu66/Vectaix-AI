const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error(typeof signal.reason === "string" && signal.reason ? signal.reason : "Request aborted");
}

function normalizeGeminiPart(part) {
  if (!part || typeof part !== "object") return null;

  if (typeof part.text === "string") {
    return { text: part.text };
  }

  const inlineData = part.inlineData;
  if (inlineData && typeof inlineData === "object") {
    const mimeType = typeof inlineData.mimeType === "string" ? inlineData.mimeType : "";
    const data = typeof inlineData.data === "string" ? inlineData.data : "";
    if (mimeType && data) {
      return {
        inlineData: {
          mimeType,
          data,
        },
      };
    }
  }

  return null;
}

function normalizeGeminiContents(contents) {
  if (!Array.isArray(contents)) return [];
  return contents
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const parts = Array.isArray(item.parts)
        ? item.parts.map(normalizeGeminiPart).filter(Boolean)
        : [];
      if (parts.length === 0) return null;
      const out = { parts };
      if (typeof item.role === "string" && item.role) {
        out.role = item.role;
      }
      return out;
    })
    .filter(Boolean);
}

function normalizeSystemInstruction(value) {
  if (!value || typeof value !== "object") return null;
  const parts = Array.isArray(value.parts)
    ? value.parts.map(normalizeGeminiPart).filter(Boolean)
    : [];
  if (parts.length === 0) return null;
  return { parts };
}

function buildGenerationConfig(config) {
  if (!config || typeof config !== "object") return null;

  const generationConfig = {};

  if (typeof config.temperature === "number") {
    generationConfig.temperature = config.temperature;
  }

  if (Number.isFinite(config.maxOutputTokens) && config.maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = Math.floor(config.maxOutputTokens);
  }

  if (config.thinkingConfig && typeof config.thinkingConfig === "object") {
    const thinkingConfig = {};
    if (typeof config.thinkingConfig.thinkingLevel === "string" && config.thinkingConfig.thinkingLevel) {
      thinkingConfig.thinkingLevel = config.thinkingConfig.thinkingLevel;
    }
    if (typeof config.thinkingConfig.includeThoughts === "boolean") {
      thinkingConfig.includeThoughts = config.thinkingConfig.includeThoughts;
    }
    if (Object.keys(thinkingConfig).length > 0) {
      generationConfig.thinkingConfig = thinkingConfig;
    }
  }

  return Object.keys(generationConfig).length > 0 ? generationConfig : null;
}

function buildGeminiRequestBody({ contents, config }) {
  const body = {};
  const normalizedContents = normalizeGeminiContents(contents);
  if (normalizedContents.length > 0) {
    body.contents = normalizedContents;
  }

  const systemInstruction = normalizeSystemInstruction(config?.systemInstruction);
  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

  const generationConfig = buildGenerationConfig(config);
  if (generationConfig) {
    body.generationConfig = generationConfig;
  }

  return body;
}

function buildGeminiEndpoint(model, { stream = false } = {}) {
  const action = stream ? "streamGenerateContent" : "generateContent";
  const suffix = stream ? "?alt=sse" : "";
  return `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:${action}${suffix}`;
}

async function readGeminiErrorMessage(response) {
  let raw = "";
  try {
    raw = await response.text();
  } catch {}

  if (!raw) {
    return `Gemini 请求失败（${response.status}）`;
  }

  try {
    const payload = JSON.parse(raw);
    const message = typeof payload?.error?.message === "string" ? payload.error.message.trim() : "";
    if (message) {
      return message;
    }
  } catch {}

  return raw.trim() || `Gemini 请求失败（${response.status}）`;
}

async function requestGemini({
  apiKey,
  model,
  contents,
  config,
  signal,
  stream = false,
}) {
  if (!apiKey) {
    throw new Error("Gemini provider apiKey is not set");
  }
  if (typeof model !== "string" || !model.trim()) {
    throw new Error("Gemini model is not set");
  }

  throwIfAborted(signal);

  const response = await fetch(buildGeminiEndpoint(model, { stream }), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(buildGeminiRequestBody({ contents, config })),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readGeminiErrorMessage(response));
  }

  if (stream) {
    return response;
  }

  return response.json();
}

function createGeminiStreamIterator(response, signal) {
  return {
    async *[Symbol.asyncIterator]() {
      if (!response.body) {
        throw new Error("Gemini 返回了空响应体");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const consume = async (final = false) => {
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = final ? "" : (blocks.pop() || "");

        const parsed = [];
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
          const dataStr = dataLines.join("\n").trim();
          if (!dataStr || dataStr === "[DONE]") continue;
          try {
            parsed.push(JSON.parse(dataStr));
          } catch {}
        }
        return parsed;
      };

      while (true) {
        throwIfAborted(signal);
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const payloads = await consume(false);
        for (const payload of payloads) {
          yield payload;
        }
      }

      buffer += decoder.decode();
      const payloads = await consume(true);
      for (const payload of payloads) {
        yield payload;
      }
    },
  };
}

export function createGeminiApiClient({ apiKey }) {
  return {
    models: {
      async generateContent({ model, contents, config, signal }) {
        return requestGemini({
          apiKey,
          model,
          contents,
          config,
          signal,
          stream: false,
        });
      },
      async generateContentStream({ model, contents, config, signal }) {
        const response = await requestGemini({
          apiKey,
          model,
          contents,
          config,
          signal,
          stream: true,
        });
        return createGeminiStreamIterator(response, signal);
      },
    },
  };
}

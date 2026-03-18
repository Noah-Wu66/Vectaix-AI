import {
  SEED_MODEL_ID,
  SEED_REASONING_LEVELS,
} from "@/lib/shared/models";

const SEED_API_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const SEED_MAX_RETRIES = 2;
const VALID_SEED_REASONING_LEVELS = new Set(SEED_REASONING_LEVELS);
const SEED_CONNECTION_ERROR_STATUS = 502;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSeedTransportErrorCode(error) {
  if (typeof error?.code === "string" && error.code) return error.code;
  if (typeof error?.cause?.code === "string" && error.cause.code) return error.cause.code;
  if (typeof error?.cause?.cause?.code === "string" && error.cause.cause.code) {
    return error.cause.cause.code;
  }
  return "";
}

function normalizeSeedTransportError(error) {
  if (!error || typeof error?.status === "number" || error?.name === "AbortError") {
    return error;
  }

  const code = extractSeedTransportErrorCode(error).toUpperCase();
  const rawMessage = typeof error?.message === "string" ? error.message.trim() : "";
  const lowerMessage = rawMessage.toLowerCase();

  let message = "Seed 官方接口连接失败，请稍后重试";

  if (
    code === "ETIMEDOUT"
    || code === "ECONNABORTED"
    || code === "UND_ERR_CONNECT_TIMEOUT"
    || lowerMessage.includes("timeout")
    || lowerMessage.includes("timed out")
  ) {
    message = "Seed 官方接口连接超时，请稍后重试";
  } else if (
    code === "ENOTFOUND"
    || code === "EAI_AGAIN"
    || code === "ECONNREFUSED"
    || code === "ECONNRESET"
    || code === "EHOSTUNREACH"
    || code === "ENETUNREACH"
    || lowerMessage.includes("fetch failed")
    || lowerMessage.includes("network")
    || lowerMessage.includes("socket")
    || lowerMessage.includes("connect")
    || lowerMessage.includes("tls")
  ) {
    message = "Seed 官方接口连接失败，请稍后重试";
  } else if (rawMessage) {
    message = `Seed 官方接口请求异常：${rawMessage}`;
  }

  const normalizedError = new Error(message);
  normalizedError.status = SEED_CONNECTION_ERROR_STATUS;
  if (code) normalizedError.code = code;
  normalizedError.cause = error;
  return normalizedError;
}

export function createSeedUpstreamSignal(req) {
  return req?.signal;
}

export function normalizeSeedChunkText(value) {
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

export function buildSeedRequestBody({
  model = SEED_MODEL_ID,
  input,
  instructions,
  maxTokens,
  thinkingLevel,
  stream = true,
  temperature = 1,
  topP = 0.95,
}) {
  const normalizedThinkingLevel = typeof thinkingLevel === "string"
    ? thinkingLevel.trim().toLowerCase()
    : "";

  const requestBody = {
    model,
    stream,
    input,
    instructions,
    temperature,
    top_p: topP,
  };

  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    requestBody.max_output_tokens = maxTokens;
  }

  if (normalizedThinkingLevel === "minimal") {
    requestBody.thinking = { type: "disabled" };
  } else {
    if (!VALID_SEED_REASONING_LEVELS.has(normalizedThinkingLevel)) {
      throw new Error("thinkingLevel invalid");
    }
    requestBody.thinking = { type: "enabled" };
    requestBody.reasoning = { effort: normalizedThinkingLevel };
  }

  return requestBody;
}

export function buildSeedJsonRequestBody({
  model = SEED_MODEL_ID,
  input,
  instructions,
  maxTokens,
  temperature = 0.2,
  thinkingLevel,
}) {
  const normalizedThinkingLevel = typeof thinkingLevel === "string"
    ? thinkingLevel.trim().toLowerCase()
    : "";

  if (!normalizedThinkingLevel) {
    throw new Error("thinkingLevel required");
  }

  const requestBody = {
    model,
    stream: false,
    input,
    instructions,
    max_output_tokens: maxTokens,
    temperature,
    top_p: 0.95,
  };

  if (normalizedThinkingLevel === "minimal") {
    requestBody.thinking = { type: "disabled" };
    return requestBody;
  }

  if (!VALID_SEED_REASONING_LEVELS.has(normalizedThinkingLevel)) {
    throw new Error("thinkingLevel invalid");
  }

  requestBody.thinking = { type: "enabled" };
  requestBody.reasoning = { effort: normalizedThinkingLevel };
  return requestBody;
}

export async function requestSeedResponses({
  apiKey,
  requestBody,
  req,
}) {
  const url = `${SEED_API_BASE_URL}/responses`;

  for (let attempt = 0; attempt < SEED_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: createSeedUpstreamSignal(req),
      });

      if (response.ok) {
        return response;
      }

      const errorText = await response.text();
      const shouldRetry = response.status >= 500 && attempt < SEED_MAX_RETRIES - 1;
      if (shouldRetry) {
        await sleep(800 * (attempt + 1));
        continue;
      }

      const error = new Error(`Seed 官方接口请求失败（${response.status}）：${errorText}`);
      error.status = response.status;
      throw error;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      const normalizedError = normalizeSeedTransportError(error);
      if (attempt >= SEED_MAX_RETRIES - 1) throw normalizedError;
      await sleep(800 * (attempt + 1));
    }
  }

  throw new Error("Seed 官方接口请求失败");
}

export function extractSeedResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  return outputs
    .filter((item) => item?.type === "message")
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((item) => normalizeSeedChunkText(item?.text ?? item))
    .join("")
    .trim();
}

export async function requestSeedJson({
  apiKey,
  requestBody,
  req,
}) {
  const response = await requestSeedResponses({ apiKey, requestBody, req });
  const payload = await response.json();
  return {
    payload,
    text: extractSeedResponseText(payload),
  };
}

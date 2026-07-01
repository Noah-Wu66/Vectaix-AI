import OpenAI from "openai";
import {
  resolveArkChatProviderConfig,
  resolveOpenRouterProviderConfig,
  resolveZenMuxProviderConfig,
} from "@/lib/modelRoutes";
import {
  DEFAULT_MODEL,
  DOUBAO_SEED_21_PRO_MODEL,
  OPENROUTER_FUSION_MODEL,
  getDefaultMaxTokensForModel,
  getMaxReasoningEffortForModel,
} from "@/lib/shared/models";

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

export const OPENROUTER_WEB_SEARCH_TOOL = {
  type: "openrouter:web_search",
  parameters: {
    engine: "exa",
    max_results: 3,
  },
};

function isArkChatModel(model) {
  return model === DOUBAO_SEED_21_PRO_MODEL;
}

function isOpenRouterChatModel(model) {
  return model === OPENROUTER_FUSION_MODEL;
}

function createOpenAIClientFromConfig(config) {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.openAIBaseUrl,
    ...(config.defaultHeaders ? { defaultHeaders: config.defaultHeaders } : {}),
  });
}

export function createChatOpenAIClient(model = DEFAULT_MODEL) {
  if (isArkChatModel(model)) {
    return createOpenAIClientFromConfig(resolveArkChatProviderConfig());
  }
  if (isOpenRouterChatModel(model)) {
    return createOpenAIClientFromConfig(resolveOpenRouterProviderConfig());
  }
  return createOpenAIClientFromConfig(resolveZenMuxProviderConfig());
}

function resolveReasoningEffort(model, reasoningEffort) {
  const effort = typeof reasoningEffort === "string" ? reasoningEffort.trim() : "";
  if (REASONING_EFFORTS.has(effort)) return effort;
  return getMaxReasoningEffortForModel(model);
}

function resolveMaxCompletionTokens(model, maxTokens) {
  const parsed = Number.parseInt(maxTokens, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return getDefaultMaxTokensForModel(model);
}

export function buildChatCompletionsRequest({
  model = DEFAULT_MODEL,
  messages,
  system,
  prompt,
  stream = false,
  reasoningEffort,
  maxTokens,
  tools,
  toolChoice,
  extra = {},
} = {}) {
  const effort = resolveReasoningEffort(model, reasoningEffort);
  const maxCompletionTokens = resolveMaxCompletionTokens(model, maxTokens);
  const requestMessages = [];

  if (typeof system === "string" && system.trim()) {
    requestMessages.push({ role: "system", content: system.trim() });
  }

  if (Array.isArray(messages)) {
    requestMessages.push(...messages);
  } else {
    requestMessages.push({ role: "user", content: String(prompt ?? "") });
  }

  if (isArkChatModel(model)) {
    return {
      model,
      messages: requestMessages,
      max_completion_tokens: maxCompletionTokens,
      thinking: effort === "minimal" ? { type: "disabled" } : { type: "enabled" },
      ...(extra || {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };
  }

  if (isOpenRouterChatModel(model)) {
    return {
      model,
      messages: requestMessages,
      max_tokens: maxCompletionTokens,
      plugins: [{ id: "fusion", preset: "general-high" }],
      ...(extra || {}),
      ...(stream ? { stream: true } : {}),
      ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };
  }

  const request = {
    model,
    messages: requestMessages,
    max_completion_tokens: maxCompletionTokens,
    reasoning_effort: effort,
    reasoning: {
      enabled: true,
      effort,
      exclude: false,
    },
    ...extra,
  };

  if (stream) {
    request.stream = true;
    request.stream_options = { include_usage: true };
  }
  if (Array.isArray(tools) && tools.length > 0) {
    request.tools = tools;
  }
  if (toolChoice) {
    request.tool_choice = toolChoice;
  }

  return request;
}

export async function requestZenMuxChatCompletionResponse({
  system,
  prompt,
  messages,
  model = DEFAULT_MODEL,
  signal,
  reasoningEffort,
  maxTokens,
  tools,
  toolChoice,
  extra = {},
} = {}) {
  const client = createChatOpenAIClient(model);

  return client.chat.completions.create(
    buildChatCompletionsRequest({
      model,
      system,
      prompt,
      messages,
      stream: false,
      reasoningEffort,
      maxTokens,
      tools,
      toolChoice,
      extra,
    }),
    { signal }
  );
}

export async function requestZenMuxChatCompletion(input = {}) {
  const response = await requestZenMuxChatCompletionResponse(input);
  return getChatCompletionOutputText(response);
}

function getContentText(content) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .join("") : "";
}

export function getChatCompletionMessage(response) {
  return response?.choices?.[0]?.message || null;
}

export function getChatCompletionAnnotations(response) {
  const annotations = getChatCompletionMessage(response)?.annotations;
  if (!Array.isArray(annotations)) return [];
  const citations = [];
  const seen = new Set();
  for (const annotation of annotations) {
    if (annotation?.type !== "url_citation") continue;
    const citation = annotation.url_citation || {};
    const url = typeof citation.url === "string" ? citation.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = typeof citation.title === "string" ? citation.title.trim() : "";
    citations.push({ url, title: title || url });
  }
  return citations;
}

export function getChatCompletionOutputText(response) {
  return getContentText(getChatCompletionMessage(response)?.content).trim();
}

export function getChatCompletionToolCalls(response) {
  const calls = getChatCompletionMessage(response)?.tool_calls;
  return Array.isArray(calls) ? calls : [];
}

export function getChatCompletionCompletedUsage(eventOrResponse) {
  return eventOrResponse?.usage && typeof eventOrResponse.usage === "object" ? eventOrResponse.usage : null;
}

export function getChatCompletionChunkDelta(chunk) {
  return chunk?.choices?.[0]?.delta || {};
}

export function getChatCompletionChunkThoughtDelta(chunk) {
  const delta = getChatCompletionChunkDelta(chunk);
  const reasoning = typeof delta?.reasoning === "string" ? delta.reasoning : "";
  const reasoningContent = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
  if (reasoning && reasoningContent && reasoning !== reasoningContent) {
    return `${reasoning}${reasoningContent}`;
  }
  return reasoningContent || reasoning;
}

export function normalizeOpenAIError(error) {
  if (error instanceof OpenAI.APIError) {
    const err = new Error(error.message || `模型请求失败（${error.status}）`);
    err.status = error.status;
    err.code = error.code;
    return err;
  }
  return error;
}

import Anthropic from "@anthropic-ai/sdk";
import {
  fetchBlobAsBase64,
  fetchImageAsBase64,
  getStoredPartsFromMessage,
  isNonEmptyString,
} from "@/app/api/chat/utils";
import {
  buildAttachmentTextBlock,
  getPreparedAttachmentTextsByUrls,
} from "@/lib/server/files/service";
import {
  getAttachmentInputType,
  isNativeBinaryCategory,
} from "@/lib/shared/attachments";
import { resolveOpenAIProviderConfig, resolveDeepSeekProviderConfig, resolveSeedProviderConfig } from "@/lib/modelRoutes";
import {
  CHAT_RUNTIME_MODE_AGENT,
  DEEPSEEK_CHAT_MODEL,
  DEEPSEEK_REASONER_MODEL,
  getDefaultThinkingLevel,
  getModelConfig,
  getModelProvider,
  isAgentBackedModelId,
  modelSupportsAvailableInput,
  normalizeModelId,
  toZenmuxModel,
} from "@/lib/shared/models";
import {
  createGeminiClient,
  isAnthropicCompatibleProvider,
  resolveAnthropicApiModel,
  resolveAnthropicProviderConfig,
  resolveGeminiApiModel,
} from "@/lib/server/chat/providerAdapters";
import {
  buildSeedMessageInput,
} from "@/app/api/bytedance/bytedanceHelpers";
import {
  buildSeedRequestBody,
  normalizeSeedChunkText,
  requestSeedResponses,
} from "@/lib/server/seed/service";

const AGENT_FINAL_MAX_TOKENS = 32000;

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error(typeof signal.reason === "string" ? signal.reason : "Request aborted");
}

function collectFileUrlsFromMessages(messages) {
  const urls = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const part of Array.isArray(message?.parts) ? message.parts : []) {
      if (
        typeof part?.fileData?.url === "string"
        && part.fileData.url
        && !isNativeBinaryCategory(part?.fileData?.category)
      ) {
        urls.push(part.fileData.url);
      }
    }
  }
  return Array.from(new Set(urls));
}

function getPartBinaryInputType(part) {
  const inputType = getAttachmentInputType(part?.fileData?.category);
  return inputType === "video" || inputType === "audio" ? inputType : "";
}

function hasBinaryInputInHistory(messages, inputType) {
  return Array.isArray(messages) && messages.some((message) =>
    Array.isArray(message?.parts) && message.parts.some((part) => getPartBinaryInputType(part) === inputType)
  );
}

function collectCurrentBinaryAttachments(attachments, inputType) {
  return Array.isArray(attachments)
    ? attachments.filter((item) => getAttachmentInputType(item?.category) === inputType)
    : [];
}

function requireAgentDriverModel(driverModel) {
  const normalizedDriverModel = normalizeModelId(driverModel);
  if (!isAgentBackedModelId(normalizedDriverModel)) {
    throw new Error("无效的 Agent 驱动模型");
  }
  return normalizedDriverModel;
}

function getPreparedAttachmentBlock(part, fileTextMap) {
  const url = typeof part?.fileData?.url === "string" ? part.fileData.url : "";
  if (!url) return "";
  const prepared = fileTextMap.get(url);
  const extractedText = prepared?.structuredText || prepared?.extractedText || "";
  if (!extractedText) return "";
  return buildAttachmentTextBlock(prepared.file || part.fileData, extractedText);
}

async function getBinaryAttachmentPayload(part) {
  const url = typeof part?.fileData?.url === "string" ? part.fileData.url : "";
  if (!url) return null;
  const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(url, { resourceLabel: "media" });
  const mimeType = part?.fileData?.mimeType || fetchedMimeType;
  if (!isNonEmptyString(mimeType)) return null;
  return {
    inputType: getPartBinaryInputType(part),
    mimeType,
    base64Data,
    dataUrl: `data:${mimeType};base64,${base64Data}`,
  };
}

function buildCurrentUserText({ prompt, preparedAttachments }) {
  const blocks = [];
  if (isNonEmptyString(prompt)) {
    blocks.push(prompt.trim());
  }
  for (const prepared of Array.isArray(preparedAttachments) ? preparedAttachments : []) {
    const extractedText = prepared?.structuredText || prepared?.extractedText || "";
    if (!extractedText) continue;
    blocks.push(buildAttachmentTextBlock(prepared.file, extractedText));
  }
  return blocks.join("\n\n").trim();
}

async function readSseStream({ response, signal, onEvent, emptyBodyMessage }) {
  if (!response.body) {
    throw new Error(emptyBodyMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (final = false) => {
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
      if (dataStr === "[DONE]") continue;

      try {
        onEvent(JSON.parse(dataStr));
      } catch { }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    throwIfAborted(signal);
    buffer += decoder.decode(value, { stream: true });
    consume(false);
  }

  buffer += decoder.decode();
  consume(true);
}

function normalizeOpenAIChunkText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item.text === "string") return item.text;
    return "";
  }).join("");
}

function normalizeOpenAIChunkThought(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item.text === "string") return item.text;
      if (item && typeof item.content === "string") return item.content;
      return "";
    }).join("");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

function normalizeOpenAIEventDelta(event) {
  if (typeof event?.delta === "string") return event.delta;
  if (typeof event?.text === "string") return event.text;
  if (typeof event?.data?.text === "string") return event.data.text;
  return "";
}

function mapOpenAIThinkingLevel(value, modelId) {
  const normalized = typeof value === "string" && value ? value.trim().toLowerCase() : "";
  const fallback = typeof getDefaultThinkingLevel(modelId) === "string"
    ? getDefaultThinkingLevel(modelId).trim().toLowerCase()
    : "high";
  const source = normalized || fallback;
  if (source === "minimal" || source === "none") return "low";
  if (source === "low") return "low";
  if (source === "medium") return "medium";
  return "high";
}

function mapClaudeThinkingLevel(value, modelId) {
  const normalized = typeof value === "string" && value ? value.trim().toLowerCase() : "";
  const fallback = typeof getDefaultThinkingLevel(modelId) === "string"
    ? getDefaultThinkingLevel(modelId).trim().toLowerCase()
    : "high";
  const source = normalized || fallback;
  if (source === "minimal" || source === "low") return "low";
  if (source === "medium") return "medium";
  if (source === "max") return "max";
  return "high";
}

function mapGeminiThinkingLevel(value, modelId) {
  const normalized = typeof value === "string" && value ? value.trim().toLowerCase() : "";
  const fallback = typeof getDefaultThinkingLevel(modelId) === "string"
    ? getDefaultThinkingLevel(modelId).trim().toLowerCase()
    : "high";
  const source = normalized || fallback;
  if (source === "minimal" || source === "low") return "LOW";
  if (source === "medium") return "MEDIUM";
  return "HIGH";
}

function hasImagesInHistory(messages) {
  return Array.isArray(messages) && messages.some((message) =>
    Array.isArray(message?.parts) && message.parts.some((part) => typeof part?.inlineData?.url === "string" && part.inlineData.url)
  );
}

function assertImageSupport(modelId, images, historyMessages) {
  const hasCurrentImages = Array.isArray(images) && images.length > 0;
  if (!hasCurrentImages && !hasImagesInHistory(historyMessages)) return;
  if (modelSupportsAvailableInput(modelId, "image", CHAT_RUNTIME_MODE_AGENT)) return;
  throw new Error("当前 Agent 模型不支持图片输入，请切换到支持图片的模型后再试");
}

function assertBinarySupport(modelId, inputType, attachments, historyMessages) {
  const currentBinaryAttachments = collectCurrentBinaryAttachments(attachments, inputType);
  if (currentBinaryAttachments.length === 0 && !hasBinaryInputInHistory(historyMessages, inputType)) return;
  if (modelSupportsAvailableInput(modelId, inputType, CHAT_RUNTIME_MODE_AGENT)) return;
  const label = inputType === "video" ? "视频" : "音频";
  throw new Error(`当前 Agent 模型不支持${label}输入，请切换到支持${label}的模型后再试`);
}

async function storedPartToOpenAIPart(part, role, fileTextMap) {
  if (!part || typeof part !== "object") return null;
  const isAssistant = role === "assistant";

  if (isNonEmptyString(part.text)) {
    return isAssistant
      ? { type: "output_text", text: part.text }
      : { type: "input_text", text: part.text };
  }

  const attachmentText = getPreparedAttachmentBlock(part, fileTextMap);
  if (attachmentText) {
    return isAssistant
      ? { type: "output_text", text: attachmentText }
      : { type: "input_text", text: attachmentText };
  }

  if (!isAssistant) {
    const url = part?.inlineData?.url;
    if (isNonEmptyString(url)) {
      const { base64Data, mimeType } = await fetchImageAsBase64(url);
      return {
        type: "input_image",
        image_url: `data:${mimeType};base64,${base64Data}`,
      };
    }
  }

  return null;
}

async function buildOpenAIHistoryInput(messages, fileTextMap) {
  const input = [];
  for (const msg of messages) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;
    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts || storedParts.length === 0) continue;
    const role = msg.role === "model" ? "assistant" : "user";
    const content = [];
    for (const storedPart of storedParts) {
      const part = await storedPartToOpenAIPart(storedPart, role, fileTextMap);
      if (part) content.push(part);
    }
    if (content.length > 0) {
      input.push({ role, content });
    }
  }
  return input;
}

async function streamOpenAIAnswer({ req, model, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, thinkingLevel, sendEvent }) {
  assertImageSupport(model, images, historyMessages);
  assertBinarySupport(model, "video", mediaAttachments, historyMessages);
  assertBinarySupport(model, "audio", mediaAttachments, historyMessages);
  const fileTextMap = await getPreparedAttachmentTextsByUrls(collectFileUrlsFromMessages(historyMessages), { userId });
  const input = await buildOpenAIHistoryInput(historyMessages, fileTextMap);
  const userContent = [];
  const userText = buildCurrentUserText({ prompt, preparedAttachments });
  if (userText) {
    userContent.push({ type: "input_text", text: userText });
  }
  for (const image of Array.isArray(images) ? images : []) {
    if (!image?.url) continue;
    const { base64Data, mimeType } = await fetchImageAsBase64(image.url);
    userContent.push({
      type: "input_image",
      image_url: `data:${mimeType};base64,${base64Data}`,
    });
  }
  if (userContent.length > 0) {
    input.push({ role: "user", content: userContent });
  }

  const providerConfig = resolveOpenAIProviderConfig();
  const requestBody = {
    model: toZenmuxModel(model),
    stream: true,
    max_output_tokens: AGENT_FINAL_MAX_TOKENS,
    instructions,
    input,
  };

  if (getModelConfig(model)?.supportsThinkingLevelControl === true) {
    requestBody.reasoning = {
      effort: mapOpenAIThinkingLevel(thinkingLevel, model),
    };
  }

  const response = await fetch(`${providerConfig.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: req?.signal,
  });

  if (!response.ok) {
    throw new Error(await response.text() || "OpenAI 请求失败");
  }

  let fullText = "";
  await readSseStream({
    response,
    signal: req?.signal,
    emptyBodyMessage: "OpenAI 返回了空响应体",
    onEvent: (event) => {
      if (event.type === "output.text.delta" || event.type === "response.output_text.delta") {
        const text = normalizeOpenAIEventDelta(event);
        if (!text) return;
        fullText += text;
        sendEvent({ type: "text", content: text });
        return;
      }

      if (event.type === "response.reasoning.delta" || event.type === "response.reasoning_summary_text.delta") {
        const thought = normalizeOpenAIEventDelta(event);
        if (!thought) return;
        sendEvent({ type: "thought", content: thought });
        return;
      }

      if (Array.isArray(event?.choices)) {
        const choice = event.choices[0] || null;
        const delta = choice?.delta;
        const text = normalizeOpenAIChunkText(delta?.content);
        if (text) {
          fullText += text;
          sendEvent({ type: "text", content: text });
        }
        const thought = normalizeOpenAIChunkThought(delta?.reasoning);
        if (thought) {
          sendEvent({ type: "thought", content: thought });
        }
      }
    },
  });

  return fullText;
}

async function storedPartToClaudePart(part, fileTextMap) {
  if (!part || typeof part !== "object") return null;

  if (isNonEmptyString(part.text)) {
    return { type: "text", text: part.text };
  }

  const attachmentText = getPreparedAttachmentBlock(part, fileTextMap);
  if (attachmentText) {
    return { type: "text", text: attachmentText };
  }

  const url = part?.inlineData?.url;
  if (isNonEmptyString(url)) {
    const { base64Data, mimeType } = await fetchImageAsBase64(url);
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType,
        data: base64Data,
      },
    };
  }

  return null;
}

async function buildClaudeMessagesFromHistory(messages, fileTextMap) {
  const claudeMessages = [];
  for (const msg of messages) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;
    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts || storedParts.length === 0) continue;
    const content = [];
    for (const storedPart of storedParts) {
      const part = await storedPartToClaudePart(storedPart, fileTextMap);
      if (part) content.push(part);
    }
    if (content.length > 0) {
      claudeMessages.push({
        role: msg.role === "model" ? "assistant" : "user",
        content,
      });
    }
  }
  return claudeMessages;
}

async function streamClaudeAnswer({ req, model, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, thinkingLevel, sendEvent }) {
  assertImageSupport(model, images, historyMessages);
  assertBinarySupport(model, "video", mediaAttachments, historyMessages);
  assertBinarySupport(model, "audio", mediaAttachments, historyMessages);
  const fileTextMap = await getPreparedAttachmentTextsByUrls(collectFileUrlsFromMessages(historyMessages), { userId });
  const claudeMessages = await buildClaudeMessagesFromHistory(historyMessages, fileTextMap);
  const userContent = [];
  const userText = buildCurrentUserText({ prompt, preparedAttachments });
  if (userText) {
    userContent.push({ type: "text", text: userText });
  }
  for (const image of Array.isArray(images) ? images : []) {
    if (!image?.url) continue;
    const { base64Data, mimeType } = await fetchImageAsBase64(image.url);
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType,
        data: base64Data,
      },
    });
  }
  if (userContent.length > 0) {
    claudeMessages.push({ role: "user", content: userContent });
  }

  const providerConfig = await resolveAnthropicProviderConfig();
  const apiModel = toZenmuxModel(resolveAnthropicApiModel(model));
  const client = new Anthropic({
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseUrl,
  });
  const requestParams = {
    model: apiModel,
    max_tokens: AGENT_FINAL_MAX_TOKENS,
    system: [{ type: "text", text: instructions }],
    messages: claudeMessages,
    stream: true,
  };

  if (getModelConfig(model)?.supportsThinkingLevelControl === true) {
    requestParams.thinking = { type: "adaptive" };
    requestParams.output_config = {
      effort: mapClaudeThinkingLevel(thinkingLevel, model),
    };
  }

  const stream = await client.messages.stream(requestParams);
  let fullText = "";
  for await (const event of stream) {
    throwIfAborted(req?.signal);
    if (event.type !== "content_block_delta") continue;
    const delta = event.delta;
    if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
      sendEvent({ type: "thought", content: delta.thinking });
      continue;
    }
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      fullText += delta.text;
      sendEvent({ type: "text", content: delta.text });
    }
  }
  return fullText;
}

async function storedPartToGeminiPart(part, fileTextMap) {
  if (!part || typeof part !== "object") return null;

  if (isNonEmptyString(part.text)) {
    return { text: part.text };
  }

  const attachmentText = getPreparedAttachmentBlock(part, fileTextMap);
  if (attachmentText) {
    return { text: attachmentText };
  }

  const url = part?.inlineData?.url;
  if (isNonEmptyString(url)) {
    const { base64Data, mimeType } = await fetchImageAsBase64(url);
    return { inlineData: { mimeType, data: base64Data } };
  }

  const binaryPayload = await getBinaryAttachmentPayload(part);
  if (binaryPayload?.base64Data && binaryPayload?.mimeType) {
    return { inlineData: { mimeType: binaryPayload.mimeType, data: binaryPayload.base64Data } };
  }

  return null;
}

function deduplicateGeminiThoughtFromText(textChunk, thoughtAccumulator) {
  if (!thoughtAccumulator) return textChunk;
  const thought = thoughtAccumulator.trim();
  const text = textChunk.trim();
  if (!thought || !text) return textChunk;

  if (text === thought) return "";

  if (text.startsWith(thought)) {
    return textChunk.slice(thought.length);
  }

  if (thought.length > 40) {
    const overlapLen = Math.min(thought.length, text.length, 100);
    const thoughtTail = thought.slice(-overlapLen);
    const textHead = text.slice(0, overlapLen);
    if (thoughtTail === textHead) {
      return textChunk.slice(overlapLen);
    }
  }

  return textChunk;
}

async function buildGeminiContentsFromHistory(messages, fileTextMap) {
  const contents = [];
  for (const msg of messages) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;
    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts || storedParts.length === 0) continue;
    const parts = [];
    for (const storedPart of storedParts) {
      const part = await storedPartToGeminiPart(storedPart, fileTextMap);
      if (part) parts.push(part);
    }
    if (parts.length > 0) {
      contents.push({ role: msg.role, parts });
    }
  }
  return contents;
}

async function streamGeminiAnswer({ req, model, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, thinkingLevel, sendEvent }) {
  assertImageSupport(model, images, historyMessages);
  assertBinarySupport(model, "video", mediaAttachments, historyMessages);
  assertBinarySupport(model, "audio", mediaAttachments, historyMessages);
  const fileTextMap = await getPreparedAttachmentTextsByUrls(collectFileUrlsFromMessages(historyMessages), { userId });
  const contents = await buildGeminiContentsFromHistory(historyMessages, fileTextMap);
  const userParts = [];
  const userText = buildCurrentUserText({ prompt, preparedAttachments });
  if (userText) {
    userParts.push({ text: userText });
  }
  for (const image of Array.isArray(images) ? images : []) {
    if (!image?.url) continue;
    const { base64Data, mimeType } = await fetchImageAsBase64(image.url);
    userParts.push({
      inlineData: {
        mimeType,
        data: base64Data,
      },
    });
  }
  for (const attachment of Array.isArray(mediaAttachments) ? mediaAttachments : []) {
    const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(attachment.url, { resourceLabel: "media" });
    const mimeType = attachment?.mimeType || fetchedMimeType;
    if (!base64Data || !mimeType) continue;
    userParts.push({
      inlineData: {
        mimeType,
        data: base64Data,
      },
    });
  }
  if (userParts.length > 0) {
    contents.push({ role: "user", parts: userParts });
  }

  const ai = await createGeminiClient();
  const config = {
    systemInstruction: { parts: [{ text: instructions }] },
    temperature: 1,
    maxOutputTokens: AGENT_FINAL_MAX_TOKENS,
  };

  if (getModelConfig(model)?.supportsThinkingLevelControl === true) {
    config.thinkingConfig = {
      thinkingLevel: mapGeminiThinkingLevel(thinkingLevel, model),
      includeThoughts: true,
    };
  }

  const streamResult = await ai.models.generateContentStream({
    model: resolveGeminiApiModel(model),
    contents,
    config,
  });

  let fullText = "";
  let accumulatedThought = "";
  for await (const chunk of streamResult) {
    throwIfAborted(req?.signal);
    const candidate = Array.isArray(chunk?.candidates) ? chunk.candidates[0] : null;
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const text = typeof part?.text === "string" ? part.text : "";
      if (!text) continue;
      if (part.thought) {
        accumulatedThought += text;
        sendEvent({ type: "thought", content: text });
      } else {
        const deduped = deduplicateGeminiThoughtFromText(text, accumulatedThought);
        if (!deduped) continue;
        fullText += deduped;
        sendEvent({ type: "text", content: deduped });
      }
    }
  }

  return fullText;
}

async function buildDeepSeekMessagesFromHistory(messages, fileTextMap) {
  const result = [];
  for (const msg of messages) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;

    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts || storedParts.length === 0) continue;

    const role = msg.role === "model" ? "assistant" : "user";
    const hasImages = role === "user" && storedParts.some((part) => typeof part?.inlineData?.url === "string" && part.inlineData.url);

    if (hasImages) {
      const contentParts = [];
      for (const part of storedParts) {
        if (isNonEmptyString(part?.text)) {
          contentParts.push({ type: "text", text: part.text });
          continue;
        }
        const attachmentText = getPreparedAttachmentBlock(part, fileTextMap);
        if (attachmentText) {
          contentParts.push({ type: "text", text: attachmentText });
          continue;
        }
        if (part?.inlineData?.url) {
          const { base64Data, mimeType } = await fetchImageAsBase64(part.inlineData.url);
          contentParts.push({
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Data}` },
          });
        }
      }
      if (contentParts.length > 0) {
        result.push({ role, content: contentParts });
      }
      continue;
    }

    const textParts = [];
    for (const part of storedParts) {
      if (isNonEmptyString(part?.text)) {
        textParts.push(part.text);
        continue;
      }
      const attachmentText = getPreparedAttachmentBlock(part, fileTextMap);
      if (attachmentText) {
        textParts.push(attachmentText);
      }
    }
    const text = textParts.join("\n\n").trim();
    if (text) {
      result.push({ role, content: text });
    }
  }
  return result;
}

async function streamDeepSeekAnswer({ req, model, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, sendEvent }) {
  assertImageSupport(model, images, historyMessages);
  assertBinarySupport(model, "video", mediaAttachments, historyMessages);
  assertBinarySupport(model, "audio", mediaAttachments, historyMessages);
  const { baseUrl: deepseekBaseUrl, apiKey } = resolveDeepSeekProviderConfig();

  const fileTextMap = await getPreparedAttachmentTextsByUrls(collectFileUrlsFromMessages(historyMessages), { userId });
  const messages = await buildDeepSeekMessagesFromHistory(historyMessages, fileTextMap);
  messages.unshift({ role: "system", content: instructions });

  const userText = buildCurrentUserText({ prompt, preparedAttachments });
  if (Array.isArray(images) && images.length > 0) {
    const content = [];
    if (userText) {
      content.push({ type: "text", text: userText });
    }
    for (const image of images) {
      if (!image?.url) continue;
      const { base64Data, mimeType } = await fetchImageAsBase64(image.url);
      content.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64Data}` },
      });
    }
    if (content.length > 0) {
      messages.push({ role: "user", content });
    }
  } else if (userText) {
    messages.push({ role: "user", content: userText });
  }

  const apiModel = toZenmuxModel(model === DEEPSEEK_REASONER_MODEL ? DEEPSEEK_REASONER_MODEL : DEEPSEEK_CHAT_MODEL);
  const response = await fetch(`${deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: apiModel,
      messages,
      stream: true,
      max_tokens: AGENT_FINAL_MAX_TOKENS,
    }),
    signal: req?.signal,
  });

  if (!response.ok) {
    throw new Error(await response.text() || "DeepSeek 请求失败");
  }

  let fullText = "";
  await readSseStream({
    response,
    signal: req?.signal,
    emptyBodyMessage: "DeepSeek 返回了空响应体",
    onEvent: (event) => {
      const choice = event?.choices?.[0];
      const delta = choice?.delta;
      if (typeof delta?.reasoning === "string" && delta.reasoning) {
        sendEvent({ type: "thought", content: delta.reasoning });
      }
      if (typeof delta?.content === "string" && delta.content) {
        fullText += delta.content;
        sendEvent({ type: "text", content: delta.content });
      }
    },
  });

  return fullText;
}

async function streamSeedAnswer({ apiKey, baseUrl, req, model, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, thinkingLevel, instructions, sendEvent }) {
  assertImageSupport(model, images, historyMessages);
  assertBinarySupport(model, "video", mediaAttachments, historyMessages);
  assertBinarySupport(model, "audio", mediaAttachments, historyMessages);
  const historyFileTextMap = await getPreparedAttachmentTextsByUrls(collectFileUrlsFromMessages(historyMessages), { userId });
  const input = [];
  for (const msg of historyMessages) {
    if (msg?.role !== "user" && msg?.role !== "model") continue;
    const storedParts = getStoredPartsFromMessage(msg);
    if (!storedParts || storedParts.length === 0) continue;
    const role = msg.role === "model" ? "assistant" : "user";
    const content = [];
    for (const part of storedParts) {
      if (isNonEmptyString(part?.text)) {
        content.push(role === "assistant"
          ? { type: "output_text", text: part.text }
          : { type: "input_text", text: part.text });
        continue;
      }
      const attachmentText = getPreparedAttachmentBlock(part, historyFileTextMap);
      if (attachmentText) {
        content.push(role === "assistant"
          ? { type: "output_text", text: attachmentText }
          : { type: "input_text", text: attachmentText });
        continue;
      }
      if (role !== "assistant" && part?.inlineData?.url) {
        const { base64Data, mimeType } = await fetchImageAsBase64(part.inlineData.url);
        content.push({
          type: "input_image",
          image_url: `data:${mimeType};base64,${base64Data}`,
        });
        continue;
      }
      if (role !== "assistant") {
        const binaryPayload = await getBinaryAttachmentPayload(part);
        if (binaryPayload?.inputType === "video") {
          content.push({
            type: "input_video",
            video_url: binaryPayload.dataUrl,
          });
          continue;
        }
        if (binaryPayload?.inputType === "audio") {
          content.push({
            type: "input_audio",
            audio_url: binaryPayload.dataUrl,
          });
        }
      }
    }
    const message = buildSeedMessageInput({ role, content });
    if (message) input.push(message);
  }

  const userContent = [];
  const userText = buildCurrentUserText({ prompt, preparedAttachments });
  if (userText) {
    userContent.push({ type: "input_text", text: userText });
  }
  for (const image of Array.isArray(images) ? images : []) {
    if (!image?.url) continue;
    const { base64Data, mimeType } = await fetchImageAsBase64(image.url);
    userContent.push({
      type: "input_image",
      image_url: `data:${mimeType};base64,${base64Data}`,
    });
  }
  for (const attachment of Array.isArray(mediaAttachments) ? mediaAttachments : []) {
    const inputType = getAttachmentInputType(attachment?.category);
    const { base64Data, mimeType: fetchedMimeType } = await fetchBlobAsBase64(attachment.url, { resourceLabel: "media" });
    const mimeType = attachment?.mimeType || fetchedMimeType;
    if (!base64Data || !mimeType) continue;
    const dataUrl = `data:${mimeType};base64,${base64Data}`;
    if (inputType === "video") {
      userContent.push({ type: "input_video", video_url: dataUrl });
      continue;
    }
    if (inputType === "audio") {
      userContent.push({ type: "input_audio", audio_url: dataUrl });
    }
  }
  const currentUserMessage = buildSeedMessageInput({ role: "user", content: userContent });
  if (currentUserMessage) input.push(currentUserMessage);

  const requestBody = buildSeedRequestBody({
    model: toZenmuxModel(model),
    input,
    instructions,
    maxTokens: AGENT_FINAL_MAX_TOKENS,
    thinkingLevel,
  });
  const response = await requestSeedResponses({ apiKey, baseUrl, requestBody, req });

  let fullText = "";
  await readSseStream({
    response,
    signal: req?.signal,
    emptyBodyMessage: "Seed 官方接口返回了空响应体，请稍后重试",
    onEvent: (event) => {
      const eventType = typeof event?.type === "string" ? event.type : "";
      if (eventType === "response.output_text.delta") {
        const text = normalizeSeedChunkText(event?.delta);
        if (!text) return;
        fullText += text;
        sendEvent({ type: "text", content: text });
        return;
      }
      if (eventType === "response.reasoning.delta" || eventType === "response.reasoning_summary_text.delta") {
        const thought = normalizeSeedChunkText(event?.delta);
        if (thought) {
          sendEvent({ type: "thought", content: thought });
        }
      }
    },
  });

  return fullText;
}

export async function runAgentControlText({
  apiKey,
  req,
  userId,
  driverModel,
  systemPrompt,
  userText,
  thinkingLevel,
  maxTokens = 1200,
  temperature = 0.1,
  onThought,
}) {
  const normalizedDriverModel = requireAgentDriverModel(driverModel);
  const provider = getModelProvider(normalizedDriverModel);

  if (provider === "openai") {
    const providerConfig = resolveOpenAIProviderConfig();
    const requestBody = {
      model: toZenmuxModel(normalizedDriverModel),
      stream: true,
      max_output_tokens: maxTokens,
      instructions: systemPrompt,
      input: [{ role: "user", content: [{ type: "input_text", text: userText }] }],
      temperature,
    };
    if (getModelConfig(normalizedDriverModel)?.supportsThinkingLevelControl === true) {
      requestBody.reasoning = {
        effort: mapOpenAIThinkingLevel(thinkingLevel, normalizedDriverModel),
      };
    }
    const response = await fetch(`${providerConfig.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: req?.signal,
    });
    if (!response.ok) {
      throw new Error(await response.text() || "OpenAI 控制请求失败");
    }

    let fullText = "";
    await readSseStream({
      response,
      signal: req?.signal,
      emptyBodyMessage: "OpenAI 控制请求返回了空响应体",
      onEvent: (event) => {
        if (event.type === "output.text.delta" || event.type === "response.output_text.delta") {
          const text = normalizeOpenAIEventDelta(event);
          if (!text) return;
          fullText += text;
          return;
        }

        if (event.type === "response.reasoning.delta" || event.type === "response.reasoning_summary_text.delta") {
          const thought = normalizeOpenAIEventDelta(event);
          if (!thought) return;
          onThought?.(thought);
          return;
        }

        if (Array.isArray(event?.choices)) {
          const choice = event.choices[0] || null;
          const delta = choice?.delta;
          const text = normalizeOpenAIChunkText(delta?.content);
          if (text) {
            fullText += text;
          }
          const thought = normalizeOpenAIChunkThought(delta?.reasoning);
          if (thought) {
            onThought?.(thought);
          }
        }
      },
    });
    return fullText.trim();
  }

  if (isAnthropicCompatibleProvider(provider)) {
    const providerConfig = await resolveAnthropicProviderConfig();
    const apiModel = toZenmuxModel(resolveAnthropicApiModel(normalizedDriverModel));
    const client = new Anthropic({
      apiKey: providerConfig.apiKey,
      baseURL: providerConfig.baseUrl,
    });
    const requestParams = {
      model: apiModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    };
    if (getModelConfig(normalizedDriverModel)?.supportsThinkingLevelControl === true) {
      requestParams.thinking = { type: "adaptive" };
      requestParams.output_config = {
        effort: mapClaudeThinkingLevel(thinkingLevel, normalizedDriverModel),
      };
    }
    const stream = await client.messages.stream(requestParams);
    let fullText = "";
    for await (const event of stream) {
      throwIfAborted(req?.signal);
      if (event.type !== "content_block_delta") continue;
      const delta = event.delta;
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        onThought?.(delta.thinking);
        continue;
      }
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        fullText += delta.text;
      }
    }
    return fullText.trim();
  }

  if (provider === "gemini") {
    const ai = await createGeminiClient();
    const config = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      maxOutputTokens: maxTokens,
      temperature,
    };
    if (getModelConfig(normalizedDriverModel)?.supportsThinkingLevelControl === true) {
      config.thinkingConfig = {
        thinkingLevel: mapGeminiThinkingLevel(thinkingLevel, normalizedDriverModel),
        includeThoughts: true,
      };
    }
    const streamResult = await ai.models.generateContentStream({
      model: resolveGeminiApiModel(normalizedDriverModel),
      contents: [{ role: "user", parts: [{ text: userText }] }],
      config,
    });

    let fullText = "";
    for await (const chunk of streamResult) {
      throwIfAborted(req?.signal);
      const candidate = Array.isArray(chunk?.candidates) ? chunk.candidates[0] : null;
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        const text = typeof part?.text === "string" ? part.text : "";
        if (!text) continue;
        if (part.thought) {
          onThought?.(text);
        } else {
          fullText += text;
        }
      }
    }
    return fullText.trim();
  }

  if (provider === "deepseek") {
    const { baseUrl: dsBaseUrl, apiKey: dsApiKey } = resolveDeepSeekProviderConfig();
    const apiModel = toZenmuxModel(normalizedDriverModel === DEEPSEEK_REASONER_MODEL ? DEEPSEEK_REASONER_MODEL : DEEPSEEK_CHAT_MODEL);
    const response = await fetch(`${dsBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dsApiKey}`,
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        stream: true,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: req?.signal,
    });
    if (!response.ok) {
      throw new Error(await response.text() || "DeepSeek 控制请求失败");
    }

    let fullText = "";
    await readSseStream({
      response,
      signal: req?.signal,
      emptyBodyMessage: "DeepSeek 控制请求返回了空响应体",
      onEvent: (event) => {
        const choice = event?.choices?.[0];
        const delta = choice?.delta;
        if (typeof delta?.reasoning === "string" && delta.reasoning) {
          onThought?.(delta.reasoning);
        }
        if (typeof delta?.content === "string" && delta.content) {
          fullText += delta.content;
        }
      },
    });
    return fullText.trim();
  }

  const seedConfig = resolveSeedProviderConfig();
  const requestBody = buildSeedRequestBody({
    model: toZenmuxModel(normalizedDriverModel),
    input: [buildSeedMessageInput({ role: "user", content: [{ type: "input_text", text: userText }] })],
    instructions: systemPrompt,
    maxTokens,
    temperature,
    thinkingLevel,
  });
  const response = await requestSeedResponses({ apiKey: seedConfig.apiKey, baseUrl: seedConfig.baseUrl, requestBody, req });
  let fullText = "";
  await readSseStream({
    response,
    signal: req?.signal,
    emptyBodyMessage: "Seed 控制请求返回了空响应体，请稍后重试",
    onEvent: (event) => {
      const eventType = typeof event?.type === "string" ? event.type : "";
      if (eventType === "response.output_text.delta") {
        const text = normalizeSeedChunkText(event?.delta);
        if (!text) return;
        fullText += text;
        return;
      }
      if (eventType === "response.reasoning.delta" || eventType === "response.reasoning_summary_text.delta") {
        const thought = normalizeSeedChunkText(event?.delta);
        if (thought) {
          onThought?.(thought);
        }
      }
    },
  });
  return fullText.trim();
}

export async function streamAgentFinalAnswer({ apiKey, req, driverModel, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, thinkingLevel, sendEvent }) {
  const normalizedDriverModel = requireAgentDriverModel(driverModel);
  const provider = getModelProvider(normalizedDriverModel);

  if (provider === "openai") {
    return streamOpenAIAnswer({ req, model: normalizedDriverModel, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, thinkingLevel, sendEvent });
  }
  if (isAnthropicCompatibleProvider(provider)) {
    return streamClaudeAnswer({ req, model: normalizedDriverModel, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, thinkingLevel, sendEvent });
  }
  if (provider === "gemini") {
    return streamGeminiAnswer({ req, model: normalizedDriverModel, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, thinkingLevel, sendEvent });
  }
  if (provider === "deepseek") {
    return streamDeepSeekAnswer({ req, model: normalizedDriverModel, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, sendEvent });
  }
  const seedConfig = resolveSeedProviderConfig();
  return streamSeedAnswer({ apiKey: seedConfig.apiKey, baseUrl: seedConfig.baseUrl, req, model: normalizedDriverModel, historyMessages, prompt, images, mediaAttachments, preparedAttachments, userId, instructions, thinkingLevel, sendEvent });
}

import { parseWebSearchConfig } from "@/lib/server/chat/requestConfig";
import { normalizeBlobFileId } from "@/lib/shared/blobFileIds";
import {
  getModelConfig,
  isAgentDriverModelId,
  normalizeModelId,
  normalizeAgentDriverModelId,
} from "@/lib/shared/models";

const ALLOWED_UPDATE_KEYS = new Set(["title", "messages", "settings", "pinned", "model"]);

const ALLOWED_SETTINGS_KEYS = new Set(["activePromptId", "agentModel", "webSearch"]);
const ALLOWED_MESSAGE_TYPES = new Set(["text", "parts", "error"]);
const ALLOWED_ROLES = new Set(["user", "model"]);
const ALLOWED_TIMELINE_KINDS = new Set(["thought", "search", "reader", "sandbox", "tool", "approval", "upload", "parse", "planner", "writer"]);
const ALLOWED_TIMELINE_STATUSES = new Set(["streaming", "running", "done", "error"]);

const MAX_MESSAGES = 500;
const MAX_MESSAGE_CHARS = 20000;
const MAX_MESSAGE_ID_CHARS = 128;
const MAX_PART_TEXT_CHARS = 10000;
const MAX_PARTS_PER_MESSAGE = 20;
const MAX_URL_CHARS = 2048;
const MAX_TITLE_CHARS = 200;
const MAX_CITATIONS = 20;
const MAX_CITATION_TITLE_CHARS = 200;
const MAX_CITATION_TEXT_CHARS = 1000;
const MAX_TIMELINE_STEPS = 50;
const MAX_TIMELINE_CONTENT_CHARS = 20000;
const MAX_TIMELINE_STRING_CHARS = 2048;
const MAX_COUNCIL_EXPERTS = 3;
const MAX_EXPERT_MODEL_CHARS = 100;
const MAX_EXPERT_LABEL_CHARS = 120;
const MAX_EXPERT_CONTENT_CHARS = 20000;
const MAX_PROMPTS = 50;
const MAX_PROMPT_NAME_CHARS = 80;
const MAX_PROMPT_CONTENT_CHARS = 8000;
const MAX_MODEL_CHARS = 100;

const ALLOWED_IMAGE_DOMAINS = [
  "blob.vercel-storage.com",
  "public.blob.vercel-storage.com",
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAllowedImageUrl(url) {
  if (typeof url !== "string" || !url.trim() || url.length > MAX_URL_CHARS) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_IMAGE_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

function isAllowedBlobUrl(url) {
  return isAllowedImageUrl(url);
}

function sanitizeCitations(value, fieldPath) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_CITATIONS) throw new Error(`${fieldPath} too many`);
  const citations = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const url = typeof item.url === "string" ? item.url : "";
    const title = typeof item.title === "string" ? item.title : "";
    const citedText = typeof item.cited_text === "string" ? item.cited_text : "";
    if (!url || url.length > MAX_URL_CHARS) continue;
    const entry = { url, title: title.slice(0, MAX_CITATION_TITLE_CHARS) };
    if (citedText) entry.cited_text = citedText.slice(0, MAX_CITATION_TEXT_CHARS);
    citations.push(entry);
  }
  return citations;
}

export function sanitizeMessage(message, index, { allowContentFallback = false } = {}) {
  if (!isPlainObject(message)) throw new Error(`messages[${index}] must be an object`);

  const role = message.role;
  const type = typeof message.type === "string" ? message.type : (allowContentFallback ? "text" : "");
  if (!ALLOWED_ROLES.has(role)) throw new Error(`messages[${index}].role invalid`);
  if (!ALLOWED_MESSAGE_TYPES.has(type)) throw new Error(`messages[${index}].type invalid`);

  const content = typeof message.content === "string" ? message.content : "";
  if (content.length > MAX_MESSAGE_CHARS) throw new Error(`messages[${index}].content too long`);

  const out = { role, type, content };

  if (typeof message.id === "string") {
    if (!message.id || message.id.length > MAX_MESSAGE_ID_CHARS) {
      throw new Error(`messages[${index}].id invalid`);
    }
    out.id = message.id;
  }

  if (typeof message.thought === "string") {
    if (message.thought.length > MAX_MESSAGE_CHARS) throw new Error(`messages[${index}].thought too long`);
    if (message.thought) out.thought = message.thought;
  }

  const citations = sanitizeCitations(message.citations, `messages[${index}].citations`);
  if (citations.length > 0) out.citations = citations;

  if (Number.isFinite(message.searchContextTokens) && message.searchContextTokens > 0) {
    out.searchContextTokens = Math.max(0, Math.floor(message.searchContextTokens));
  }

  if (Array.isArray(message.thinkingTimeline) && message.thinkingTimeline.length > 0) {
    if (message.thinkingTimeline.length > MAX_TIMELINE_STEPS) {
      throw new Error(`messages[${index}].thinkingTimeline too many`);
    }
    const timeline = [];
    for (const step of message.thinkingTimeline) {
      if (!isPlainObject(step)) continue;
      const kind = typeof step.kind === "string" ? step.kind : "";
      if (!ALLOWED_TIMELINE_KINDS.has(kind)) continue;
      let status = typeof step.status === "string" ? step.status : "done";
      if (!ALLOWED_TIMELINE_STATUSES.has(status)) status = "done";
      if (status === "streaming" || status === "running") status = "done";
      const entry = { kind, status };
      if (typeof step.id === "string" && step.id.length <= MAX_MESSAGE_ID_CHARS) entry.id = step.id;
      if (typeof step.content === "string") entry.content = step.content.slice(0, MAX_TIMELINE_CONTENT_CHARS);
      if (typeof step.query === "string") entry.query = step.query.slice(0, MAX_TIMELINE_STRING_CHARS);
      if (typeof step.title === "string") entry.title = step.title.slice(0, MAX_TIMELINE_STRING_CHARS);
      if (typeof step.url === "string") entry.url = step.url.slice(0, MAX_URL_CHARS);
      if (typeof step.message === "string") entry.message = step.message.slice(0, MAX_TIMELINE_STRING_CHARS);
      if (Number.isFinite(step.round)) entry.round = step.round;
      if (Number.isFinite(step.resultCount)) entry.resultCount = step.resultCount;
      if (step.synthetic === true) entry.synthetic = true;
      timeline.push(entry);
    }
    if (timeline.length > 0) out.thinkingTimeline = timeline;
  }

  const sourceParts = Array.isArray(message.parts) && message.parts.length > 0
    ? message.parts
    : (allowContentFallback && content ? [{ text: content }] : []);

  if (!allowContentFallback && sourceParts.length === 0) {
    throw new Error(`messages[${index}].parts required`);
  }
  if (sourceParts.length > MAX_PARTS_PER_MESSAGE) {
    throw new Error(`messages[${index}].parts too many`);
  }

  const parts = [];
  for (const part of sourceParts) {
    if (!isPlainObject(part)) continue;
    const nextPart = {};
    if (typeof part.text === "string") {
      if (part.text.length > MAX_PART_TEXT_CHARS) {
        throw new Error(`messages[${index}].parts text too long`);
      }
      if (part.text) nextPart.text = part.text;
    }
    if (isPlainObject(part.inlineData)) {
      const url = part.inlineData.url;
      if (!isAllowedImageUrl(url)) throw new Error(`messages[${index}].parts image invalid`);
      const mimeType = typeof part.inlineData.mimeType === "string" ? part.inlineData.mimeType.trim() : "";
      if (!mimeType || mimeType.length > 128) {
        throw new Error(`messages[${index}].parts image mimeType invalid`);
      }
      nextPart.inlineData = { url, mimeType };
      const blobFileId = normalizeBlobFileId(part.inlineData.blobFileId);
      if (blobFileId) nextPart.inlineData.blobFileId = blobFileId;
    }
    if (isPlainObject(part.fileData)) {
      const url = typeof part.fileData.url === "string" ? part.fileData.url.trim() : "";
      const name = typeof part.fileData.name === "string" ? part.fileData.name.trim() : "";
      const mimeType = typeof part.fileData.mimeType === "string" ? part.fileData.mimeType.trim() : "";
      const extension = typeof part.fileData.extension === "string" ? part.fileData.extension.trim().toLowerCase() : "";
      const category = typeof part.fileData.category === "string" ? part.fileData.category.trim() : "";
      const size = Number(part.fileData.size);
      if (!url || !isAllowedBlobUrl(url)) {
        throw new Error(`messages[${index}].parts file invalid`);
      }
      if (!name || name.length > MAX_TITLE_CHARS) {
        throw new Error(`messages[${index}].parts file name invalid`);
      }
      if (!mimeType || mimeType.length > 128) {
        throw new Error(`messages[${index}].parts file mimeType invalid`);
      }
      if (!extension || extension.length > 32) {
        throw new Error(`messages[${index}].parts file extension invalid`);
      }
      if (!category || category.length > 32) {
        throw new Error(`messages[${index}].parts file category invalid`);
      }
      if (!Number.isFinite(size) || size < 0) {
        throw new Error(`messages[${index}].parts file size invalid`);
      }
      nextPart.fileData = { url, name, mimeType, size, extension, category };
      const blobFileId = normalizeBlobFileId(part.fileData.blobFileId);
      if (blobFileId) nextPart.fileData.blobFileId = blobFileId;
    }
    if (typeof part.thoughtSignature === "string" && part.thoughtSignature.length <= 256) {
      nextPart.thoughtSignature = part.thoughtSignature;
    }
    if (Object.keys(nextPart).length > 0) parts.push(nextPart);
  }

  if (parts.length === 0) {
    throw new Error(`messages[${index}].parts invalid`);
  }
  out.parts = parts;

  if (Array.isArray(message.councilExperts)) {
    if (message.councilExperts.length > MAX_COUNCIL_EXPERTS) {
      throw new Error(`messages[${index}].councilExperts too many`);
    }
    const experts = [];
    for (const [expertIndex, expert] of message.councilExperts.entries()) {
      if (!isPlainObject(expert)) continue;
      const modelId = typeof expert.modelId === "string" ? expert.modelId.trim() : "";
      const label = typeof expert.label === "string" ? expert.label.trim() : "";
      const contentText = typeof expert.content === "string" ? expert.content : "";
      if (!modelId || modelId.length > MAX_EXPERT_MODEL_CHARS) {
        throw new Error(`messages[${index}].councilExperts[${expertIndex}].modelId invalid`);
      }
      if (!label || label.length > MAX_EXPERT_LABEL_CHARS) {
        throw new Error(`messages[${index}].councilExperts[${expertIndex}].label invalid`);
      }
      if (!contentText || contentText.length > MAX_EXPERT_CONTENT_CHARS) {
        throw new Error(`messages[${index}].councilExperts[${expertIndex}].content invalid`);
      }
      const expertEntry = { modelId, label, content: contentText };
      const expertCitations = sanitizeCitations(
        expert.citations,
        `messages[${index}].councilExperts[${expertIndex}].citations`
      );
      if (expertCitations.length > 0) expertEntry.citations = expertCitations;
      experts.push(expertEntry);
    }
    if (experts.length > 0) out.councilExperts = experts;
  }

  if (message.createdAt) {
    const date = new Date(message.createdAt);
    if (!Number.isNaN(date.getTime())) out.createdAt = date;
  }

  return out;
}

export function sanitizeMessages(messages, options) {
  if (!Array.isArray(messages)) return [];
  if (messages.length > MAX_MESSAGES) throw new Error(`messages too many (max ${MAX_MESSAGES})`);
  return messages.map((message, index) => sanitizeMessage(message, index, options));
}

export function sanitizeConversationSettingsUpdates(settings) {
  const updates = {};
  for (const [settingKey, settingValue] of Object.entries(settings || {})) {
    if (!ALLOWED_SETTINGS_KEYS.has(settingKey)) continue;
    if (settingKey === "activePromptId") {
      if (typeof settingValue !== "string" || settingValue.length > 128) {
        throw new Error("settings.activePromptId invalid");
      }
      updates[`settings.${settingKey}`] = settingValue;
      continue;
    }
    if (settingKey === "agentModel") {
      if (typeof settingValue !== "string" || !isAgentDriverModelId(settingValue)) {
        throw new Error("settings.agentModel invalid");
      }
      updates[`settings.${settingKey}`] = normalizeAgentDriverModelId(settingValue);
      continue;
    }
    if (settingKey === "webSearch") {
      updates[`settings.${settingKey}`] = parseWebSearchConfig(settingValue);
    }
  }
  return updates;
}

export function sanitizeConversationBody(body) {
  if (!isPlainObject(body)) {
    throw new Error("Invalid request body");
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_UPDATE_KEYS.has(key)) {
      throw new Error("Unsupported field in request body");
    }
  }

  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    throw new Error("messages must be an array");
  }

  if (body.pinned !== undefined && typeof body.pinned !== "boolean") {
    throw new Error("pinned must be a boolean");
  }

  if (body.settings !== undefined && !isPlainObject(body.settings)) {
    throw new Error("settings must be an object");
  }

  const update = {};
  let shouldTouchUpdatedAt = false;

  if (typeof body.title === "string") {
    if (body.title.length > MAX_TITLE_CHARS) {
      throw new Error("title too long");
    }
    update.title = body.title;
  }

  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !body.model.trim()) {
      throw new Error("model invalid");
    }
    const normalizedModel = normalizeModelId(body.model.trim());
    if (!getModelConfig(normalizedModel)) {
      throw new Error("model invalid");
    }
    update.model = normalizedModel;
  }

  if (Array.isArray(body.messages)) {
    update.messages = sanitizeMessages(body.messages);
    shouldTouchUpdatedAt = true;
  }

  if (typeof body.pinned === "boolean") {
    update.pinned = body.pinned;
  }

  if (body.settings) {
    Object.assign(update, sanitizeConversationSettingsUpdates(body.settings));
  }

  if (shouldTouchUpdatedAt) {
    update.updatedAt = Date.now();
  }

  return update;
}

export function sanitizeImportedConversationSettings(settings, index) {
  if (!isPlainObject(settings)) return undefined;

  const out = {};
  for (const [settingKey, settingValue] of Object.entries(settings)) {
    if (!ALLOWED_SETTINGS_KEYS.has(settingKey)) continue;
    if (settingKey === "activePromptId") {
      if (typeof settingValue !== "string" || settingValue.length > 128) {
        throw new Error(`conversations[${index}].settings.activePromptId invalid`);
      }
      out.activePromptId = settingValue;
      continue;
    }
    if (settingKey === "agentModel") {
      if (typeof settingValue !== "string" || !isAgentDriverModelId(settingValue)) {
        throw new Error(`conversations[${index}].settings.agentModel invalid`);
      }
      out.agentModel = normalizeAgentDriverModelId(settingValue);
      continue;
    }
    if (settingKey === "webSearch") {
      try {
        out.webSearch = parseWebSearchConfig(settingValue);
      } catch {
        throw new Error(`conversations[${index}].settings.webSearch invalid`);
      }
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeImportedConversation(conversation, index, userId) {
  if (!isPlainObject(conversation)) throw new Error(`conversations[${index}] must be an object`);

  const title = typeof conversation.title === "string" ? conversation.title : "New Chat";
  if (title.length > MAX_TITLE_CHARS) {
    throw new Error(`conversations[${index}].title too long`);
  }

  const messagesSrc = Array.isArray(conversation.messages) ? conversation.messages : [];
  const pinned = typeof conversation.pinned === "boolean" ? conversation.pinned : false;
  const messages = sanitizeMessages(messagesSrc, { allowContentFallback: true });

  const out = {
    userId,
    title,
    messages,
    pinned,
  };

  if (typeof conversation.model === "string" && conversation.model.trim()) {
    const model = conversation.model.trim();
    if (model.length > MAX_MODEL_CHARS) {
      throw new Error(`conversations[${index}].model too long`);
    }
    out.model = model;
  }

  const settings = sanitizeImportedConversationSettings(conversation.settings, index);
  if (settings) out.settings = settings;

  if (conversation.updatedAt) {
    const date = new Date(conversation.updatedAt);
    if (!Number.isNaN(date.getTime())) out.updatedAt = date;
  }

  return out;
}

export function sanitizeImportedUserSettings(settings, userId) {
  if (!settings || !isPlainObject(settings)) return null;
  const { _id, userId: _ignoreUserId, __v, ...rest } = settings;
  const avatar = typeof rest.avatar === "string" ? rest.avatar : null;
  if (avatar && !isAllowedImageUrl(avatar)) {
    throw new Error("settings.avatar invalid");
  }
  const systemPrompts = Array.isArray(rest.systemPrompts) ? rest.systemPrompts : [];
  if (systemPrompts.length > MAX_PROMPTS) {
    throw new Error(`settings.systemPrompts too many (max ${MAX_PROMPTS})`);
  }

  const sanitizedPrompts = systemPrompts
    .map((prompt) => {
      if (!isPlainObject(prompt)) return null;
      const name = typeof prompt.name === "string" ? prompt.name.trim() : "";
      const content = typeof prompt.content === "string" ? prompt.content.trim() : "";
      if (!name || !content) return null;
      if (name.length > MAX_PROMPT_NAME_CHARS || content.length > MAX_PROMPT_CONTENT_CHARS) {
        throw new Error("settings.systemPrompts item too long");
      }
      return { name, content };
    })
    .filter(Boolean);

  return {
    userId,
    avatar,
    systemPrompts: sanitizedPrompts,
    updatedAt: new Date(),
  };
}

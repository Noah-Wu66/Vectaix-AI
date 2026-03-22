import { apiJson } from "@/lib/client/apiClient";
import {
  AGENT_MODEL_ID,
  getModelConfig,
  getModelProvider,
  normalizeAgentDriverModelId,
} from "@/lib/shared/models";
import { normalizeWebSearchSettings } from "@/lib/shared/webSearch";

/**
 * 判断错误信息是否表示上下文窗口超出
 */
function isContextOverflowError(errorMessage) {
  if (typeof errorMessage !== "string") return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes("context length") ||
    lower.includes("context window") ||
    lower.includes("too many tokens") ||
    lower.includes("token limit") ||
    lower.includes("max_tokens") ||
    lower.includes("content_length") ||
    lower.includes("request too large") ||
    lower.includes("prompt is too long") ||
    lower.includes("maximum context length") ||
    lower.includes("exceeds the model") ||
    lower.includes("input is too long") ||
    lower.includes("resource has been exhausted") ||
    lower.includes("resource_exhausted") ||
    // Gemini 特有
    lower.includes("generate_content_request.contents") ||
    // Claude 特有
    lower.includes("input too long") ||
    // OpenAI 特有
    lower.includes("maximum context") ||
    lower.includes("reduce the length")
  );
}

function isUnauthorizedError(errorMessage) {
  if (typeof errorMessage !== "string") return false;
  const lower = errorMessage.toLowerCase();
  return lower.includes("401") || lower.includes("unauthorized");
}

function isConversationMissingError(errorMessage) {
  if (typeof errorMessage !== "string") return false;
  const normalized = errorMessage.trim().toLowerCase();
  return (
    normalized === "not found" ||
    normalized === "invalid id" ||
    normalized.includes("conversation not found") ||
    normalized.includes("会话不存在")
  );
}

function isUpstreamRouteMissingError(errorMessage) {
  if (typeof errorMessage !== "string") return false;
  const lower = errorMessage.toLowerCase();
  return /\b404\b.*page not found/.test(lower);
}

const ALLOWED_PERSISTED_TYPES = new Set(["text", "parts", "error"]);
const ALLOWED_PERSISTED_ROLES = new Set(["user", "model"]);
const ALLOWED_TIMELINE_KINDS = new Set(["thought", "search", "reader", "sandbox", "tool", "approval", "upload", "parse", "planner", "writer"]);
const ALLOWED_TIMELINE_STATUSES = new Set(["streaming", "running", "done", "error"]);
const PENDING_MESSAGE_TEXTS = new Set(["正在处理中...", "Council 正在处理中..."]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePersistedCitations(citations) {
  if (!Array.isArray(citations)) return undefined;
  const next = citations
    .filter((item) => item && typeof item === "object" && isNonEmptyString(item.url))
    .map((item) => {
      const entry = {
        url: item.url,
        title: typeof item.title === "string" ? item.title : "",
      };
      if (typeof item.cited_text === "string" && item.cited_text) {
        entry.cited_text = item.cited_text;
      }
      return entry;
    });
  return next.length > 0 ? next : undefined;
}

function normalizePersistedTimeline(steps) {
  if (!Array.isArray(steps)) return undefined;
  const next = steps
    .filter((step) => step && typeof step === "object" && ALLOWED_TIMELINE_KINDS.has(step.kind))
    .map((step) => {
      let status = typeof step.status === "string" && ALLOWED_TIMELINE_STATUSES.has(step.status)
        ? step.status
        : "done";
      if (status === "streaming" || status === "running") {
        status = "done";
      }

      const entry = { kind: step.kind, status };
      if (isNonEmptyString(step.id)) entry.id = step.id;
      if (typeof step.content === "string") entry.content = step.content;
      if (typeof step.query === "string") entry.query = step.query;
      if (typeof step.title === "string") entry.title = step.title;
      if (typeof step.url === "string") entry.url = step.url;
      if (typeof step.message === "string") entry.message = step.message;
      if (Number.isFinite(step.round)) entry.round = step.round;
      if (Number.isFinite(step.resultCount)) entry.resultCount = step.resultCount;
      if (step.synthetic === true) entry.synthetic = true;
      return entry;
    });
  return next.length > 0 ? next : undefined;
}

function normalizePersistedParts(parts, content) {
  if (Array.isArray(parts) && parts.length > 0) {
    const next = parts
      .filter((part) => part && typeof part === "object")
      .map((part) => {
        const entry = {};

        if (typeof part.text === "string" && part.text) {
          entry.text = part.text;
        }

        if (part.inlineData && typeof part.inlineData === "object" && isNonEmptyString(part.inlineData.url)) {
          entry.inlineData = {
            url: part.inlineData.url,
            mimeType: isNonEmptyString(part.inlineData.mimeType) ? part.inlineData.mimeType : "image/jpeg",
          };
        }

        if (part.fileData && typeof part.fileData === "object") {
          const { url, name, mimeType, extension, category } = part.fileData;
          const size = Number(part.fileData.size);
          if (
            isNonEmptyString(url)
            && isNonEmptyString(name)
            && isNonEmptyString(mimeType)
            && isNonEmptyString(extension)
            && isNonEmptyString(category)
            && Number.isFinite(size)
            && size >= 0
          ) {
            entry.fileData = {
              url,
              name,
              mimeType,
              size,
              extension,
              category,
            };
          }
        }

        if (isNonEmptyString(part.thoughtSignature)) {
          entry.thoughtSignature = part.thoughtSignature;
        }

        return Object.keys(entry).length > 0 ? entry : null;
      })
      .filter(Boolean);

    if (next.length > 0) {
      return next;
    }
  }

  if (typeof content === "string" && content) {
    return [{ text: content }];
  }

  return undefined;
}

function normalizePersistedCouncilExperts(experts) {
  if (!Array.isArray(experts)) return undefined;
  const next = experts
    .filter((expert) => expert && typeof expert === "object")
    .map((expert) => {
      if (!isNonEmptyString(expert.modelId) || !isNonEmptyString(expert.label) || !isNonEmptyString(expert.content)) {
        return null;
      }
      const entry = {
        modelId: expert.modelId,
        label: expert.label,
        content: expert.content,
      };
      const citations = normalizePersistedCitations(expert.citations);
      if (citations) entry.citations = citations;
      return entry;
    })
    .filter(Boolean);
  return next.length > 0 ? next : undefined;
}

function hasMeaningfulModelProgress(message, { content, parts, thinkingTimeline, citations } = {}) {
  if (!message || message.role !== "model") return false;

  const normalizedContent = typeof content === "string"
    ? content.trim()
    : (typeof message.content === "string" ? message.content.trim() : "");
  if (normalizedContent && !PENDING_MESSAGE_TEXTS.has(normalizedContent)) {
    return true;
  }

  if (typeof message.thought === "string" && message.thought.trim()) {
    return true;
  }

  if (typeof message.searchError === "string" && message.searchError.trim()) {
    return true;
  }

  const normalizedParts = Array.isArray(parts) ? parts : (Array.isArray(message.parts) ? message.parts : []);
  if (normalizedParts.some((part) => {
    const text = typeof part?.text === "string" ? part.text.trim() : "";
    return text && !PENDING_MESSAGE_TEXTS.has(text);
  })) {
    return true;
  }

  const normalizedTimeline = Array.isArray(thinkingTimeline)
    ? thinkingTimeline
    : (Array.isArray(message.thinkingTimeline) ? message.thinkingTimeline : []);
  if (normalizedTimeline.length > 0) {
    return true;
  }

  const normalizedCitations = Array.isArray(citations)
    ? citations
    : (Array.isArray(message.citations) ? message.citations : []);
  if (normalizedCitations.length > 0) {
    return true;
  }

  if (Array.isArray(message.councilExpertStates) && message.councilExpertStates.length > 0) {
    return true;
  }

  if (Array.isArray(message.councilExperts) && message.councilExperts.length > 0) {
    return true;
  }

  if (message.councilSummaryState && typeof message.councilSummaryState === "object") {
    return true;
  }

  return false;
}

function normalizePersistedMessage(message) {
  if (!message || typeof message !== "object") return null;
  if (!ALLOWED_PERSISTED_ROLES.has(message.role)) return null;

  const content = typeof message.content === "string" ? message.content : "";
  const parts = normalizePersistedParts(message.parts, content);
  if (!parts || parts.length === 0) return null;

  const thinkingTimeline = normalizePersistedTimeline(message.thinkingTimeline);
  const citations = normalizePersistedCitations(message.citations);

  if (!hasMeaningfulModelProgress(message, { content, parts, thinkingTimeline, citations })) {
    const normalizedContent = content.trim();
    const pendingOnly = message.role === "model"
      && (!normalizedContent || PENDING_MESSAGE_TEXTS.has(normalizedContent))
      && parts.every((part) => {
        const text = typeof part?.text === "string" ? part.text.trim() : "";
        return !text || PENDING_MESSAGE_TEXTS.has(text);
      });
    if (pendingOnly) {
      return null;
    }
  }

  const out = {
    role: message.role,
    type: ALLOWED_PERSISTED_TYPES.has(message.type) ? message.type : "parts",
    content,
    parts,
  };

  if (isNonEmptyString(message.id)) out.id = message.id;
  if (typeof message.thought === "string" && message.thought) out.thought = message.thought;

  if (citations) out.citations = citations;

  if (Number.isFinite(message.searchContextTokens) && message.searchContextTokens > 0) {
    out.searchContextTokens = Math.max(0, Math.floor(message.searchContextTokens));
  }

  if (thinkingTimeline) out.thinkingTimeline = thinkingTimeline;

  const councilExperts = normalizePersistedCouncilExperts(message.councilExperts);
  if (councilExperts) out.councilExperts = councilExperts;

  return out;
}

export function buildPersistedConversationMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(normalizePersistedMessage).filter(Boolean);
}

/**
 * 调用压缩 API，将历史消息压缩为摘要
 */
async function compressHistory(messages) {
  const data = await apiJson("/api/chat/compress", {
    method: "POST",
    body: { messages },
  });
  return data.summary;
}

export function buildChatConfig({
  modelId,
  agentModel,
  thinkingLevel,
  mediaResolution,
  systemPrompts,
  activePromptId,
  imageUrls,
  images,
  attachments,
  maxTokens,
  webSearch,
} = {}) {
  const modelConfig = getModelConfig(modelId);
  const cfg = {};
  if (modelConfig?.supportsThinkingLevelControl === true && typeof thinkingLevel === "string" && thinkingLevel) {
    cfg.thinkingLevel = thinkingLevel;
  }
  if (modelConfig?.supportsMaxTokensControl === true && Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0) {
    cfg.maxTokens = maxTokens;
  }
  if (modelConfig?.supportsWebSearch === true) {
    cfg.webSearch = normalizeWebSearchSettings(webSearch, { defaultEnabled: true });
  }
  if (modelId === AGENT_MODEL_ID) {
    cfg.agentModel = normalizeAgentDriverModelId(agentModel);
  }

  if (modelId !== AGENT_MODEL_ID) {
    const promptList = Array.isArray(systemPrompts) ? systemPrompts : [];
    const activeId = activePromptId == null ? null : String(activePromptId);
    const activePrompt = promptList.find((p) => String(p?._id) === activeId);
    if (activePrompt) cfg.systemPrompt = activePrompt.content;
  }

  // 支持多张图片
  if (Array.isArray(images) && images.length > 0) {
    cfg.images = images
      .filter((item) => typeof item?.url === "string" && item.url)
      .map((item) => ({
        url: item.url,
        ...(typeof item?.mimeType === "string" && item.mimeType
          ? { mimeType: item.mimeType }
          : {}),
      }));
    cfg.mediaResolution = mediaResolution;
  } else if (imageUrls?.length > 0) {
    cfg.images = imageUrls.map((url) => ({ url }));
    cfg.mediaResolution = mediaResolution;
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    cfg.attachments = attachments;
  }

  return cfg;
}

let completionSoundUnlocked = false;
let completionSoundUnlocking = false;
let completionSoundContext = null;
let completionSoundBuffer = null;
let completionSoundBufferPromise = null;

const getCompletionSoundContext = () => {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext;
  if (!AudioCtx) return null;
  if (!completionSoundContext || completionSoundContext.state === "closed") {
    completionSoundContext = new AudioCtx();
  }
  return completionSoundContext;
};

const loadCompletionSoundBuffer = async () => {
  if (completionSoundBuffer) return completionSoundBuffer;
  if (completionSoundBufferPromise) return completionSoundBufferPromise;
  const ctx = getCompletionSoundContext();
  if (!ctx) return null;
  completionSoundBufferPromise = fetch("/audio/staplebops-01.aac")
    .then((res) => res.arrayBuffer())
    .then((buf) => {
      if (typeof ctx.decodeAudioData !== "function") return null;
      const decoded = ctx.decodeAudioData(buf);
      if (decoded && typeof decoded.then === "function") return decoded;
      return new Promise((resolve, reject) => {
        ctx.decodeAudioData(buf, resolve, reject);
      });
    })
    .then((decoded) => {
      if (decoded) completionSoundBuffer = decoded;
      return completionSoundBuffer;
    })
    .catch(() => null)
    .finally(() => {
      completionSoundBufferPromise = null;
    });
  return completionSoundBufferPromise;
};

const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export function unlockCompletionSound() {
  if (completionSoundUnlocked || completionSoundUnlocking) return;
  const ctx = getCompletionSoundContext();
  if (!ctx) return;
  completionSoundUnlocking = true;
  const attempt = typeof ctx.resume === "function" ? ctx.resume() : null;
  if (attempt && typeof attempt.then === "function") {
    attempt
      .then(() => {
        completionSoundUnlocked = true;
        completionSoundUnlocking = false;
        loadCompletionSoundBuffer();
      })
      .catch(() => {
        completionSoundUnlocking = false;
      });
  } else {
    completionSoundUnlocked = true;
    completionSoundUnlocking = false;
    loadCompletionSoundBuffer();
  }
}

export async function runChat({
  prompt,
  historyMessages,
  conversationId,
  model,
  config,
  historyLimit,
  currentConversationId,
  setCurrentConversationId,
  fetchConversations,
  setMessages,
  setLoading,
  signal,
  mode,
  messagesForRegenerate,
  settings,
  completionSoundVolume,
  refusalRestoreMessages,
  onSensitiveRefusal,
  onError,
  onUnauthorized,
  onConversationMissing,
  userMessageId,
  targetMessageId,
  _agentAutoContinueCount = 0,
  // 上下文压缩相关
  _isCompressedRetry = false,
  _compressedSummary = null,
}) {
  // 在函数开头声明，确保在整个函数范围内可用
  let newConvId = null;

  const playCompletionSound = async () => {
    const rawVolume = Number(completionSoundVolume);
    if (!Number.isFinite(rawVolume) || rawVolume <= 0) return;
    const ctx = getCompletionSoundContext();
    if (!ctx) return;
    // Safari mobile: resume AudioContext first and wait for it
    if (ctx.state === "suspended" && typeof ctx.resume === "function") {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }
    const normalized = Math.max(0, Math.min(1, rawVolume / 100));
    if (!completionSoundBuffer) {
      await loadCompletionSoundBuffer();
    }
    if (!completionSoundBuffer) return;
    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = normalized;
      source.buffer = completionSoundBuffer;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
    } catch { }
  };
  const historyPayload = _isCompressedRetry && _compressedSummary
    ? [{
        role: "user",
        content: `[以下是之前对话的摘要，请基于此继续对话]\n\n${_compressedSummary}`,
        parts: [{ text: `[以下是之前对话的摘要，请基于此继续对话]\n\n${_compressedSummary}` }],
      }, {
        role: "model",
        content: "好的，我已了解之前的对话内容，请继续。",
        parts: [{ text: "好的，我已了解之前的对话内容，请继续。" }],
      }]
    : historyMessages.map((m) => ({
        role: m.role,
        content: m.content,
        parts: m.parts,
      }));

  const modelMessageId = generateMessageId();

  // 根据 provider 选择 API 端点（提前定义以便后续使用）
  const provider = getModelProvider(model);
  
  // Council 模式自己从数据库构建历史摘要，不需要前端发送 history，减少请求体大小
  const councilHistory = provider === "council" ? [] : historyPayload;
  
  const payload = {
    prompt,
    model,
    config,
    history: councilHistory,
    historyLimit,
    conversationId,
    ...(mode ? { mode } : {}),
    ...(mode === "regenerate" ? { messages: buildPersistedConversationMessages(messagesForRegenerate) } : {}),
    ...(!conversationId && settings ? { settings } : {}),
    ...(userMessageId ? { userMessageId } : {}),
    modelMessageId: targetMessageId || modelMessageId,
  };
  const apiEndpoint = provider === "claude" || provider === "xiaomi" || provider === "minimax"
    ? "/api/anthropic"
    : provider === "seed"
      ? "/api/bytedance"
      : provider === "vectaix"
      ? "/api/agent"
      : provider === "openai"
      ? "/api/openai"
      : provider === "deepseek"
      ? "/api/deepseek"
      : provider === "council"
      ? "/api/council"
      : "/api/google";

  const syncConversationMessages = async (convId, nextMessages) => {
    if (!convId || !Array.isArray(nextMessages)) return;
    try {
      const persistedMessages = buildPersistedConversationMessages(nextMessages);
      await fetch(`/api/conversations/${convId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: persistedMessages }),
        }
      );
    } catch { }
  };

  const restoreRegenerateMessages = async (convId) => {
    if (mode !== "regenerate" || !Array.isArray(refusalRestoreMessages)) {
      return false;
    }
    setMessages(refusalRestoreMessages);
    await syncConversationMessages(convId, refusalRestoreMessages);
    return true;
  };

  const captureCurrentMessages = async () => new Promise((resolve) => {
    setMessages((prev) => {
      resolve(Array.isArray(prev) ? prev : []);
      return prev;
    });
  });

  const removePendingUserMessage = (messagesList) => {
    if (!Array.isArray(messagesList) || messagesList.length === 0) return messagesList;
    const next = messagesList.slice();

    if (typeof userMessageId === "string" && userMessageId) {
      const targetIndex = next.findIndex((msg) => msg?.id === userMessageId);
      if (targetIndex >= 0) {
        next.splice(targetIndex, 1);
        return next;
      }
    }

    const hasPromptText = typeof prompt === "string" && prompt.trim();
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const msg = next[i];
      if (msg?.role !== "user") continue;
      if (hasPromptText) {
        if (msg?.content === prompt) {
          next.splice(i, 1);
          break;
        }
      } else if (typeof msg?.content === "string" && msg.content.trim() === "") {
        next.splice(i, 1);
        break;
      }
    }
    return next;
  };

  setLoading(true);
  let streamMsgId = modelMessageId;
  const shouldDelayConversationActivation = provider === "council";
  let conversationActivated = false;

  const ensureConversationActivated = () => {
    if (conversationActivated) return;
    if (!newConvId || currentConversationId) {
      conversationActivated = true;
      return;
    }
    conversationActivated = true;
    setCurrentConversationId(newConvId);
    fetchConversations();
  };

  const rollbackPendingTurn = async (convId) => {
    let nextMessagesForSync = null;
    setMessages((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      let next = prev;
      if (streamMsgId !== null) {
        next = next.filter((msg) => msg.id !== streamMsgId);
      }
      next = removePendingUserMessage(next);
      nextMessagesForSync = next;
      return next;
    });
    await syncConversationMessages(convId, nextMessagesForSync);
    if (newConvId) {
      setCurrentConversationId((prevId) => (prevId === newConvId ? null : prevId));
      fetchConversations();
    }
    streamMsgId = null;
  };

  try {
    const res = await fetch(apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      let errorMessage = res.statusText;
      try {
        const errorData = await res.json();
        errorMessage = errorData.error;
      } catch { }

      // 检测上下文超出错误，自动触发压缩重试（Council 模式有自己的历史管理机制，不触发压缩）
      if (!_isCompressedRetry && isContextOverflowError(errorMessage) && historyMessages.length > 0 && provider !== "council") {

        // 显示压缩中的状态消息
        const compressMsgId = generateMessageId();
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            content: "",
            type: "text",
            id: compressMsgId,
            isStreaming: true,
            isThinkingStreaming: true,
            isWaitingFirstChunk: false,
            thought: "",
            isSearching: false,
            searchQuery: null,
            searchResults: null,
            thinkingTimeline: [{ id: `timeline_compress_${Date.now()}`, kind: "thought", status: "streaming", content: "上下文已超出模型限制，正在压缩历史对话...", synthetic: false }],
            citations: null,
            searchError: null,
          },
        ]);

        try {
          const summary = await compressHistory(historyMessages);

          // 构建压缩后的消息列表：摘要消息 + 最近一轮对话
          const summaryUserMsg = {
            id: generateMessageId(),
            role: "user",
            content: `[以下是之前对话的摘要]\n\n${summary}`,
            type: "text",
            parts: [{ text: `[以下是之前对话的摘要]\n\n${summary}` }],
          };
          const summaryModelMsg = {
            id: generateMessageId(),
            role: "model",
            content: "好的，我已了解之前的对话内容，请继续。",
            type: "text",
            parts: [{ text: "好的，我已了解之前的对话内容，请继续。" }],
          };

          // 替换前端消息列表：摘要 + 最后一条用户消息（如果有）
          const compressedMessages = [summaryUserMsg, summaryModelMsg];

          // 移除压缩状态消息
          setMessages((prev) => {
            const filtered = prev.filter((m) => m.id !== compressMsgId);
            // 找到最后一条用户消息（当前正在发送的那条）
            const lastUserMsg = filtered.length > 0 && filtered[filtered.length - 1]?.role === "user"
              ? filtered[filtered.length - 1]
              : null;
            if (lastUserMsg) {
              return [...compressedMessages, lastUserMsg];
            }
            return compressedMessages;
          });

          // 同步压缩后的消息到数据库
          const targetConvId = newConvId || currentConversationId;
          if (targetConvId) {
            try {
              const currentMessages = await captureCurrentMessages();
              await syncConversationMessages(targetConvId, currentMessages);
            } catch { /* ignore sync error */ }
          }

          // 用压缩后的摘要重新发送请求
          return runChat({
              prompt,
              historyMessages: compressedMessages,
              conversationId: newConvId || currentConversationId || conversationId,
              model,
              config,
              historyLimit,
              currentConversationId: newConvId || currentConversationId,
              setCurrentConversationId,
              fetchConversations,
              setMessages,
              setLoading,
              signal,
              mode,
              messagesForRegenerate: mode === "regenerate" ? compressedMessages : messagesForRegenerate,
              settings,
              completionSoundVolume,
              refusalRestoreMessages,
              onSensitiveRefusal,
              onError,
              onUnauthorized,
              onConversationMissing,
              userMessageId,
              _isCompressedRetry: true,
              _compressedSummary: summary,
            });
         } catch (compressErr) {
           // 移除压缩状态消息
           setMessages((prev) => prev.filter((m) => m.id !== compressMsgId));
           throw new Error("对话上下文过长，自动压缩失败：" + (compressErr?.message || "未知错误"));
        }
      }

      const responseError = new Error(errorMessage);
      responseError.httpStatus = res.status;
      throw responseError;
    }


    newConvId = res.headers.get("X-Conversation-Id");
    if (newConvId && !currentConversationId && !shouldDelayConversationActivation) {
      ensureConversationActivated();
    }

    // continue 模式下需要继承已有消息的 timeline/thought，避免清空导致气泡闪烁
    let _inheritedTimeline = null;
    let _inheritedThought = null;

    setMessages((prev) => {
      const targetId = targetMessageId || streamMsgId;
      const existing = prev.find((item) => item?.id === targetId);
      const isContinue = false;
      if (isContinue) {
        _inheritedTimeline = Array.isArray(existing.thinkingTimeline) ? existing.thinkingTimeline : null;
        _inheritedThought = typeof existing.thought === "string" ? existing.thought : null;
      }
      const nextStreamingState = {
        role: "model",
        content: "",
        type: "text",
        id: targetId,
        isStreaming: true,
        isThinkingStreaming: true,
        isWaitingFirstChunk: !isContinue,
        thought: "",
        isSearching: false,
        searchQuery: null,
        searchResults: null,
        thinkingTimeline: [],
        citations: null,
        councilExperts: null,
        councilExpertStates: null,
        councilSummaryState: null,
        searchError: null,
      };
      const index = prev.findIndex((item) => item?.id === targetId);
      if (index >= 0) {
        const next = prev.slice();
        next[index] = {
          ...prev[index],
          ...nextStreamingState,
          thinkingTimeline: Array.isArray(prev[index]?.thinkingTimeline) ? prev[index].thinkingTimeline : nextStreamingState.thinkingTimeline,
          citations: prev[index]?.citations || nextStreamingState.citations,
          thought: isContinue ? (prev[index]?.thought || "") : "",
          content: prev[index]?.content || "",
          parts: prev[index]?.parts,
        };
        streamMsgId = targetId;
        return next;
      }
      streamMsgId = targetId;
      return [...prev, nextStreamingState];
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let fullText = "";
    let displayedText = "";
    let fullThought = _inheritedThought || "";
    let buffer = "";
    let thinkingEnded = false;
    let sawDone = false;
    const convIdForSync = newConvId || currentConversationId || conversationId;

    let flushScheduled = false;
    let hasReceivedContent = Boolean(_inheritedTimeline?.length || _inheritedThought);
    let isSearching = false;
    let searchQuery = null;
    let searchResults = null;
    let citations = null;
    let councilExperts = null;
    let councilExpertStates = null;
    let councilSummaryState = null;
    let searchError = null;
    let streamErrorMessage = null; // 流内错误消息（来自 stream_error 事件）
    let searchContextTokens = 0; // 联网搜索注入的上下文 token 数
    let thinkingTimeline = _inheritedTimeline || [];
    let timelineStepSeq = _inheritedTimeline?.length || 0;

    const nextTimelineId = () => `timeline_${Date.now()}_${++timelineStepSeq}`;

    const updateThinkingTimeline = (updater) => {
      const base = Array.isArray(thinkingTimeline) ? thinkingTimeline : [];
      const next = updater(base);
      if (Array.isArray(next)) {
        thinkingTimeline = next;
      }
    };

    const appendTimelineStep = (step) => {
      if (!step || typeof step !== "object") return;
      updateThinkingTimeline((prev) => [...prev, { id: nextTimelineId(), ...step }]);
    };

    const upsertCouncilExpertState = (nextState) => {
      if (!nextState || typeof nextState !== "object") return;
      const key = typeof nextState.key === "string" && nextState.key
        ? nextState.key
        : (typeof nextState.modelId === "string" && nextState.modelId ? nextState.modelId : null);
      if (!key) return;

      const base = Array.isArray(councilExpertStates) ? councilExpertStates : [];
      const index = base.findIndex((item) => item?.key === key);
      if (index >= 0) {
        const next = base.slice();
        next[index] = { ...next[index], ...nextState, key };
        councilExpertStates = next;
        return;
      }
      councilExpertStates = [...base, { ...nextState, key }];
    };

    const getLastTimelineStep = () => {
      if (!Array.isArray(thinkingTimeline) || thinkingTimeline.length === 0) return null;
      return thinkingTimeline[thinkingTimeline.length - 1] || null;
    };

    const ensureSyntheticThoughtRunning = () => {
      const last = getLastTimelineStep();
      if (last?.kind === "thought" && last?.status === "streaming") return;
      appendTimelineStep({
        kind: "thought",
        status: "streaming",
        content: "",
        synthetic: true,
      });
    };

    const patchLastRunningStep = (kind, patch) => {
      let updated = false;
      updateThinkingTimeline((prev) => {
        for (let i = prev.length - 1; i >= 0; i -= 1) {
          const item = prev[i];
          if (item?.kind === kind && item?.status === "running") {
            const next = prev.slice();
            next[i] = { ...item, ...patch };
            updated = true;
            return next;
          }
        }
        return prev;
      });
      return updated;
    };

    const appendThoughtStep = (deltaText) => {
      if (typeof deltaText !== "string" || !deltaText) return;
      updateThinkingTimeline((prev) => {
        if (prev.length > 0) {
          const last = prev[prev.length - 1];
          if (last?.kind === "thought" && last?.status === "streaming") {
            const next = prev.slice();
            next[next.length - 1] = {
              ...last,
              synthetic: false,
              content: `${typeof last.content === "string" ? last.content : ""}${deltaText}`,
            };
            return next;
          }
        }
        return [...prev, { id: nextTimelineId(), kind: "thought", status: "streaming", content: deltaText, synthetic: false }];
      });
    };

    const closeStreamingThoughtSteps = () => {
      updateThinkingTimeline((prev) => {
        let changed = false;
        const next = prev.map((item) => {
          if (item?.kind === "thought" && item?.status === "streaming") {
            changed = true;
            return { ...item, status: "done" };
          }
          return item;
        });
        return changed ? next : prev;
      });
    };

    const flushStreamingMessage = () => {
      flushScheduled = false;
      setMessages((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) return prev;

        const lastIdx = prev.length - 1;
        const isLast = prev[lastIdx]?.id === streamMsgId;
        const idx = isLast ? lastIdx : prev.findIndex((m) => m?.id === streamMsgId);
        if (idx < 0) return prev;

        const base = prev[idx];
        const nowHasContent =
          displayedText.length > 0 ||
          fullThought.length > 0 ||
          isSearching ||
          searchError ||
          (Array.isArray(councilExpertStates) && councilExpertStates.length > 0) ||
          (councilSummaryState && typeof councilSummaryState === "object") ||
          (Array.isArray(thinkingTimeline) && thinkingTimeline.length > 0);
        if (nowHasContent && !hasReceivedContent) {
          hasReceivedContent = true;
        }
        const nextMsg = {
          ...base,
          content: displayedText,
          parts: displayedText.length > 0 ? [{ text: displayedText }] : base.parts,
          thought: fullThought,
          isThinkingStreaming: !thinkingEnded,
          isWaitingFirstChunk: !hasReceivedContent,
          isSearching,
          searchQuery,
          searchResults,
          thinkingTimeline,
          citations,
          councilExperts,
          councilExpertStates,
          councilSummaryState,
          searchError,
          searchContextTokens: searchContextTokens || undefined,
        };
        if (
          base.content === nextMsg.content &&
          base.thought === nextMsg.thought &&
          base.isThinkingStreaming === nextMsg.isThinkingStreaming &&
          base.isWaitingFirstChunk === nextMsg.isWaitingFirstChunk &&
          base.isSearching === nextMsg.isSearching &&
          base.searchQuery === nextMsg.searchQuery &&
          base.searchResults === nextMsg.searchResults &&
          base.thinkingTimeline === nextMsg.thinkingTimeline &&
          base.citations === nextMsg.citations &&
          base.councilExperts === nextMsg.councilExperts &&
          base.councilExpertStates === nextMsg.councilExpertStates &&
          base.councilSummaryState === nextMsg.councilSummaryState &&
          base.searchError === nextMsg.searchError &&
          base.searchContextTokens === nextMsg.searchContextTokens
        ) {
          return prev;
        }

        const next = prev.slice();
        next[idx] = nextMsg;
        return next;
      });
    };

    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(flushStreamingMessage);
      else setTimeout(flushStreamingMessage, 0);
    };

    const applyEventPayload = (payload) => {
      const p = payload.trim();
      if (!p) return;
      if (p === "[DONE]") {
        sawDone = true;
        isSearching = false;
        patchLastRunningStep("search", { status: "done" });
        closeStreamingThoughtSteps();
        displayedText = fullText;
        scheduleFlush();
        return;
      }
      try {
        const data = JSON.parse(p);
        if (data.type === "thought") {
          const delta = typeof data.content === "string" ? data.content : "";
          fullThought += delta;
          appendThoughtStep(delta);
        } else if (data.type === "text") {
          const delta = typeof data.content === "string" ? data.content : "";
          fullText += delta;
          displayedText = fullText;
          if (shouldDelayConversationActivation && fullText.trim()) {
            ensureConversationActivated();
          }
          if (!thinkingEnded) {
            ensureSyntheticThoughtRunning();
            thinkingEnded = true;
            closeStreamingThoughtSteps();
          }
          isSearching = false;
          scheduleFlush();
        } else if (data.type === "search_start") {
          isSearching = true;
          const query = typeof data.query === "string" ? data.query.trim() : "";
          const round = Number.isFinite(data.round) ? data.round : null;
          if (query) searchQuery = query;
          ensureSyntheticThoughtRunning();
          closeStreamingThoughtSteps();
          appendTimelineStep({
            kind: "search",
            status: "running",
            ...(round ? { round } : {}),
            query: query || "（空检索词）",
          });
          searchError = null;
        } else if (data.type === "search_result") {
          isSearching = false;
          const query = typeof data.query === "string" ? data.query.trim() : "";
          const round = Number.isFinite(data.round) ? data.round : null;
          if (query) searchQuery = query;
          const updated = patchLastRunningStep("search", {
            status: "done",
            ...(round ? { round } : {}),
            query: query || undefined,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "search",
              status: "done",
              ...(round ? { round } : {}),
              query: query || "（空检索词）",
            });
          }
          searchResults = data.results;
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
        } else if (data.type === "search_error") {
          isSearching = false;
          const query = typeof data.query === "string" ? data.query.trim() : "";
          const round = Number.isFinite(data.round) ? data.round : null;
          const message = typeof data.message === "string" && data.message.trim()
            ? data.message.trim()
            : "联网搜索失败，请稍后再试";
          const updated = patchLastRunningStep("search", {
            status: "error",
            ...(round ? { round } : {}),
            query: query || undefined,
            message,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "search",
              status: "error",
              ...(round ? { round } : {}),
              query: query || searchQuery || "（空检索词）",
              message,
            });
          }
          searchError = message;
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
        } else if (data.type === "agent_step") {
          const step = data.step && typeof data.step === "object" ? data.step : null;
          if (step) {
            const nextStep = {
              id: typeof step.id === "string" ? step.id : nextTimelineId(),
              kind: typeof step.kind === "string" ? step.kind : "thought",
              status: typeof step.status === "string" ? step.status : "done",
              title: typeof step.title === "string" ? step.title : "",
              content: typeof step.content === "string" ? step.content : "",
              message: typeof step.message === "string" ? step.message : "",
              query: typeof step.query === "string" ? step.query : "",
            };
            updateThinkingTimeline((prev) => {
              const idx = prev.findIndex((item) => item?.id === nextStep.id);
              if (idx >= 0) {
                const next = prev.slice();
                next[idx] = { ...next[idx], ...nextStep };
                return next;
              }
              // 新步骤进入前，关闭前面所有还在 running/streaming 的步骤
              const closed = prev.map((item) => {
                if ((item.status === "running" || item.status === "streaming") && item.id !== nextStep.id) {
                  return { ...item, status: "done" };
                }
                return item;
              });
              return [...closed, nextStep];
            });
            scheduleFlush();
          }
        } else if (data.type === "citations") {
          citations = Array.isArray(data.citations) ? data.citations : null;
          scheduleFlush();
        } else if (data.type === "council_experts") {
          councilExperts = Array.isArray(data.experts) ? data.experts : null;
          scheduleFlush();
        } else if (data.type === "council_expert_result") {
          if (data.expert && typeof data.expert === "object") {
            if (!councilExperts) councilExperts = [];
            const idx = councilExperts.findIndex((e) => e.label === data.expert.label);
            if (idx >= 0) {
              councilExperts = councilExperts.map((e, i) => i === idx ? data.expert : e);
            } else {
              councilExperts = [...councilExperts, data.expert];
            }
            scheduleFlush();
          }
        } else if (data.type === "council_expert_states") {
          councilExpertStates = Array.isArray(data.experts) ? data.experts : null;
          scheduleFlush();
        } else if (data.type === "council_expert_state") {
          upsertCouncilExpertState(data.expert);
          scheduleFlush();
        } else if (data.type === "council_summary_state") {
          councilSummaryState = data.summary && typeof data.summary === "object"
            ? data.summary
            : null;
          scheduleFlush();
        } else if (data.type === "council_triage") {
          if (data.skipped) {
            // Seed 预判为简单问题，将所有专家状态设为 skipped
            const base = Array.isArray(councilExpertStates) ? councilExpertStates : [];
            councilExpertStates = base.map((item) => ({
              ...item,
              status: "skipped",
              phase: "skipped",
              message: "已跳过",
            }));
            scheduleFlush();
          }
        } else if (data.type === "search_context_tokens") {
          const tokens = typeof data.tokens === "number" ? data.tokens : 0;
          if (tokens > 0) searchContextTokens = tokens;
        } else if (data.type === "stream_error") {
          // 流内错误：记录错误信息，后续在主循环中处理
          streamErrorMessage = typeof data.message === "string" ? data.message : "Unknown stream error";
        }
      } catch {
        return;
      }
    };

    const consumeSseBuffer = (final = false) => {
      // 兼容 \n\n 和 \r\n\r\n 的分隔
      const blocks = buffer.split(/\r?\n\r?\n/);
      if (!final) buffer = blocks.pop();
      else buffer = "";

      for (const block of blocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) continue;

        // SSE 允许多行 data:，需要合并
        const lines = trimmedBlock.split(/\r?\n/);
        const dataLines = [];
        for (const line of lines) {
          if (!line) continue;
          if (line.startsWith(":")) continue; // comment/heartbeat
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^\s*/, ""));
          }
        }
        if (!dataLines.length) continue;
        applyEventPayload(dataLines.join("\n"));
      }
    };

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (signal?.aborted) break;
      if (value) buffer += decoder.decode(value, { stream: true });
      consumeSseBuffer(false);

      if (signal?.aborted) break;
      scheduleFlush();
    }

    // flush TextDecoder / 最后一段 buffer（避免最后一个事件未以空行结尾时被漏掉）
    buffer += decoder.decode();
    consumeSseBuffer(true);
    displayedText = fullText;
    if (shouldDelayConversationActivation && fullText.trim()) {
      ensureConversationActivated();
    }
    flushStreamingMessage();

    // 检查流内错误（AI API 在流式传输过程中报错，如上下文超出）
    if (streamErrorMessage && fullText.trim() === "") {
      // 移除正在流式输出的空消息
      if (streamMsgId !== null) {
        setMessages((prev) => prev.filter((msg) => msg.id !== streamMsgId));
        streamMsgId = null;
      }
      throw new Error(streamErrorMessage);
    }

    const isGeminiRefusal =
      provider === "gemini" &&
      !signal?.aborted &&
      sawDone &&
      fullText.trim() === "" &&
      fullThought.trim() === "" &&
      (!citations || citations.length === 0);

    if (isGeminiRefusal) {
    const convIdForSync = newConvId || currentConversationId || conversationId;
      let nextMessagesForSync = null;
      if (Array.isArray(refusalRestoreMessages)) {
        setMessages(refusalRestoreMessages);
        nextMessagesForSync = refusalRestoreMessages;
      } else {
        setMessages((prev) => {
          if (!Array.isArray(prev) || prev.length === 0) return prev;
          let next = prev.filter((msg) => msg.id !== streamMsgId);
          const hasPromptText = typeof prompt === "string" && prompt.trim();
          if (hasPromptText) {
            for (let i = next.length - 1; i >= 0; i -= 1) {
              const msg = next[i];
              if (msg?.role === "user" && msg?.content === prompt) {
                next.splice(i, 1);
                break;
              }
            }
          } else {
            for (let i = next.length - 1; i >= 0; i -= 1) {
              const msg = next[i];
              if (msg?.role === "user" && typeof msg?.content === "string" && msg.content.trim() === "") {
                next.splice(i, 1);
                break;
              }
            }
          }
          nextMessagesForSync = next;
          return next;
        });
      }

      if (convIdForSync && Array.isArray(nextMessagesForSync)) {
        await syncConversationMessages(convIdForSync, nextMessagesForSync);
      }

      const shouldPrefill = mode !== "regenerate" && !Array.isArray(refusalRestoreMessages);
      onSensitiveRefusal?.({ prompt, shouldPrefill });
      return;
    }

    if (!signal?.aborted && (sawDone || fullText.length > 0)) {
      await playCompletionSound();
    }

    // 流式结束后做一次"最终对齐"：移动端偶发断流/缓冲时，避免必须刷新才能看到完整内容
    if (!signal?.aborted && sawDone && convIdForSync) {
      (async () => {
        try {
          const convRes = await fetch(`/api/conversations/${convIdForSync}`);
          if (!convRes.ok) return;
          const data = await convRes.json();
          const serverMessages = data?.conversation?.messages;
          if (!Array.isArray(serverMessages)) return;

          const lastModelLen = (arr) => {
            for (let i = arr.length - 1; i >= 0; i -= 1) {
              if (arr[i]?.role === "model") return arr[i]?.content.length;
            }
            return 0;
          };

          // 将 thinkingTimeline 回写到服务器，使切换对话后能恢复完整流程展示
          const hasTimelineToSave = Array.isArray(thinkingTimeline) && thinkingTimeline.length > 0;
          if (hasTimelineToSave) {
            const nextMsgs = serverMessages.slice();
            let patched = false;
            for (let i = nextMsgs.length - 1; i >= 0; i -= 1) {
              if (nextMsgs[i]?.role === "model") {
                nextMsgs[i] = { ...nextMsgs[i], thinkingTimeline };
                patched = true;
                break;
              }
            }
            if (patched) {
              await syncConversationMessages(convIdForSync, nextMsgs);
            }
          }

          setMessages((prev) => {
            const idx = prev.findIndex((m) => m?.id === streamMsgId);
            // 如果用户已经发了下一条消息，就不要覆盖，避免竞态把新消息"抹掉"
            if (idx !== -1 && idx !== prev.length - 1) return prev;
            if (lastModelLen(serverMessages) < lastModelLen(prev)) return prev;
            const streamMsg = idx >= 0 ? prev[idx] : null;
            const streamTimeline = Array.isArray(streamMsg?.thinkingTimeline)
              ? streamMsg.thinkingTimeline
              : null;
            const streamCouncilExperts = Array.isArray(streamMsg?.councilExperts)
              ? streamMsg.councilExperts
              : null;
            const streamCitations = Array.isArray(streamMsg?.citations)
              ? streamMsg.citations
              : null;
            const streamCouncilExpertStates = Array.isArray(streamMsg?.councilExpertStates)
              ? streamMsg.councilExpertStates
              : null;
            const streamCouncilSummaryState = streamMsg?.councilSummaryState && typeof streamMsg.councilSummaryState === "object"
              ? streamMsg.councilSummaryState
              : null;
            const streamSearchError = typeof streamMsg?.searchError === "string"
              ? streamMsg.searchError
              : null;

            // 保留流式消息的 id，避免 MessageList key 变化导致整条气泡重新挂载（framer-motion 入场动画 => "闪一下"）
            if (streamMsgId != null) {
              const next = serverMessages.slice();
              for (let i = next.length - 1; i >= 0; i -= 1) {
                if (next[i]?.role === "model") {
                  next[i] = {
                    ...next[i],
                    id: streamMsgId,
                    ...(streamTimeline?.length ? { thinkingTimeline: streamTimeline } : {}),
                    ...(streamCitations?.length ? { citations: streamCitations } : {}),
                    ...(streamCouncilExperts?.length ? { councilExperts: streamCouncilExperts } : {}),
                    ...(streamCouncilExpertStates?.length ? { councilExpertStates: streamCouncilExpertStates } : {}),
                    ...(streamCouncilSummaryState ? { councilSummaryState: streamCouncilSummaryState } : {}),
                    ...(streamSearchError ? { searchError: streamSearchError } : {}),
                  };
                  break;
                }
              }

              // 同步上一条用户消息的 id，避免"上一条气泡"闪烁
              if (prev.length >= 2 && next.length >= 2) {
                const prevLast = prev[prev.length - 1];
                const prevPrev = prev[prev.length - 2];
                const nextPrev = next[next.length - 2];
                if (
                  prevLast?.id === streamMsgId &&
                  prevPrev?.role === "user" &&
                  prevPrev?.id != null &&
                  nextPrev?.role === "user" &&
                  typeof prevPrev?.content === "string" &&
                  prevPrev.content === nextPrev?.content
                ) {
                  next[next.length - 2] = { ...nextPrev, id: prevPrev.id };
                }
              }

              return next;
            }

            return serverMessages;
          });
        } catch {
          // ignore
        }
      })();
    }

  } catch (err) {
    const isAbortError = err?.name === "AbortError";
    const convIdForSync = newConvId || currentConversationId || conversationId;

    if (isAbortError) {
      const restored = await restoreRegenerateMessages(convIdForSync);
      if (restored) {
        streamMsgId = null;
      } else {
        await rollbackPendingTurn(convIdForSync);
      }
    } else {
      const errMsg = err?.message;
      const normalizedErrMsg = typeof errMsg === "string" ? errMsg.trim() : "";
      const lowerErrMsg = normalizedErrMsg.toLowerCase();
      const errorStatus = typeof err?.httpStatus === "number" ? err.httpStatus : undefined;
      const isUnauthorized = errorStatus === 401;
      const isProviderUnauthorized = !isUnauthorized && isUnauthorizedError(errMsg);
      const isConversationMissing = (
        errorStatus === 404 ||
        (errorStatus === 400 && typeof errMsg === "string" && errMsg.trim().toLowerCase() === "invalid id")
      ) && isConversationMissingError(errMsg);
      const isUpstreamRouteMissing = isUpstreamRouteMissingError(errMsg);

      // 检测上下文超出错误，自动触发压缩重试（流内错误场景，Council 模式不触发）
      if (!_isCompressedRetry && isContextOverflowError(errMsg) && historyMessages.length > 0 && provider !== "council") {

        // 移除正在流式输出的消息（如有）
        if (streamMsgId !== null) {
          setMessages((prev) => prev.filter((msg) => msg.id !== streamMsgId));
        }

        // 显示压缩中的状态消息
        const compressMsgId = generateMessageId();
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            content: "",
            type: "text",
            id: compressMsgId,
            isStreaming: true,
            isThinkingStreaming: true,
            isWaitingFirstChunk: false,
            thought: "",
            isSearching: false,
            searchQuery: null,
            searchResults: null,
            thinkingTimeline: [{ id: `timeline_compress_${Date.now()}`, kind: "thought", status: "streaming", content: "上下文已超出模型限制，正在压缩历史对话...", synthetic: false }],
            citations: null,
            searchError: null,
          },
        ]);

        try {
          const summary = await compressHistory(historyMessages);

          const summaryUserMsg = {
            id: generateMessageId(),
            role: "user",
            content: `[以下是之前对话的摘要]\n\n${summary}`,
            type: "text",
            parts: [{ text: `[以下是之前对话的摘要]\n\n${summary}` }],
          };
          const summaryModelMsg = {
            id: generateMessageId(),
            role: "model",
            content: "好的，我已了解之前的对话内容，请继续。",
            type: "text",
            parts: [{ text: "好的，我已了解之前的对话内容，请继续。" }],
          };

          const compressedMessages = [summaryUserMsg, summaryModelMsg];

          // 移除压缩状态消息，替换为压缩后的消息
          setMessages((prev) => {
            const filtered = prev.filter((m) => m.id !== compressMsgId);
            const lastUserMsg = filtered.length > 0 && filtered[filtered.length - 1]?.role === "user"
              ? filtered[filtered.length - 1]
              : null;
            if (lastUserMsg) {
              return [...compressedMessages, lastUserMsg];
            }
            return compressedMessages;
          });

          // 同步压缩后的消息到数据库
          const targetConvId = newConvId || currentConversationId;
          if (targetConvId) {
            try {
              const currentMessages = await captureCurrentMessages();
              await syncConversationMessages(targetConvId, currentMessages);
            } catch { /* ignore sync error */ }
          }

          // 用压缩后的摘要重新发送请求
          return runChat({
            prompt,
            historyMessages: compressedMessages,
            conversationId: newConvId || currentConversationId || conversationId,
            model,
            config,
            historyLimit,
            currentConversationId: newConvId || currentConversationId,
            setCurrentConversationId,
            fetchConversations,
            setMessages,
            setLoading,
            signal,
            mode,
            messagesForRegenerate: mode === "regenerate" ? compressedMessages : messagesForRegenerate,
            settings,
            completionSoundVolume,
            refusalRestoreMessages,
            onSensitiveRefusal,
            onError,
            onUnauthorized,
            onConversationMissing,
            userMessageId,
            _isCompressedRetry: true,
            _compressedSummary: summary,
          });
        } catch (compressErr) {
          setMessages((prev) => prev.filter((m) => m.id !== compressMsgId));
          if (mode === "regenerate" && Array.isArray(refusalRestoreMessages)) {
            await restoreRegenerateMessages(newConvId || currentConversationId || conversationId);
          }
          onError?.("对话上下文过长，自动压缩失败：" + (compressErr?.message || "未知错误"));
          streamMsgId = null;
          return;
        }
      }

      // 根据错误类型给出准确的提示
      let errorMessage;
      if (
        lowerErrMsg.includes("failed to fetch")
        || lowerErrMsg.includes("fetch failed")
        || lowerErrMsg.includes("networkerror")
        || lowerErrMsg.includes("network")
      ) {
        errorMessage = "网络连接失败，请检查网络后重试";
      } else if (normalizedErrMsg.includes("rate limit") || normalizedErrMsg.includes("429")) {
        errorMessage = "请求过于频繁，请稍后再试";
      } else if (isUnauthorized) {
        errorMessage = "登录已过期，请刷新页面重新登录";
      } else if (isProviderUnauthorized) {
        errorMessage = "模型服务认证失败，请稍后再试";
      } else if (isConversationMissing) {
        errorMessage = "当前对话已失效，已切回新对话，请重新发送消息";
      } else if (isUpstreamRouteMissing) {
        errorMessage = "模型服务接口异常，请稍后再试";
      } else if (normalizedErrMsg.includes("500") || normalizedErrMsg.includes("Internal Server Error")) {
        errorMessage = "服务器内部错误，请稍后再试";
      } else if (normalizedErrMsg.includes("503") || normalizedErrMsg.includes("Service Unavailable")) {
        errorMessage = "服务暂时不可用，请稍后再试";
      } else if (normalizedErrMsg) {
        // 有具体错误信息时直接显示
        errorMessage = normalizedErrMsg;
      } else {
        errorMessage = "请求失败，请重试";
      }
      if (mode === "regenerate" && Array.isArray(refusalRestoreMessages)) {
        await restoreRegenerateMessages(convIdForSync);
      } else {
        await rollbackPendingTurn(convIdForSync);
      }

      if (isConversationMissing) {
        onConversationMissing?.();
      }
      if (isUnauthorized) {
        onUnauthorized?.();
      }
      // 通过回调通知错误（由调用方显示 toast）
      onError?.(errorMessage);
      streamMsgId = null;
    }
  } finally {
    if (streamMsgId !== null) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamMsgId ? { ...msg, isStreaming: false, isWaitingFirstChunk: false } : msg,
        ),
      );
    }
    setLoading(false);
  }
}

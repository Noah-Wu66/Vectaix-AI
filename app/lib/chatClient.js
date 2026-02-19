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

/**
 * 调用压缩 API，将历史消息压缩为摘要
 */
async function compressHistory(messages) {
  const res = await fetch("/api/chat/compress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "压缩失败");
  }
  const data = await res.json();
  return data.summary;
}

export function buildChatConfig({
  thinkingLevel,
  mediaResolution,
  systemPrompts,
  activePromptId,
  imageUrls,
  maxTokens,
  budgetTokens,
  webSearch,
  lineMode,
}) {
  const cfg = {};
  cfg.thinkingLevel = thinkingLevel;
  cfg.maxTokens = maxTokens;
  cfg.budgetTokens = budgetTokens;
  cfg.webSearch = webSearch === true;
  cfg.lineMode = lineMode === "economy" ? "economy" : "premium";

  const activeId = activePromptId == null ? null : String(activePromptId);
  const activePrompt = systemPrompts.find((p) => String(p?._id) === activeId);
  if (activePrompt) cfg.systemPrompt = activePrompt.content;

  // 支持多张图片
  if (imageUrls?.length > 0) {
    cfg.images = imageUrls.map((url) => ({ url }));
    cfg.mediaResolution = mediaResolution;
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
  provider,
  settings,
  completionSoundVolume,
  refusalRestoreMessages,
  onSensitiveRefusal,
  onError,
  userMessageId,
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

  const payload = {
    prompt,
    model,
    config,
    history: historyPayload,
    historyLimit,
    conversationId,
    ...(mode ? { mode } : {}),
    ...(mode === "regenerate" ? { messages: messagesForRegenerate } : {}),
    ...(!conversationId && settings ? { settings } : {}),
    ...(userMessageId ? { userMessageId } : {}),
    modelMessageId,
  };

  // 根据 provider 选择 API 端点
  const apiEndpoint = provider === "claude"
    ? "/api/anthropic"
    : provider === "seed"
      ? "/api/bytedance"
      : provider === "openai"
      ? "/api/openai"
      : "/api/google";

  const syncConversationMessages = async (convId, nextMessages) => {
    if (!convId || !Array.isArray(nextMessages)) return;
    try {
      await fetch(`/api/conversations/${convId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextMessages }),
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

  setLoading(true);
  let streamMsgId = modelMessageId;
  const debugTag = "[chat-stream]";
  const logProgressStep = 500;

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

      // 检测上下文超出错误，自动触发压缩重试
      if (!_isCompressedRetry && isContextOverflowError(errorMessage) && historyMessages.length > 0) {
        console.log(debugTag, "context overflow detected, compressing history...", {
          historyLen: historyMessages.length,
          errorMessage,
        });

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
          console.log(debugTag, "compression done", { summaryLen: summary.length });

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
              const currentMessages = await new Promise((resolve) => {
                setMessages((prev) => {
                  resolve(prev);
                  return prev;
                });
              });
              await fetch(`/api/conversations/${targetConvId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: currentMessages }),
              });
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
              provider,
              settings,
              completionSoundVolume,
              refusalRestoreMessages,
              onSensitiveRefusal,
              onError,
              userMessageId,
              _isCompressedRetry: true,
              _compressedSummary: summary,
            });
         } catch (compressErr) {
           console.error(debugTag, "compression failed", compressErr?.message);
           // 移除压缩状态消息
           setMessages((prev) => prev.filter((m) => m.id !== compressMsgId));
           throw new Error("对话上下文过长，自动压缩失败：" + (compressErr?.message || "未知错误"));
        }
      }

      throw new Error(errorMessage);
    }


    newConvId = res.headers.get("X-Conversation-Id");
    if (newConvId && !currentConversationId) {
      setCurrentConversationId(newConvId);
      fetchConversations();
    }

    setMessages((prev) => [
      ...prev,
      {
        role: "model",
        content: "",
        type: "text",
        id: streamMsgId,
        isStreaming: true,
        isThinkingStreaming: true,
        isWaitingFirstChunk: true,
        thought: "",
        isSearching: false,
        searchQuery: null,
        searchResults: null,
        thinkingTimeline: [],
        citations: null,
        searchError: null,
      },
    ]);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let fullText = "";
    let displayedText = "";
    let fullThought = "";
    let buffer = "";
    let thinkingEnded = false;
    let sawDone = false;
    const convIdForSync = newConvId || currentConversationId || conversationId;

    let flushScheduled = false;
    let hasReceivedContent = false;
    let isSearching = false;
    let searchQuery = null;
    let searchResults = null;
    let citations = null;
    let searchError = null;
    let streamErrorMessage = null; // 流内错误消息（来自 stream_error 事件）
    let searchContextTokens = 0; // 联网搜索注入的上下文 token 数
    let thinkingTimeline = [];
    let timelineStepSeq = 0;
    let lastTextLogLen = 0;
    let lastThoughtLogLen = 0;

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

    console.log(debugTag, "response ok", {
      status: res.status,
      endpoint: apiEndpoint,
      conversationId: newConvId,
      provider,
      model,
    });

    // 通用超时检测：统一30秒
    let timeoutId = null;
    let timedOut = false;
    const timeoutMs = 30000;
    timeoutId = setTimeout(() => {
      if (!hasReceivedContent) {
        timedOut = true;
        reader.cancel();
      }
    }, timeoutMs);

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
          (Array.isArray(thinkingTimeline) && thinkingTimeline.length > 0);
        if (nowHasContent && !hasReceivedContent) {
          hasReceivedContent = true;
          // 收到内容，清除超时定时器
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
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
        patchLastRunningStep("reader", { status: "done" });
        closeStreamingThoughtSteps();
        displayedText = fullText;
        scheduleFlush();
        console.log(debugTag, "sse done", {
          fullTextLen: fullText.length,
          fullThoughtLen: fullThought.length,
          hasCitations: Array.isArray(citations) ? citations.length : 0,
        });
        return;
      }
      try {
        const data = JSON.parse(p);
        if (data.type === "thought") {
          const delta = typeof data.content === "string" ? data.content : "";
          fullThought += delta;
          appendThoughtStep(delta);
          if (fullThought.length === delta.length) {
            console.log(debugTag, "thought start", { len: fullThought.length });
          } else if (fullThought.length - lastThoughtLogLen >= logProgressStep) {
            lastThoughtLogLen = fullThought.length;
            console.log(debugTag, "thought progress", { len: fullThought.length });
          }
        } else if (data.type === "text") {
          const delta = typeof data.content === "string" ? data.content : "";
          fullText += delta;
          displayedText = fullText;
          if (fullText.length === delta.length) {
            console.log(debugTag, "text start", { len: fullText.length });
          } else if (fullText.length - lastTextLogLen >= logProgressStep) {
            lastTextLogLen = fullText.length;
            console.log(debugTag, "text progress", { len: fullText.length });
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
          console.log(debugTag, "search start", { query: data.query });
          const query = typeof data.query === "string" ? data.query.trim() : "";
          if (query) searchQuery = query;
          ensureSyntheticThoughtRunning();
          closeStreamingThoughtSteps();
          appendTimelineStep({
            kind: "search",
            status: "running",
            query: query || "（空检索词）",
          });
          searchError = null;
        } else if (data.type === "search_result") {
          isSearching = false;
          const resultCount = Array.isArray(data.results) ? data.results.length : 0;
          console.log(debugTag, "search result", {
            query: data.query,
            resultCount,
          });
          const query = typeof data.query === "string" ? data.query.trim() : "";
          if (query) searchQuery = query;
          const updated = patchLastRunningStep("search", {
            status: "done",
            query: query || undefined,
            resultCount,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "search",
              status: "done",
              query: query || "（空检索词）",
              resultCount,
            });
          }
          searchResults = data.results;
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
        } else if (data.type === "search_reader_start") {
          isSearching = true;
          const title = typeof data.title === "string" ? data.title.trim() : "";
          const url = typeof data.url === "string" ? data.url.trim() : "";
          searchQuery = title ? `查看全文：${title}` : (url ? `查看全文：${url}` : "查看全文");
          ensureSyntheticThoughtRunning();
          closeStreamingThoughtSteps();
          appendTimelineStep({
            kind: "reader",
            status: "running",
            title,
            url,
          });
          searchError = null;
        } else if (data.type === "search_reader_result") {
          isSearching = false;
          const title = typeof data.title === "string" ? data.title.trim() : "";
          const url = typeof data.url === "string" ? data.url.trim() : "";
          const updated = patchLastRunningStep("reader", {
            status: "done",
            title: title || undefined,
            url: url || undefined,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "reader",
              status: "done",
              title,
              url,
            });
          }
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
        } else if (data.type === "search_reader_error") {
          isSearching = false;
          const title = typeof data.title === "string" ? data.title.trim() : "";
          const url = typeof data.url === "string" ? data.url.trim() : "";
          const message = "网页全文读取失败，已继续使用检索摘要";
          const updated = patchLastRunningStep("reader", {
            status: "error",
            title: title || undefined,
            url: url || undefined,
            message,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "reader",
              status: "error",
              title,
              url,
              message,
            });
          }
          searchError = message;
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
        } else if (data.type === "search_error") {
          isSearching = false;
          const query = typeof data.query === "string" ? data.query.trim() : "";
          const message = typeof data.message === "string" && data.message.trim()
            ? data.message.trim()
            : "检索失败，请稍后再试";
          const updated = patchLastRunningStep("search", {
            status: "error",
            query: query || undefined,
            message,
          });
          if (!updated) {
            appendTimelineStep({
              kind: "search",
              status: "error",
              query: query || searchQuery || "（空检索词）",
              message,
            });
          }
          searchError = message;
          if (!thinkingEnded) ensureSyntheticThoughtRunning();
        } else if (data.type === "citations") {
          citations = data.citations;
          console.log(debugTag, "citations", {
            count: Array.isArray(citations) ? citations.length : 0,
          });
        } else if (data.type === "search_context_tokens") {
          const tokens = typeof data.tokens === "number" ? data.tokens : 0;
          if (tokens > 0) searchContextTokens = tokens;
        } else if (data.type === "stream_error") {
          // 流内错误：记录错误信息，后续在主循环中处理
          streamErrorMessage = typeof data.message === "string" ? data.message : "Unknown stream error";
          console.error(debugTag, "stream_error received", { message: streamErrorMessage });
        }
      } catch {
        const preview = p.length > 200 ? `${p.slice(0, 200)}...` : p;
        console.warn(debugTag, "invalid sse payload", preview);
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
      // 检查超时
      if (timedOut) {
        throw new Error("API_TIMEOUT");
      }
      if (value) buffer += decoder.decode(value, { stream: true });
      consumeSseBuffer(false);

      if (signal?.aborted) break;
      scheduleFlush();
    }

    // 检查超时（在循环结束后再检查一次）
    if (timedOut) {
      throw new Error("API_TIMEOUT");
    }

    // flush TextDecoder / 最后一段 buffer（避免最后一个事件未以空行结尾时被漏掉）
    buffer += decoder.decode();
    consumeSseBuffer(true);
    displayedText = fullText;
    flushStreamingMessage();

    console.log(debugTag, "stream finished", {
      sawDone,
      fullTextLen: fullText.length,
      fullThoughtLen: fullThought.length,
      timedOut,
      streamErrorMessage,
    });

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
        try {
          await fetch(`/api/conversations/${convIdForSync}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: nextMessagesForSync }),
            }
          );
        } catch { }
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
          const hasTimelineToSave = Array.isArray(thinkingTimeline) && thinkingTimeline.length > 0
            && thinkingTimeline.some((s) => s?.kind === "search" || s?.kind === "reader");
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
              try {
                await fetch(`/api/conversations/${convIdForSync}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ messages: nextMsgs }),
                });
              } catch { /* ignore */ }
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
      }
    } else {
      const errMsg = err?.message;

      // 检测上下文超出错误，自动触发压缩重试（流内错误场景）
      if (!_isCompressedRetry && isContextOverflowError(errMsg) && historyMessages.length > 0) {
        console.log(debugTag, "context overflow in stream, compressing history...", {
          historyLen: historyMessages.length,
          errorMessage: errMsg,
        });

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
          console.log(debugTag, "compression done (stream error path)", { summaryLen: summary.length });

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
              const currentMessages = await new Promise((resolve) => {
                setMessages((prev) => {
                  resolve(prev);
                  return prev;
                });
              });
              await fetch(`/api/conversations/${targetConvId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: currentMessages }),
              });
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
            provider,
            settings,
            completionSoundVolume,
            refusalRestoreMessages,
            onSensitiveRefusal,
            onError,
            userMessageId,
            _isCompressedRetry: true,
            _compressedSummary: summary,
          });
        } catch (compressErr) {
          console.error(debugTag, "compression failed (stream error path)", compressErr?.message);
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
      if (errMsg === "API_TIMEOUT") {
        errorMessage = "AI 响应超时，请稍后重试";
      } else if (errMsg?.includes("Failed to fetch") || errMsg?.includes("NetworkError") || errMsg?.includes("network")) {
        errorMessage = "网络连接失败，请检查网络后重试";
      } else if (errMsg?.includes("rate limit") || errMsg?.includes("429")) {
        errorMessage = "请求过于频繁，请稍后再试";
      } else if (errMsg?.includes("401") || errMsg?.includes("Unauthorized")) {
        errorMessage = "登录已过期，请刷新页面重新登录";
      } else if (errMsg?.includes("500") || errMsg?.includes("Internal Server Error")) {
        errorMessage = "服务器内部错误，请稍后再试";
      } else if (errMsg?.includes("503") || errMsg?.includes("Service Unavailable")) {
        errorMessage = "服务暂时不可用，请稍后再试";
      } else if (errMsg) {
        // 有具体错误信息时直接显示
        errorMessage = errMsg;
      } else {
        errorMessage = "请求失败，请重试";
      }
      // 移除正在流式输出的消息（如有）
      if (streamMsgId !== null) {
        setMessages((prev) => prev.filter((msg) => msg.id !== streamMsgId));
      }
      // regenerate 失败：恢复原消息，避免旧回答丢失
      if (mode === "regenerate" && Array.isArray(refusalRestoreMessages)) {
        await restoreRegenerateMessages(convIdForSync);
      }

      // 超时：回滚本次用户消息，避免"悬空提问"扰乱上下文
      if (errMsg === "API_TIMEOUT" && mode !== "regenerate") {
        let nextMessagesForSync = null;
        setMessages((prev) => {
          if (!Array.isArray(prev) || prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last?.role !== "user") return prev;
          if (typeof prompt === "string" && last?.content !== prompt) return prev;
          const next = prev.slice(0, -1);
          nextMessagesForSync = next;
          return next;
        });
        await syncConversationMessages(convIdForSync, nextMessagesForSync);
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

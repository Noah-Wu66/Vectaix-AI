export function buildChatConfig({
  model,
  thinkingLevel,
  mediaResolution,
  systemPrompts,
  activePromptId,
  imageUrl,
  imageUrls,
  maxTokens,
  budgetTokens,
  webSearch,
}) {
  const cfg = {};
  cfg.thinkingLevel = thinkingLevel;
  cfg.maxTokens = maxTokens;
  cfg.budgetTokens = budgetTokens;
  cfg.webSearch = webSearch === true;

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
    .catch((e) => {
      console.error("[completionSound] decode failed:", e);
      return null;
    })
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
    } catch (e) {
      console.error("[completionSound] play failed:", e);
    }
  };
  const historyPayload = historyMessages.map((m) => ({
    role: m.role,
    content: m.content,
    image: m.image,
    images: m.images,
    mimeType: m.mimeType,
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
  const apiEndpoint = provider === "claude" ? "/api/claude" : provider === "openai" ? "/api/openai" : "/api/gemini";

  setLoading(true);
  let streamMsgId = modelMessageId;
  let simulatedStreamTimer = null;

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
      } catch (e) {
        console.error("Failed to parse error response:", e);
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
        citations: null,
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
    const convIdForSync = newConvId;

    let flushScheduled = false;
    let hasReceivedContent = false;
    let isSearching = false;
    let searchQuery = null;
    let searchResults = null;
    let citations = null;

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

    // 模拟流式输出：控制文本逐步显示
    const SIMULATED_STREAM_INTERVAL = 8; // 每8ms显示一批字符
    const SIMULATED_STREAM_BATCH = 3; // 每批显示3个字符

    const flushStreamingMessage = () => {
      flushScheduled = false;
      setMessages((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) return prev;

        const lastIdx = prev.length - 1;
        const isLast = prev[lastIdx]?.id === streamMsgId;
        const idx = isLast ? lastIdx : prev.findIndex((m) => m?.id === streamMsgId);
        if (idx < 0) return prev;

        const base = prev[idx];
        const nowHasContent = displayedText.length > 0 || fullThought.length > 0 || isSearching;
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
          thought: fullThought,
          isThinkingStreaming: !thinkingEnded,
          isWaitingFirstChunk: !hasReceivedContent,
          isSearching,
          searchQuery,
          searchResults,
          citations,
        };
        if (
          base.content === nextMsg.content &&
          base.thought === nextMsg.thought &&
          base.isThinkingStreaming === nextMsg.isThinkingStreaming &&
          base.isWaitingFirstChunk === nextMsg.isWaitingFirstChunk &&
          base.isSearching === nextMsg.isSearching &&
          base.searchQuery === nextMsg.searchQuery &&
          base.searchResults === nextMsg.searchResults &&
          base.citations === nextMsg.citations
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

    // 启动模拟流式输出定时器
    const startSimulatedStream = () => {
      if (simulatedStreamTimer) return;
      simulatedStreamTimer = setInterval(() => {
        // 检查是否已中止，如果已中止则立即停止定时器
        if (signal?.aborted) {
          clearInterval(simulatedStreamTimer);
          simulatedStreamTimer = null;
          return;
        }
        if (displayedText.length < fullText.length) {
          const remaining = fullText.length - displayedText.length;
          const batchSize = Math.min(SIMULATED_STREAM_BATCH, remaining);
          displayedText = fullText.slice(0, displayedText.length + batchSize);
          scheduleFlush();
        } else if (sawDone && displayedText.length >= fullText.length) {
          clearInterval(simulatedStreamTimer);
          simulatedStreamTimer = null;
        }
      }, SIMULATED_STREAM_INTERVAL);
    };

    const applyEventPayload = (payload) => {
      const p = payload.trim();
      if (!p) return;
      if (p === "[DONE]") {
        sawDone = true;
        isSearching = false;
        // Gemini 模型返回日志
        if (provider === "gemini") {
          console.log("[Gemini 返回完成]", { fullText, fullThought, citations });
        }
        return;
      }
      try {
        const data = JSON.parse(p);
        // Gemini 模型返回日志
        if (provider === "gemini") {
          console.log("[Gemini 返回]", data);
        }
        if (data.type === "thought") {
          fullThought += data.content;
        } else if (data.type === "text") {
          fullText += data.content;
          if (!thinkingEnded) thinkingEnded = true;
          isSearching = false;
          // 启动模拟流式输出
          startSimulatedStream();
        } else if (data.type === "search_start") {
          isSearching = true;
          if (typeof data.query === "string" && data.query.trim()) {
            searchQuery = data.query.trim();
          }
        } else if (data.type === "search_result") {
          isSearching = false;
          if (typeof data.query === "string" && data.query.trim()) {
            searchQuery = data.query.trim();
          }
          searchResults = data.results;
        } else if (data.type === "citations") {
          citations = data.citations;
        }
      } catch {
        // ignore
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

    // 等待模拟流式输出完成
    const waitForSimulatedStream = () => {
      return new Promise((resolve) => {
        const checkComplete = () => {
          // 如果已中止，立即完成
          if (signal?.aborted) {
            if (simulatedStreamTimer) {
              clearInterval(simulatedStreamTimer);
              simulatedStreamTimer = null;
            }
            resolve();
            return;
          }
          if (displayedText.length >= fullText.length) {
            if (simulatedStreamTimer) {
              clearInterval(simulatedStreamTimer);
              simulatedStreamTimer = null;
            }
            // 确保显示完整内容
            displayedText = fullText;
            flushStreamingMessage();
            resolve();
          } else {
            setTimeout(checkComplete, 20);
          }
        };
        // 如果已中止、没有内容或者没有启动定时器，直接完成
        if (signal?.aborted || fullText.length === 0 || !simulatedStreamTimer) {
          if (simulatedStreamTimer) {
            clearInterval(simulatedStreamTimer);
            simulatedStreamTimer = null;
          }
          if (!signal?.aborted) {
            displayedText = fullText;
            flushStreamingMessage();
          }
          resolve();
        } else {
          checkComplete();
        }
      });
    };

    await waitForSimulatedStream();

    const isGeminiRefusal =
      provider === "gemini" &&
      !signal?.aborted &&
      sawDone &&
      fullText.trim() === "" &&
      fullThought.trim() === "" &&
      (!citations || citations.length === 0);

    if (isGeminiRefusal) {
    const convIdForSync = newConvId;
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
        } catch (syncErr) {
          console.error("Failed to rollback sensitive message:", syncErr);
        }
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

          setMessages((prev) => {
            const idx = prev.findIndex((m) => m?.id === streamMsgId);
            // 如果用户已经发了下一条消息，就不要覆盖，避免竞态把新消息"抹掉"
            if (idx !== -1 && idx !== prev.length - 1) return prev;
            if (lastModelLen(serverMessages) < lastModelLen(prev)) return prev;

            // 保留流式消息的 id，避免 MessageList key 变化导致整条气泡重新挂载（framer-motion 入场动画 => "闪一下"）
            if (streamMsgId != null) {
              const next = serverMessages.slice();
              for (let i = next.length - 1; i >= 0; i -= 1) {
                if (next[i]?.role === "model") {
                  next[i] = { ...next[i], id: streamMsgId };
                  break;
                }
              }

              // 同步上一条用户消息的 id，避免“上一条气泡”闪烁
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
    if (err?.name !== "AbortError") {
      console.error(err);
      // 根据错误类型给出准确的提示
      let errorMessage;
      const errMsg = err?.message;
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
      // 超时：回滚本次用户消息，避免"悬空提问"扰乱上下文
      if (errMsg === "API_TIMEOUT" && mode !== "regenerate") {
        const convIdForSync = newConvId;
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
        if (convIdForSync && Array.isArray(nextMessagesForSync)) {
          try {
            await fetch(`/api/conversations/${convIdForSync}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: nextMessagesForSync }),
              }
            );
          } catch (syncErr) {
            console.error("Failed to rollback user message:", syncErr);
          }
        }
      }
      // 通过回调通知错误（由调用方显示 toast）
      onError?.(errorMessage);
      streamMsgId = null;
    }
  } finally {
    // 清理定时器
    if (simulatedStreamTimer) {
      clearInterval(simulatedStreamTimer);
      simulatedStreamTimer = null;
    }
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

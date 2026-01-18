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
  claudeRoute,
}) {
  const cfg = {};
  cfg.thinkingLevel = thinkingLevel;
  cfg.maxTokens = maxTokens;
  cfg.budgetTokens = budgetTokens;
  cfg.webSearch = webSearch === true;
  cfg.claudeRoute = claudeRoute || "primary";

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
}) {
  const historyPayload = historyMessages.map((m) => ({
    role: m.role,
    content: m.content,
    image: m.image || null,
    images: m.images || null,
    mimeType: m.mimeType || null,
    parts: m.parts || null,
  }));

  const payload = {
    prompt,
    model,
    config,
    history: historyPayload,
    historyLimit,
    conversationId,
    ...(mode ? { mode } : {}),
    ...(mode === "regenerate" ? { messages: messagesForRegenerate || [] } : {}),
    ...(!conversationId && settings ? { settings } : {}),
  };

  // 根据 provider 选择 API 端点
  const apiEndpoint = provider === "claude" ? "/api/claude" : provider === "openai" ? "/api/openai" : "/api/gemini";

  setLoading(true);
  let streamMsgId = null;
  let simulatedStreamTimer = null;

  // 构建 Claude 路由参数
  const claudeRouteLevel = provider === "claude" && config?.claudeRoute && config.claudeRoute !== "primary"
    ? config.claudeRoute
    : null;

  // 如果指定了线路，添加到 payload
  const finalPayload = claudeRouteLevel
    ? { ...payload, routeLevel: claudeRouteLevel }
    : payload;

  try {
    const res = await fetch(apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalPayload),
      signal,
    });

    if (!res.ok) {
      let errorMessage = res.statusText;
      try {
        const errorData = await res.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (e) {
        console.error("Failed to parse error response:", e);
      }
      throw new Error(errorMessage);
    }


    const newConvId = res.headers.get("X-Conversation-Id");
    if (newConvId && !currentConversationId) {
      setCurrentConversationId(newConvId);
      fetchConversations();
    }

    streamMsgId = Date.now();
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
    const convIdForSync = newConvId || currentConversationId || conversationId;

    let flushScheduled = false;
    let hasReceivedContent = false;
    let isSearching = false;
    let searchResults = null;
    let citations = null;

    // Claude 超时检测：有图片时30秒，否则15秒
    let claudeTimeoutId = null;
    let claudeTimedOut = false;
    if (provider === "claude") {
      // 检查当前请求是否包含图片
      const hasImages = config?.images?.length > 0;
      const timeoutMs = hasImages ? 30000 : 15000;
      claudeTimeoutId = setTimeout(() => {
        if (!hasReceivedContent) {
          claudeTimedOut = true;
          reader.cancel();
        }
      }, timeoutMs);
    }

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

        const base = prev[idx] || {};
        const nowHasContent = displayedText.length > 0 || fullThought.length > 0 || isSearching;
        if (nowHasContent && !hasReceivedContent) {
          hasReceivedContent = true;
          // 收到内容，清除 Claude 超时定时器
          if (claudeTimeoutId) {
            clearTimeout(claudeTimeoutId);
            claudeTimeoutId = null;
          }
        }
        const nextMsg = {
          ...base,
          content: displayedText,
          thought: fullThought,
          isThinkingStreaming: !thinkingEnded,
          isWaitingFirstChunk: !hasReceivedContent,
          isSearching,
          searchResults,
          citations,
        };
        if (
          base.content === nextMsg.content &&
          base.thought === nextMsg.thought &&
          base.isThinkingStreaming === nextMsg.isThinkingStreaming &&
          base.isWaitingFirstChunk === nextMsg.isWaitingFirstChunk &&
          base.isSearching === nextMsg.isSearching &&
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
      const p = (payload ?? "").trim();
      if (!p) return;
      if (p === "[DONE]") {
        sawDone = true;
        isSearching = false;
        return;
      }
      try {
        const data = JSON.parse(p);
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
        } else if (data.type === "search_result") {
          isSearching = false;
          searchResults = data.results || [];
        } else if (data.type === "citations") {
          citations = data.citations || [];
        }
      } catch {
        // ignore
      }
    };

    const consumeSseBuffer = (final = false) => {
      // 兼容 \n\n 和 \r\n\r\n 的分隔
      const blocks = buffer.split(/\r?\n\r?\n/);
      if (!final) buffer = blocks.pop() || "";
      else buffer = "";

      for (const block of blocks) {
        const trimmedBlock = (block ?? "").trim();
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
      // 检查 Claude 超时
      if (claudeTimedOut) {
        throw new Error("CLAUDE_TIMEOUT");
      }
      if (value) buffer += decoder.decode(value, { stream: true });
      consumeSseBuffer(false);

      if (signal?.aborted) break;
      scheduleFlush();
    }

    // 检查 Claude 超时（在循环结束后再检查一次）
    if (claudeTimedOut) {
      throw new Error("CLAUDE_TIMEOUT");
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
              if (arr[i]?.role === "model") return (arr[i]?.content || "").length;
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
                  return next;
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
      // Claude 超时：显示特定错误提示
      const errorMessage = err?.message === "CLAUDE_TIMEOUT"
        ? "服务暂不可用，请尝试在设置中切换线路"
        : "Error: " + err.message;
      setMessages((prev) => [
        ...prev,
        { role: "model", content: errorMessage, type: "error" },
      ]);
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
          msg.id === streamMsgId ? { ...msg, isStreaming: false } : msg,
        ),
      );
    }
    setLoading(false);
  }
}



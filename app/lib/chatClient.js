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

// Claude 路由记忆状态（每个会话独立）
// key: conversationId, value: { routeLevel: number, roundCount: number }
const claudeRouteMemory = new Map();
const CLAUDE_ROUTE_RESET_ROUNDS = 5; // 每5轮对话重置为主线路

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

  // Claude 备用路由超时配置（15秒无响应切换备用线路）
  const CLAUDE_FALLBACK_TIMEOUT_MS = 15000;

  setLoading(true);
  let streamMsgId = null;
  let simulatedStreamTimer = null;

  // Claude 请求封装：支持三级路由超时切换（主线路 → 备用线路 → 保障线路）
  // routeLevel: 0=主线路, 1=备用线路, 2=保障线路
  let finalRouteLevel = 0; // 记录最终使用的路由级别
  const fetchWithClaudeRoute = async (routeLevel = 0) => {
    const routeNames = ["主线路", "备用线路 AIGOCODE", "保障线路 AIHUBMIX"];
    const routeParams = [null, "fallback", "guarantee"];
    const maxRouteLevel = 2; // 最多三级路由

    let hasReceivedAnyData = false;
    const routeController = new AbortController();
    const combinedSignal = signal;

    // 监听外部 abort signal
    const onExternalAbort = () => {
      routeController.abort();
    };
    if (combinedSignal) {
      combinedSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    // 设置超时定时器（仅非保障线路需要）
    let timeoutId = null;
    let timeoutPromise = null;
    if (routeLevel < maxRouteLevel) {
      timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (!hasReceivedAnyData) {
            routeController.abort();
            reject(new Error("CLAUDE_ROUTE_TIMEOUT"));
          }
        }, CLAUDE_FALLBACK_TIMEOUT_MS);
      });
    }

    // 构建请求 payload，添加路由级别参数
    const routePayload = routeLevel === 0
      ? payload
      : { ...payload, routeLevel: routeParams[routeLevel] };

    try {
      const fetchPromise = (async () => {
        const res = await fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(routePayload),
          signal: routeController.signal,
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
        // 包装 response，添加数据接收检测
        const originalReader = res.body.getReader();
        const wrappedStream = new ReadableStream({
          async pull(controller) {
            try {
              const { value, done } = await originalReader.read();
              if (done) {
                controller.close();
                return;
              }
              // 收到任何数据就标记并清除超时
              hasReceivedAnyData = true;
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
              controller.enqueue(value);
            } catch (err) {
              controller.error(err);
            }
          },
          cancel() {
            originalReader.cancel();
          }
        });
        // 记录成功使用的路由级别
        finalRouteLevel = routeLevel;
        return new Response(wrappedStream, {
          headers: res.headers,
          status: res.status,
          statusText: res.statusText
        });
      })();

      const res = timeoutPromise
        ? await Promise.race([fetchPromise, timeoutPromise])
        : await fetchPromise;
      if (timeoutId) clearTimeout(timeoutId);
      if (combinedSignal) combinedSignal.removeEventListener("abort", onExternalAbort);
      return res;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (combinedSignal) combinedSignal.removeEventListener("abort", onExternalAbort);

      // 检查是否是超时触发的切换
      const isTimeout = err.message === "CLAUDE_ROUTE_TIMEOUT" ||
        (err.name === "AbortError" && !hasReceivedAnyData && !combinedSignal?.aborted);

      if (isTimeout && routeLevel < maxRouteLevel) {
        const nextLevel = routeLevel + 1;
        console.log(`[Claude] ${routeNames[routeLevel]} 15s 无响应，切换${routeNames[nextLevel]}...`);
        return fetchWithClaudeRoute(nextLevel);
      }
      throw err;
    }
  };

  const fetchWithClaudeFallback = async () => {
    if (provider !== "claude") {
      // 非 Claude 直接使用原逻辑
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
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          console.error("Failed to parse error response:", e);
        }
        throw new Error(errorMessage);
      }
      return res;
    }

    // Claude：检查路由记忆
    const convId = conversationId || currentConversationId;
    let startRouteLevel = 0;

    if (convId && claudeRouteMemory.has(convId)) {
      const memory = claudeRouteMemory.get(convId);
      // 每5轮重置为主线路
      if (memory.roundCount >= CLAUDE_ROUTE_RESET_ROUNDS) {
        console.log(`[Claude] 已达 ${CLAUDE_ROUTE_RESET_ROUNDS} 轮，重新尝试主线路`);
        claudeRouteMemory.delete(convId);
      } else {
        startRouteLevel = memory.routeLevel;
        if (startRouteLevel > 0) {
          const routeNames = ["主线路", "备用线路 AIGOCODE", "保障线路 AIHUBMIX"];
          console.log(`[Claude] 继续使用${routeNames[startRouteLevel]} (第 ${memory.roundCount + 1}/${CLAUDE_ROUTE_RESET_ROUNDS} 轮)`);
        }
      }
    }

    const res = await fetchWithClaudeRoute(startRouteLevel);

    // 更新路由记忆
    const finalConvId = res.headers.get("X-Conversation-Id") || convId;
    if (finalConvId && finalRouteLevel > 0) {
      const existing = claudeRouteMemory.get(finalConvId);
      claudeRouteMemory.set(finalConvId, {
        routeLevel: finalRouteLevel,
        roundCount: (existing?.roundCount || 0) + 1
      });
    } else if (finalConvId && finalRouteLevel === 0 && claudeRouteMemory.has(finalConvId)) {
      // 主线路成功，清除记忆
      claudeRouteMemory.delete(finalConvId);
    }

    return res;
  };

  try {
    const res = await fetchWithClaudeFallback();

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
        if (nowHasContent && !hasReceivedContent) hasReceivedContent = true;
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
      if (value) buffer += decoder.decode(value, { stream: true });
      consumeSseBuffer(false);

      if (signal?.aborted) break;
      scheduleFlush();
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
      setMessages((prev) => [
        ...prev,
        { role: "model", content: "Error: " + err.message, type: "error" },
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



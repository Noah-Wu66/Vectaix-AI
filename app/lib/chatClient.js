export function buildChatConfig({
  model,
  thinkingLevel,
  aspectRatio,
  mediaResolution,
  systemPrompts,
  activePromptId,
  imageUrl,
}) {
  const cfg = {};
  if (model === "gemini-3-pro-image-preview") {
    cfg.imageConfig = { aspectRatio: aspectRatio, imageSize: "4K" };
  } else {
    cfg.thinkingLevel = thinkingLevel;
  }

  const activePrompt = systemPrompts.find((p) => p._id === activePromptId);
  if (activePrompt) cfg.systemPrompt = activePrompt.content;

  if (imageUrl) {
    cfg.image = { url: imageUrl };
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
}) {
  const historyPayload = historyMessages.map((m) => ({
    role: m.role,
    content: m.content,
    image: null,
  }));

  const payload = {
    prompt,
    model,
    config,
    history: historyPayload,
    historyLimit,
    conversationId,
  };

  setLoading(true);
  let streamMsgId = null;
  try {
    if (model === "gemini-3-pro-image-preview") {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.conversationId && !currentConversationId) {
        setCurrentConversationId(data.conversationId);
        fetchConversations();
      }

      if (data.type !== "parts" || !Array.isArray(data.parts)) {
        throw new Error("Unexpected response");
      }

      const textContent = data.parts
        .map((p) => (p && typeof p.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("");
      setMessages((prev) => [
        ...prev,
        { role: "model", type: "parts", parts: data.parts, content: textContent },
      ]);
      return;
    }

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) throw new Error(res.statusText);

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
        thought: "",
      },
    ]);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let fullText = "";
    let fullThought = "";
    let buffer = "";
    let thinkingEnded = false;
    let sawDone = false;
    const convIdForSync = newConvId || currentConversationId || conversationId;

    let flushScheduled = false;
    const flushStreamingMessage = () => {
      flushScheduled = false;
      setMessages((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) return prev;

        const lastIdx = prev.length - 1;
        const isLast = prev[lastIdx]?.id === streamMsgId;
        const idx = isLast ? lastIdx : prev.findIndex((m) => m?.id === streamMsgId);
        if (idx < 0) return prev;

        const base = prev[idx] || {};
        const nextMsg = { ...base, content: fullText, thought: fullThought, isThinkingStreaming: !thinkingEnded };
        if (base.content === nextMsg.content && base.thought === nextMsg.thought && base.isThinkingStreaming === nextMsg.isThinkingStreaming) {
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
      const p = (payload ?? "").trim();
      if (!p) return;
      if (p === "[DONE]") {
        sawDone = true;
        return;
      }
      try {
        const data = JSON.parse(p);
        if (data.type === "thought") {
          fullThought += data.content;
        } else if (data.type === "text") {
          fullText += data.content;
          if (!thinkingEnded) thinkingEnded = true;
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
    flushStreamingMessage();

    // 流式结束后做一次“最终对齐”：移动端偶发断流/缓冲时，避免必须刷新才能看到完整内容
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
            // 如果用户已经发了下一条消息，就不要覆盖，避免竞态把新消息“抹掉”
            if (idx !== -1 && idx !== prev.length - 1) return prev;
            return lastModelLen(serverMessages) >= lastModelLen(prev) ? serverMessages : prev;
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



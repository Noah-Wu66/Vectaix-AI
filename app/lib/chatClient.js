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

      if (data.type === "parts" && Array.isArray(data.parts)) {
        const textContent = data.parts
          .map((p) => (p && typeof p.text === "string" ? p.text : ""))
          .filter(Boolean)
          .join("");
        setMessages((prev) => [
          ...prev,
          { role: "model", type: "parts", parts: data.parts, content: textContent },
        ]);
      } else if (data.type === "image") {
        // Legacy fallback
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            content: data.data,
            mimeType: data.mimeType,
            type: "image",
          },
        ]);
      } else {
        // Legacy fallback
        setMessages((prev) => [
          ...prev,
          { role: "model", content: data.content, type: "text" },
        ]);
      }
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

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (!value) continue;

      if (signal?.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      
      // SSE 格式: "data: {...}\n\n"
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const trimmed = event.trim();
        if (!trimmed) continue;
        
        // 提取 data: 后的内容
        const dataMatch = trimmed.match(/^data:\s*(.+)$/s);
        if (!dataMatch) continue;
        
        const payload = dataMatch[1].trim();
        if (payload === "[DONE]") continue;
        
        try {
          const data = JSON.parse(payload);
          if (data.type === "thought") {
            fullThought += data.content;
          } else if (data.type === "text") {
            fullText += data.content;
            if (!thinkingEnded) thinkingEnded = true;
          }
        } catch {
          // 忽略解析错误（可能是填充空格）
        }
      }

      if (signal?.aborted) break;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamMsgId
            ? { ...msg, content: fullText, thought: fullThought, isThinkingStreaming: !thinkingEnded }
            : msg,
        ),
      );
    }

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === streamMsgId ? { ...msg, isStreaming: false } : msg,
      ),
    );
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



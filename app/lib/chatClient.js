export function buildChatConfig({
  model,
  thinkingLevel,
  aspectRatio,
  mediaResolution,
  systemPrompts,
  activePromptId,
  imageUrl,
}) {
  if (model === "gemini-3-pro-image-preview") {
    return { imageConfig: { aspectRatio: aspectRatio, imageSize: "4K" } };
  }

  const cfg = { thinkingLevel };

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

      if (data.type === "image") {
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
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (data.type === "thought") {
          fullThought += data.content;
        } else if (data.type === "text") {
          fullText += data.content;
          if (!thinkingEnded) thinkingEnded = true;
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



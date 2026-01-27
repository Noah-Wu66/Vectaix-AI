import { upload } from "@vercel/blob/client";
import { buildChatConfig, runChat } from "./chatClient";
import { getMessageImageSrcs, isDataImageUrl, isHttpUrl } from "./messageImage";

let msgIdCounter = 0;
const generateMsgId = () => `msg_${Date.now()}_${++msgIdCounter}`;

export function createChatAppActions({
  toast,
  messages,
  setMessages,
  loading,
  setLoading,
  model,
  thinkingLevels,
  mediaResolution,
  systemPrompts,
  activePromptId,
  maxTokens,
  budgetTokens,
  webSearch,
  historyLimit,
  currentConversationId,
  setCurrentConversationId,
  fetchConversations,
  currentModelConfig,
  chatAbortRef,
  chatRequestLockRef,
  userInterruptedRef,
  editingMsgIndex,
  editingContent,
  editingImageAction,
  editingImage,
  setEditingMsgIndex,
  setEditingContent,
  setEditingImageAction,
  setEditingImage,
}) {
  const stopStreaming = () => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatRequestLockRef.current = false;
    setLoading(false);
    setMessages((prev) => prev
      .filter((m) => !m.isStreaming || (m.content || "").trim() || (m.thought || "").trim())
      .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  };

  const onEditingImageSelect = (img) => {
    setEditingImageAction("new");
    setEditingImage(img || null);
  };

  const onEditingImageRemove = () => {
    setEditingImageAction("remove");
    setEditingImage(null);
  };

  const onEditingImageKeep = () => {
    setEditingImageAction("keep");
    setEditingImage(null);
  };

  const copyMessage = async (content) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (e) {
      console.error("复制失败", e);
    }
  };

  const syncConversationMessages = async (nextMessages) => {
    if (!currentConversationId) return;
    try {
      await fetch(`/api/conversations/${currentConversationId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextMessages }),
        }
      );
    } catch (e) {
      console.error(e);
    }
  };

  const deleteModelMessage = async (index) => {
    const nextMessages = messages.filter((_, i) => i !== index);
    setMessages(nextMessages);
    await syncConversationMessages(nextMessages);
  };

  const deleteUserMessage = async (index) => {
    const nextMessages = messages.filter(
      (_, i) => i !== index && i !== index + 1,
    );
    setMessages(nextMessages);
    await syncConversationMessages(nextMessages);
  };

  const handleSendFromComposer = async ({ text, images }) => {
    if ((!text && (!images || images.length === 0)) || loading || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;

    userInterruptedRef.current = false;

    const firstImagePreview = images?.[0]?.preview || null;

    const userMsg = {
      id: generateMsgId(),
      role: "user",
      content: text,
      type: "text",
      image: firstImagePreview,
      images: images?.map((img) => img.preview) || [],
    };

    const historyBeforeUser = messages;
    setMessages((prev) => [...prev, userMsg]);

    setLoading(true);
    try {
      const imageUrls = [];
      if (images && images.length > 0) {
        for (const image of images) {
          if (image?.file) {
            const blob = await upload(image.file.name, image.file, {
              access: "public",
              handleUploadUrl: "/api/upload",
            });
            imageUrls.push(blob.url);
          }
        }
      }

      if (imageUrls.length > 0) {
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            const m = next[i];
            if (m?.role === "user" && m?.id === userMsg.id) {
              next[i] = {
                ...m,
                image: imageUrls[0] || null,
                images: imageUrls,
              };
              break;
            }
          }
          return next;
        });
      }

      const config = buildChatConfig({
        model,
        thinkingLevel: thinkingLevels?.[model],
        mediaResolution,
        systemPrompts,
        activePromptId,
        imageUrl: imageUrls[0] || null,
        imageUrls: imageUrls.length > 0 ? imageUrls : null,
        maxTokens,
        budgetTokens,
        webSearch: (model?.startsWith("claude-") || model?.startsWith("gpt-") || model?.startsWith("gemini-")) ? webSearch : false,
      });

      await runChat({
        prompt: text,
        historyMessages: historyBeforeUser,
        conversationId: currentConversationId,
        model,
        config,
        historyLimit,
        currentConversationId,
        setCurrentConversationId,
        fetchConversations,
        setMessages,
        setLoading,
        signal: (chatAbortRef.current = new AbortController()).signal,
        provider: currentModelConfig?.provider,
        settings: !currentConversationId ? {
          thinkingLevel: thinkingLevels?.[model] || null,
          historyLimit,
          maxTokens,
          budgetTokens,
          activePromptId: activePromptId != null ? String(activePromptId) : null,
        } : undefined,
        onError: (msg) => toast.error(msg),
      });
    } catch (err) {
      console.error(err);
      const errMsg = err?.message || "发送失败";
      const friendlyMsg = errMsg.includes("Failed to fetch") ? "网络连接失败，请检查网络后重试" : errMsg;
      toast.error(friendlyMsg);
      setLoading(false);
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const regenerateModelMessage = async (index) => {
    if (loading || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    const userMsgIndex = index - 1;
    if (userMsgIndex < 0 || messages[userMsgIndex]?.role !== "user") {
      chatRequestLockRef.current = false;
      return;
    }

    userInterruptedRef.current = false;

    const userMsg = messages[userMsgIndex];
    const historyWithUser = messages.slice(0, index);
    setMessages(historyWithUser);

    const config = buildChatConfig({
      model,
      thinkingLevel: thinkingLevels?.[model],
      mediaResolution,
      systemPrompts,
      activePromptId,
      maxTokens,
      budgetTokens,
      webSearch: (model?.startsWith("claude-") || model?.startsWith("gpt-") || model?.startsWith("gemini-")) ? webSearch : false,
    });

    try {
      await runChat({
        prompt: userMsg.content,
        historyMessages: historyWithUser.slice(0, -1),
        conversationId: currentConversationId,
        model,
        config,
        historyLimit,
        currentConversationId,
        setCurrentConversationId,
        fetchConversations,
        setMessages,
        setLoading,
        signal: (chatAbortRef.current = new AbortController()).signal,
        mode: "regenerate",
        messagesForRegenerate: historyWithUser,
        provider: currentModelConfig?.provider,
        onError: (msg) => toast.error(msg),
      });
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const startEdit = (index, msg) => {
    if (loading) return;
    setEditingMsgIndex(index);
    setEditingContent(msg?.content || "");
    setEditingImageAction("keep");
    setEditingImage(null);
  };

  const cancelEdit = () => {
    setEditingMsgIndex(null);
    setEditingContent("");
    setEditingImageAction("keep");
    setEditingImage(null);
  };

  const submitEditAndRegenerate = async (index) => {
    if (loading || editingMsgIndex === null || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    const newContent = editingContent.trim();
    const oldMsg = messages[index];
    const existingImageSrcs = getMessageImageSrcs(oldMsg);
    const canKeepExistingImages = existingImageSrcs.length > 0 && existingImageSrcs.every((src) => isHttpUrl(src) || isDataImageUrl(src));
    const hasImageAfterEdit =
      (editingImageAction === "new" && editingImage?.file) ||
      (editingImageAction === "keep" && canKeepExistingImages);
    if (!newContent && !hasImageAfterEdit) {
      chatRequestLockRef.current = false;
      return;
    }

    userInterruptedRef.current = false;
    setLoading(true);

    const nextMessages = messages.slice(0, index);
    const updatedMsg = { ...oldMsg, content: newContent };

    let nextImageUrls = [];
    let nextMimeType = null;
    try {
      if (editingImageAction === "remove") {
        nextImageUrls = [];
      } else if (editingImageAction === "new" && editingImage?.file) {
        const blob = await upload(editingImage.file.name, editingImage.file, {
          access: "public",
          handleUploadUrl: "/api/upload",
        });
        nextImageUrls = [blob.url];
        nextMimeType = editingImage.mimeType || editingImage.file.type || null;
      } else if (editingImageAction === "keep") {
        if (typeof oldMsg?.mimeType === "string" && oldMsg.mimeType) nextMimeType = oldMsg.mimeType;

        for (const src of existingImageSrcs) {
          if (isHttpUrl(src)) {
            nextImageUrls.push(src);
          } else if (isDataImageUrl(src)) {
            const resp = await fetch(src);
            const b = await resp.blob();
            const mime = b.type || nextMimeType || "image/png";
            const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
            const file = new File([b], `edit-${Date.now()}-${nextImageUrls.length}.${ext}`, { type: mime });
            const uploaded = await upload(file.name, file, {
              access: "public",
              handleUploadUrl: "/api/upload",
            });
            nextImageUrls.push(uploaded.url);
            if (!nextMimeType) nextMimeType = mime;
          }
        }
      }

      const parts = [];
      if (newContent) parts.push({ text: newContent });
      for (const imgUrl of nextImageUrls) {
        const inlineData = { url: imgUrl };
        if (nextMimeType) inlineData.mimeType = nextMimeType;
        parts.push({ inlineData });
      }

      if (parts.length > 0) updatedMsg.parts = parts;
      else delete updatedMsg.parts;

      if (nextImageUrls.length > 0) {
        updatedMsg.image = nextImageUrls[0];
        updatedMsg.images = nextImageUrls;
      } else {
        delete updatedMsg.image;
        delete updatedMsg.images;
      }

      if (nextMimeType) updatedMsg.mimeType = nextMimeType;
      else if (editingImageAction === "remove") delete updatedMsg.mimeType;
    } catch (e) {
      console.error(e);
      chatRequestLockRef.current = false;
      setLoading(false);
      const errMsg = e?.message || "图片处理失败";
      const friendlyMsg = errMsg.includes("Failed to fetch") ? "网络连接失败，请检查网络后重试" : `图片上传失败：${errMsg}`;
      toast.error(friendlyMsg);
      return;
    }
    nextMessages.push(updatedMsg);
    setMessages(nextMessages);
    cancelEdit();

    const config = buildChatConfig({
      model,
      thinkingLevel: thinkingLevels?.[model],
      mediaResolution,
      systemPrompts,
      activePromptId,
      maxTokens,
      budgetTokens,
      webSearch: (model?.startsWith("claude-") || model?.startsWith("gpt-") || model?.startsWith("gemini-")) ? webSearch : false,
    });

    try {
      await runChat({
        prompt: newContent,
        historyMessages: nextMessages.slice(0, -1),
        conversationId: currentConversationId,
        model,
        config,
        historyLimit,
        currentConversationId,
        setCurrentConversationId,
        fetchConversations,
        setMessages,
        setLoading,
        signal: (chatAbortRef.current = new AbortController()).signal,
        mode: "regenerate",
        messagesForRegenerate: nextMessages,
        provider: currentModelConfig?.provider,
        onError: (msg) => toast.error(msg),
      });
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  return {
    stopStreaming,
    onEditingImageSelect,
    onEditingImageRemove,
    onEditingImageKeep,
    copyMessage,
    deleteModelMessage,
    deleteUserMessage,
    handleSendFromComposer,
    regenerateModelMessage,
    startEdit,
    cancelEdit,
    submitEditAndRegenerate,
  };
}

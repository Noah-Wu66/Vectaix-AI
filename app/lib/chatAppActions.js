import { upload } from "@vercel/blob/client";
import { buildChatConfig, runChat, unlockCompletionSound } from "./chatClient";
import { isDataImageUrl, isHttpUrl } from "./messageImage";

let msgIdCounter = 0;
const generateMsgId = () => `msg_${Date.now()}_${++msgIdCounter}`;
const SEED_MODEL_ID = "volcengine/doubao-seed-2.0-pro";

function getSeedThinkingLevelByBudget(budgetTokens) {
  const budget = Number(budgetTokens);
  if (budget <= 4000) return "low";
  if (budget <= 16000) return "medium";
  return "high";
}

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
  completionSoundVolume,
  lineMode,
  onSensitiveRefusal,
  onConversationActivity,
}) {
  const getEffectiveThinkingLevel = (m) => {
    if (m === SEED_MODEL_ID) {
      return getSeedThinkingLevelByBudget(budgetTokens);
    }
    const v = thinkingLevels?.[m];
    if (typeof v === "string" && v) return v;
    return undefined;
  };

  const stopStreaming = () => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatRequestLockRef.current = false;
    setLoading(false);
    setMessages((prev) => prev.filter((m) => !m.isStreaming));
  };

  const onEditingImageSelect = (img) => {
    setEditingImageAction("new");
    setEditingImage(img);
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
    } catch { }
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
    } catch { }
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

    if (currentConversationId) {
      onConversationActivity?.(currentConversationId);
    }

    unlockCompletionSound();

    userInterruptedRef.current = false;

    const userMsgParts = [];
    if (typeof text === "string" && text) {
      userMsgParts.push({ text });
    }
    if (Array.isArray(images) && images.length > 0) {
      for (const img of images) {
        const url = img?.preview;
        const mimeType = img?.file?.type;
        if (typeof url === "string" && url && typeof mimeType === "string" && mimeType) {
          userMsgParts.push({ inlineData: { url, mimeType } });
        }
      }
    }

    const userMsg = {
      id: generateMsgId(),
      role: "user",
      content: text,
      type: "parts",
      parts: userMsgParts,
    };

    const historyBeforeUser = messages;
    setMessages((prev) => [...prev, userMsg]);

    setLoading(true);
    try {
      const imageUrls = [];
      const imageMimeTypes = [];
      if (images && images.length > 0) {
        for (const image of images) {
          if (image?.file) {
            const blob = await upload(image.file.name, image.file, {
              access: "public",
              handleUploadUrl: "/api/upload",
              clientPayload: JSON.stringify({ kind: "chat" }),
            });
            imageUrls.push(blob.url);
            imageMimeTypes.push(image.file.type);
          }
        }
      }

      if (imageUrls.length > 0) {
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            const m = next[i];
            if (m?.role === "user" && m?.id === userMsg.id) {
              const nextParts = [];
              if (typeof text === "string" && text) {
                nextParts.push({ text });
              }
              for (let j = 0; j < imageUrls.length; j += 1) {
                const url = imageUrls[j];
                const mimeType = imageMimeTypes[j];
                if (typeof url === "string" && url && typeof mimeType === "string" && mimeType) {
                  nextParts.push({ inlineData: { url, mimeType } });
                }
              }
              next[i] = { ...m, parts: nextParts };
              break;
            }
          }
          return next;
        });
      }

      const config = buildChatConfig({
        thinkingLevel: getEffectiveThinkingLevel(model),
        mediaResolution,
        systemPrompts,
        activePromptId,
        imageUrls,
        maxTokens,
        budgetTokens,
        webSearch: webSearch,
        lineMode,
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
        userMessageId: userMsg.id,
        settings: !currentConversationId ? {
          thinkingLevel: getEffectiveThinkingLevel(model),
          historyLimit,
          maxTokens,
          budgetTokens,
          activePromptId: activePromptId != null ? String(activePromptId) : null,
        } : undefined,
        completionSoundVolume,
        onSensitiveRefusal,
        onError: (msg) => toast.error(msg),
      });
    } catch (err) {
      const errMsg = err?.message;
      const friendlyMsg = errMsg?.includes("Failed to fetch") ? "网络连接失败，请检查网络后重试" : errMsg;
      toast.error(friendlyMsg);
      setLoading(false);
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const regenerateModelMessage = async (index) => {
    if (loading || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    unlockCompletionSound();
    const userMsgIndex = index - 1;
    if (userMsgIndex < 0 || messages[userMsgIndex]?.role !== "user") {
      chatRequestLockRef.current = false;
      return;
    }

    userInterruptedRef.current = false;

    const userMsg = messages[userMsgIndex];
    const messagesBeforeRegenerate = messages.slice();
    const historyWithUser = messages.slice(0, index);
    setMessages(historyWithUser);

    const config = buildChatConfig({
      thinkingLevel: getEffectiveThinkingLevel(model),
      mediaResolution,
      systemPrompts,
      activePromptId,
      maxTokens,
      budgetTokens,
      webSearch: webSearch,
      lineMode,
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
        completionSoundVolume,
        refusalRestoreMessages: messagesBeforeRegenerate,
        onSensitiveRefusal,
        onError: (msg) => toast.error(msg),
      });
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const startEdit = (index, msg) => {
    if (loading) return;
    setEditingMsgIndex(index);
    setEditingContent(msg?.content);
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
    unlockCompletionSound();
    const newContent = editingContent.trim();
    const oldMsg = messages[index];
    const messagesBeforeEdit = messages.slice();
    const existingImageParts = Array.isArray(oldMsg?.parts)
      ? oldMsg.parts.filter((p) => typeof p?.inlineData?.url === "string" && p.inlineData.url)
      : [];
    const canKeepExistingImages = existingImageParts.length > 0 && existingImageParts.every((p) => {
      const url = p?.inlineData?.url;
      const mimeType = p?.inlineData?.mimeType;
      return (isHttpUrl(url) || isDataImageUrl(url)) && typeof mimeType === "string" && Boolean(mimeType);
    });
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

    let nextImageParts = [];
    try {
      if (editingImageAction === "remove") {
        nextImageParts = [];
      } else if (editingImageAction === "new" && editingImage?.file) {
        const blob = await upload(editingImage.file.name, editingImage.file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({ kind: "chat" }),
        });
        const mimeType = typeof editingImage.mimeType === "string" ? editingImage.mimeType : "";
        if (!mimeType) throw new Error("图片 mimeType 缺失");
        nextImageParts = [{ inlineData: { url: blob.url, mimeType } }];
      } else if (editingImageAction === "keep") {
        for (const p of existingImageParts) {
          const src = p?.inlineData?.url;
          const mimeType = typeof p?.inlineData?.mimeType === "string" ? p.inlineData.mimeType : "";
          if (!src || !mimeType) continue;

          if (isHttpUrl(src)) {
            nextImageParts.push({ inlineData: { url: src, mimeType } });
            continue;
          }

          if (isDataImageUrl(src)) {
            const resp = await fetch(src);
            const b = await resp.blob();
            const mime = b.type || mimeType;
            if (!mime) throw new Error("图片 mimeType 缺失");
            const ext = mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
            const file = new File([b], `edit-${Date.now()}-${nextImageParts.length}.${ext}`, { type: mime });
            const uploaded = await upload(file.name, file, {
              access: "public",
              handleUploadUrl: "/api/upload",
              clientPayload: JSON.stringify({ kind: "chat" }),
            });
            nextImageParts.push({ inlineData: { url: uploaded.url, mimeType: mime } });
          }
        }
      }

      const parts = [];
      if (newContent) parts.push({ text: newContent });
      for (const part of nextImageParts) {
        if (part?.inlineData?.url && part?.inlineData?.mimeType) {
          parts.push({ inlineData: { url: part.inlineData.url, mimeType: part.inlineData.mimeType } });
        }
      }

      if (parts.length > 0) updatedMsg.parts = parts;
      else delete updatedMsg.parts;

    } catch (e) {
      chatRequestLockRef.current = false;
      setLoading(false);
      const errMsg = e?.message;
      const friendlyMsg = errMsg.includes("Failed to fetch") ? "网络连接失败，请检查网络后重试" : `图片上传失败：${errMsg}`;
      toast.error(friendlyMsg);
      return;
    }
    nextMessages.push(updatedMsg);
    setMessages(nextMessages);
    cancelEdit();

    const config = buildChatConfig({
      thinkingLevel: getEffectiveThinkingLevel(model),
      mediaResolution,
      systemPrompts,
      activePromptId,
      maxTokens,
      budgetTokens,
      webSearch: webSearch,
      lineMode,
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
        completionSoundVolume,
        refusalRestoreMessages: messagesBeforeEdit,
        onSensitiveRefusal,
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

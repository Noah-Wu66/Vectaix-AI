import { upload } from "@vercel/blob/client";
import { buildChatConfig, runChat, unlockCompletionSound } from "@/lib/client/chat/chatClient";
import { apiJson } from "@/lib/client/apiClient";
import { isDataImageUrl, isHttpUrl } from "@/lib/shared/messageImage";
import { createAttachmentDescriptor } from "@/lib/shared/attachments";
import { isImageAttachment } from "@/lib/shared/messageAttachments";
import {
  AGENT_MODEL_ID,
  COUNCIL_MAX_ROUNDS,
  SEED_MODEL_ID,
  countCompletedCouncilRounds,
  isCouncilModel,
} from "@/lib/shared/models";

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
  onSensitiveRefusal,
  onAuthExpired,
  onConversationMissing,
  onConversationActivity,
}) {
  const isCouncilConversation = isCouncilModel(model);

  const getEffectiveThinkingLevel = (m) => {
    if (m === SEED_MODEL_ID) {
      const v = thinkingLevels?.[m];
      return typeof v === "string" && v ? v : "high";
    }
    const v = thinkingLevels?.[m];
    if (typeof v === "string" && v) return v;
    return undefined;
  };

  const buildRuntimeConfig = ({ imageUrls = [], images = [], attachments = [] } = {}) => {
    if (isCouncilConversation) {
      return buildChatConfig({
        mediaResolution,
        imageUrls,
        images,
        attachments,
      });
    }
    return buildChatConfig({
      thinkingLevel: getEffectiveThinkingLevel(model),
      mediaResolution,
      systemPrompts,
      activePromptId,
      imageUrls,
      images,
      attachments,
      maxTokens,
      webSearch,
    });
  };

  const stopStreaming = () => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatRequestLockRef.current = false;
    setLoading(false);
    setMessages((prev) => prev.filter((m) => !m.isStreaming));
  };

  const onEditingImageSelect = (img) => {
    const uploadId = `edit-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setEditingImageAction("new");
    setEditingImage({
      ...img,
      uploadId,
      uploadStatus: "uploading",
      blobUrl: null,
      errorMessage: "",
    });

    upload(img.file.name, img.file, {
      access: "public",
      handleUploadUrl: "/api/upload",
      clientPayload: JSON.stringify({
        kind: "chat",
        model,
        originalName: img.file.name,
        declaredMimeType: img.file.type || img.mimeType,
      }),
    }).then((blob) => {
      setEditingImage((prev) => (
        prev?.uploadId === uploadId
          ? { ...prev, uploadStatus: "ready", blobUrl: blob.url, errorMessage: "" }
          : prev
      ));
    }).catch((error) => {
      setEditingImage((prev) => (
        prev?.uploadId === uploadId
          ? { ...prev, uploadStatus: "error", blobUrl: null, errorMessage: error?.message || "未知错误" }
          : prev
      ));
      toast.error(`图片上传失败：${error?.message || "未知错误"}`);
    });
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

  const getCouncilRoundStartIndex = (index) => {
    if (!Array.isArray(messages) || index < 0 || index >= messages.length) return -1;
    const current = messages[index];
    if (current?.role === "user") return index;
    if (current?.role === "model" && index > 0 && messages[index - 1]?.role === "user") {
      return index - 1;
    }
    return -1;
  };

  const deleteModelMessage = async (index) => {
    const nextMessages = isCouncilConversation
      ? (() => {
          const roundStart = getCouncilRoundStartIndex(index);
          return roundStart >= 0 ? messages.slice(0, roundStart) : messages;
        })()
      : messages.filter((_, i) => i !== index);
    setMessages(nextMessages);
    await syncConversationMessages(nextMessages);
  };

  const deleteUserMessage = async (index) => {
    const nextMessages = isCouncilConversation
      ? (() => {
          const roundStart = getCouncilRoundStartIndex(index);
          return roundStart >= 0 ? messages.slice(0, roundStart) : messages;
        })()
      : messages.filter(
          (_, i) => i !== index && i !== index + 1,
        );
    setMessages(nextMessages);
    await syncConversationMessages(nextMessages);
  };

  const handleSendFromComposer = async ({ text, attachments }) => {
    if ((!text && (!attachments || attachments.length === 0)) || loading || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    const isCouncil = isCouncilConversation;

    if (isCouncil && countCompletedCouncilRounds(messages) >= COUNCIL_MAX_ROUNDS) {
      toast.warning(`Council 最多支持 ${COUNCIL_MAX_ROUNDS} 轮对话，请新建对话继续。`);
      chatRequestLockRef.current = false;
      return;
    }

    if (currentConversationId) {
      onConversationActivity?.(currentConversationId);
    }

    unlockCompletionSound();
    userInterruptedRef.current = false;

    const uploadedImages = [];
    const uploadedFiles = [];
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const attachment of attachments) {
        const fileName = attachment?.name || attachment?.file?.name || "文件";
        const blobUrl = typeof attachment?.blobUrl === "string" ? attachment.blobUrl : "";

        if (!blobUrl) {
          toast.error(`「${fileName}」还没上传完成，已跳过`);
          continue;
        }

        if (isImageAttachment(attachment)) {
          const mimeType = attachment?.file?.type || attachment?.mimeType;
          if (typeof mimeType === "string" && mimeType) {
            uploadedImages.push({ url: blobUrl, mimeType });
          }
          continue;
        }

        uploadedFiles.push(createAttachmentDescriptor({
          url: blobUrl,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          extension: attachment.extension,
          category: attachment.category,
        }));
      }
    }

    const userMsgParts = [];
    if (typeof text === "string" && text) {
      userMsgParts.push({ text });
    }
    for (const image of uploadedImages) {
      if (image?.url && image?.mimeType) {
        userMsgParts.push({ inlineData: { url: image.url, mimeType: image.mimeType } });
      }
    }
    for (const file of uploadedFiles) {
      if (file?.url && file?.name && file?.mimeType && file?.extension && file?.category) {
        userMsgParts.push({ fileData: file });
      }
    }

    if (userMsgParts.length === 0) {
      setLoading(false);
      chatRequestLockRef.current = false;
      return;
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
      const config = buildRuntimeConfig({ images: uploadedImages, attachments: uploadedFiles });

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
        settings: !currentConversationId && !isCouncil ? {
          webSearch,
          activePromptId: activePromptId != null ? String(activePromptId) : null,
        } : undefined,
        completionSoundVolume,
        onSensitiveRefusal,
        onUnauthorized: onAuthExpired,
        onConversationMissing,
        onError: (msg) => toast.error(msg),
      });
    } catch (err) {
      const errMsg = err?.message;
      const friendlyMsg = errMsg?.includes("Failed to fetch")
        ? "网络连接失败，请检查网络后重试"
        : `发送失败：${errMsg || "未知错误"}`;
      toast.error(friendlyMsg);
      setLoading(false);
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const regenerateModelMessage = async (index) => {
    if (model === AGENT_MODEL_ID) {
      toast.error("Agent 模式不支持重新生成");
      return;
    }
    if (loading || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    unlockCompletionSound();

    const userMsgIndex = isCouncilConversation ? getCouncilRoundStartIndex(index) : index - 1;
    if (userMsgIndex < 0 || messages[userMsgIndex]?.role !== "user") {
      chatRequestLockRef.current = false;
      return;
    }

    userInterruptedRef.current = false;

    const userMsg = messages[userMsgIndex];
    const messagesBeforeRegenerate = messages.slice();
    const historyWithUser = isCouncilConversation
      ? messages.slice(0, userMsgIndex + 1)
      : messages.slice(0, index);
    setMessages(historyWithUser);

    const config = buildRuntimeConfig();

    try {
      await runChat({
        prompt: userMsg.content || "",
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
        onUnauthorized: onAuthExpired,
        onConversationMissing,
        onError: (msg) => toast.error(msg),
      });
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const continueAgentRun = async (index) => {
    if (loading || chatRequestLockRef.current) return;
    const message = messages?.[index];
    const agentRun = message?.agentRun;
    if (!agentRun?.runId || !currentConversationId) return;

    chatRequestLockRef.current = true;
    unlockCompletionSound();

    const config = buildRuntimeConfig();

    try {
      syncLocalAgentMessage(message.id, {
        isStreaming: true,
        isThinkingStreaming: true,
        isWaitingFirstChunk: false,
        isSearching: false,
        searchError: null,
        agentRun: {
          status: "running",
          executionState: "running",
          canResume: false,
          currentStep: "继续执行中",
        },
      });
      await runChat({
        prompt: "",
        historyMessages: messages,
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
        completionSoundVolume,
        runId: agentRun.runId,
        resume: true,
        mode: "continue",
        targetMessageId: message.id,
        onSensitiveRefusal,
        onUnauthorized: onAuthExpired,
        onConversationMissing,
        onError: (msg) => toast.error(msg),
      });
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const syncLocalAgentMessage = (messageId, patch = {}) => {
    setMessages((prev) => prev.map((msg) => {
      if (msg?.id !== messageId) return msg;
      return {
        ...msg,
        ...patch,
        agentRun: {
          ...(msg?.agentRun || {}),
          ...(patch.agentRun || {}),
        },
      };
    }));
  };

  const approveAgentRun = async (index) => {
    if (loading || chatRequestLockRef.current) return;
    const message = messages?.[index];
    const agentRun = message?.agentRun;
    if (!agentRun?.runId) return;
    chatRequestLockRef.current = true;
    try {
      const data = await apiJson(`/api/agent/runs/${agentRun.runId}/action`, {
        method: "POST",
        body: { action: "approve" },
      });
      syncLocalAgentMessage(message.id, {
        content: data?.content || "审批已通过，任务将继续执行。",
        parts: [{ text: data?.content || "审批已通过，任务将继续执行。" }],
        agentRun: data?.run || {
          ...agentRun,
          status: "waiting_continue",
          executionState: "waiting_continue",
          canResume: true,
          approvalStatus: "approved",
        },
      });
    } catch (error) {
      toast.error(error?.message || "审批失败");
    } finally {
      chatRequestLockRef.current = false;
    }
  };

  const rejectAgentRun = async (index) => {
    const message = messages?.[index];
    const agentRun = message?.agentRun;
    if (!agentRun?.runId) return;
    try {
      const data = await apiJson(`/api/agent/runs/${agentRun.runId}/action`, {
        method: "POST",
        body: { action: "reject" },
      });
      syncLocalAgentMessage(message.id, {
        content: data?.content || "你已拒绝继续执行，本次任务已结束。",
        parts: [{ text: data?.content || "你已拒绝继续执行，本次任务已结束。" }],
        agentRun: data?.run || {
          ...agentRun,
          status: "cancelled",
          executionState: "cancelled",
          canResume: false,
          approvalStatus: "rejected",
        },
      });
    } catch (error) {
      toast.error(error?.message || "拒绝失败");
    }
  };

  const cancelAgentRun = async (index) => {
    const message = messages?.[index];
    const agentRun = message?.agentRun;
    if (!agentRun?.runId) return;
    try {
      const data = await apiJson(`/api/agent/runs/${agentRun.runId}/action`, {
        method: "POST",
        body: { action: "cancel" },
      });
      syncLocalAgentMessage(message.id, {
        content: data?.content || "任务已取消。",
        parts: [{ text: data?.content || "任务已取消。" }],
        agentRun: data?.run || {
          ...agentRun,
          status: "cancelled",
          executionState: "cancelled",
          canResume: false,
        },
      });
    } catch (error) {
      toast.error(error?.message || "取消失败");
    }
  };

  const startEdit = (index, msg) => {
    if (model === AGENT_MODEL_ID) {
      toast.error("Agent 模式不支持编辑并重新生成");
      return;
    }
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
    if (model === AGENT_MODEL_ID) {
      toast.error("Agent 模式不支持编辑并重新生成");
      return;
    }
    if (loading || editingMsgIndex === null || chatRequestLockRef.current) return;
    chatRequestLockRef.current = true;
    unlockCompletionSound();
    const newContent = editingContent.trim();
    if (editingImageAction === "new" && editingImage?.uploadStatus === "uploading") {
      chatRequestLockRef.current = false;
      toast.warning("图片还在上传，请稍等上传完成后再提交");
      return;
    }
    if (editingImageAction === "new" && editingImage?.uploadStatus === "error") {
      chatRequestLockRef.current = false;
      toast.error(`图片上传失败：${editingImage?.errorMessage || "未知错误"}`);
      return;
    }
    const oldMsg = messages[index];
    const messagesBeforeEdit = messages.slice();
    const existingImageParts = Array.isArray(oldMsg?.parts)
      ? oldMsg.parts.filter((p) => typeof p?.inlineData?.url === "string" && p.inlineData.url)
      : [];
    const existingFileParts = Array.isArray(oldMsg?.parts)
      ? oldMsg.parts.filter((p) => p?.fileData?.url && p?.fileData?.name)
      : [];
    const canKeepExistingImages = existingImageParts.length > 0 && existingImageParts.every((p) => {
      const url = p?.inlineData?.url;
      const mimeType = p?.inlineData?.mimeType;
      return (isHttpUrl(url) || isDataImageUrl(url)) && typeof mimeType === "string" && Boolean(mimeType);
    });
    const hasImageAfterEdit =
      (editingImageAction === "new" && editingImage?.file) ||
      (editingImageAction === "keep" && canKeepExistingImages);
    const hasFileAfterEdit = existingFileParts.length > 0;
    if (!newContent && !hasImageAfterEdit && !hasFileAfterEdit) {
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
        const blobUrl = typeof editingImage?.blobUrl === "string" ? editingImage.blobUrl : "";
        const mimeType = typeof editingImage.mimeType === "string" ? editingImage.mimeType : "";
        if (!blobUrl || !mimeType) throw new Error("图片还没上传完成");
        nextImageParts = [{ inlineData: { url: blobUrl, mimeType } }];
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
      for (const part of existingFileParts) {
        if (part?.fileData?.url && part?.fileData?.name) {
          parts.push({
            fileData: {
              url: part.fileData.url,
              name: part.fileData.name,
              mimeType: part.fileData.mimeType,
              size: Number(part.fileData.size) || 0,
              extension: part.fileData.extension,
              category: part.fileData.category,
              formatSummary: typeof part.fileData.formatSummary === "string" ? part.fileData.formatSummary : "",
              visualAssetCount: Number(part.fileData.visualAssetCount) || 0,
            },
          });
        }
      }

      if (parts.length > 0) updatedMsg.parts = parts;
      else delete updatedMsg.parts;
    } catch (e) {
      chatRequestLockRef.current = false;
      setLoading(false);
      const errMsg = e?.message || "未知错误";
      const friendlyMsg = errMsg.includes("Failed to fetch") ? "网络连接失败，请检查网络后重试" : `图片上传失败：${errMsg}`;
      toast.error(friendlyMsg);
      return;
    }

    nextMessages.push(updatedMsg);
    setMessages(nextMessages);
    cancelEdit();

    const config = buildRuntimeConfig();

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
        onUnauthorized: onAuthExpired,
        onConversationMissing,
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
    continueAgentRun,
    approveAgentRun,
    rejectAgentRun,
    cancelAgentRun,
    startEdit,
    cancelEdit,
    submitEditAndRegenerate,
  };
}

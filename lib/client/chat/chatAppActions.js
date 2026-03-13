import { upload } from "@vercel/blob/client";
import { buildChatConfig, runChat, unlockCompletionSound } from "@/lib/client/chat/chatClient";
import { apiJson } from "@/lib/client/apiClient";
import { isDataImageUrl, isHttpUrl } from "@/lib/shared/messageImage";
import { createAttachmentDescriptor } from "@/lib/shared/attachments";
import { isImageAttachment } from "@/lib/shared/messageAttachments";
import {
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

    const userMsgParts = [];
    if (typeof text === "string" && text) {
      userMsgParts.push({ text });
    }
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const item of attachments) {
        if (isImageAttachment(item)) {
          const url = item?.preview;
          const mimeType = item?.file?.type || item?.mimeType;
          if (typeof url === "string" && url && typeof mimeType === "string" && mimeType) {
            userMsgParts.push({ inlineData: { url, mimeType } });
          }
          continue;
        }
        const descriptor = createAttachmentDescriptor({
          url: `local://${item?.id || Date.now()}`,
          name: item?.name,
          mimeType: item?.mimeType,
          size: item?.size,
          extension: item?.extension,
          category: item?.category,
        });
        if (descriptor.name && descriptor.mimeType && descriptor.extension && descriptor.category) {
          userMsgParts.push({ fileData: descriptor });
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
      const uploadedImages = [];
      const preparedAttachments = [];

      // 检测是否包含需要解析的文档附件（上传已在 Composer 中完成）
      const hasDocAttachments = attachments && attachments.length > 0 && attachments.some((a) => a?.file && !isImageAttachment(a));
      const prepareMsgId = hasDocAttachments ? generateMsgId() : null;

      // 辅助函数：更新临时进度消息的 thinkingTimeline
      const updatePrepareTimeline = (updater) => {
        if (!prepareMsgId) return;
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === prepareMsgId);
          if (idx < 0) return prev;
          const next = [...prev];
          const msg = next[idx];
          const oldTimeline = Array.isArray(msg.thinkingTimeline) ? msg.thinkingTimeline : [];
          next[idx] = { ...msg, thinkingTimeline: updater(oldTimeline) };
          return next;
        });
      };

      if (hasDocAttachments) {
        // 插入临时 model 消息，展示文件解析进度
        setMessages((prev) => [
          ...prev,
          {
            id: prepareMsgId,
            role: "model",
            content: "",
            type: "text",
            isStreaming: true,
            isThinkingStreaming: true,
            isWaitingFirstChunk: false,
            thought: "",
            isSearching: false,
            searchQuery: null,
            searchResults: null,
            thinkingTimeline: [],
            citations: null,
            searchError: null,
          },
        ]);
      }

      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          if (!attachment?.file) continue;
          const fileName = attachment.file.name || "文件";

          if (isImageAttachment(attachment)) {
            // 图片：仍然在发送时上传（体积小，速度快）
            const blob = await upload(attachment.file.name, attachment.file, {
              access: "public",
              handleUploadUrl: "/api/upload",
              clientPayload: JSON.stringify({
                kind: "chat",
                model,
                originalName: attachment.file.name,
                declaredMimeType: attachment.file.type || attachment.mimeType,
              }),
            });
            uploadedImages.push({
              url: blob.url,
              mimeType: attachment.file.type || attachment.mimeType,
            });
            continue;
          }

          // 文档附件：使用 Composer 中已上传好的 blobUrl
          const blobUrl = attachment.blobUrl;
          if (!blobUrl) {
            toast.error(`「${fileName}」未完成上传，已跳过`);
            continue;
          }

          // 显示解析步骤
          const parseStepId = `parse_${Date.now()}_${Math.random()}`;
          updatePrepareTimeline((prev) => [
            ...prev,
            { id: parseStepId, kind: "parse", status: "running", title: `正在解析「${fileName}」`, message: `正在解析「${fileName}」`, synthetic: false },
          ]);

          const prepared = await apiJson("/api/files/prepare", {
            method: "POST",
            body: {
              url: blobUrl,
              model,
            },
          });

          // 标记解析完成
          updatePrepareTimeline((prev) =>
            prev.map((s) => (s.id === parseStepId ? { ...s, status: "done", title: `「${fileName}」已解析`, message: `「${fileName}」已解析` } : s))
          );

          if (prepared?.file) {
            preparedAttachments.push(prepared.file);
          }
        }
      }

      // 移除临时进度消息，后续由 runChat 创建真正的流式消息
      if (prepareMsgId) {
        setMessages((prev) => prev.filter((m) => m.id !== prepareMsgId));
      }

      if (uploadedImages.length > 0 || preparedAttachments.length > 0) {
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            const m = next[i];
            if (m?.role === "user" && m?.id === userMsg.id) {
              const nextParts = [];
              if (typeof text === "string" && text) {
                nextParts.push({ text });
              }
              for (const image of uploadedImages) {
                const url = image?.url;
                const mimeType = image?.mimeType;
                if (typeof url === "string" && url && typeof mimeType === "string" && mimeType) {
                  nextParts.push({ inlineData: { url, mimeType } });
                }
              }
              for (const file of preparedAttachments) {
                if (file?.url && file?.name && file?.mimeType && file?.extension && file?.category) {
                  nextParts.push({ fileData: file });
                }
              }
              next[i] = { ...m, parts: nextParts };
              break;
            }
          }
          return next;
        });
      }

      const config = buildRuntimeConfig({ images: uploadedImages, attachments: preparedAttachments });

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
      // 确保异常时也清除临时进度消息
      if (prepareMsgId) {
        setMessages((prev) => prev.filter((m) => m.id !== prepareMsgId));
      }
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

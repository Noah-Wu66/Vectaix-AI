"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown,
  Copy,
  Download,
  Edit3,
  Paperclip,
  RotateCcw,
  Trash2,
  Type,
  User,
  X,
} from "lucide-react";
import Markdown from "./Markdown";
import ThinkingBlock from "./ThinkingBlock";
import ImageLightbox from "./ImageLightbox";
import ConfirmModal from "./ConfirmModal";
import { useToast } from "./ToastProvider";
import { exportMessageContent } from "@/lib/client/messageExport";
import { getMessageImageSrc, isKeepableImageSrc } from "@/lib/shared/messageImage";
import { getMessageFileAttachments } from "@/lib/shared/messageAttachments";
import {
  AttachmentCard,
  AIAvatar,
  ResponsiveAIAvatar,
  buildCopyText,
  buildPlainText,
  normalizeCopiedText,
  isSelectionFullyInsideElement,
  Thumb,
  Citations,
  LoadingSweepText,
} from "./MessageListHelpers";
import { AGENT_MODEL_ID, CHAT_MODELS, getModelConfig, isCouncilModel } from "@/lib/shared/models";

const AGENT_MIN_TOTAL_STEPS = 9;

function containsMarkdownTable(text) {
  if (typeof text !== "string") return false;
  const normalized = text.replace(/\r\n/g, "\n");
  return /\|.*\|[\t ]*\n[\t ]*\|?[\t ]*:?-{3,}:?[\t ]*(\|[\t ]*:?-{3,}:?[\t ]*)+\|?/u.test(normalized);
}

export default function MessageList({
  messages,
  loading,
  chatEndRef,
  listRef,
  onScroll,
  editingMsgIndex,
  editingContent,
  editingImageAction,
  editingImage,
  fontSizeClass,
  model,
  modelReady = true,
  onEditingContentChange,
  onEditingImageSelect,
  onEditingImageRemove,
  onEditingImageKeep,
  onCancelEdit,
  onSubmitEdit,
  onCopy,
  onDeleteModelMessage,
  onDeleteUserMessage,
  onRegenerateModelMessage,
  onContinueAgentRun,
  onApproveAgentRun,
  onRejectAgentRun,
  onStartEdit,
  userAvatar,
}) {
  const editTextareaRef = useRef(null);
  const editFileInputRef = useRef(null);
  const exportMenuRef = useRef(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, index: null, role: null });
  const [openExportMenuIndex, setOpenExportMenuIndex] = useState(null);
  const prevMessagesRef = useRef([]);
  const isCouncilConversation = isCouncilModel(model);
  const isAgentConversation = model === AGENT_MODEL_ID;
  const canEditImages = getModelConfig(model)?.supportsImages === true;
  const toast = useToast();

  useEffect(() => {
    prevMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!exportMenuRef.current?.contains(event.target)) {
        setOpenExportMenuIndex(null);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpenExportMenuIndex(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    setOpenExportMenuIndex(null);
  }, [messages]);

  const isNewMessage = (msg, index) => {
    const prevMsgs = prevMessagesRef.current;
    return !prevMsgs[index] || prevMsgs[index].id !== msg.id;
  };

  const openLightbox = (src) => {
    if (!src) return;
    setLightboxSrc(src);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    setLightboxSrc(null);
  };

  const handleDeleteClick = (index, role) => {
    setDeleteConfirm({ open: true, index, role });
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm.index !== null) {
      if (deleteConfirm.role === "user") {
        onDeleteUserMessage(deleteConfirm.index);
      } else {
        onDeleteModelMessage(deleteConfirm.index);
      }
    }
    setDeleteConfirm({ open: false, index: null, role: null });
  };

  const handleEditFileSelect = (e) => {
    if (!canEditImages) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onEditingImageSelect?.({
        file,
        preview: ev.target?.result,
        name: file.name,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const hasEditingImage = () => {
    if (editingImageAction === "new") return Boolean(editingImage?.preview);
    if (editingImageAction === "keep") {
      const msg = messages?.[editingMsgIndex];
      return isKeepableImageSrc(getMessageImageSrc(msg));
    }
    return false;
  };

  const isEditingImageUploading = editingImageAction === "new" && editingImage?.uploadStatus === "uploading";

  const resizeEditTextarea = () => {
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
  };

  const scrollEditIntoView = () => {
    const el = editTextareaRef.current;
    const container = listRef?.current;
    if (!el) return;
    // 优先只滚动消息列表容器，避免移动端键盘弹出时把整个页面滚飞
    if (container && typeof container.scrollTo === "function") {
      const elRect = el.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      const delta = elRect.top - (cRect.top + cRect.height / 2);
      container.scrollTo({ top: container.scrollTop + delta, behavior: "auto" });
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "auto" });
  };

  useEffect(() => {
    if (editingMsgIndex === null || editingMsgIndex === undefined) return;
    const el = editTextareaRef.current;
    resizeEditTextarea();
    // 用 preventScroll 阻止浏览器为 focus 自己滚动（移动端键盘弹出时最容易乱跳）
    if (el && typeof el.focus === "function") {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }
    // 首次对齐 + 等键盘/viewport 完成一次布局后再对齐一次
    requestAnimationFrame(scrollEditIntoView);
    const t = setTimeout(scrollEditIntoView, 80);
    return () => clearTimeout(t);
  }, [editingMsgIndex]);

  useEffect(() => {
    if (editingMsgIndex === null || editingMsgIndex === undefined) return;
    resizeEditTextarea();
  }, [editingContent, editingMsgIndex]);

  // 键盘弹出会触发 visualViewport resize；编辑中跟随一次，避免“必须按键才回正”
  useEffect(() => {
    if (editingMsgIndex === null || editingMsgIndex === undefined) return;
    const vv = window.visualViewport;
    if (!vv?.addEventListener) return;
    const onResize = () => requestAnimationFrame(scrollEditIntoView);
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [editingMsgIndex]);

  const handleBubbleCopy = (e) => {
    const el = e.currentTarget;
    if (!el) return;
    if (!isSelectionFullyInsideElement(el)) return;

    const selText = window.getSelection?.()?.toString?.();
    if (!selText) return;

    e.preventDefault();
    e.clipboardData?.setData("text/plain", normalizeCopiedText(selText));
  };

  const handleExportMessage = async (format, msg) => {
    const labelMap = {
      markdown: "Markdown",
      pdf: "PDF",
      docx: "Docx",
    };

    try {
      await exportMessageContent(format, buildCopyText(msg));
      toast.success(`已导出 ${labelMap[format] || "文件"}`);
    } catch (error) {
      toast.error(error?.message || "导出失败");
    } finally {
      setOpenExportMenuIndex(null);
    }
  };

  return (
    <div
      ref={listRef}
      onScroll={onScroll}
      className={`flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-4 space-y-4 scroll-smooth custom-scrollbar mobile-scroll ${fontSizeClass}`}
    >
      <ImageLightbox open={lightboxOpen} onClose={closeLightbox} src={lightboxSrc} />

      <ConfirmModal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, index: null, role: null })}
        onConfirm={handleConfirmDelete}
        title="删除消息"
        message={isCouncilConversation ? "确定要从这一轮开始删除吗？此操作会删除这一轮及其后所有轮次，无法撤销。" : `确定要删除这条${deleteConfirm.role === "user" ? "你的" : "AI"}消息吗？此操作无法撤销。`}
        confirmText="删除"
        danger
      />

      {messages.length === 0 ? (
        loading ? (
          // 加载历史会话时的居中加载动画
          <div className="h-full flex flex-col items-center justify-center">
            <div className="flex items-center gap-1.5 px-4 py-3 bg-zinc-100 rounded-2xl">
              <LoadingSweepText text="加载中" className="text-base" />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400">
            <>
              <div className="mb-4">
                {modelReady ? (
                  <AIAvatar model={model} size={40} animate={model === AGENT_MODEL_ID} />
                ) : (
                  <div className="h-10 w-10 rounded-md bg-zinc-100" aria-hidden />
                )}
              </div>
              <p className="font-medium">开始新对话</p>
            </>
          </div>
        )
      ) : (
        messages.map((msg, i) => {
          const hasParts = Array.isArray(msg.parts) && msg.parts.length > 0;
          const hasTableContent = (
            (typeof msg.content === "string" && containsMarkdownTable(msg.content))
            || (hasParts && msg.parts.some((part) => containsMarkdownTable(part?.text)))
          );
          const hasBodyOutput =
            (typeof msg.content === "string" && msg.content.trim().length > 0)
            || (hasParts && msg.parts.some((part) => part && typeof part.text === "string" && part.text.trim().length > 0));
          const hasThinkingTimeline = Array.isArray(msg.thinkingTimeline)
            && msg.thinkingTimeline.some((step) => step?.kind === "search" || step?.kind === "sandbox" || step?.kind === "thought" || step?.kind === "upload" || step?.kind === "parse" || step?.kind === "tool");
          const hasCouncilExpertStates = Array.isArray(msg.councilExpertStates) && msg.councilExpertStates.length > 0;
          const hasCouncilSummaryState = msg.councilSummaryState && typeof msg.councilSummaryState === "object";
          const chatRun = msg?.chatRun && typeof msg.chatRun === "object" ? msg.chatRun : null;
          const chatRunStatus = typeof chatRun?.status === "string" ? chatRun.status : "";
          const chatRunActive = chatRunStatus === "queued" || chatRunStatus === "running";
          const agentRun = msg?.agentRun && typeof msg.agentRun === "object" ? msg.agentRun : null;
          const agentCanResume = agentRun?.canResume === true && typeof agentRun?.runId === "string" && agentRun.runId;
          const agentExecutionState = typeof agentRun?.executionState === "string" ? agentRun.executionState : agentRun?.status;
          const agentNeedsApproval = agentExecutionState === "awaiting_approval";
          const agentIsRunning = Boolean(agentRun)
            && !agentNeedsApproval
            && agentExecutionState !== "waiting_continue"
            && agentRun?.status !== "failed"
            && agentRun?.status !== "cancelled"
            && agentRun?.status !== "completed";
          // 跳过等待首个内容且没有任何可显示内容的 model 消息（但搜索中的消息不跳过）
          if (msg.role === "model" && msg.isWaitingFirstChunk && !msg.thought && !msg.content && !hasParts && !msg.isSearching && !msg.searchError && !hasThinkingTimeline && !hasCouncilExpertStates && !hasCouncilSummaryState) {
            return null;
          }
          return (
            <motion.div
              key={msg.id}
              initial={isNewMessage(msg, i) ? { opacity: 0, y: 10 } : false}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col gap-1.5 ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              {msg.role === "user" && (
                <div className="flex items-center gap-1.5 flex-row-reverse">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center bg-zinc-100 text-zinc-600 overflow-hidden">
                    {userAvatar ? (
                      <img src={userAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User size={16} />
                    )}
                  </div>
                  <span className="text-xs text-zinc-400 font-medium">你</span>
                </div>
              )}
              {msg.role === "model" && (msg.thought || msg.content || (msg.isStreaming && !msg.isWaitingFirstChunk) || hasParts || msg.isSearching || msg.searchError || hasThinkingTimeline || hasCouncilExpertStates || hasCouncilSummaryState || chatRunActive) && (
                <div className="flex items-center gap-1.5">
                  <AIAvatar
                    model={model}
                    size={28}
                    animate={(isCouncilModel(model) && (msg.isStreaming || chatRunActive)) || (model === AGENT_MODEL_ID && agentIsRunning) || chatRunActive}
                  />
                  <span className="text-xs text-zinc-400 font-medium">
                    {CHAT_MODELS.find((m) => m.id === model)?.name}
                  </span>
                </div>
              )}

              <div
                className={`flex flex-col ${msg.role === "user"
                  ? "items-end w-full max-w-full"
                  : "items-start w-full max-w-full"
                  }`}
              >
                {msg.role === "model" && (msg.thought || msg.isSearching || msg.searchError || hasThinkingTimeline || hasCouncilExpertStates || hasCouncilSummaryState) && (
                  <ThinkingBlock
                    thought={msg.thought}
                    isStreaming={msg.isThinkingStreaming}
                    isSearching={msg.isSearching}
                    searchQuery={msg.searchQuery}
                    searchError={msg.searchError}
                    timeline={msg.thinkingTimeline}
                    councilExpertStates={msg.councilExpertStates}
                    councilSummaryState={msg.councilSummaryState}
                    councilExperts={msg.councilExperts}
                    bodyText={hasBodyOutput ? "1" : ""}
                    showThoughtDetails={!isAgentConversation && !isCouncilConversation}
                  />
                )}

                {msg.role === "model" && msg.isStreaming && !msg.isWaitingFirstChunk && !msg.isSearching && !msg.thought && !msg.content && !hasParts && !hasThinkingTimeline && !hasCouncilExpertStates && !hasCouncilSummaryState && (
                  <div className="flex min-w-[4.75rem] items-center justify-center px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-100 rounded-2xl">
                    <LoadingSweepText text="..." ariaText="等待响应" className="loading-sweep-dots text-lg sm:text-xl" />
                  </div>
                )}

                {/* 编辑模式 */}
                {editingMsgIndex === i && msg.role === "user" && !isAgentConversation ? (
                  <div className="w-full flex flex-col items-end gap-2">
                    {canEditImages && (
                      <input
                        type="file"
                        ref={editFileInputRef}
                        onChange={handleEditFileSelect}
                        className="hidden"
                        accept="image/*"
                      />
                    )}

                    {(() => {
                      const existing = getMessageImageSrc(msg);
                      const existingFiles = getMessageFileAttachments(msg);
                      const showSrc =
                        editingImageAction === "new"
                          ? editingImage?.preview
                          : editingImageAction === "keep"
                            ? existing
                            : null;
                      return showSrc || existingFiles.length > 0 ? (
                        <div className="flex w-full max-w-full flex-wrap justify-end gap-2 md:max-w-[900px] lg:max-w-[1000px]">
                          {showSrc ? <Thumb src={showSrc} onClick={openLightbox} /> : null}
                          {existingFiles.map((file) => (
                            <AttachmentCard key={file.url || file.name} file={file} compact />
                          ))}
                        </div>
                      ) : null;
                    })()}

                    {editingImageAction === "new" && editingImage?.uploadStatus === "uploading" ? (
                      <div className="w-full max-w-full text-right text-xs text-zinc-500 md:max-w-[900px] lg:max-w-[1000px]">图片上传中，上传完成后才能提交。</div>
                    ) : null}
                    {editingImageAction === "new" && editingImage?.uploadStatus === "error" ? (
                      <div className="w-full max-w-full text-right text-xs text-red-500 md:max-w-[900px] lg:max-w-[1000px]">图片上传失败，请重新选择。</div>
                    ) : null}

                    <div
                      className="msg-bubble inline-block w-full max-w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-zinc-800 md:max-w-[900px] lg:max-w-[1000px]"
                      style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                    >
                      <textarea
                        ref={editTextareaRef}
                        value={editingContent}
                        onChange={(e) => onEditingContentChange(e.target.value)}
                        onFocus={scrollEditIntoView}
                        onInput={resizeEditTextarea}
                        onKeyDown={(e) => {
                          // 桌面端：Enter 发送，Shift+Enter 换行
                          // 移动端：不拦截 Enter，避免 iOS 输入法换行按钮误触发送
                          if (e.key === "Enter" && !e.shiftKey) {
                            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                            if (!isMobile) {
                              e.preventDefault();
                              if (!loading && !isEditingImageUploading && (editingContent.trim() || hasEditingImage())) {
                                onSubmitEdit(i);
                              }
                            }
                          }
                        }}
                        className="block w-full max-h-[45vh] resize-none overflow-y-auto bg-transparent p-0 text-sm leading-6 text-zinc-800 outline-none mobile-scroll custom-scrollbar"
                        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                      />
                    </div>
                    <div className="flex w-full max-w-full flex-wrap justify-end gap-2 md:max-w-[900px] lg:max-w-[1000px]">
                      {canEditImages && (
                        <button
                          type="button"
                          onClick={() => editFileInputRef.current?.click()}
                          className="px-3 py-1.5 text-xs text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors inline-flex items-center gap-1"
                          title="添加/更换图片"
                        >
                          <Paperclip size={14} />
                          图片
                        </button>
                      )}

                      {(() => {
                        const existing = getMessageImageSrc(msg);
                        const hasExisting = isKeepableImageSrc(existing);
                        const hasNew = editingImageAction === "new" && Boolean(editingImage?.preview);
                        const showToggle =
                          editingImageAction === "remove" ? hasExisting : hasExisting || hasNew;
                        if (!showToggle) return null;

                        const label = editingImageAction === "remove" ? "恢复图片" : "移除图片";
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              if (editingImageAction === "remove") {
                                if (hasExisting) onEditingImageKeep?.();
                              } else {
                                onEditingImageRemove?.();
                              }
                              if (editFileInputRef.current) editFileInputRef.current.value = "";
                            }}
                            className="px-3 py-1.5 text-xs text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors inline-flex items-center gap-1"
                            title={label}
                          >
                            <X size={14} />
                            {label}
                          </button>
                        );
                      })()}

                      <button
                        onClick={onCancelEdit}
                        className="px-3 py-1.5 text-xs text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => onSubmitEdit(i)}
                        disabled={loading || isEditingImageUploading || (!editingContent.trim() && !hasEditingImage())}
                        className="px-3 py-1.5 text-xs text-white bg-zinc-600 hover:bg-zinc-500 disabled:opacity-50 rounded-lg transition-colors"
                      >
                        提交并重新生成
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {(hasParts || (typeof msg.content === "string" && msg.content.trim().length > 0)) && (
                    <div
                      className={`msg-bubble px-4 py-3 rounded-2xl overflow-hidden break-words ${msg.role === "user"
                          ? "bg-white border border-zinc-200 text-zinc-800 inline-block max-w-full md:max-w-[900px] lg:max-w-[1000px] max-h-[45vh] overflow-y-auto mobile-scroll custom-scrollbar"
                          : hasTableContent
                            ? "bg-zinc-100 text-zinc-800 inline-block max-w-full md:max-w-[980px] lg:max-w-[1180px] xl:max-w-[1320px]"
                            : "bg-zinc-100 text-zinc-800 inline-block max-w-full md:max-w-[900px] lg:max-w-[1000px]"
                          }`}
                        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                        onCopy={handleBubbleCopy}
                      >
                        {hasParts ? (
                          <div className="flex flex-col gap-2">
                            {(() => {
                              const entries = msg.parts.map((part, idx) => ({ part, idx }));
                              const isUser = msg.role === "user";
                              const imageEntries = entries.filter(({ part }) => {
                                const url = part?.inlineData?.url;
                                return typeof url === "string" && url;
                              });
                              const fileEntries = entries.filter(({ part }) => {
                                return part?.fileData?.name && part?.fileData?.mimeType;
                              });
                              const textEntries = entries.filter(({ part }) => {
                                return part && typeof part.text === "string" && part.text.trim();
                              });
                              const ordered = isUser ? [...imageEntries, ...fileEntries, ...textEntries] : entries;

                              return ordered.map(({ part, idx }) => {
                                const url = part?.inlineData?.url;
                                if (typeof url === "string" && url) {
                                  return <Thumb key={idx} src={url} className="w-fit" onClick={openLightbox} />;
                                }
                                if (part?.fileData?.name) {
                                  return <AttachmentCard key={idx} file={part.fileData} compact={msg.role === "user"} />;
                                }
                                if (part && typeof part.text === "string" && part.text.trim()) {
                                  return isUser ? (
                                    <Markdown key={idx} enableHighlight={false}>
                                      {part.text}
                                    </Markdown>
                                  ) : (
                                    <Markdown
                                      key={idx}
                                      enableHighlight={!msg.isStreaming}
                                    >
                                      {part.text}
                                    </Markdown>
                                  );
                                }
                                return null;
                              });
                            })()}
                          </div>
                        ) : (
                          msg.role === "user" ? (
                            <Markdown enableHighlight={false}>{msg.content}</Markdown>
                          ) : (
                            <Markdown enableHighlight={!msg.isStreaming}>{msg.content}</Markdown>
                          )
                        )}

                        {msg.role === "model" && !msg.isStreaming && msg.citations && (
                          <Citations citations={msg.citations} />
                        )}
                      </div>
                    )}
                    {/* 消息操作按钮 */}
                    {!msg.isStreaming && (
                      <div
                        className={`flex flex-wrap gap-1 mt-1 ${msg.role === "user" ? "flex-row-reverse" : ""
                          }`}
                      >
                        {(hasParts || (typeof msg.content === "string" && msg.content.trim().length > 0)) && (
                          <button
                            onClick={() => onCopy(buildCopyText(msg))}
                            className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                            title="复制"
                          >
                            <Copy size={14} />
                          </button>
                        )}

                        {msg.role === "model" && (hasParts || (typeof msg.content === "string" && msg.content.trim().length > 0)) && (
                          <button
                            onClick={() => onCopy(buildPlainText(msg))}
                            className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                            title="复制纯文本"
                          >
                            <Type size={14} />
                          </button>
                        )}

                        {msg.role === "user" ? (
                          <>
                            <button
                              onClick={() => handleDeleteClick(i, "user")}
                              className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-zinc-100 rounded-lg transition-colors"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                            {!isAgentConversation ? (
                              <button
                                onClick={() => onStartEdit(i, msg)}
                                className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                                title="编辑并重新生成"
                              >
                                <Edit3 size={14} />
                              </button>
                            ) : null}
                          </>
                        ) : msg.role === "model" ? (
                          <>
                            {agentNeedsApproval ? (
                              <button
                                type="button"
                                onClick={() => onApproveAgentRun?.(i)}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
                              >
                                批准继续
                              </button>
                            ) : null}
                            {agentNeedsApproval ? (
                              <button
                                type="button"
                                onClick={() => onRejectAgentRun?.(i)}
                                className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200"
                              >
                                拒绝
                              </button>
                            ) : null}
                            {agentCanResume ? (
                              <button
                                type="button"
                                onClick={() => onContinueAgentRun?.(i)}
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
                              >
                                继续执行
                              </button>
                            ) : null}
                            <button
                              onClick={() => handleDeleteClick(i, "model")}
                              className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-zinc-100 rounded-lg transition-colors"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                            {!isAgentConversation ? (
                              <button
                                onClick={() => onRegenerateModelMessage(i)}
                                disabled={loading}
                                className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
                                title="重新生成"
                              >
                                <RotateCcw size={14} />
                              </button>
                            ) : null}
                            {(hasParts || (typeof msg.content === "string" && msg.content.trim().length > 0)) && (
                              <div className="relative" ref={openExportMenuIndex === i ? exportMenuRef : null}>
                                <button
                                  type="button"
                                  onClick={() => setOpenExportMenuIndex((prev) => (prev === i ? null : i))}
                                  className={`inline-flex items-center gap-1 p-1.5 rounded-lg transition-colors ${openExportMenuIndex === i
                                    ? "text-zinc-700 bg-zinc-100"
                                    : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
                                    }`}
                                  title="导出"
                                >
                                  <Download size={14} />
                                  <ChevronDown size={12} className={`transition-transform ${openExportMenuIndex === i ? "rotate-180" : ""}`} />
                                </button>

                                {openExportMenuIndex === i && (
                                  <motion.div
                                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 6, scale: 0.96 }}
                                    className="absolute right-0 top-full z-20 mt-1 min-w-[150px] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg sm:left-full sm:right-auto sm:top-1/2 sm:mt-0 sm:ml-2 sm:-translate-y-1/2"
                                  >
                                    {[
                                      { key: "markdown", label: "导出 Markdown" },
                                      { key: "pdf", label: "导出 PDF" },
                                      { key: "docx", label: "导出 Docx" },
                                    ].map((item) => (
                                      <button
                                        key={item.key}
                                        type="button"
                                        onClick={() => handleExportMessage(item.key, msg)}
                                        className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                                      >
                                        {item.label}
                                      </button>
                                    ))}
                                  </motion.div>
                                )}
                              </div>
                            )}
                          </>
                        ) : null}
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          );
        })
      )}

      {/* 只在有消息且加载中且没有正在流式输出或搜索的消息时显示加载指示器 */}
      {messages.length > 0 && (loading || messages.some((m) => m.isWaitingFirstChunk)) && !messages.some((m) => (m.isStreaming && !m.isWaitingFirstChunk) || m.isSearching) && (
        <div className="flex gap-2 sm:gap-3 items-start">
          <ResponsiveAIAvatar
            model={model}
            mobileSize={22}
            desktopSize={28}
            animate={isCouncilModel(model) || model === AGENT_MODEL_ID}
          />
          <div className="flex min-w-[4.75rem] items-center justify-center px-3 sm:px-4 py-2.5 sm:py-3 bg-zinc-100 rounded-2xl">
            <LoadingSweepText text="..." ariaText="等待响应" className="loading-sweep-dots text-lg sm:text-xl" />
          </div>
        </div>
      )}

      <div ref={chatEndRef} />
    </div>
  );
}
